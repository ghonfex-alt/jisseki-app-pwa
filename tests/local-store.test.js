"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("./setup");
require("../db.js");
require("../local-api.js");
require("../local/store.js");

test("createStore: 正常に作成でき、id/name/regular_closed_days/champagne_menuを持つ", async () => {
  const store = await createStore({ id: "store-a", name: "店舗A" });
  assert.deepStrictEqual(store, {
    id: "store-a",
    name: "店舗A",
    regular_closed_days: [],
    champagne_menu: [],
  });
});

test("createStore: idが無ければ400", async () => {
  await assert.rejects(
    async () => createStore({ name: "no id" }),
    (err) => {
      assert.ok(err instanceof ApiError);
      assert.strictEqual(err.status, 400);
      assert.match(err.message, /id is required/);
      return true;
    }
  );
});

test("createStore: nameが無ければ400", async () => {
  await assert.rejects(
    async () => createStore({ id: "store-b" }),
    (err) => {
      assert.strictEqual(err.status, 400);
      assert.match(err.message, /name is required/);
      return true;
    }
  );
});

test("createStore: 既存のidは400(重複)", async () => {
  await createStore({ id: "store-dup", name: "重複元" });
  await assert.rejects(
    async () => createStore({ id: "store-dup", name: "重複先" }),
    (err) => {
      assert.strictEqual(err.status, 400);
      assert.match(err.message, /既に使用されています/);
      return true;
    }
  );
});

test("getStores: store_idをキーにしたdict形で全件返す", async () => {
  await createStore({ id: "store-c1", name: "C1" });
  await createStore({ id: "store-c2", name: "C2" });
  const stores = await getStores();
  assert.strictEqual(stores["store-c1"].name, "C1");
  assert.strictEqual(stores["store-c2"].name, "C2");
});

test("getStore: 存在しなければ404", async () => {
  await assert.rejects(async () => getStore("no-such-store"), (err) => {
    assert.strictEqual(err.status, 404);
    assert.strictEqual(err.message, "store not found");
    return true;
  });
});

test("getStore: 存在すればそのオブジェクトを返す", async () => {
  await createStore({ id: "store-d", name: "D店" });
  const store = await getStore("store-d");
  assert.strictEqual(store.name, "D店");
});

test("updateStore: 部分更新(dict.update相当)で既存フィールドを保持する", async () => {
  await createStore({ id: "store-e", name: "E店" });
  const updated = await updateStore("store-e", { name: "E店(改名)" });
  assert.strictEqual(updated.name, "E店(改名)");
  assert.deepStrictEqual(updated.regular_closed_days, []);

  const again = await updateStore("store-e", { regular_closed_days: ["mon"] });
  assert.strictEqual(again.name, "E店(改名)");
  assert.deepStrictEqual(again.regular_closed_days, ["mon"]);
});

test("updateStore: 存在しなければ404", async () => {
  await assert.rejects(async () => updateStore("no-such-store", { name: "x" }), (err) => {
    assert.strictEqual(err.status, 404);
    return true;
  });
});

// audit-loop(2026-11-01)の監査で、dbGet→変更→dbPutが直列化されておらず、
// 設定画面の定休日チェックボックス(店舗ごとに7個、frontend/settings.jsの
// toggleRegularClosedDayが1個ずつ個別にPUT /stores/:idを呼ぶ)を素早く連続操作
// すると片方の変更が消えることが判明した(local/settings.jsで実際に起きた
// インセンティブ単価の事故と同じ原因)。updateStoreがdbUpdate()経由の
// 直列化に直った後、同じシナリオで両方の変更が残ることを確認する。
test("updateStore: 異なるフィールドへの並行更新は両方とも反映される(レース修正の回帰テスト)", async () => {
  await createStore({ id: "store-race", name: "店舗レース" });

  await Promise.all([
    updateStore("store-race", { regular_closed_days: ["mon"] }),
    updateStore("store-race", { name: "改名後の店舗" }),
  ]);

  const result = await getStore("store-race");
  assert.deepStrictEqual(result.regular_closed_days, ["mon"]);
  assert.strictEqual(result.name, "改名後の店舗");
});

test("checkStoreId: 登録済みなら何も起きない", async () => {
  await createStore({ id: "store-f", name: "F店" });
  await assert.doesNotReject(async () => checkStoreId("store-f"));
});

test("checkStoreId: 未登録なら400", async () => {
  await assert.rejects(async () => checkStoreId("no-such-store"), (err) => {
    assert.strictEqual(err.status, 400);
    assert.match(err.message, /登録されていません/);
    return true;
  });
});

test("addChampagne → updateChampagne → deleteChampagne の一連の流れ", async () => {
  await createStore({ id: "store-g", name: "G店" });

  const added = await addChampagne("store-g", { id: "c1", name: "ドンペリ", price: 30000 });
  assert.deepStrictEqual(added, { id: "c1", name: "ドンペリ", price: 30000 });

  const store1 = await getStore("store-g");
  assert.strictEqual(store1.champagne_menu.length, 1);

  const updated = await updateChampagne("store-g", "c1", { price: 35000 });
  assert.strictEqual(updated.name, "ドンペリ");
  assert.strictEqual(updated.price, 35000);

  const delResult = await deleteChampagne("store-g", "c1");
  assert.deepStrictEqual(delResult, { ok: true });

  const store2 = await getStore("store-g");
  assert.deepStrictEqual(store2.champagne_menu, []);
});

test("addChampagne: idが重複していると400(2026-09-27事故の再発防止)", async () => {
  await createStore({ id: "store-h", name: "H店" });
  await addChampagne("store-h", { id: "c1", name: "ドンペリ", price: 30000 });
  await assert.rejects(
    async () => addChampagne("store-h", { id: "c1", name: "モエ", price: 10000 }),
    (err) => {
      assert.strictEqual(err.status, 400);
      assert.match(err.message, /既に使用されています/);
      return true;
    }
  );
});

test("addChampagne: id/nameが無ければ400", async () => {
  await createStore({ id: "store-i", name: "I店" });
  await assert.rejects(async () => addChampagne("store-i", { price: 1000 }), (err) => {
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("updateChampagne: 対象店舗が無ければ404", async () => {
  await assert.rejects(async () => updateChampagne("no-such-store", "c1", { price: 1 }), (err) => {
    assert.strictEqual(err.status, 404);
    assert.strictEqual(err.message, "store not found");
    return true;
  });
});

test("updateChampagne: 対象のchampagneが無ければ404", async () => {
  await createStore({ id: "store-j", name: "J店" });
  await assert.rejects(async () => updateChampagne("store-j", "no-such-champ", { price: 1 }), (err) => {
    assert.strictEqual(err.status, 404);
    assert.strictEqual(err.message, "champagne not found");
    return true;
  });
});

test("deleteStore: アクティブなスタッフが残っていると409", async () => {
  await createStore({ id: "store-k", name: "K店" });
  await dbPut("staff", "staff-k1", {
    id: "staff-k1",
    name: "K子",
    store_id: "store-k",
    pay_type: "hourly",
    active: true,
  });

  await assert.rejects(async () => deleteStore("store-k"), (err) => {
    assert.strictEqual(err.status, 409);
    assert.match(err.message, /スタッフが残っている/);
    return true;
  });
});

test("deleteStore: 非アクティブなスタッフのみなら削除できる", async () => {
  await createStore({ id: "store-l", name: "L店" });
  await dbPut("staff", "staff-l1", {
    id: "staff-l1",
    name: "L子",
    store_id: "store-l",
    pay_type: "hourly",
    active: false,
  });

  const result = await deleteStore("store-l");
  assert.deepStrictEqual(result, { ok: true });
  await assert.rejects(async () => getStore("store-l"), (err) => {
    assert.strictEqual(err.status, 404);
    return true;
  });
});

test("deleteStore: daily実績データが残っていると409", async () => {
  await createStore({ id: "store-m", name: "M店" });
  // "daily"ストアは年をキーに { date: { store_id: dayData } } を値として
  // 保存する前提(local/store.js内のコメント・Task4との前提合わせ参照)。
  await dbPut("daily", 2026, {
    "2026-11-01": {
      "store-m": { staff_entries: [{ staff_id: "x", drinks: 1 }] },
    },
  });

  await assert.rejects(async () => deleteStore("store-m"), (err) => {
    assert.strictEqual(err.status, 409);
    assert.match(err.message, /実績データが残っている/);
    return true;
  });
});

test("deleteStore: daily実績データが空オブジェクトなら削除できる(falsyは無視)", async () => {
  await createStore({ id: "store-n", name: "N店" });
  await dbPut("daily", 2027, {
    "2027-01-01": {
      "store-n": {},
    },
  });

  const result = await deleteStore("store-n");
  assert.deepStrictEqual(result, { ok: true });
});

test("deleteStore: 存在しない店舗は404", async () => {
  await assert.rejects(async () => deleteStore("no-such-store"), (err) => {
    assert.strictEqual(err.status, 404);
    return true;
  });
});

test("localApiCall経由でのルーティング: GET/POST/PUT/DELETE /stores", async () => {
  const created = await localApiCall("POST", "/stores", { id: "store-route1", name: "Route店" });
  assert.strictEqual(created.name, "Route店");

  const fetched = await localApiCall("GET", "/stores/store-route1");
  assert.strictEqual(fetched.name, "Route店");

  const updated = await localApiCall("PUT", "/stores/store-route1", { name: "Route店2" });
  assert.strictEqual(updated.name, "Route店2");

  const all = await localApiCall("GET", "/stores");
  assert.strictEqual(all["store-route1"].name, "Route店2");

  const deleted = await localApiCall("DELETE", "/stores/store-route1");
  assert.deepStrictEqual(deleted, { ok: true });
});
