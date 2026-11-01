"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("./setup");
require("../db.js");
require("../local-api.js");
require("../local/store.js");
require("../local/daily.js");

const YEAR = 2026;

// テスト用の店舗を1つ作っておく(checkStoreIdを通すため)。重複作成はエラーを
// 握りつぶす(local-staff.test.jsのensureStoreと同じパターン)。
async function ensureStore(storeId) {
  await createStore({ id: storeId, name: storeId + "店" }).catch(() => {});
}

test("getDay: データが無ければEMPTY_DAY相当(memoは新設フィールド)", async () => {
  await ensureStore("d-a");
  const day = await getDay(YEAR, "2026-01-01", "d-a");
  assert.strictEqual(day.closed, false);
  assert.strictEqual(day.sales_excl_tax, 0);
  assert.strictEqual(day.customer_count, 0);
  assert.strictEqual(day.card_sales, 0);
  assert.deepStrictEqual(day.staff_entries, []);
  assert.strictEqual(day.memo, ""); // 新設: 日報メモの既定値
});

test("putDay → getDay: 保存した内容がそのまま読めること", async () => {
  await ensureStore("d-b");
  const payload = {
    closed: false,
    sales_excl_tax: 71100,
    customer_count: 18,
    card_sales: 61160,
    staff_entries: [
      { staff_id: "yabu", hours: 7.5, drinks: 3, champagne: { orishan: 1 }, okuri: false },
    ],
  };
  await putDay(YEAR, "2026-01-02", "d-b", payload);
  const day = await getDay(YEAR, "2026-01-02", "d-b");
  assert.strictEqual(day.sales_excl_tax, 71100);
  assert.strictEqual(day.staff_entries[0].hours, 7.5);
});

test("getMonth: 配列を返す", async () => {
  await ensureStore("d-c");
  const days = await getMonth(YEAR, 1, "d-c");
  assert.ok(Array.isArray(days));
});

test("getMonthAll: PUT後にbulkエンドポイント相当で取得できる", async () => {
  await ensureStore("d-d");
  await putDay(YEAR, "2026-01-03", "d-d", { sales_excl_tax: 12345, customer_count: 5, staff_entries: [] });
  const data = await getMonthAll(YEAR, "2026-01");
  assert.ok("2026-01-03" in data);
  assert.strictEqual(data["2026-01-03"]["d-d"].sales_excl_tax, 12345);
});

test("localApiCall経由: GET /daily/:year/ym/:ym が /:year/:date/:store_id に横取りされない", async () => {
  await ensureStore("d-e");
  await localApiCall("PUT", `/daily/${YEAR}/2026-01-04/d-e`, { sales_excl_tax: 999, staff_entries: [] });
  const data = await localApiCall("GET", `/daily/${YEAR}/ym/2026-01`);
  assert.strictEqual(typeof data, "object");
  Object.keys(data).forEach((key) => {
    assert.ok(key.startsWith("2026-01-"), `unexpected key: ${key}`);
  });
  assert.strictEqual(data["2026-01-04"]["d-e"].sales_excl_tax, 999);
});

test("getMonth: 非dict値が混入していてもクラッシュしない", async () => {
  await ensureStore("d-f");
  await dbPut("daily", YEAR, { "2026-01-05": "malformed_string" });
  const days = await getMonth(YEAR, 1, "d-f");
  assert.ok(Array.isArray(days));
});

test("getDay: 日付エントリがdict以外でもEMPTY_DAY相当を返す", async () => {
  await ensureStore("d-g");
  await dbPut("daily", YEAR, { "2026-01-06": "corrupted_non_dict" });
  const day = await getDay(YEAR, "2026-01-06", "d-g");
  assert.strictEqual(day.sales_excl_tax, 0);
  assert.strictEqual(day.closed, false);
});

test("putDay: 日付エントリがdict以外でも正常に書き込める", async () => {
  await ensureStore("d-h");
  await dbPut("daily", YEAR, { "2026-01-07": "corrupted_non_dict" });
  await putDay(YEAR, "2026-01-07", "d-h", { sales_excl_tax: 9999 });
  const all = await dbGet("daily", YEAR);
  assert.strictEqual(typeof all["2026-01-07"], "object");
  assert.strictEqual(all["2026-01-07"]["d-h"].sales_excl_tax, 9999);
});

test("getDay: 店舗エントリがnullでもEMPTY_DAY相当を返す", async () => {
  await ensureStore("d-i");
  await dbPut("daily", YEAR, { "2026-01-08": { "d-i": null } });
  const day = await getDay(YEAR, "2026-01-08", "d-i");
  assert.strictEqual(day.sales_excl_tax, 0);
  assert.strictEqual(day.closed, false);
});

test("putDay: URLのyearとdateの年が一致しなければ400", async () => {
  await ensureStore("d-j");
  await assert.rejects(async () => putDay(2025, "2026-01-09", "d-j", { sales_excl_tax: 1 }), (err) => {
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("putDay: 存在しないstore_idは400で拒否され、データも作られない", async () => {
  await assert.rejects(
    async () => putDay(YEAR, "2026-01-10", "garbage_store", { sales_excl_tax: 9999 }),
    (err) => {
      assert.strictEqual(err.status, 400);
      return true;
    }
  );
  const all = (await dbGet("daily", YEAR)) || {};
  const day = all["2026-01-10"] || {};
  assert.ok(!("garbage_store" in day));
});

test("resetDay: 存在しないstore_idは400で拒否される", async () => {
  await assert.rejects(async () => resetDay(YEAR, "2026-01-11", "garbage_store"), (err) => {
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("putDay: 不正な形式のdateは400(_month_ofが無言で0を返さないこと)", async () => {
  await ensureStore("d-k");
  await assert.rejects(async () => putDay(YEAR, "not-a-date", "d-k", { sales_excl_tax: 9999 }), (err) => {
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("putDay: 給与確定済みの月は423", async () => {
  await ensureStore("d-l");
  global.isLocked = (y, m) => y === 2026 && m === 1;
  try {
    await assert.rejects(async () => putDay(YEAR, "2026-01-12", "d-l", { sales_excl_tax: 9999 }), (err) => {
      assert.strictEqual(err.status, 423);
      assert.match(err.message, /給与確定済み/);
      return true;
    });
  } finally {
    delete global.isLocked;
  }
});

test("resetDay: 給与確定済みの月は423", async () => {
  await ensureStore("d-l2");
  global.isLocked = (y, m) => y === 2026 && m === 1;
  try {
    await assert.rejects(async () => resetDay(YEAR, "2026-01-13", "d-l2"), (err) => {
      assert.strictEqual(err.status, 423);
      assert.match(err.message, /給与確定済み/);
      return true;
    });
  } finally {
    delete global.isLocked;
  }
});

test("putDay: isLockedが未定義(Task6未実装)の間は常に許可する", async () => {
  await ensureStore("d-m");
  assert.strictEqual(typeof global.isLocked, "undefined");
  const day = await putDay(YEAR, "2026-01-14", "d-m", { sales_excl_tax: 100 });
  assert.strictEqual(day.sales_excl_tax, 100);
});

test("putDay: staff_entriesだけ更新しても他フィールドが消えない(部分更新)", async () => {
  await ensureStore("d-n");
  await putDay(YEAR, "2026-01-15", "d-n", {
    sales_excl_tax: 10000,
    customer_count: 3,
    staff_entries: [{ staff_id: "koji", hours: 5, drinks: 1, champagne: {}, okuri: false, include_drink: true }],
  });
  await putDay(YEAR, "2026-01-15", "d-n", { sales_excl_tax: 20000 });
  const day = await getDay(YEAR, "2026-01-15", "d-n");
  assert.strictEqual(day.sales_excl_tax, 20000);
  assert.strictEqual(day.staff_entries.length, 1);
  assert.strictEqual(day.staff_entries[0].staff_id, "koji");
});

test("resetDay: {}を書き込むのではなくキー自体を削除する(EMPTY_DAYと完全一致)", async () => {
  await ensureStore("d-o");
  await putDay(YEAR, "2026-01-16", "d-o", { sales_excl_tax: 99999, card_sales: 100, customer_count: 2 });
  const result = await resetDay(YEAR, "2026-01-16", "d-o");
  assert.deepStrictEqual(result, { reset: true, date: "2026-01-16", store_id: "d-o" });

  const all = (await dbGet("daily", YEAR)) || {};
  const day = all["2026-01-16"] || {};
  assert.ok(!("d-o" in day)); // {}が残っているだけでは不合格

  const fetched = await getDay(YEAR, "2026-01-16", "d-o");
  assert.deepStrictEqual(fetched, dailyEmptyDay());
});

test("putDay: _deletedフラグがbodyに含まれていても保存結果に残らない", async () => {
  await ensureStore("d-p");
  await dbPut("daily", YEAR, { "2026-01-17": { "d-p": { _deleted: true } } });

  const body = { _deleted: true, sales_excl_tax: 5000, customer_count: 1 };
  const result = await putDay(YEAR, "2026-01-17", "d-p", body);
  assert.ok(!("_deleted" in result));

  const all = await dbGet("daily", YEAR);
  assert.ok(!("_deleted" in all["2026-01-17"]["d-p"]));
});

// --- 新設: キャッチ・呼び・延長インセンティブカウント ---

test("putDay: catch_count/call_count/extension_countの保存・取得", async () => {
  await ensureStore("d-q");
  await putDay(YEAR, "2026-01-18", "d-q", {
    staff_entries: [
      { staff_id: "s1", hours: 5, drinks: 2, catch_count: 3, call_count: 1, extension_count: 2 },
    ],
  });
  const day = await getDay(YEAR, "2026-01-18", "d-q");
  assert.strictEqual(day.staff_entries[0].catch_count, 3);
  assert.strictEqual(day.staff_entries[0].call_count, 1);
  assert.strictEqual(day.staff_entries[0].extension_count, 2);
});

test("putDay: catch_count/call_count/extension_countが未指定でも保存できる(デフォルトはUI/payroll側で0扱い)", async () => {
  await ensureStore("d-r");
  const day = await putDay(YEAR, "2026-01-19", "d-r", {
    staff_entries: [{ staff_id: "s1", hours: 5 }],
  });
  assert.strictEqual(day.staff_entries[0].catch_count, undefined);
});

for (const field of ["catch_count", "call_count", "extension_count"]) {
  test(`putDay: staff_entries[].${field}が負数だと400`, async () => {
    await ensureStore("d-s-" + field);
    await assert.rejects(
      async () =>
        putDay(YEAR, "2026-01-20", "d-s-" + field, {
          staff_entries: [{ staff_id: "s1", hours: 5, [field]: -1 }],
        }),
      (err) => {
        assert.strictEqual(err.status, 400);
        assert.match(err.message, new RegExp(field + " must not be negative"));
        return true;
      }
    );
  });

  test(`putDay: staff_entries[].${field}が文字列だと400`, async () => {
    await ensureStore("d-t-" + field);
    await assert.rejects(
      async () =>
        putDay(YEAR, "2026-01-21", "d-t-" + field, {
          staff_entries: [{ staff_id: "s1", hours: 5, [field]: "abc" }],
        }),
      (err) => {
        assert.strictEqual(err.status, 400);
        return true;
      }
    );
  });
}

// --- 新設: 日報メモ欄 ---

test("putDay → getDay: memoフィールドが自由記述で保存・取得できる(バリデーション無し)", async () => {
  await ensureStore("d-u");
  await putDay(YEAR, "2026-01-22", "d-u", { memo: "レジ金が1000円合わない" });
  const day = await getDay(YEAR, "2026-01-22", "d-u");
  assert.strictEqual(day.memo, "レジ金が1000円合わない");
});

test("localApiCall経由でのルーティング: GET/PUT/POST(reset) /daily/...", async () => {
  await ensureStore("d-route");
  const putResult = await localApiCall("PUT", `/daily/${YEAR}/2026-01-23/d-route`, {
    sales_excl_tax: 3000,
    staff_entries: [{ staff_id: "s1", hours: 4, catch_count: 1 }],
  });
  assert.strictEqual(putResult.sales_excl_tax, 3000);

  const fetched = await localApiCall("GET", `/daily/${YEAR}/2026-01-23/d-route`);
  assert.strictEqual(fetched.sales_excl_tax, 3000);

  const month = await localApiCall("GET", `/daily/${YEAR}/month/1/d-route`);
  assert.ok(month.some((d) => d.date === "2026-01-23"));

  const reset = await localApiCall("POST", `/daily/${YEAR}/2026-01-23/d-route/reset`);
  assert.deepStrictEqual(reset, { reset: true, date: "2026-01-23", store_id: "d-route" });

  const afterReset = await localApiCall("GET", `/daily/${YEAR}/2026-01-23/d-route`);
  assert.deepStrictEqual(afterReset, dailyEmptyDay());
});

test("getAnnual: 月別集計(売上・客数・営業日数・平均)を正しく返す", async () => {
  await ensureStore("d-annual");
  await putDay(YEAR, "2026-02-01", "d-annual", { sales_excl_tax: 10000, customer_count: 5 });
  await putDay(YEAR, "2026-02-02", "d-annual", { sales_excl_tax: 20000, customer_count: 10 });
  await putDay(YEAR, "2026-02-03", "d-annual", { sales_excl_tax: 0, customer_count: 0, closed: true });
  await putDay(YEAR, "2026-03-01", "d-annual", { sales_excl_tax: 5000, customer_count: 2 });

  const annual = await localApiCall("GET", `/daily/${YEAR}/annual`);
  assert.ok(annual["d-annual"]);
  const feb = annual["d-annual"].find((m) => m.month === "2026-02");
  assert.strictEqual(feb.sales, 30000);
  assert.strictEqual(feb.customers, 15);
  assert.strictEqual(feb.open_days, 2);
  assert.strictEqual(feb.avg_daily_sales, 15000);
  assert.strictEqual(feb.avg_per_customer, 2000);
  const mar = annual["d-annual"].find((m) => m.month === "2026-03");
  assert.strictEqual(mar.sales, 5000);
});

test("getAnnual: データが無い店舗は結果に含まれない", async () => {
  await ensureStore("d-annual-empty");
  const annual = await localApiCall("GET", `/daily/${YEAR}/annual`);
  assert.strictEqual(annual["d-annual-empty"], undefined);
});

test("getStoreHistory: 複数年をまたいで月別の売上・客数を集計する", async () => {
  await ensureStore("d-hist");
  await putDay(2025, "2025-12-15", "d-hist", { sales_excl_tax: 8000, customer_count: 4 });
  await putDay(YEAR, "2026-01-10", "d-hist", { sales_excl_tax: 12000, customer_count: 6 });
  await putDay(YEAR, "2026-01-11", "d-hist", { sales_excl_tax: 0, customer_count: 0, closed: true });

  const hist = await localApiCall("GET", "/sync/history/d-hist");
  assert.strictEqual(hist.store, "d-hist");
  const dec = hist.months.find((m) => m.month === "2025-12");
  assert.strictEqual(dec.sales, 8000);
  assert.strictEqual(dec.customers, 4);
  assert.strictEqual(dec.avg_per_customer, 2000);
  const jan = hist.months.find((m) => m.month === "2026-01");
  assert.strictEqual(jan.sales, 12000);
  assert.strictEqual(jan.customers, 6);
});

test("getStoreHistory: データが無い店舗は空のmonths配列を返す", async () => {
  const hist = await localApiCall("GET", "/sync/history/d-hist-none");
  assert.strictEqual(hist.store, "d-hist-none");
  assert.deepStrictEqual(hist.months, []);
});
