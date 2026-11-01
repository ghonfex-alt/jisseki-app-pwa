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

async function ensureStore(storeId) {
  await createStore({ id: storeId, name: storeId + "店" }).catch(() => {});
}

// 各テスト後にロック状態を確実にクリアする(テスト間の汚染防止)。
async function cleanupLock(year, month) {
  await unlockMonth(year, month).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────
// isLocked / getSnapshot の遅延バインディング受け口が正しく定義されること
// ─────────────────────────────────────────────────────────────────────
test("payroll-admin読み込み後、window.isLocked/window.getSnapshotが関数として定義される", () => {
  assert.strictEqual(typeof global.isLocked, "function");
  assert.strictEqual(typeof global.getSnapshot, "function");
});

test("isLocked: 何もロックしていない月はfalse", () => {
  assert.strictEqual(isLocked(2099, 1), false);
});

// ─────────────────────────────────────────────────────────────────────
// getLocks / lockMonth / unlockMonth の基本動作
// ─────────────────────────────────────────────────────────────────────
test("getLocks: 初期状態は空dict", async () => {
  const locks = await getLocks();
  assert.deepStrictEqual(locks, {});
});

test("lockMonth → isLockedが即座にtrueになる(同期キャッシュ即時反映)", async () => {
  await ensureStore("pa-a");
  try {
    const result = await lockMonth(2026, 3);
    assert.deepStrictEqual(result, { locked: "2026-03" });
    assert.strictEqual(isLocked(2026, 3), true);

    const locks = await getLocks();
    assert.deepStrictEqual(locks, { "2026-03": true });
  } finally {
    await cleanupLock(2026, 3);
  }
});

test("lockMonth: 既にロック済みの月への再ロックは423", async () => {
  await ensureStore("pa-b");
  try {
    await lockMonth(2026, 4);
    await assert.rejects(async () => lockMonth(2026, 4), (err) => {
      assert.strictEqual(err.status, 423);
      assert.match(err.message, /既に給与確定済み/);
      return true;
    });
  } finally {
    await cleanupLock(2026, 4);
  }
});

test("unlockMonth: ロック解除後にisLockedがfalseになる", async () => {
  await ensureStore("pa-c");
  await lockMonth(2026, 5);
  assert.strictEqual(isLocked(2026, 5), true);

  const result = await unlockMonth(2026, 5);
  assert.deepStrictEqual(result, { unlocked: "2026-05" });
  assert.strictEqual(isLocked(2026, 5), false);

  const locks = await getLocks();
  assert.ok(!("2026-05" in locks));
});

test("unlockMonth: ロックされていない月でも例外を投げず成功する(Python版と同じ無条件成功)", async () => {
  const result = await unlockMonth(2099, 12);
  assert.deepStrictEqual(result, { unlocked: "2099-12" });
});

// ─────────────────────────────────────────────────────────────────────
// スナップショット: ロック時点のデータで凍結され、以後のdailyデータ変更に影響されない
// ─────────────────────────────────────────────────────────────────────
test("lockMonth: 全店舗分のスナップショットが作成され、getSnapshotで取得できる", async () => {
  await ensureStore("pa-d1");
  await ensureStore("pa-d2");
  await createStaff({ id: "pa-d1-koji", name: "こうじ", store_id: "pa-d1", pay_type: "hourly", hourly_rate: 1000, transport_one_way: 0 });
  await createStaff({ id: "pa-d2-yuki", name: "ゆき", store_id: "pa-d2", pay_type: "hourly", hourly_rate: 1200, transport_one_way: 0 });
  await putDay(2026, "2026-06-10", "pa-d1", {
    sales_excl_tax: 10000, customer_count: 2,
    staff_entries: [{ staff_id: "pa-d1-koji", hours: 5, drinks: 0, champagne: {}, okuri: false }],
  });
  await putDay(2026, "2026-06-10", "pa-d2", {
    sales_excl_tax: 20000, customer_count: 4,
    staff_entries: [{ staff_id: "pa-d2-yuki", hours: 6, drinks: 0, champagne: {}, okuri: false }],
  });

  try {
    await lockMonth(2026, 6);

    const snap1 = await getSnapshot(2026, 6, "pa-d1");
    assert.ok(snap1);
    assert.strictEqual(snap1.store_id, "pa-d1");
    const sp1 = snap1.staff_payroll.find((s) => s.staff_id === "pa-d1-koji");
    assert.strictEqual(sp1.base_pay, 5000); // 5h * 1000

    const snap2 = await getSnapshot(2026, 6, "pa-d2");
    assert.ok(snap2);
    assert.strictEqual(snap2.store_id, "pa-d2");
  } finally {
    await cleanupLock(2026, 6);
  }
});

test("【回帰】ロック後にdaily実績を直接改変しても、GET /payroll はスナップショットのまま変わらない", async () => {
  await ensureStore("pa-e");
  await createStaff({ id: "pa-e-koji", name: "こうじ", store_id: "pa-e", pay_type: "hourly", hourly_rate: 1000, transport_one_way: 0 });
  await putDay(2026, "2026-07-10", "pa-e", {
    sales_excl_tax: 10000, customer_count: 2,
    staff_entries: [{ staff_id: "pa-e-koji", hours: 5, drinks: 0, champagne: {}, okuri: false }],
  });

  try {
    await lockMonth(2026, 7);

    // ロック後にdailyストアを直接書き換える(putDay経由だと423で拒否されるため、
    // 「ロックをすり抜けて裏からデータが変わった」ケースを直接再現する)。
    const yearData = await dbGet("daily", 2026);
    yearData["2026-07-10"]["pa-e"].staff_entries[0].hours = 100;
    await dbPut("daily", 2026, yearData);

    const data = await localApiCall("GET", "/payroll/2026/7/pa-e");
    const sp = data.staff_payroll.find((s) => s.staff_id === "pa-e-koji");
    assert.strictEqual(sp.base_pay, 5000, "ロック済みのはずの給与がdailyデータの事後変更に追随してしまっている");
  } finally {
    await cleanupLock(2026, 7);
  }
});

test("unlockMonth: スナップショット破棄後はGET /payrollが最新データで再計算される", async () => {
  await ensureStore("pa-f");
  await createStaff({ id: "pa-f-koji", name: "こうじ", store_id: "pa-f", pay_type: "hourly", hourly_rate: 1000, transport_one_way: 0 });
  await putDay(2026, "2026-08-10", "pa-f", {
    sales_excl_tax: 10000, customer_count: 2,
    staff_entries: [{ staff_id: "pa-f-koji", hours: 5, drinks: 0, champagne: {}, okuri: false }],
  });
  await lockMonth(2026, 8);

  await unlockMonth(2026, 8);
  const snapAfterUnlock = await getSnapshot(2026, 8, "pa-f");
  assert.strictEqual(snapAfterUnlock, undefined, "unlock後もスナップショットが残っている");

  // ロック解除後は再度編集できる。
  await putDay(2026, "2026-08-10", "pa-f", {
    sales_excl_tax: 10000, customer_count: 2,
    staff_entries: [{ staff_id: "pa-f-koji", hours: 8, drinks: 0, champagne: {}, okuri: false }],
  });
  const data = await localApiCall("GET", "/payroll/2026/8/pa-f");
  const sp = data.staff_payroll.find((s) => s.staff_id === "pa-f-koji");
  assert.strictEqual(sp.base_pay, 8000); // 8h * 1000 (再計算されている)
});

// ─────────────────────────────────────────────────────────────────────
// 統合テスト: Task3〜5の遅延バインディングが本物のロックに正しく繋がること
// ─────────────────────────────────────────────────────────────────────
test("【統合】lockMonth後、PUT /daily/:year/:date/:store_id が423で拒否される", async () => {
  await ensureStore("pa-g");
  try {
    await lockMonth(2026, 9);
    await assert.rejects(
      async () => putDay(2026, "2026-09-01", "pa-g", { sales_excl_tax: 1 }),
      (err) => {
        assert.strictEqual(err.status, 423);
        assert.match(err.message, /給与確定済み/);
        return true;
      }
    );
  } finally {
    await cleanupLock(2026, 9);
  }
});

test("【統合】lockMonth後、POST /daily/.../reset が423で拒否される", async () => {
  await ensureStore("pa-h");
  await putDay(2026, "2026-10-01", "pa-h", { sales_excl_tax: 1 });
  try {
    await lockMonth(2026, 10);
    await assert.rejects(
      async () => resetDay(2026, "2026-10-01", "pa-h"),
      (err) => {
        assert.strictEqual(err.status, 423);
        return true;
      }
    );
  } finally {
    await cleanupLock(2026, 10);
  }
});

test("【統合】unlockMonth後は再度daily編集ができる", async () => {
  await ensureStore("pa-i");
  await lockMonth(2026, 11);
  await unlockMonth(2026, 11);
  const day = await putDay(2026, "2026-11-01", "pa-i", { sales_excl_tax: 500 });
  assert.strictEqual(day.sales_excl_tax, 500);
});

test("【統合】lockMonth後、staff.jsのrate_history変更(対象月)も423で拒否される", async () => {
  await ensureStore("pa-j");
  await createStaff({ id: "pa-j-staff", name: "J", store_id: "pa-j", pay_type: "hourly", rate_history: [] });
  try {
    await lockMonth(2026, 6);
    await assert.rejects(
      async () => updateStaff("pa-j-staff", { rate_history: [{ from: "2026-06-01", rate: 1500 }] }),
      (err) => {
        assert.strictEqual(err.status, 423);
        return true;
      }
    );
  } finally {
    await cleanupLock(2026, 6);
  }
});

test("【統合】lockMonth後、個別調整(adjustment)の変更は423で拒否される", async () => {
  await ensureStore("pa-k");
  await createStaff({ id: "pa-k-koji", name: "こうじ", store_id: "pa-k", pay_type: "hourly", hourly_rate: 1000 });
  try {
    await lockMonth(2026, 12);
    await assert.rejects(
      async () => setAdjustment(2026, 12, "pa-k", "pa-k-koji", { amount: 100 }),
      (err) => {
        assert.strictEqual(err.status, 423);
        assert.match(err.message, /給与確定済み/);
        return true;
      }
    );
  } finally {
    await cleanupLock(2026, 12);
  }
});

test("【統合】ロック前の調整は保存・取得でき、GET /payrollに反映される", async () => {
  await ensureStore("pa-l");
  await createStaff({ id: "pa-l-koji", name: "こうじ", store_id: "pa-l", pay_type: "hourly", hourly_rate: 1000, transport_one_way: 0 });
  await putDay(2027, "2027-01-01", "pa-l", {
    sales_excl_tax: 5000, customer_count: 1,
    staff_entries: [{ staff_id: "pa-l-koji", hours: 4, drinks: 0, champagne: {}, okuri: false }],
  });
  const saved = await setAdjustment(2027, 1, "pa-l", "pa-l-koji", { amount: 300, memo: "手当" });
  assert.strictEqual(saved.amount, 300);

  const data = await localApiCall("GET", "/payroll/2027/1/pa-l");
  const sp = data.staff_payroll.find((s) => s.staff_id === "pa-l-koji");
  assert.strictEqual(sp.adjustment, 300);
  assert.strictEqual(sp.adjustment_memo, "手当");
  assert.strictEqual(sp.total, 4000 + 300);
});

// ─────────────────────────────────────────────────────────────────────
// ルーター層経由(localApiCall)
// ─────────────────────────────────────────────────────────────────────
test("localApiCall経由: POST/GET/DELETE /payroll/lock/:year/:month", async () => {
  await ensureStore("pa-m");
  try {
    const locked = await localApiCall("POST", "/payroll/lock/2026/2");
    assert.deepStrictEqual(locked, { locked: "2026-02" });

    const locks = await localApiCall("GET", "/payroll/locks");
    assert.deepStrictEqual(locks, { "2026-02": true });

    const unlocked = await localApiCall("DELETE", "/payroll/lock/2026/2");
    assert.deepStrictEqual(unlocked, { unlocked: "2026-02" });

    const locksAfter = await localApiCall("GET", "/payroll/locks");
    assert.ok(!("2026-02" in locksAfter));
  } finally {
    await cleanupLock(2026, 2);
  }
});

// ─────────────────────────────────────────────────────────────────────
// 起動直後(前回セッションの確定状態の再読込)
// ─────────────────────────────────────────────────────────────────────
test("ensureLocksLoaded: アプリ再起動相当(メモリキャッシュ再構築)でも前回のロックを認識する", async () => {
  await ensureStore("pa-n");
  await lockMonth(2026, 1); // IndexedDBには"2026-01"が永続化されている

  // 「アプリを再起動した」状態を再現する: メモリキャッシュだけを空にする
  // (IndexedDB側のpayroll_locksレコードはそのまま残っている)。
  _resetLocksCacheForTest();
  assert.strictEqual(isLocked(2026, 1), false, "キャッシュリセット直後はまだ読み込み中のはず");

  await ensureLocksLoaded();
  assert.strictEqual(isLocked(2026, 1), true, "IndexedDBに永続化済みのロックが再読込後に反映されていない");

  await cleanupLock(2026, 1);
});
