"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("./setup");
require("../db.js");
require("../local-api.js");
require("../local/store.js");
require("../local/staff.js");
require("../local/daily.js");
require("../local/tax-table-r8.js");
require("../local/payroll.js");
require("../local/payroll-admin.js");
require("../local/settings.js");
require("../local/export.js");

const XLSX = require("xlsx");

async function ensureStore(storeId, champagneMenu) {
  await createStore({ id: storeId, name: storeId + "店", champagne_menu: champagneMenu || [] }).catch(() => {});
}

async function ensureStaff(staff) {
  const existing = await dbGet("staff", staff.id);
  if (existing !== undefined) return existing;
  return createStaff(staff);
}

function sheetCell(ws, ref) {
  const cell = ws[ref];
  return cell ? cell.v : undefined;
}

// ─────────────────────────────────────────────────────────────────────
// buildDayLaborMap: ドリンク/シャンパン/交通費/ワンオペ手当/新設インセンティブ
// ─────────────────────────────────────────────────────────────────────
test("buildDayLaborMap: 時給スタッフのドリンクバック・交通費を日別人件費に反映する", async () => {
  const storeId = "exp-labor-a";
  await ensureStore(storeId);
  await ensureStaff({
    id: "exp-labor-a-staff1", name: "スタッフ1", store_id: storeId,
    pay_type: "hourly", hourly_rate: 1200, transport_one_way: 500,
  });

  await putDay(2026, "2026-06-05", storeId, {
    sales_excl_tax: 10000, customer_count: 5, card_sales: 0,
    staff_entries: [{ staff_id: "exp-labor-a-staff1", hours: 5, drinks: 2, okuri: false }],
  });

  const dailyRows = await getMonth(2026, 6, storeId);
  const payroll = await getMonthlyPayroll(2026, 6, storeId);
  payroll.store_id = storeId;
  const dayMap = await buildDayLaborMap(2026, 6, storeId, dailyRows, payroll);

  // 1200*5 (基本給) + 2*70 (ドリンク) + 500*2 (交通費、okuri=false=往復) = 7140
  assert.equal(dayMap["2026-06-05"], 7140);
});

test("buildDayLaborMap: incentive_rates設定時にキャッチ/呼び/延長を日別人件費に反映する(新設)", async () => {
  const storeId = "exp-labor-b";
  await ensureStore(storeId);
  await ensureStaff({
    id: "exp-labor-b-staff1", name: "スタッフ2", store_id: storeId,
    pay_type: "hourly", hourly_rate: 1000,
  });

  await updateSettings({
    incentive_rates: {
      catch: { yen_per_count: 300 },
      call: { yen_per_count: 200 },
      extension: { yen_per_count: 100 },
    },
  });

  await putDay(2026, "2026-06-06", storeId, {
    sales_excl_tax: 10000, customer_count: 5, card_sales: 0,
    staff_entries: [{
      staff_id: "exp-labor-b-staff1", hours: 4, drinks: 0,
      catch_count: 2, call_count: 1, extension_count: 3,
    }],
  });

  const dailyRows = await getMonth(2026, 6, storeId);
  const payroll = await getMonthlyPayroll(2026, 6, storeId);
  payroll.store_id = storeId;
  const dayMap = await buildDayLaborMap(2026, 6, storeId, dailyRows, payroll);

  // 1000*4 (基本給) + 2*300 + 1*200 + 3*100 = 4000+600+200+300 = 5100
  assert.equal(dayMap["2026-06-06"], 5100);

  // 他テストへの汚染防止: incentive_ratesを既定値(0円)に戻す
  await updateSettings({
    incentive_rates: {
      catch: { yen_per_count: 0 }, call: { yen_per_count: 0 }, extension: { yen_per_count: 0 },
    },
  });
});

test("buildDayLaborMap: 日別内訳の合計がgetMonthlyPayrollのtotal_labor_costと一致する(整合性)", async () => {
  const storeId = "exp-labor-c";
  await ensureStore(storeId, [{ id: "ristel", name: "リステル", price: 8000 }]);
  await ensureStaff({
    id: "exp-labor-c-staff1", name: "スタッフ3", store_id: storeId,
    pay_type: "hourly", hourly_rate: 1500, transport_one_way: 300,
  });
  await ensureStaff({
    id: "exp-labor-c-staff2", name: "スタッフ4", store_id: storeId,
    pay_type: "hourly", hourly_rate: 1300,
  });

  // スタッフ1人だけの日(ワンオペ)
  await putDay(2026, "2026-07-01", storeId, {
    sales_excl_tax: 20000, customer_count: 8, card_sales: 0,
    staff_entries: [{ staff_id: "exp-labor-c-staff1", hours: 6, drinks: 3, champagne: { ristel: 1 }, okuri: true }],
  });
  // 2人出勤の日
  await putDay(2026, "2026-07-02", storeId, {
    sales_excl_tax: 30000, customer_count: 10, card_sales: 5000,
    staff_entries: [
      { staff_id: "exp-labor-c-staff1", hours: 5, drinks: 1 },
      { staff_id: "exp-labor-c-staff2", hours: 5, drinks: 0 },
    ],
  });

  const dailyRows = await getMonth(2026, 7, storeId);
  const payroll = await getMonthlyPayroll(2026, 7, storeId);
  payroll.store_id = storeId;
  const dayMap = await buildDayLaborMap(2026, 7, storeId, dailyRows, payroll);

  const sumFromMap = Object.values(dayMap).reduce((a, b) => a + b, 0);
  assert.equal(sumFromMap, payroll.total_labor_cost);
});

// ─────────────────────────────────────────────────────────────────────
// writeCombinedSheet: レイアウト(列構成・見出し・値)がSheetJSで正しく読める
// ─────────────────────────────────────────────────────────────────────
test("writeCombinedSheet: 日次セクションの見出し・日次行・合計行がA-K列に正しく書かれる", async () => {
  const storeId = "exp-sheet-a";
  await ensureStore(storeId);
  await ensureStaff({
    id: "exp-sheet-a-staff1", name: "シート花子", store_id: storeId,
    pay_type: "hourly", hourly_rate: 1200,
  });

  await putDay(2026, "2026-08-03", storeId, {
    sales_excl_tax: 50000, customer_count: 12, card_sales: 10000,
    staff_entries: [{ staff_id: "exp-sheet-a-staff1", hours: 6, drinks: 4 }],
  });
  await putDay(2026, "2026-08-04", storeId, { closed: true });

  const dailyRows = await getMonth(2026, 8, storeId);
  const payroll = await getMonthlyPayroll(2026, 8, storeId);
  payroll.store_id = storeId;
  const dayLaborMap = await buildDayLaborMap(2026, 8, storeId, dailyRows, payroll);
  const fullNameMap = { "exp-sheet-a-staff1": "シート花子" };

  const wb = writeCombinedSheet(null, "8月_合算", [[dailyRows, payroll, dayLaborMap, fullNameMap]], fullNameMap);
  assert.deepEqual(wb.SheetNames, ["8月_合算"]);
  const ws = wb.Sheets["8月_合算"];

  // タイトル行(row2, A2) — merge_cells(A2:K2)相当
  assert.ok(String(sheetCell(ws, "A2")).includes("実績帳簿"));
  assert.ok(String(sheetCell(ws, "A2")).includes("exp-sheet-a"));

  // 見出し行(row3)
  assert.equal(sheetCell(ws, "A3"), "日付");
  assert.equal(sheetCell(ws, "B3"), "曜");
  assert.equal(sheetCell(ws, "C3"), "客数");
  assert.equal(sheetCell(ws, "D3"), "売上(税抜)");
  assert.equal(sheetCell(ws, "J3"), "出勤者");

  // 1日目(row4): 8/3は月曜 → "8/3", "月"
  assert.equal(sheetCell(ws, "A4"), "8/3");
  assert.equal(sheetCell(ws, "B4"), "月");
  assert.equal(sheetCell(ws, "C4"), 12);
  assert.equal(sheetCell(ws, "D4"), 50000);
  assert.equal(sheetCell(ws, "E4"), 40000); // cash = sales - card
  assert.equal(sheetCell(ws, "F4"), 10000);
  assert.equal(sheetCell(ws, "J4"), "シート花子");

  // 2日目(row5): 臨時休業(closed)
  assert.ok(String(sheetCell(ws, "A5")).includes("臨時休業"));

  // 月合計行(row6)
  assert.equal(sheetCell(ws, "A6"), "合計");
  assert.equal(sheetCell(ws, "C6"), 12);
  assert.equal(sheetCell(ws, "D6"), 50000);
});

test("writeCombinedSheet: 給与明細セクション(ドリンク・振込額等)が正しく書かれる", async () => {
  const storeId = "exp-sheet-b";
  await ensureStore(storeId);
  await ensureStaff({
    id: "exp-sheet-b-staff1", name: "給与太郎", store_id: storeId,
    pay_type: "hourly", hourly_rate: 1000,
  });

  await putDay(2026, "2026-09-01", storeId, {
    sales_excl_tax: 30000, customer_count: 10, card_sales: 0,
    staff_entries: [{ staff_id: "exp-sheet-b-staff1", hours: 4, drinks: 5 }],
  });

  const dailyRows = await getMonth(2026, 9, storeId);
  const payroll = await getMonthlyPayroll(2026, 9, storeId);
  payroll.store_id = storeId;
  const dayLaborMap = await buildDayLaborMap(2026, 9, storeId, dailyRows, payroll);

  const wb = writeCombinedSheet(null, "9月_合算", [[dailyRows, payroll, dayLaborMap, {}]]);
  const ws = wb.Sheets["9月_合算"];

  // 日次セクション: 1行(row4) + 合計行(row5) → 空白(row6=height6扱いだがセル無し) →
  // 給与明細ヘッダーはrow7。end_row(=給与合計行)を基準にしたいので、
  // ヘッダー文字列"スタッフ"をシート全体から探して検証する(行番号のズレに
  // 強いテストにするため)。
  const refs = Object.keys(ws).filter((k) => k !== "!ref" && k !== "!merges" && k !== "!cols");
  const staffHdrRef = refs.find((r) => sheetCell(ws, r) === "スタッフ");
  assert.ok(staffHdrRef, "「スタッフ」見出しが見つかること");
  const row = Number(XLSX.utils.decode_cell(staffHdrRef).r) + 1; // 1始まりの行番号

  assert.equal(sheetCell(ws, "A" + row), "スタッフ");
  assert.equal(sheetCell(ws, "F" + row), "ドリンク");
  assert.equal(sheetCell(ws, "J" + row), "振込額");

  const dataRow = row + 1;
  assert.equal(sheetCell(ws, "A" + dataRow), "給与太郎");
  assert.equal(sheetCell(ws, "F" + dataRow), 350); // drinks 5 * 70
  assert.equal(sheetCell(ws, "D" + dataRow), 4000); // take_home = 1000*4

  const totalRow = dataRow + 1;
  assert.equal(sheetCell(ws, "A" + totalRow), "合計");
  assert.equal(sheetCell(ws, "F" + totalRow), 350);
});

test("writeCombinedSheet: 同月を再出力すると同名シートが上書きされる(重複しない)", async () => {
  const storeId = "exp-sheet-c";
  await ensureStore(storeId);
  await putDay(2026, "2026-10-01", storeId, { sales_excl_tax: 1000, customer_count: 1, card_sales: 0, staff_entries: [] });

  const dailyRows1 = await getMonth(2026, 10, storeId);
  const payroll1 = await getMonthlyPayroll(2026, 10, storeId);
  payroll1.store_id = storeId;
  const dayLaborMap1 = await buildDayLaborMap(2026, 10, storeId, dailyRows1, payroll1);

  let wb = writeCombinedSheet(null, "10月_合算", [[dailyRows1, payroll1, dayLaborMap1, {}]]);
  assert.deepEqual(wb.SheetNames, ["10月_合算"]);

  // 既存ワークブックのバイト列を経由して再出力(前回ダウンロードを読み直す運用を想定)
  const bytes = workbookToArray(wb);

  await putDay(2026, "2026-10-02", storeId, { sales_excl_tax: 2000, customer_count: 2, card_sales: 0, staff_entries: [] });
  const dailyRows2 = await getMonth(2026, 10, storeId);
  const payroll2 = await getMonthlyPayroll(2026, 10, storeId);
  payroll2.store_id = storeId;
  const dayLaborMap2 = await buildDayLaborMap(2026, 10, storeId, dailyRows2, payroll2);

  wb = writeCombinedSheet(bytes, "10月_合算", [[dailyRows2, payroll2, dayLaborMap2, {}]]);
  assert.deepEqual(wb.SheetNames, ["10月_合算"]); // 重複せず1枚のまま
  const ws = wb.Sheets["10月_合算"];
  assert.equal(sheetCell(ws, "C6"), 1 + 2); // 月合計(客数)が2日分に増えている
});

test("writeCombinedSheet: 異なる月の既存シートは残り、同月だけ差し替わる", async () => {
  const storeId = "exp-sheet-d";
  await ensureStore(storeId);
  await putDay(2026, "2026-11-01", storeId, { sales_excl_tax: 1000, customer_count: 1, card_sales: 0, staff_entries: [] });
  const dailyRowsNov = await getMonth(2026, 11, storeId);
  const payrollNov = await getMonthlyPayroll(2026, 11, storeId);
  payrollNov.store_id = storeId;
  const dayLaborMapNov = await buildDayLaborMap(2026, 11, storeId, dailyRowsNov, payrollNov);
  let wb = writeCombinedSheet(null, "11月_合算", [[dailyRowsNov, payrollNov, dayLaborMapNov, {}]]);
  const bytes = workbookToArray(wb);

  await putDay(2026, "2026-12-01", storeId, { sales_excl_tax: 500, customer_count: 1, card_sales: 0, staff_entries: [] });
  const dailyRowsDec = await getMonth(2026, 12, storeId);
  const payrollDec = await getMonthlyPayroll(2026, 12, storeId);
  payrollDec.store_id = storeId;
  const dayLaborMapDec = await buildDayLaborMap(2026, 12, storeId, dailyRowsDec, payrollDec);
  wb = writeCombinedSheet(bytes, "12月_合算", [[dailyRowsDec, payrollDec, dayLaborMapDec, {}]]);

  assert.deepEqual(wb.SheetNames.slice().sort(), ["11月_合算", "12月_合算"]);
});

test("writeCombinedSheet: 生成したバイト列をXLSX.readで実際に読み直せる(ブラウザCDN版と同一ライブラリの往復確認)", async () => {
  const storeId = "exp-sheet-e";
  await ensureStore(storeId);
  await putDay(2026, "2026-01-05", storeId, { sales_excl_tax: 7777, customer_count: 3, card_sales: 0, staff_entries: [] });
  const dailyRows = await getMonth(2026, 1, storeId);
  const payroll = await getMonthlyPayroll(2026, 1, storeId);
  payroll.store_id = storeId;
  const dayLaborMap = await buildDayLaborMap(2026, 1, storeId, dailyRows, payroll);
  const wb = writeCombinedSheet(null, "1月_合算", [[dailyRows, payroll, dayLaborMap, {}]]);
  const array = workbookToArray(wb);

  const wb2 = XLSX.read(array, { type: "array" });
  const ws2 = wb2.Sheets["1月_合算"];
  assert.equal(sheetCell(ws2, "D4"), 7777);
});

// ─────────────────────────────────────────────────────────────────────
// 複数店舗: 右エリア(全店合算サマリー・店舗対決)
// ─────────────────────────────────────────────────────────────────────
test("writeCombinedSheet: 2店舗分を渡すと全店合算サマリー・店舗対決セクションが書かれる", async () => {
  const storeA = "exp-multi-a";
  const storeB = "exp-multi-b";
  await ensureStore(storeA);
  await ensureStore(storeB);

  await putDay(2026, "2026-02-01", storeA, { sales_excl_tax: 10000, customer_count: 4, card_sales: 0, staff_entries: [] });
  await putDay(2026, "2026-02-01", storeB, { sales_excl_tax: 20000, customer_count: 6, card_sales: 0, staff_entries: [] });

  const dailyA = await getMonth(2026, 2, storeA);
  const payrollA = await getMonthlyPayroll(2026, 2, storeA);
  payrollA.store_id = storeA;
  const laborA = await buildDayLaborMap(2026, 2, storeA, dailyA, payrollA);

  const dailyB = await getMonth(2026, 2, storeB);
  const payrollB = await getMonthlyPayroll(2026, 2, storeB);
  payrollB.store_id = storeB;
  const laborB = await buildDayLaborMap(2026, 2, storeB, dailyB, payrollB);

  const wb = writeCombinedSheet(null, "2月_合算", [
    [dailyA, payrollA, laborA, {}],
    [dailyB, payrollB, laborB, {}],
  ]);
  const ws = wb.Sheets["2月_合算"];
  const refs = Object.keys(ws).filter((k) => k.charAt(0) !== "!");

  const summaryRef = refs.find((r) => sheetCell(ws, r) === "全店合算サマリー");
  assert.ok(summaryRef, "「全店合算サマリー」見出しが見つかること");
  const summaryRow = XLSX.utils.decode_cell(summaryRef).r;

  const battleRef = refs.find((r) => sheetCell(ws, r) === "店舗対決 ― 今月の成績");
  assert.ok(battleRef, "「店舗対決」見出しが見つかること");

  // 総売上(税抜)の合計が全店合計(10000+20000=30000)になっていること。
  // 同じラベルは各店舗のKPIセクション内にも単独で出るため、
  // 「全店合算サマリー」より後に初めて現れる行に絞る(_write_comparison_section参照)。
  const totalSalesLabelRef = refs
    .filter((r) => sheetCell(ws, r) === "総売上(税抜)" && Number(XLSX.utils.decode_cell(r).c) === 12
      && XLSX.utils.decode_cell(r).r > summaryRow)
    .sort((a, b) => XLSX.utils.decode_cell(a).r - XLSX.utils.decode_cell(b).r)[0];
  assert.ok(totalSalesLabelRef);
  const row = XLSX.utils.decode_cell(totalSalesLabelRef).r;
  // R_VAL1(列N, 0始まり13)から店舗数分 + 合計列が並ぶ(_sumRowの移植参照)。
  const salesRowRefs = [13, 14, 15].map((c) => XLSX.utils.encode_cell({ r: row, c })); // N,O,P列
  const values = salesRowRefs.map((ref) => sheetCell(ws, ref));
  assert.deepEqual(values, [10000, 20000, 30000]);
});

// ─────────────────────────────────────────────────────────────────────
// recalcComposite: calc_company_rankingの結果でcomposite_score/dph_ratioを上書き
// ─────────────────────────────────────────────────────────────────────
test("recalcComposite: staff_payrollのmetrics.composite_scoreがcalcCompanyRankingの結果で上書きされる", async () => {
  const storeId = "exp-recalc-a";
  await ensureStore(storeId);
  await ensureStaff({
    id: "exp-recalc-a-staff1", name: "再計算花子", store_id: storeId,
    pay_type: "hourly", hourly_rate: 1000,
  });

  // 3日以上出勤(MIN_WORK_DAYS_FOR_RANKING=3)させてeligibleにする
  for (const date of ["2026-03-01", "2026-03-02", "2026-03-03"]) {
    await putDay(2026, date, storeId, {
      sales_excl_tax: 10000, customer_count: 5, card_sales: 0,
      staff_entries: [{ staff_id: "exp-recalc-a-staff1", hours: 5, drinks: 2 }],
    });
  }

  const dailyRows = await getMonth(2026, 3, storeId);
  const payroll = await getMonthlyPayroll(2026, 3, storeId);
  payroll.store_id = storeId;
  const dayLaborMap = await buildDayLaborMap(2026, 3, storeId, dailyRows, payroll);
  const storesData = [[dailyRows, payroll, dayLaborMap, {}]];

  await recalcComposite(storesData);

  const sp = payroll.staff_payroll.find((s) => s.staff_id === "exp-recalc-a-staff1");
  assert.ok(sp.metrics);
  assert.ok(typeof sp.metrics.composite_score === "number");
  // 単一スタッフ・単一店舗なのでRPH比=100%、スコアも正の値になるはず
  assert.ok(sp.metrics.composite_score > 0);
});

// ─────────────────────────────────────────────────────────────────────
// exportMonth: トップレベルのオーケストレーション(Blob生成まで)
// ─────────────────────────────────────────────────────────────────────
test("exportMonth: ワークブック・配列・Blob・ファイル名が一通り生成される", async () => {
  const storeId = "exp-top-a";
  await ensureStore(storeId);
  await putDay(2026, "2026-04-10", storeId, { sales_excl_tax: 15000, customer_count: 5, card_sales: 0, staff_entries: [] });

  const result = await exportMonth(2026, 4);
  assert.equal(result.filename, "実績帳簿2026.xlsx");
  assert.equal(result.sheet, "4月_合算");
  assert.ok(result.workbook.SheetNames.includes("4月_合算"));
  assert.ok(
    result.array instanceof Uint8Array ||
    result.array instanceof ArrayBuffer ||
    Array.isArray(result.array) ||
    Buffer.isBuffer(result.array)
  );
  assert.ok(result.blob); // Node 18+はグローバルBlobを持つ

  // 実際に読み直せることも確認する
  const wb2 = XLSX.read(result.array, { type: "array" });
  const ws2 = wb2.Sheets["4月_合算"];
  assert.ok(ws2);
});

test("downloadWorkbook: DOM無しのNode環境でも例外を投げない", () => {
  assert.doesNotThrow(() => {
    downloadWorkbook(new Blob(["dummy"]), "dummy.xlsx");
  });
});

// ─────────────────────────────────────────────────────────────────────
// local-api経由のルーティング(POST /export/:year/:month)
// ─────────────────────────────────────────────────────────────────────
test("POST /export/:year/:month: localApiCall経由でも呼び出せ、path/sheetを返す", async () => {
  const storeId = "exp-route-a";
  await ensureStore(storeId);
  await putDay(2026, "2026-05-01", storeId, { sales_excl_tax: 1000, customer_count: 1, card_sales: 0, staff_entries: [] });

  const result = await localApiCall("POST", "/export/2026/5");
  assert.equal(result.sheet, "5月_合算");
  assert.equal(result.path, "実績帳簿2026.xlsx");
});
