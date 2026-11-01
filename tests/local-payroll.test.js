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

async function ensureStore(storeId) {
  await createStore({ id: storeId, name: storeId + "店" }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────
// ドリンクバック
// ─────────────────────────────────────────────────────────────────────
test("calcDrinkBack: 基本", () => {
  assert.equal(calcDrinkBack(3), 210);
});
test("calcDrinkBack: 0杯", () => {
  assert.equal(calcDrinkBack(0), 0);
});
// 2026-11-02、買い手の実際の単価(100円)が判明し、DRINK_UNIT固定70円から
// 設定可能な単価(rate引数)に変更した。rate省略時は既定の70円のまま
// (上の2テスト)、明示的に渡せばその単価で計算されることを確認する。
test("calcDrinkBack: rate引数を渡すとその単価で計算される", () => {
  assert.equal(calcDrinkBack(3, 100), 300);
});
test("calcDrinkBack: rate=0なら0円(単価未設定時の安全側挙動)", () => {
  assert.equal(calcDrinkBack(3, 0), 0);
});

test("getIncentiveRates: drinkは未設定時70円(元々のDRINK_UNIT固定値を踏襲)", async () => {
  await dbDelete("settings", "global");
  const rates = await getIncentiveRates();
  assert.equal(rates.drink.yen_per_count, 70);
  assert.equal(rates.catch.yen_per_count, 0);
});

test("getIncentiveRates: drinkは設定済みならその値を返す", async () => {
  try {
    await dbPut("settings", "global", { incentive_rates: { drink: { yen_per_count: 100 } } });
    const rates = await getIncentiveRates();
    assert.equal(rates.drink.yen_per_count, 100);
  } finally {
    await dbDelete("settings", "global");
  }
});

// ─────────────────────────────────────────────────────────────────────
// シャンパンバック
// ─────────────────────────────────────────────────────────────────────
const CHAMP_MENU = [
  { id: "ristel", name: "リステル", price: 8000 },
  { id: "orishan", name: "オリシャン", price: 15000 },
];

test("calcChampagneBack: 単品", () => {
  assert.equal(calcChampagneBack({ orishan: 1 }, CHAMP_MENU), 1500);
});
test("calcChampagneBack: 複数", () => {
  assert.equal(calcChampagneBack({ ristel: 2, orishan: 1 }, CHAMP_MENU), 3100);
});
test("calcChampagneBack: 空", () => {
  assert.equal(calcChampagneBack({}, CHAMP_MENU), 0);
});
test("calcChampagneBack: id/price欠損メニューでもクラッシュしない", () => {
  const brokenMenu = [
    { name: "リステル" },
    { id: "orishan" },
    { id: "ristel", price: 8000 },
  ];
  assert.equal(calcChampagneBack({ orishan: 1, ristel: 2 }, brokenMenu), 1600);
});
test("calcChampagneBack: champagneがnullでもクラッシュしない", () => {
  assert.equal(calcChampagneBack(null, CHAMP_MENU), 0);
});
test("calcChampagneBack: champagneがdict以外でもクラッシュしない", () => {
  assert.equal(calcChampagneBack("invalid", CHAMP_MENU), 0);
});
test("calcChampagneBack: メニューのpriceがnullでもクラッシュしない", () => {
  const menu = [
    { id: "ristel", name: "リステル", price: null },
    { id: "orishan", name: "オリシャン", price: 15000 },
  ];
  assert.equal(calcChampagneBack({ ristel: 2, orishan: 1 }, menu), 1500);
});

// ─────────────────────────────────────────────────────────────────────
// 交通費
// ─────────────────────────────────────────────────────────────────────
test("calcTransport: 片道2倍(okuri=false)", () => {
  assert.equal(calcTransport(500, false), 1000);
});
test("calcTransport: 送迎あり(okuri=true)は片道のみ", () => {
  assert.equal(calcTransport(500, true), 500);
});

// ─────────────────────────────────────────────────────────────────────
// 社会保険料控除
// ─────────────────────────────────────────────────────────────────────
test("calcMonthlyDeductions: 基本(やぶ相当)", () => {
  const deduction = {
    health_insurance_rate: 0.05145,
    childcare_support_rate: 0.0018,
    pension_rate: 0.0915,
    employment_insurance_rate: 0.006,
    dependents: 0,
  };
  const result = calcMonthlyDeductions(250000, deduction);
  assert.equal(result.health_insurance, 12863);
  assert.equal(result.childcare_support, 450);
  assert.equal(result.pension, 22875);
  assert.equal(result.employment_insurance, 1500);
  assert.equal(result.total, 12863 + 450 + 22875 + 1500 + result.income_tax);
});
test("calcMonthlyDeductions: rateがnullでもクラッシュしない", () => {
  const deduction = { health_insurance_rate: null, pension_rate: 0.0915, dependents: null };
  const result = calcMonthlyDeductions(300000, deduction);
  assert.equal(result.health_insurance, 0);
  assert.equal(result.pension, 27450);
});
test("calcMonthlyDeductions: apply_social_insurance=falseは社保のみ0(雇用保険は課税)", () => {
  const deduction = {
    health_insurance_rate: 0.05145, childcare_support_rate: 0.0018,
    pension_rate: 0.0915, employment_insurance_rate: 0.006, dependents: 0,
  };
  const result = calcMonthlyDeductions(250000, deduction, undefined, false);
  assert.equal(result.health_insurance, 0);
  assert.equal(result.childcare_support, 0);
  assert.equal(result.pension, 0);
  assert.equal(result.employment_insurance, 1500);
});
test("calcMonthlyDeductions: rateキー欠損でもクラッシュしない", () => {
  const result = calcMonthlyDeductions(200000, { dependents: 0 });
  assert.equal(result.health_insurance, 0);
  assert.equal(result.pension, 0);
  assert.equal(result.total, result.income_tax);
});
test("calcMonthlyDeductions: standard_remuneration=0は0ベース(月給にフォールバックしない)", () => {
  const deduction = {
    health_insurance_rate: 0.05145, pension_rate: 0.0915,
    employment_insurance_rate: 0.006, dependents: 0,
  };
  const r0 = calcMonthlyDeductions(250000, deduction, 0);
  const rNone = calcMonthlyDeductions(250000, deduction, undefined);
  assert.equal(r0.health_insurance, 0);
  assert.equal(r0.pension, 0);
  assert.ok(rNone.health_insurance > 0);
});
test("calcMonthlyDeductions: manual_income_taxが変換不可でもフォールバック", () => {
  const result = calcMonthlyDeductions(200000, { dependents: 0, manual_income_tax: "not-a-number" });
  assert.ok(result.income_tax >= 0);
});
test("calcMonthlyDeductions: manual_income_taxが有効値ならそのまま使う", () => {
  const result = calcMonthlyDeductions(200000, { dependents: 0, manual_income_tax: 3000 });
  assert.equal(result.income_tax, 3000);
});

// ─────────────────────────────────────────────────────────────────────
// 月末退職の特例(社保)
// ─────────────────────────────────────────────────────────────────────
test("shakaihokenApplies: 退職日未設定は常に課税", () => {
  assert.equal(shakaihokenApplies(null, 2026, 8), true);
});
test("shakaihokenApplies: 月中退職は当月分は課されない", () => {
  assert.equal(shakaihokenApplies("2026-08-29", 2026, 8), false);
});
test("shakaihokenApplies: 月末退職は当月分も課される", () => {
  assert.equal(shakaihokenApplies("2026-08-31", 2026, 8), true);
});
test("shakaihokenApplies: 退職月より後は課されない", () => {
  assert.equal(shakaihokenApplies("2026-08-29", 2026, 9), false);
});
test("shakaihokenApplies: 退職月より前は課される", () => {
  assert.equal(shakaihokenApplies("2026-08-29", 2026, 7), true);
});
test("shakaihokenApplies: 不正な日付文字列でもクラッシュしない(課税扱い)", () => {
  assert.equal(shakaihokenApplies("not-a-date", 2026, 8), true);
});

// ─────────────────────────────────────────────────────────────────────
// 源泉徴収
// ─────────────────────────────────────────────────────────────────────
test("calcSourceWithholding: 扶養0人、妥当な範囲", () => {
  const result = calcSourceWithholding(212312, 0);
  assert.ok(result >= 4000 && result <= 8000, `got ${result}`);
});
test("calcSourceWithholding: 収入0円は税額0円", () => {
  assert.equal(calcSourceWithholding(0, 0), 0);
});
test("calcSourceWithholding: dependentsがnullでもクラッシュしない", () => {
  assert.ok(calcSourceWithholding(212312, null) >= 0);
});
test("calcSourceWithholding: 高額帯は表の値をそのまま使う(フォールバック近似値ではない)", () => {
  assert.equal(calcSourceWithholding(700000, 0), 63590);
});

// ─────────────────────────────────────────────────────────────────────
// 時給スタッフ給与
// ─────────────────────────────────────────────────────────────────────
const HOURLY_STAFF = {
  id: "koji", pay_type: "hourly", hourly_rate: 1250,
  transport_one_way: 500, deduction: null,
};

test("calcHourlyPayroll: 基本計算", async () => {
  const entries = [
    { staff_id: "koji", hours: 7.5, drinks: 3, champagne: { orishan: 1 }, okuri: false },
  ];
  const result = await calcHourlyPayroll(HOURLY_STAFF, entries, CHAMP_MENU);
  assert.equal(result.work_days, 1);
  assert.equal(result.total_hours, 7.5);
  assert.equal(result.base_pay, 9375);
  assert.equal(result.drink_back, 210);
  assert.equal(result.champagne_back, 1500);
  assert.equal(result.transport, 1000);
  assert.equal(result.total, 9375 + 210 + 1500 + 1000);
});

test("calcHourlyPayroll: hours/drinksがnullでも0扱い(クラッシュしない)", async () => {
  const staff = { id: "koji", pay_type: "hourly", hourly_rate: 1250, transport_one_way: 500 };
  const entries = [{ staff_id: "koji", hours: null, drinks: null, champagne: {}, okuri: false }];
  const result = await calcHourlyPayroll(staff, entries, CHAMP_MENU);
  assert.equal(result.total_hours, 0);
  assert.equal(result.base_pay, 0);
  assert.equal(result.drink_back, 0);
});

test("calcHourlyPayroll: transport_one_wayがnullでも0扱い", async () => {
  const staff = { id: "koji", pay_type: "hourly", hourly_rate: 1250, transport_one_way: null };
  const entries = [{ staff_id: "koji", hours: 5.0, drinks: 2, champagne: {}, okuri: false }];
  const result = await calcHourlyPayroll(staff, entries, CHAMP_MENU);
  assert.equal(result.transport, 0);
  assert.equal(result.base_pay, 6250);
});

// ─────────────────────────────────────────────────────────────────────
// ワンオペ手当 ── 過去の本番事故(既定値が0以外になり給与過払い)の再発防止。
// この既定値0のテストは「他のテストがたまたま0のまま通っている」のではなく、
// 明示的な回帰テストとして常に実行されること。
// ─────────────────────────────────────────────────────────────────────
test("【回帰】ワンオペ手当の既定値は必ず0円(settingsストア未設定時)", async () => {
  // settingsストアに何も書き込んでいない状態(実運用の初期状態と同じ)を明示的に再現する。
  await dbDelete("settings", "global");
  const bonus = await getWanopeBonus();
  assert.equal(bonus, 0, "ワンオペ手当の既定値が0円でない(過去の本番過払い事故と同じ不具合)");
});

test("【回帰】ワンオペ手当が既定(0円)のとき、1人出勤日でも手当が加算されない", async () => {
  await dbDelete("settings", "global");
  const staff = { ...HOURLY_STAFF, hourly_rate: 1000, transport_one_way: 0 };
  const entries = [
    { staff_id: "s1", hours: 8, drinks: 0, champagne: {}, okuri: false, wanope: true },
  ];
  const result = await calcHourlyPayroll(staff, entries, CHAMP_MENU);
  assert.equal(result.base_pay, 8000);
  assert.equal(result.wanope_bonus, 0, "既定値0円のはずのワンオペ手当が加算されている");
  assert.equal(result.wanope_days, 1);
  assert.equal(result.total, 8000, "ワンオペ手当が既定で給与総額に混入している");
});

test("ワンオペ手当: settingsで単価を明示設定した場合は正しく加算される", async () => {
  await dbPut("settings", "global", { wanope_bonus: 200 });
  try {
    const staff = { ...HOURLY_STAFF, hourly_rate: 1000 };
    const entries = [
      { staff_id: "s1", hours: 8, drinks: 0, champagne: {}, okuri: false, wanope: true },
    ];
    const result = await calcHourlyPayroll(staff, entries, CHAMP_MENU);
    assert.equal(result.base_pay, 8000);
    assert.equal(result.wanope_bonus, 1600);
    assert.equal(result.wanope_days, 1);
  } finally {
    await dbDelete("settings", "global");
  }
});

// ─────────────────────────────────────────────────────────────────────
// 新設: キャッチ・呼び・延長インセンティブ(既定0円は給与に影響しないこと)
// ─────────────────────────────────────────────────────────────────────
test("【回帰】キャッチ/呼び/延長インセンティブの既定値(単価0円)は給与に影響しない", async () => {
  await dbDelete("settings", "global");
  const rates = await getIncentiveRates();
  assert.equal(rates.catch.yen_per_count, 0);
  assert.equal(rates.call.yen_per_count, 0);
  assert.equal(rates.extension.yen_per_count, 0);

  const staff = { ...HOURLY_STAFF, hourly_rate: 1000, transport_one_way: 0 };
  const entries = [
    { staff_id: "s1", hours: 8, drinks: 0, champagne: {}, okuri: false, catch_count: 5, call_count: 3, extension_count: 2 },
  ];
  const result = await calcHourlyPayroll(staff, entries, CHAMP_MENU);
  assert.equal(result.incentive_back, 0);
  assert.equal(result.total, 8000, "単価未設定なのに給与が変化している");
});

test("キャッチ/呼び/延長インセンティブ: 単価を設定すると正しく加算される", async () => {
  await dbPut("settings", "global", {
    incentive_rates: {
      catch: { yen_per_count: 100 },
      call: { yen_per_count: 50 },
      extension: { yen_per_count: 300 },
    },
  });
  try {
    const staff = { ...HOURLY_STAFF, hourly_rate: 1000, transport_one_way: 0 };
    const entries = [
      { staff_id: "s1", hours: 8, drinks: 0, champagne: {}, okuri: false, catch_count: 5, call_count: 3, extension_count: 2 },
    ];
    const result = await calcHourlyPayroll(staff, entries, CHAMP_MENU);
    // 5*100 + 3*50 + 2*300 = 500 + 150 + 600 = 1250
    assert.equal(result.incentive_back, 1250);
    assert.equal(result.total, 8000 + 1250);
  } finally {
    await dbDelete("settings", "global");
  }
});

test("キャッチ/呼び/延長インセンティブ: 単価設定時の一部のみ設定(他は0円のまま)", async () => {
  await dbPut("settings", "global", {
    incentive_rates: { catch: { yen_per_count: 150 } },
  });
  try {
    const rates = await getIncentiveRates();
    assert.equal(rates.catch.yen_per_count, 150);
    assert.equal(rates.call.yen_per_count, 0);
    assert.equal(rates.extension.yen_per_count, 0);
  } finally {
    await dbDelete("settings", "global");
  }
});

// ─────────────────────────────────────────────────────────────────────
// 欠勤控除
// ─────────────────────────────────────────────────────────────────────
test("calcAbsenceDeduction: 基本", () => {
  const result = calcAbsenceDeduction(300000, 22, 2);
  assert.equal(result, Math.trunc(300000 / 22 * 2));
});
test("calcAbsenceDeduction: 欠勤0日は控除0", () => {
  assert.equal(calcAbsenceDeduction(300000, 22, 0), 0);
});
test("calcAbsenceDeduction: 所定日数0は控除0", () => {
  assert.equal(calcAbsenceDeduction(300000, 0, 2), 0);
});
test("calcAbsenceDeduction: base_salary=0は月給にフォールバックしない", () => {
  assert.equal(calcAbsenceDeduction(300000, 22, 2, 0), 0);
});

// ─────────────────────────────────────────────────────────────────────
// 月給フル計算
// ─────────────────────────────────────────────────────────────────────
const MONTHLY_STAFF = {
  id: "yabu", pay_type: "monthly", hourly_rate: null,
  monthly_salary: 250000, transport_one_way: 1000,
  deduction: {
    health_insurance_rate: 0.05145, childcare_support_rate: 0.0018,
    pension_rate: 0.0915, employment_insurance_rate: 0.006, dependents: 0,
  },
  default_scheduled_days: 22,
};

test("calcMonthlyPayroll: 基本計算(ドリンク・シャンパン反映あり)", async () => {
  const entries = [
    { staff_id: "yabu", hours: 8, drinks: 5, champagne: { ristel: 1 }, okuri: false, include_drink: true, include_champagne: true },
  ];
  const result = await calcMonthlyPayroll(MONTHLY_STAFF, entries, CHAMP_MENU);
  assert.equal(result.work_days, 1);
  assert.equal(result.drink_back, 350);
  assert.equal(result.champagne_back, 800);
  assert.equal(result.drink_back_raw, 350);
  assert.equal(result.transport, 2000);
  assert.equal(result.total, result.take_home + 350 + 800 + 2000);
});

test("calcMonthlyPayroll: 月中退職は社保を0円にする", async () => {
  const staff = { ...MONTHLY_STAFF, resignation_date: "2026-08-29" };
  const entries = [
    { staff_id: "yabu", hours: 8, drinks: 0, champagne: {}, okuri: false, include_drink: true, include_champagne: true },
  ];
  const result = await calcMonthlyPayroll(staff, entries, CHAMP_MENU, { year: 2026, month: 8 });
  assert.equal(result.deductions.health_insurance, 0);
  assert.equal(result.deductions.childcare_support, 0);
  assert.equal(result.deductions.pension, 0);
  assert.ok(result.deductions.employment_insurance > 0);
});

test("calcMonthlyPayroll: social_insurance_override=falseは退職日未設定でも社保免除", async () => {
  const entries = [
    { staff_id: "yabu", hours: 8, drinks: 0, champagne: {}, okuri: false, include_drink: true, include_champagne: true },
  ];
  const result = await calcMonthlyPayroll(MONTHLY_STAFF, entries, CHAMP_MENU, {
    year: 2026, month: 8, social_insurance_override: false,
  });
  assert.equal(result.deductions.health_insurance, 0);
  assert.equal(result.deductions.pension, 0);
  assert.equal(result.social_insurance_exempt, true);
});

test("calcMonthlyPayroll: social_insurance_override=trueは退職日があっても課税する", async () => {
  const staff = { ...MONTHLY_STAFF, resignation_date: "2026-08-29" };
  const entries = [
    { staff_id: "yabu", hours: 8, drinks: 0, champagne: {}, okuri: false, include_drink: true, include_champagne: true },
  ];
  const result = await calcMonthlyPayroll(staff, entries, CHAMP_MENU, {
    year: 2026, month: 8, social_insurance_override: true,
  });
  assert.ok(result.deductions.health_insurance > 0);
  assert.ok(result.deductions.pension > 0);
  assert.equal(result.social_insurance_exempt, false);
});

test("calcMonthlyPayroll: social_insurance_override未指定は退職日ルールにフォールバック", async () => {
  const staff = { ...MONTHLY_STAFF, resignation_date: "2026-08-29" };
  const entries = [
    { staff_id: "yabu", hours: 8, drinks: 0, champagne: {}, okuri: false, include_drink: true, include_champagne: true },
  ];
  const result = await calcMonthlyPayroll(staff, entries, CHAMP_MENU, {
    year: 2026, month: 8, social_insurance_override: null,
  });
  assert.equal(result.deductions.health_insurance, 0);
  assert.equal(result.social_insurance_exempt, true);
});

test("calcMonthlyPayroll: 未反映(include_drink/champagne=false)はrawだけ記録され控除されない", async () => {
  const entries = [
    { staff_id: "yabu", hours: 8, drinks: 5, champagne: { ristel: 1 }, okuri: false, include_drink: false, include_champagne: false },
  ];
  const result = await calcMonthlyPayroll(MONTHLY_STAFF, entries, CHAMP_MENU);
  assert.equal(result.drink_back, 0);
  assert.equal(result.drink_back_raw, 350);
  assert.equal(result.champagne_back, 0);
  assert.equal(result.champagne_back_raw, 800);
});

test("calcMonthlyPayroll: monthly_salary欠損でもクラッシュせずゼロ扱い", async () => {
  const staff = { id: "test", pay_type: "monthly", transport_one_way: 0, deduction: null };
  const result = await calcMonthlyPayroll(staff, [], []);
  assert.equal(result.monthly_salary, 0);
  assert.equal(result.total, 0);
});

test("calcMonthlyPayroll: 手渡し調整額が大きくマイナスでも hand/transfer の不変条件を保つ", async () => {
  const staff = {
    id: "test", pay_type: "monthly", monthly_salary: 100000,
    transport_one_way: 0, deduction: null, default_scheduled_days: 22,
  };
  const result = await calcMonthlyPayroll(staff, [], [], { adjustment: -150000, adjustment_hand_delivery: true });
  assert.ok(result.hand_amount >= 0);
  assert.ok(result.transfer_amount >= 0);
  assert.equal(result.total, result.transfer_amount + result.hand_amount);
});

test("calcMonthlyPayroll: 通常の(プラスの)手渡し調整は従来通り分割される", async () => {
  const staff = {
    id: "test", pay_type: "monthly", monthly_salary: 200000,
    transport_one_way: 0, deduction: null, default_scheduled_days: 22,
  };
  const result = await calcMonthlyPayroll(staff, [], [], { adjustment: 50000, adjustment_hand_delivery: true });
  assert.equal(result.hand_amount, 50000);
  assert.equal(result.transfer_amount, 200000);
  assert.equal(result.total, result.transfer_amount + result.hand_amount);
});

test("【回帰】calcMonthlyPayroll: キャッチ/呼び/延長インセンティブ既定0円は月給にも影響しない", async () => {
  await dbDelete("settings", "global");
  const entries = [
    { staff_id: "yabu", hours: 8, drinks: 0, champagne: {}, okuri: false, catch_count: 10, call_count: 10, extension_count: 10 },
  ];
  const result = await calcMonthlyPayroll(MONTHLY_STAFF, entries, CHAMP_MENU);
  assert.equal(result.incentive_back, 0);
});

// ─────────────────────────────────────────────────────────────────────
// 時給履歴・研修時給
// ─────────────────────────────────────────────────────────────────────
test("getEffectiveRate: 履歴なしはhourly_rateそのまま", () => {
  assert.equal(getEffectiveRate({ hourly_rate: 1200, rate_history: [] }, "2026-06-01"), 1200);
});
test("getEffectiveRate: 履歴ありは日付に応じて切り替わる", () => {
  const staff = {
    hourly_rate: 1250,
    rate_history: [
      { from: "2026-01-01", rate: 1200 },
      { from: "2026-04-01", rate: 1300 },
    ],
  };
  assert.equal(getEffectiveRate(staff, "2026-03-31"), 1200);
  assert.equal(getEffectiveRate(staff, "2026-04-01"), 1300);
  assert.equal(getEffectiveRate(staff, "2026-12-31"), 1300);
});
test("getEffectiveRate: from欠損エントリは無視される", () => {
  const staff = {
    hourly_rate: 1000,
    rate_history: [{ rate: 9999 }, { from: "2026-01-01", rate: 1200 }],
  };
  assert.equal(getEffectiveRate(staff, "2026-06-01"), 1200);
});
test("getEffectiveRate: 非dict混入でもクラッシュしない", () => {
  const staff = {
    hourly_rate: 1100,
    rate_history: ["not_a_dict", null, { from: "2026-01-01", rate: 1200 }],
  };
  assert.equal(getEffectiveRate(staff, "2026-06-01"), 1200);
});

const TRAINING_STAFF = {
  id: "trainee", hourly_rate: 1150,
  training_rate: { base_rate: 1150, raised_rate: 1250, threshold_hours: 100 },
};

test("getEffectiveRate(研修): 閾値未満はbase_rate", () => {
  assert.equal(getEffectiveRate(TRAINING_STAFF, "2026-06-01", 99), 1150);
});
test("getEffectiveRate(研修): 閾値到達はraised_rate", () => {
  assert.equal(getEffectiveRate(TRAINING_STAFF, "2026-06-01", 100), 1250);
});
test("getEffectiveRate(研修): 閾値超過もraised_rate", () => {
  assert.equal(getEffectiveRate(TRAINING_STAFF, "2026-06-01", 150), 1250);
});
test("getEffectiveRate(研修): cumulative_hours省略は安全側(base_rate)", () => {
  assert.equal(getEffectiveRate(TRAINING_STAFF, "2026-06-01"), 1150);
});
test("getEffectiveRate(研修): 卒業後にrate_historyの昇給が上回れば優先される", () => {
  const staff = {
    hourly_rate: 1150,
    training_rate: { base_rate: 1150, raised_rate: 1250, threshold_hours: 100 },
    rate_history: [{ from: "2026-09-01", rate: 1300 }],
  };
  assert.equal(getEffectiveRate(staff, "2026-08-01", 150), 1250);
  assert.equal(getEffectiveRate(staff, "2026-09-01", 200), 1300);
});
test("getEffectiveRate(研修): rate_historyが低くても卒業後の単価は下がらない", () => {
  const staff = {
    hourly_rate: 1150,
    training_rate: { base_rate: 1150, raised_rate: 1250, threshold_hours: 100 },
    rate_history: [{ from: "2026-01-01", rate: 1000 }],
  };
  assert.equal(getEffectiveRate(staff, "2026-08-01", 150), 1250);
});

// ─────────────────────────────────────────────────────────────────────
// 累計勤務時間
// ─────────────────────────────────────────────────────────────────────
test("cumulativeHoursBefore: 指定日より前の時間のみ合算", () => {
  const allStaff = { trainee: { id: "trainee" } };
  const daily = {
    "2026-08-01": { to: { staff_entries: [{ staff_id: "trainee", hours: 4 }] } },
    "2026-08-02": { to: { staff_entries: [{ staff_id: "trainee", hours: 5 }] } },
    "2026-08-03": { to: { staff_entries: [{ staff_id: "trainee", hours: 6 }] } },
  };
  assert.equal(cumulativeHoursBefore("trainee", null, "2026-08-03", allStaff, [daily]), 9);
});
test("cumulativeHoursBefore: 他スタッフの時間は含めない", () => {
  const allStaff = { trainee: { id: "trainee" }, other: { id: "other" } };
  const daily = {
    "2026-08-01": { to: { staff_entries: [{ staff_id: "trainee", hours: 4 }, { staff_id: "other", hours: 100 }] } },
  };
  assert.equal(cumulativeHoursBefore("trainee", null, "2026-08-02", allStaff, [daily]), 4);
});
test("cumulativeHoursBefore: alias_groupが同じ別IDも合算される", () => {
  const allStaff = {
    trainee_old: { id: "trainee_old", alias_group: "risa", active: false },
    trainee_new: { id: "trainee_new", alias_group: "risa", active: true },
  };
  const daily = {
    "2026-07-01": { to: { staff_entries: [{ staff_id: "trainee_old", hours: 50 }] } },
    "2026-08-01": { to: { staff_entries: [{ staff_id: "trainee_new", hours: 4 }] } },
  };
  assert.equal(cumulativeHoursBefore("trainee_new", "risa", "2026-08-02", allStaff, [daily]), 54);
});
test("cumulativeHoursBefore: 店舗・年をまたいでも合算される", () => {
  const allStaff = { trainee: { id: "trainee" } };
  const daily2025 = { "2025-12-31": { nishinaka: { staff_entries: [{ staff_id: "trainee", hours: 3 }] } } };
  const daily2026 = { "2026-01-01": { to: { staff_entries: [{ staff_id: "trainee", hours: 2 }] } } };
  assert.equal(cumulativeHoursBefore("trainee", null, "2026-01-02", allStaff, [daily2025, daily2026]), 5);
});

// ─────────────────────────────────────────────────────────────────────
// 店平均比・D/h・シャンパン売上
// ─────────────────────────────────────────────────────────────────────
test("calcStoreMetrics: 基本", () => {
  const metrics = calcStoreMetrics(20, 80000, 200000, 40, 4, 1, 15000);
  assert.ok(Math.abs(metrics.performance_ratio - 80.0) <= 0.5);
  assert.ok(Math.abs(metrics.drinks_per_hour - 0.2) <= 0.01);
  assert.equal(metrics.champagne_total, 1);
  assert.equal(metrics.champagne_amount, 15000);
});
test("calcStoreMetrics: hours=0でもゼロ除算しない", () => {
  const metrics = calcStoreMetrics(0, 0, 100000, 10, 0, 0, 0);
  assert.equal(metrics.performance_ratio, 0);
  assert.equal(metrics.drinks_per_hour, 0);
});

// ─────────────────────────────────────────────────────────────────────
// ルーター層: GET /payroll/:year/:month/:store_id (routers/payroll.pyのget_monthly_payroll相当)
// ─────────────────────────────────────────────────────────────────────
test("localApiCall経由: GET /payroll/:year/:month/:store_id が集計を返す(時給スタッフ)", async () => {
  await ensureStore("p-a");
  await createStaff({ id: "p-a-koji", name: "こうじ", store_id: "p-a", pay_type: "hourly", hourly_rate: 1250, transport_one_way: 0 }).catch(() => {});
  await putDay(2026, "2026-05-10", "p-a", {
    sales_excl_tax: 50000, customer_count: 10,
    staff_entries: [{ staff_id: "p-a-koji", hours: 8, drinks: 2, champagne: {}, okuri: false }],
  });
  const data = await localApiCall("GET", "/payroll/2026/5/p-a");
  assert.equal(data.year, 2026);
  assert.equal(data.store_id, "p-a");
  const sp = data.staff_payroll.find((s) => s.staff_id === "p-a-koji");
  assert.ok(sp, "対象スタッフの給与結果が見つからない");
  assert.equal(sp.base_pay, 10000); // 8 * 1250
  assert.equal(sp.drink_back, 140); // 2 * 70
  assert.equal(sp.total, 10140);
});

test("localApiCall経由: GET /payroll/effective-rate/:staff_id/:date がranking/store_idルートに横取りされない", async () => {
  await ensureStore("p-b");
  await createStaff({ id: "p-b-staff", name: "テスト", store_id: "p-b", pay_type: "hourly", hourly_rate: 1300 }).catch(() => {});
  const data = await localApiCall("GET", "/payroll/effective-rate/p-b-staff/2026-05-01");
  assert.equal(data.rate, 1300);
});

test("localApiCall経由: GET /payroll/:year/:month/ranking がstore_idルートに横取りされない", async () => {
  const data = await localApiCall("GET", "/payroll/2026/5/ranking");
  assert.ok("ranked" in data);
  assert.ok(Array.isArray(data.ranked));
});

test("GET /payroll: 日付エントリがnull/文字列等でもクラッシュしない", async () => {
  await ensureStore("p-c");
  await dbPut("daily", 2026, { "2026-06-29": { "p-c": null } });
  let data = await localApiCall("GET", "/payroll/2026/6/p-c");
  assert.equal(data.store_id, "p-c");

  await dbPut("daily", 2026, { "2026-06-29": { "p-c": "corrupted" } });
  data = await localApiCall("GET", "/payroll/2026/6/p-c");
  assert.equal(data.store_id, "p-c");
});

test("GET /payroll: staff_entriesにnullが混入してもクラッシュしない", async () => {
  await ensureStore("p-d");
  await createStaff({ id: "p-d-koji", name: "こうじ", store_id: "p-d", pay_type: "hourly", hourly_rate: 1250 }).catch(() => {});
  await dbPut("daily", 2026, {
    "2026-06-29": {
      "p-d": {
        closed: false, sales_excl_tax: 5000, customer_count: 2,
        staff_entries: [null, { staff_id: "p-d-koji", hours: 5, drinks: 1, champagne: {}, okuri: false }],
      },
    },
  });
  const data = await localApiCall("GET", "/payroll/2026/6/p-d");
  assert.equal(data.store_id, "p-d");
  const sp = data.staff_payroll.find((s) => s.staff_id === "p-d-koji");
  assert.ok(sp);
});

test("PUT /payroll/:year/:month/:store_id/:staff_id/adjustment: 保存・反映される", async () => {
  await ensureStore("p-e");
  await createStaff({ id: "p-e-koji", name: "こうじ", store_id: "p-e", pay_type: "hourly", hourly_rate: 1000, transport_one_way: 0 }).catch(() => {});
  await putDay(2026, "2026-07-01", "p-e", {
    sales_excl_tax: 10000, customer_count: 2,
    staff_entries: [{ staff_id: "p-e-koji", hours: 5, drinks: 0, champagne: {}, okuri: false }],
  });
  await localApiCall("PUT", "/payroll/2026/7/p-e/p-e-koji/adjustment", { amount: 500, memo: "ボーナス" });
  const data = await localApiCall("GET", "/payroll/2026/7/p-e");
  const sp = data.staff_payroll.find((s) => s.staff_id === "p-e-koji");
  assert.equal(sp.adjustment, 500);
  assert.equal(sp.adjustment_memo, "ボーナス");
  assert.equal(sp.total, 5000 + 500); // 5h*1000 + 調整500
});

test("PUT /payroll/.../adjustment: 存在しないstore_idは400で拒否される", async () => {
  await assert.rejects(
    async () => localApiCall("PUT", "/payroll/2026/7/garbage_store/some-staff/adjustment", { amount: 100 }),
    (err) => {
      assert.equal(err.status, 400);
      return true;
    }
  );
});
