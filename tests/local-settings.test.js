"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("./setup");
require("../db.js");
require("../local-api.js");
require("../local/settings.js");

test.beforeEach(async () => {
  await dbDelete("settings", "global");
});

test("【回帰】getSettings: 未設定時はwanope_bonusが必ず0円(過去の本番事故の教訓)", async () => {
  const settings = await getSettings();
  assert.equal(settings.wanope_bonus, 0, "既定値0円のはずのワンオペ手当が0以外になっている");
});

test("【回帰】getSettings: 未設定時はincentive_rates(catch/call/extension)が全て0円", async () => {
  const settings = await getSettings();
  assert.deepStrictEqual(settings.incentive_rates, {
    catch: { yen_per_count: 0 },
    call: { yen_per_count: 0 },
    extension: { yen_per_count: 0 },
    // drinkだけ既定値70円(元々のDRINK_UNIT固定値を踏襲。ファイル先頭コメント
    // および local/settings.js の _defaultIncentiveRates コメント参照)。
    drink: { yen_per_count: 70 },
  }, "キャッチ/呼び/延長の単価が既定0円以外、またはドリンクの単価が既定70円以外になっている");
});

test("【回帰】getSettings: 未設定時はbase_session_minutesが60分", async () => {
  const settings = await getSettings();
  assert.equal(settings.base_session_minutes, 60);
});

test("updateSettings: base_session_minutesを更新できる", async () => {
  const result = await updateSettings({ base_session_minutes: 90 });
  assert.equal(result.base_session_minutes, 90);
});

test("updateSettings: base_session_minutesが負数なら400", async () => {
  await assert.rejects(async () => updateSettings({ base_session_minutes: -1 }), (err) => {
    assert.strictEqual(err.status, 400);
    assert.match(err.message, /base_session_minutes/);
    return true;
  });
});

test("updateSettings: incentive_rates.drink.yen_per_countを更新できる", async () => {
  const result = await updateSettings({ incentive_rates: { drink: { yen_per_count: 100 } } });
  assert.equal(result.incentive_rates.drink.yen_per_count, 100);
  // 他の単価(既定値)は維持されること。
  assert.equal(result.incentive_rates.catch.yen_per_count, 0);
});

test("getSettings: 保存済みのwanope_bonusをそのまま返す", async () => {
  await dbPut("settings", "global", { wanope_bonus: 200 });
  const settings = await getSettings();
  assert.equal(settings.wanope_bonus, 200);
});

test("updateSettings: wanope_bonusを更新できる", async () => {
  const result = await updateSettings({ wanope_bonus: 300 });
  assert.equal(result.wanope_bonus, 300);
  const reread = await getSettings();
  assert.equal(reread.wanope_bonus, 300);
});

test("updateSettings: wanope_bonusが数値以外なら400", async () => {
  await assert.rejects(async () => updateSettings({ wanope_bonus: "abc" }), (err) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.status, 400);
    assert.match(err.message, /wanope_bonus/);
    return true;
  });
});

test("updateSettings: wanope_bonusが負数なら400", async () => {
  await assert.rejects(async () => updateSettings({ wanope_bonus: -1 }), (err) => {
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("updateSettings: wanope_bonusがbool型なら400(Python版のbool除外ガードと同じ挙動)", async () => {
  await assert.rejects(async () => updateSettings({ wanope_bonus: true }), (err) => {
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("updateSettings: incentive_rates.catch.yen_per_countを更新できる", async () => {
  const result = await updateSettings({ incentive_rates: { catch: { yen_per_count: 100 } } });
  assert.equal(result.incentive_rates.catch.yen_per_count, 100);
  // 更新していないcall/extensionは既定値0円のまま。
  assert.equal(result.incentive_rates.call.yen_per_count, 0);
  assert.equal(result.incentive_rates.extension.yen_per_count, 0);
});

test("updateSettings: incentive_ratesは1項目だけ送っても他の既存設定値を消さない(フィールド単位マージ)", async () => {
  await updateSettings({
    incentive_rates: {
      catch: { yen_per_count: 100 },
      call: { yen_per_count: 50 },
      extension: { yen_per_count: 30 },
    },
  });

  // catchだけを更新する(call/extensionは送らない)。
  const result = await updateSettings({ incentive_rates: { catch: { yen_per_count: 999 } } });
  assert.equal(result.incentive_rates.catch.yen_per_count, 999);
  assert.equal(result.incentive_rates.call.yen_per_count, 50, "送っていないcallの既存値が消えている(単価が静かに書き換わる事故)");
  assert.equal(result.incentive_rates.extension.yen_per_count, 30, "送っていないextensionの既存値が消えている(単価が静かに書き換わる事故)");
});

// 2026-11-01の実機検証で実際に発生した事故(設定画面でキャッチ/呼び/延長を
// 連続編集→callだけ0円に戻っていた)の直接的な回帰テスト。dbUpdate()経由の
// 直列化で、3項目を並行更新しても全て残ることを確認する。
test("updateSettings: catch/call/extensionを並行更新しても全て反映される(レース修正の回帰テスト)", async () => {
  await Promise.all([
    updateSettings({ incentive_rates: { catch: { yen_per_count: 100 } } }),
    updateSettings({ incentive_rates: { call: { yen_per_count: 150 } } }),
    updateSettings({ incentive_rates: { extension: { yen_per_count: 200 } } }),
  ]);

  const result = await getSettings();
  assert.equal(result.incentive_rates.catch.yen_per_count, 100);
  assert.equal(result.incentive_rates.call.yen_per_count, 150);
  assert.equal(result.incentive_rates.extension.yen_per_count, 200);
});

test("updateSettings: incentive_rates.call.yen_per_countが負数なら400", async () => {
  await assert.rejects(async () => updateSettings({ incentive_rates: { call: { yen_per_count: -5 } } }), (err) => {
    assert.strictEqual(err.status, 400);
    assert.match(err.message, /incentive_rates\.call\.yen_per_count/);
    return true;
  });
});

test("updateSettings: incentive_rates.extension.yen_per_countがbool型なら400", async () => {
  await assert.rejects(async () => updateSettings({ incentive_rates: { extension: { yen_per_count: false } } }), (err) => {
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("updateSettings: incentive_ratesがオブジェクトでなければ400", async () => {
  await assert.rejects(async () => updateSettings({ incentive_rates: "not-an-object" }), (err) => {
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("updateSettings: incentive_rates.catchが数値を直接持たない形(sub-objectでない)なら400", async () => {
  await assert.rejects(async () => updateSettings({ incentive_rates: { catch: 100 } }), (err) => {
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("localApiCall経由でのルーティング: GET/PUT /settings", async () => {
  const before = await localApiCall("GET", "/settings");
  assert.equal(before.wanope_bonus, 0);

  const updated = await localApiCall("PUT", "/settings", {
    wanope_bonus: 500,
    incentive_rates: { catch: { yen_per_count: 70 } },
  });
  assert.equal(updated.wanope_bonus, 500);
  assert.equal(updated.incentive_rates.catch.yen_per_count, 70);

  const after = await localApiCall("GET", "/settings");
  assert.equal(after.wanope_bonus, 500);
  assert.equal(after.incentive_rates.catch.yen_per_count, 70);
});

// audit-loop(2026-11-02、2周目)の監査で指摘(設計批評・minor): last_backup_at
// はupdateSettings()を経由せず、local/backup.js::_recordBackupExportedが
// dbUpdate()で直接settingsレコードに書き込む別経路を持つ。updateSettings()
// 自身はこのフィールドの存在を知らないため、将来「未知のキーを除去する」
// ような変更が入ると静かに消えうる(2026-11-01に実際に起きた直列化漏れ事故と
// 同じ「同じレコードへの複数の書き込み経路」というカテゴリの問題)。
// この回帰テストで、updateSettings()の通常の呼び出しがlast_backup_atを
// 消さないことを固定する。
test("【回帰】updateSettings: last_backup_at(backup.js側が直接書き込む別経路のフィールド)を消さない", async () => {
  // local/backup.js::_recordBackupExportedと同じ形で直接書き込む
  // (backup.jsをrequireせずに同じ効果を再現する)。
  await dbPut("settings", "global", { last_backup_at: "2026-10-01T00:00:00.000Z" });

  const updated = await updateSettings({ wanope_bonus: 300 });
  assert.equal(updated.last_backup_at, "2026-10-01T00:00:00.000Z", "last_backup_atが消えている");
  assert.equal(updated.wanope_bonus, 300);
});
