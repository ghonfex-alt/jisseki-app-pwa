"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("./setup");
require("../db.js");

test("dbOpen: 全オブジェクトストアが作成されている", async () => {
  const db = await dbOpen();
  assert.strictEqual(db.name, "jisseki-db");
  assert.strictEqual(db.version, 1);
  for (const name of DB_STORE_NAMES) {
    assert.ok(
      db.objectStoreNames.contains(name),
      `object store missing: ${name}`
    );
  }
});

test("dbOpen: 複数回呼んでも同じ接続を返す", async () => {
  const db1 = await dbOpen();
  const db2 = await dbOpen();
  assert.strictEqual(db1, db2);
});

test("dbGet: 存在しないキーは undefined を返す", async () => {
  const value = await dbGet("settings", "no-such-key");
  assert.strictEqual(value, undefined);
});

test("dbGetAll: 空ストアは空配列を返す", async () => {
  const all = await dbGetAll("nippo_confirmed");
  assert.deepStrictEqual(all, []);
});

// 全ストアに対して put -> get -> getAll -> delete の一連の動作を検証する。
for (const storeName of DB_STORE_NAMES) {
  test(`put/get/getAll/delete roundtrip: ${storeName}`, async () => {
    const key = `test-key-${storeName}`;
    const value = { marker: "roundtrip", storeName, n: 1 };

    // put後、getで同じ値が取れること
    await dbPut(storeName, key, value);
    const got = await dbGet(storeName, key);
    assert.deepStrictEqual(got, value);

    // getAllに含まれること
    const allAfterPut = await dbGetAll(storeName);
    assert.ok(
      allAfterPut.some(
        (item) => item && item.marker === "roundtrip" && item.storeName === storeName
      ),
      `getAll does not contain the put value for store: ${storeName}`
    );

    // putで上書きできること
    const updated = { marker: "roundtrip", storeName, n: 2 };
    await dbPut(storeName, key, updated);
    const gotAfterUpdate = await dbGet(storeName, key);
    assert.deepStrictEqual(gotAfterUpdate, updated);

    // deleteで消え、以後getはundefinedを返すこと
    await dbDelete(storeName, key);
    const gotAfterDelete = await dbGet(storeName, key);
    assert.strictEqual(gotAfterDelete, undefined);
  });
}
