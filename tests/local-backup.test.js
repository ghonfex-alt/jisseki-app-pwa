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
require("../local/backup.js");

// ストアごとに型の違うキー(文字列id・number・固定文字列・複合文字列)を混在させて
// 書き込む。db.jsの全ストアはout-of-lineキー(createObjectStoreにkeyPath無し)な
// ので、本テストはdbGetAllWithKeysで得たキーの「型」まで含めてバックアップ/
// リストアが正しく機能することを検証する。
async function _seedAllStores() {
  await dbPut("stores", "store-a", { id: "store-a", name: "A店" });
  await dbPut("staff", "staff-1", { id: "staff-1", name: "スタッフ1", store_id: "store-a" });
  await dbPut("daily", 2026, { "2026-06-01": { "store-a": { sales_excl_tax: 10000 } } }); // キーがnumber
  await dbPut("shifts", "2026-06-store-a", { shifts: ["staff-1"] });
  await dbPut("shift_requests", "2026-06-store-a", { requests: [] });
  await dbPut("shift_gap_dismissed", "2026-06-01::store-a::staff-1", true);
  await dbPut("inventory", "store-a", [{ id: "flavor-1", name: "フレーバー1", stock: 5 }]);
  await dbPut("inventory_log", "log", [{ at: "2026-06-01T00:00:00.000Z", delta: 1 }]);
  await dbPut("settings", "global", { wanope_bonus: 0, incentive_rates: { catch: { yen_per_count: 300 } } });
  await dbPut("license", "status", { activated: true });
  await dbPut("payroll_locks", "2026-06", { year: 2026, month: 6, locked_at: "2026-06-30T00:00:00.000Z" });
  await dbPut("payroll_snapshots", "2026-06-store-a", { year: 2026, month: 6, store_id: "store-a", total_sales: 10000 });
  await dbPut("payroll_adjustments", "2026-06-store-a-staff-1", { amount: 1000, note: "調整" });
  await dbPut("targets", "store-a", { monthly: 1200000 });
  await dbPut("nippo_confirmed", "2026-06-01::store-a", true);
}

// 全ストアのスナップショット({storeName: [{key,value}, ...]}、キーでソート済み)を取る。
async function _snapshotAll() {
  const snap = {};
  for (const name of DB_STORE_NAMES) {
    const entries = await dbGetAllWithKeys(name);
    entries.sort((a, b) => String(a.key).localeCompare(String(b.key)));
    snap[name] = entries;
  }
  return snap;
}

async function _clearAll() {
  for (const name of DB_STORE_NAMES) {
    await dbClear(name);
  }
}

test("dbGetAllWithKeys/dbClear: 値だけでなくキーも取得でき、clearで全消去できる(db.js新設ヘルパー)", async () => {
  await dbPut("targets", "db-helper-store", { monthly: 500000 });
  const before = await dbGetAllWithKeys("targets");
  assert.ok(before.some((e) => e.key === "db-helper-store" && e.value.monthly === 500000));

  await dbClear("targets");
  const after = await dbGetAllWithKeys("targets");
  assert.deepStrictEqual(after, []);
});

test("exportBackup: 全DB_STORE_NAMESを含み、各ストアがkey/valueペアの配列になっている", async () => {
  await _clearAll();
  await _seedAllStores();

  const backup = await exportBackup();
  assert.strictEqual(backup.format, "jisseki-app-pwa-backup");
  assert.strictEqual(backup.version, 1);
  assert.ok(typeof backup.exported_at === "string" && backup.exported_at.length > 0);

  for (const name of DB_STORE_NAMES) {
    assert.ok(Array.isArray(backup.stores[name]), `stores.${name} should be an array`);
  }
  // dailyストアはnumberキー(年)のまま保持されていること(文字列化されていない)。
  const dailyEntry = backup.stores.daily.find((e) => e.key === 2026);
  assert.ok(dailyEntry, "daily entry with number key 2026 should exist");
  assert.strictEqual(typeof dailyEntry.key, "number");
});

test("ラウンドトリップ: export→全ストアwipe→import で元のデータと完全一致する", async () => {
  await _clearAll();
  await _seedAllStores();

  const before = await _snapshotAll();

  // ファイル書き出し→読み込みと同じ経路を通す(JSON文字列化を経由させることで
  // 「JSON.stringifyでnumberキーが壊れないか」等もあわせて検証する)。
  const exported = await exportBackup();
  const json = JSON.stringify(exported);

  await _clearAll();
  const wiped = await _snapshotAll();
  for (const name of DB_STORE_NAMES) {
    assert.deepStrictEqual(wiped[name], [], `${name} should be empty after wipe`);
  }

  const parsed = JSON.parse(json);
  const result = await importBackup(parsed);

  const after = await _snapshotAll();
  assert.deepStrictEqual(after, before, "import後のデータがexport前と完全一致すること");

  // store_countsが各ストアの件数(本テストでは全ストア1件)を正しく報告すること。
  for (const name of DB_STORE_NAMES) {
    assert.strictEqual(result.store_counts[name], before[name].length);
  }
});

test("importBackup: バックアップに含まれないストア名は既存データを変更しない(部分バックアップの安全側挙動)", async () => {
  await _clearAll();
  await _seedAllStores();

  const full = await exportBackup();
  // "staff"ストアをバックアップから除外した「古いバージョンのバックアップ」を模す。
  const partial = { ...full, stores: { ...full.stores } };
  delete partial.stores.staff;

  const beforeStaff = await dbGetAllWithKeys("staff");
  await importBackup(partial);
  const afterStaff = await dbGetAllWithKeys("staff");

  assert.deepStrictEqual(afterStaff, beforeStaff, "backupに含まれないstaffストアは変更されない");
});

test("importBackup: バックアップ時点に無かった新規レコードはimportで消える(全件クリア方式の意図通り)", async () => {
  await _clearAll();
  await _seedAllStores();
  const backup = await exportBackup();

  // バックアップ後にユーザーが追加したレコード。
  await dbPut("staff", "staff-added-after-backup", { id: "staff-added-after-backup", name: "後から追加" });

  await importBackup(backup);

  const staffAfter = await dbGetAllWithKeys("staff");
  assert.ok(
    !staffAfter.some((e) => e.key === "staff-added-after-backup"),
    "バックアップ時点に無かったレコードはimport(上書き)で消えること"
  );
});

test("importBackup: 配列要素が壊れている(オブジェクトでない/keyが無い)場合はスキップし全体は失敗しない", async () => {
  await dbClear("targets");
  const backup = {
    format: "jisseki-app-pwa-backup",
    version: 1,
    exported_at: new Date().toISOString(),
    stores: { targets: [null, "not-an-object", { noKeyField: true }, { key: "ok-store", value: { monthly: 1 } }] },
  };
  const result = await importBackup(backup);
  assert.strictEqual(result.store_counts.targets, 1);
  const entries = await dbGetAllWithKeys("targets");
  assert.deepStrictEqual(entries, [{ key: "ok-store", value: { monthly: 1 } }]);
});

test("importBackup: 不正な形式はApiError(400)で拒否される", async () => {
  await assert.rejects(() => importBackup(null), (err) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.status, 400);
    return true;
  });
  await assert.rejects(() => importBackup([1, 2, 3]), (err) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.status, 400);
    return true;
  });
  await assert.rejects(() => importBackup({ format: "something-else", stores: {} }), (err) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.status, 400);
    return true;
  });
  await assert.rejects(() => importBackup({ format: "jisseki-app-pwa-backup" }), (err) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.status, 400);
    return true;
  });
  await assert.rejects(
    () => importBackup({ format: "jisseki-app-pwa-backup", stores: { targets: "not-an-array" } }),
    (err) => {
      assert.ok(err instanceof ApiError);
      assert.strictEqual(err.status, 400);
      return true;
    }
  );
});

test("local-api経由: POST /backup/export → POST /backup/import でラウンドトリップできる", async () => {
  await _clearAll();
  await _seedAllStores();
  const before = await _snapshotAll();

  // Node環境ではdocument/navigator.shareが無いため、ダウンロード処理自体は
  // 何もしない(local/export.js::downloadWorkbook/_downloadViaAnchorの早期return)。
  // ここではルーティング(localApiCall)経由でハンドラが正しく呼ばれ、
  // 期待するレスポンス形になることを検証する。
  const exportResult = await localApiCall("POST", "/backup/export");
  assert.match(exportResult.filename, /^jisseki-backup_\d{8}_\d{4}\.json$/);
  for (const name of DB_STORE_NAMES) {
    assert.strictEqual(exportResult.store_counts[name], before[name].length);
  }

  // exportBackup()を直接呼んでファイルの内容相当を取得し、JSON文字列化→解析を
  // 経由させてimportルートに渡す(実際のフロント側のFileReader+JSON.parseと同じ経路)。
  const data = await exportBackup();
  const roundTripped = JSON.parse(JSON.stringify(data));

  await _clearAll();
  const importResult = await localApiCall("POST", "/backup/import", roundTripped);
  for (const name of DB_STORE_NAMES) {
    assert.strictEqual(importResult.store_counts[name], before[name].length);
  }

  const after = await _snapshotAll();
  assert.deepStrictEqual(after, before);
});
