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

test("ラウンドトリップ: export→全ストアwipe→import で元のデータと完全一致する(licenseを除く)", async () => {
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
  // audit-loop(2026-11-02)の監査でlicenseストアをインポート対象から除外した
  // (セキュリティ修正、下の専用テスト参照)ため、licenseだけは意図的に
  // 復元されない(=wipe後の空のまま)。それ以外の全ストアは完全一致すること。
  const otherStores = DB_STORE_NAMES.filter((n) => n !== "license");
  for (const name of otherStores) {
    assert.deepStrictEqual(after[name], before[name], `${name} should match before after import`);
  }
  assert.deepStrictEqual(after.license, [], "licenseはインポート対象から除外され、復元されないこと");

  // store_countsが各ストアの件数(本テストでは全ストア1件)を正しく報告すること。
  // licenseはインポート処理自体をスキップするためstore_countsに含まれない。
  for (const name of otherStores) {
    assert.strictEqual(result.store_counts[name], before[name].length);
  }
  assert.strictEqual(result.store_counts.license, undefined);
});

// audit-loop(2026-11-02)の監査で指摘(設計批評・major、実際に再現可能な
// セキュリティ上の懸念): クライアント側のみのライセンス認証
// (local/license.js)は、バックアップの「データを読み込む」機能経由でも
// 回避できてしまっていた——stores.license に{"key":"status",
// "value":{"activated":true}}を仕込んだJSONを読み込ませるだけで、
// 正規のライセンスキーを一切知らなくても認証済み状態にできた(devtoolsが
// 使える人向けの回避策より、むしろこちらの方が「普通にアプリのUIを操作する
// だけ」で再現できてしまう分、危険度が高い)。修正後はlicenseストアが常に
// インポート対象から除外されるため、この経路での認証バイパスができない
// ことを直接検証する。
test("importBackup: 偽のライセンス認証情報を仕込んだバックアップを読み込んでも認証状態は変わらない(セキュリティ修正)", async () => {
  await dbClear("license");
  // 現在のアプリは未認証状態。
  const beforeLicense = await dbGetAllWithKeys("license");
  assert.deepStrictEqual(beforeLicense, []);

  // 攻撃者が仕込んだ、認証済みを偽装するバックアップファイル。
  const maliciousBackup = {
    format: "jisseki-app-pwa-backup",
    version: 1,
    exported_at: new Date().toISOString(),
    stores: {
      license: [{ key: "status", value: { activated: true } }],
    },
  };

  await importBackup(maliciousBackup);

  const afterLicense = await dbGetAllWithKeys("license");
  assert.deepStrictEqual(
    afterLicense,
    [],
    "licenseストアはインポートで一切変更されないこと(偽の認証情報が書き込まれていない)"
  );
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

  // Node環境ではdocument/navigator.shareが無いため、ダウンロード処理自体は
  // 何もしない(local/export.js::downloadWorkbook/_downloadViaAnchorの早期return)。
  // ここではルーティング(localApiCall)経由でハンドラが正しく呼ばれ、
  // 期待するレスポンス形になることを検証する。
  //
  // 注: POST /backup/exportはlast_backup_atをsettingsストアに書き込む副作用が
  // ある(local/backup.js::_recordBackupExported)ため、「before」スナップショットは
  // この1回目のexport呼び出しの後に取る(でないと、後続の比較でbefore/afterの
  // settingsだけ食い違ってしまう)。
  const exportResultCountsBefore = await _snapshotAll();
  const exportResult = await localApiCall("POST", "/backup/export");
  assert.match(exportResult.filename, /^jisseki-backup_\d{8}_\d{4}\.json$/);
  for (const name of DB_STORE_NAMES) {
    assert.strictEqual(exportResult.store_counts[name], exportResultCountsBefore[name].length);
  }

  const before = await _snapshotAll();

  // exportBackup()を直接呼んでファイルの内容相当を取得し、JSON文字列化→解析を
  // 経由させてimportルートに渡す(実際のフロント側のFileReader+JSON.parseと同じ経路)。
  const data = await exportBackup();
  const roundTripped = JSON.parse(JSON.stringify(data));

  await _clearAll();
  const importResult = await localApiCall("POST", "/backup/import", roundTripped);
  // licenseはセキュリティ修正によりインポート対象から除外される(上の専用
  // テスト参照)ため、import側のstore_countsには含まれない。
  const otherStores = DB_STORE_NAMES.filter((n) => n !== "license");
  for (const name of otherStores) {
    assert.strictEqual(importResult.store_counts[name], before[name].length);
  }
  assert.strictEqual(importResult.store_counts.license, undefined);

  const after = await _snapshotAll();
  for (const name of otherStores) {
    assert.deepStrictEqual(after[name], before[name]);
  }
  assert.deepStrictEqual(after.license, []);
});

// audit-loop(2026-11-02)の監査で指摘(設計批評・major): インポートは
// dbClear→dbPutの完全上書きで、バックアップ時点より後に追加された現在の
// データがどれだけ失われるか、画面には一切表示していなかった(静的な注意文
// だけ)。checkImportDataLossRiskは「バックアップより後に実際に保存された
// 日次データがあるか」を判定する(frontend/settings.jsの確認モーダルが
// この結果を見て警告文を強めるために呼ぶ、POST /backup/check-import-risk)。
async function _ensureStore(storeId) {
  await createStore({ id: storeId, name: storeId + "店" }).catch(() => {});
}

test("checkImportDataLossRisk: バックアップより後の保存済みデータが無ければ警告なし", async () => {
  await _clearAll();
  await _ensureStore("risk-a");
  await putDay(2026, "2026-06-01", "risk-a", { sales_excl_tax: 1000 });

  // バックアップのexported_atが保存日より後(=最新のバックアップ)。
  const backup = { format: "jisseki-app-pwa-backup", stores: {}, exported_at: "2026-06-02T00:00:00.000Z" };
  const result = await checkImportDataLossRisk(backup);
  assert.strictEqual(result.newer_date, null);
});

test("checkImportDataLossRisk: バックアップより後に保存した日次データがあれば警告する", async () => {
  await _clearAll();
  await _ensureStore("risk-b");
  await putDay(2026, "2026-06-10", "risk-b", { sales_excl_tax: 2000 });

  // バックアップのexported_atが保存日より前(=古いバックアップを復元しようとしている)。
  const backup = { format: "jisseki-app-pwa-backup", stores: {}, exported_at: "2026-06-01T00:00:00.000Z" };
  const result = await checkImportDataLossRisk(backup);
  assert.strictEqual(result.newer_date, "2026-06-10");
  assert.strictEqual(result.backup_date, "2026-06-01");
});

test("checkImportDataLossRisk: _user_edited:falseなレコードは警告対象にしない(未編集の空枠)", async () => {
  await _clearAll();
  await _ensureStore("risk-c");
  // _user_editedが付かない形で直接dbPut(putDay経由ではない=未編集扱い)。
  await dbPut("daily", 2026, { "2026-06-15": { "risk-c": { sales_excl_tax: 0 } } });

  const backup = { format: "jisseki-app-pwa-backup", stores: {}, exported_at: "2026-06-01T00:00:00.000Z" };
  const result = await checkImportDataLossRisk(backup);
  assert.strictEqual(result.newer_date, null);
});
