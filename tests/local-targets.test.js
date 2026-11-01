"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("./setup");
require("../db.js");
require("../local-api.js");
require("../local/store.js");
require("../local/targets.js");

test("getTargets: 何も設定していなければ空dict", async () => {
  const targets = await getTargets();
  assert.deepStrictEqual(targets, {});
});

test("setTarget: 存在しないstore_idは400(check_store_id相当)", async () => {
  await assert.rejects(async () => setTarget("no-such-store", { monthly: 1000000 }), (err) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.status, 400);
    assert.match(err.message, /登録されていません/);
    return true;
  });
});

test("setTarget → getTargets: 設定した値がstore_idをキーにした形で取得できる", async () => {
  await createStore({ id: "store-t1", name: "T1店" });
  const result = await setTarget("store-t1", { monthly: 1200000 });
  assert.deepStrictEqual(result, { ok: true });

  const targets = await getTargets();
  assert.strictEqual(targets["store-t1"].monthly, 1200000);
});

test("setTarget: dict.update相当の部分更新(既存フィールドを保持する)", async () => {
  await createStore({ id: "store-t2", name: "T2店" });
  await setTarget("store-t2", { monthly: 1000000, note: "初期値" });
  await setTarget("store-t2", { monthly: 1500000 });

  const targets = await getTargets();
  assert.strictEqual(targets["store-t2"].monthly, 1500000);
  assert.strictEqual(targets["store-t2"].note, "初期値");
});

test("getTargets: 複数店舗分をそれぞれ別キーで返す", async () => {
  await createStore({ id: "store-t3", name: "T3店" });
  await createStore({ id: "store-t4", name: "T4店" });
  await setTarget("store-t3", { monthly: 100 });
  await setTarget("store-t4", { monthly: 200 });

  const targets = await getTargets();
  assert.strictEqual(targets["store-t3"].monthly, 100);
  assert.strictEqual(targets["store-t4"].monthly, 200);
});

test("localApiCall経由でのルーティング: GET/PUT /targets", async () => {
  await localApiCall("POST", "/stores", { id: "store-t5", name: "T5店" });
  const put = await localApiCall("PUT", "/targets/store-t5", { monthly: 999 });
  assert.deepStrictEqual(put, { ok: true });

  const all = await localApiCall("GET", "/targets");
  assert.strictEqual(all["store-t5"].monthly, 999);
});
