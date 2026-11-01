"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("./setup");
require("../db.js");
require("../local-api.js");
require("../local/store.js");
require("../local/inventory.js");

async function ensureStore(storeId) {
  await createStore({ id: storeId, name: storeId + "店" }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────
// getInventory
// ─────────────────────────────────────────────────────────────────────
test("getInventory: 店舗は実在するが在庫未登録なら空配列(store not foundにはしない)", async () => {
  await ensureStore("inv-a");
  const items = await getInventory("inv-a");
  assert.deepStrictEqual(items, []);
});

test("getInventory: 存在しないstore_idは400", async () => {
  await assert.rejects(async () => getInventory("inv-nonexistent"), (err) => {
    assert.strictEqual(err.status, 400);
    return true;
  });
});

// ─────────────────────────────────────────────────────────────────────
// addFlavor
// ─────────────────────────────────────────────────────────────────────
test("addFlavor: 正常に追加でき、id/brand/name/stock/min_stockを持つ", async () => {
  await ensureStore("inv-b");
  const result = await addFlavor("inv-b", { brand: "AF", name: "ダブルアップル", stock: 3, min_stock: 2 });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.id, "af_ダブルアップル");

  const items = await getInventory("inv-b");
  assert.deepStrictEqual(items, [
    { id: "af_ダブルアップル", brand: "AF", name: "ダブルアップル", stock: 3, min_stock: 2 },
  ]);
});

test("addFlavor: stock/min_stock省略時は既定値(0/1)になる", async () => {
  await ensureStore("inv-c");
  const result = await addFlavor("inv-c", { name: "テスト商品" });
  const items = await getInventory("inv-c");
  const item = items.find((f) => f.id === result.id);
  assert.strictEqual(item.stock, 0);
  assert.strictEqual(item.min_stock, 1);
  assert.strictEqual(item.brand, "その他"); // brand省略時の既定値
});

test("addFlavor: nameが無ければ400", async () => {
  await ensureStore("inv-d");
  await assert.rejects(async () => addFlavor("inv-d", { brand: "AF" }), (err) => {
    assert.strictEqual(err.status, 400);
    assert.match(err.message, /name required/);
    return true;
  });
});

test("addFlavor: idが重複していると409", async () => {
  await ensureStore("inv-e");
  await addFlavor("inv-e", { brand: "AF", name: "ペア" });
  await assert.rejects(async () => addFlavor("inv-e", { brand: "AF", name: "ペア" }), (err) => {
    assert.strictEqual(err.status, 409);
    return true;
  });
});

test("addFlavor: 存在しないstore_idは400", async () => {
  await assert.rejects(async () => addFlavor("inv-nonexistent", { name: "x" }), (err) => {
    assert.strictEqual(err.status, 400);
    return true;
  });
});

// ─────────────────────────────────────────────────────────────────────
// updateStock
// ─────────────────────────────────────────────────────────────────────
test("updateStock: 在庫数を更新できる", async () => {
  await ensureStore("inv-f");
  const added = await addFlavor("inv-f", { brand: "AF", name: "グレフル", stock: 5 });
  const result = await updateStock("inv-f", added.id, { stock: 8 });
  assert.strictEqual(result.stock, 8);
  const items = await getInventory("inv-f");
  assert.strictEqual(items.find((f) => f.id === added.id).stock, 8);
});

// audit-loop(2026-11-01)の監査で発見: 在庫画面は商品ごとに+/-ボタンがあり、
// frontend/inventory.js::_setStockはデバウンス/キュー無しで連打のたびに
// 新規PUTを発火する。dbGet→dbPutが直列化されていなければ、2商品を素早く
// 連続操作した際に片方の在庫変更が消えていた。dbUpdate()経由の直列化後、
// 両方の変更が残ることを確認する。
test("updateStock: 異なる商品への並行更新は両方とも反映される(レース修正の回帰テスト)", async () => {
  await ensureStore("inv-race");
  const a = await addFlavor("inv-race", { brand: "AF", name: "商品A", stock: 5 });
  const b = await addFlavor("inv-race", { brand: "AF", name: "商品B", stock: 10 });

  await Promise.all([
    updateStock("inv-race", a.id, { stock: 8 }),
    updateStock("inv-race", b.id, { stock: 3 }),
  ]);

  const items = await getInventory("inv-race");
  assert.strictEqual(items.find((f) => f.id === a.id).stock, 8);
  assert.strictEqual(items.find((f) => f.id === b.id).stock, 3);
});

test("updateStock: 負数は0にクランプされる", async () => {
  await ensureStore("inv-g");
  const added = await addFlavor("inv-g", { brand: "AF", name: "レッドアップル", stock: 2 });
  const result = await updateStock("inv-g", added.id, { stock: -5 });
  assert.strictEqual(result.stock, 0);
});

test("updateStock: bodyのstockがnullなら既存値のまま(_int_or相当)", async () => {
  await ensureStore("inv-h");
  const added = await addFlavor("inv-h", { brand: "AF", name: "チョコ", stock: 4 });
  const result = await updateStock("inv-h", added.id, { stock: null });
  assert.strictEqual(result.stock, 4);
});

test("updateStock: 存在しないstore_idは400", async () => {
  await assert.rejects(async () => updateStock("inv-nonexistent", "x", { stock: 1 }), (err) => {
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("updateStock: 在庫未登録の店舗(flavor自体が無い)は404(store not found)", async () => {
  await ensureStore("inv-i");
  await assert.rejects(async () => updateStock("inv-i", "x", { stock: 1 }), (err) => {
    assert.strictEqual(err.status, 404);
    assert.match(err.message, /store not found/);
    return true;
  });
});

test("updateStock: 存在しないflavor_idは404(flavor not found)", async () => {
  await ensureStore("inv-j");
  await addFlavor("inv-j", { brand: "AF", name: "ドラゴン" });
  await assert.rejects(async () => updateStock("inv-j", "nonexistent-flavor", { stock: 1 }), (err) => {
    assert.strictEqual(err.status, 404);
    assert.match(err.message, /flavor not found/);
    return true;
  });
});

// ─────────────────────────────────────────────────────────────────────
// deleteFlavor
// ─────────────────────────────────────────────────────────────────────
test("deleteFlavor: 削除できる", async () => {
  await ensureStore("inv-k");
  const added = await addFlavor("inv-k", { brand: "AF", name: "ペアチル" });
  const result = await deleteFlavor("inv-k", added.id);
  assert.deepStrictEqual(result, { ok: true });
  const items = await getInventory("inv-k");
  assert.deepStrictEqual(items, []);
});

test("deleteFlavor: 存在しないstore_idは400", async () => {
  await assert.rejects(async () => deleteFlavor("inv-nonexistent", "x"), (err) => {
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("deleteFlavor: 在庫未登録の店舗は404(store not found)", async () => {
  await ensureStore("inv-l");
  await assert.rejects(async () => deleteFlavor("inv-l", "x"), (err) => {
    assert.strictEqual(err.status, 404);
    assert.match(err.message, /store not found/);
    return true;
  });
});

test("deleteFlavor: 存在しないflavor_idは404(flavor not found)", async () => {
  await ensureStore("inv-m");
  await addFlavor("inv-m", { brand: "AF", name: "すいか" });
  await assert.rejects(async () => deleteFlavor("inv-m", "nonexistent"), (err) => {
    assert.strictEqual(err.status, 404);
    assert.match(err.message, /flavor not found/);
    return true;
  });
});

// ─────────────────────────────────────────────────────────────────────
// getLog
// ─────────────────────────────────────────────────────────────────────
test("getLog: 在庫変更のたびにログが記録され、新しい順で返る", async () => {
  await ensureStore("inv-n");
  const added = await addFlavor("inv-n", { brand: "AF", name: "ダブアポ", stock: 5 });
  await updateStock("inv-n", added.id, { stock: 8 });
  await updateStock("inv-n", added.id, { stock: 3 });

  const log = await getLog("inv-n", 100);
  assert.strictEqual(log.length, 2);
  // 新しい順(直近の変更が先頭)
  assert.deepStrictEqual(
    [log[0].from_stock, log[0].to_stock],
    [8, 3]
  );
  assert.deepStrictEqual(
    [log[1].from_stock, log[1].to_stock],
    [5, 8]
  );
});

test("getLog: 変更が無い更新(同じstockを指定)はログに残らない", async () => {
  await ensureStore("inv-o");
  const added = await addFlavor("inv-o", { brand: "AF", name: "ちび炭", stock: 2 });
  await updateStock("inv-o", added.id, { stock: 2 }); // 変化無し
  const log = await getLog("inv-o", 100);
  assert.deepStrictEqual(log, []);
});

test("getLog: limit<=0は空配列(limit=0で全件返る旧事故の回帰テスト)", async () => {
  await ensureStore("inv-p");
  const added = await addFlavor("inv-p", { brand: "AF", name: "デカ炭", stock: 1 });
  await updateStock("inv-p", added.id, { stock: 9 });
  const log = await getLog("inv-p", 0);
  assert.deepStrictEqual(log, []);
});

test("getLog: limit未指定は既定100件", async () => {
  await ensureStore("inv-q");
  const added = await addFlavor("inv-q", { brand: "AF", name: "ペア2", stock: 0 });
  await updateStock("inv-q", added.id, { stock: 1 });
  const log = await getLog("inv-q", undefined);
  assert.strictEqual(log.length, 1);
});

test("getLog: 他店舗のログは混ざらない", async () => {
  await ensureStore("inv-r1");
  await ensureStore("inv-r2");
  const a = await addFlavor("inv-r1", { brand: "AF", name: "r1品", stock: 0 });
  const b = await addFlavor("inv-r2", { brand: "AF", name: "r2品", stock: 0 });
  await updateStock("inv-r1", a.id, { stock: 1 });
  await updateStock("inv-r2", b.id, { stock: 1 });

  const logR1 = await getLog("inv-r1", 100);
  assert.strictEqual(logR1.length, 1);
  assert.strictEqual(logR1[0].store_id, "inv-r1");
});

// ─────────────────────────────────────────────────────────────────────
// ルーター層経由(localApiCall)
// ─────────────────────────────────────────────────────────────────────
test("localApiCall経由: GET/POST/PUT/DELETE /inventory", async () => {
  await ensureStore("inv-s");
  const added = await localApiCall("POST", "/inventory/inv-s/flavor", { brand: "AF", name: "ヘーゼル", stock: 1 });
  let items = await localApiCall("GET", "/inventory/inv-s");
  assert.strictEqual(items.length, 1);

  await localApiCall("PUT", `/inventory/inv-s/${added.id}`, { stock: 9 });
  items = await localApiCall("GET", "/inventory/inv-s");
  assert.strictEqual(items[0].stock, 9);

  await localApiCall("DELETE", `/inventory/inv-s/${added.id}`);
  items = await localApiCall("GET", "/inventory/inv-s");
  assert.deepStrictEqual(items, []);
});

test("localApiCall経由: GET /inventory/:store_id/log/recent?limit=... が /inventory/:store_id に横取りされない", async () => {
  await ensureStore("inv-t");
  const added = await localApiCall("POST", "/inventory/inv-t/flavor", { brand: "AF", name: "デリアポ", stock: 0 });
  await localApiCall("PUT", `/inventory/inv-t/${added.id}`, { stock: 5 });

  const log = await localApiCall("GET", "/inventory/inv-t/log/recent?limit=10");
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].to_stock, 5);
});
