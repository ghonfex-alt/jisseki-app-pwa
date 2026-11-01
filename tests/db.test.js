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

// audit-loop(2026-11-01)で、local/settings.js以外にもdbGet→変更→dbPutを
// 個別に書いていたファイルが複数見つかり(local/store.js・staff.js・daily.js・
// inventory.js・targets.js)、同じ「後勝ちで片方の変更が消える」レースが
// 構造的に再発する問題だと判明した。dbUpdateはその根本修正として追加した
// 直列化ヘルパーなので、ここでレースが実際に閉じることを検証する。
test("dbUpdate: 同じキーへの並行呼び出しは両方の変更を失わない(直列化される)", async () => {
  await dbPut("settings", "concurrent-key", { a: 0, b: 0 });

  // 2つの更新をほぼ同時に発火する。dbGet→dbPutが直列化されていなければ、
  // 両方がa:0,b:0を読んでから書き戻すため、どちらか一方の変更が消える。
  await Promise.all([
    dbUpdate("settings", "concurrent-key", async (current) => {
      return { ...current, a: current.a + 1 };
    }),
    dbUpdate("settings", "concurrent-key", async (current) => {
      return { ...current, b: current.b + 1 };
    }),
  ]);

  const result = await dbGet("settings", "concurrent-key");
  assert.deepStrictEqual(result, { a: 1, b: 1 });
});

test("dbUpdate: 異なるキーへの並行呼び出しは互いに干渉しない", async () => {
  await dbPut("settings", "key-x", { n: 0 });
  await dbPut("settings", "key-y", { n: 0 });

  await Promise.all([
    dbUpdate("settings", "key-x", async (c) => ({ n: c.n + 1 })),
    dbUpdate("settings", "key-y", async (c) => ({ n: c.n + 1 })),
  ]);

  assert.deepStrictEqual(await dbGet("settings", "key-x"), { n: 1 });
  assert.deepStrictEqual(await dbGet("settings", "key-y"), { n: 1 });
});

test("dbUpdate: mutatorが例外を投げても後続の呼び出しは正常に続行する", async () => {
  await dbPut("settings", "fail-then-ok-key", { n: 0 });

  await assert.rejects(
    dbUpdate("settings", "fail-then-ok-key", async () => {
      throw new Error("boom");
    })
  );

  // 失敗後もキューが詰まらず、次の更新は正常に通ること
  await dbUpdate("settings", "fail-then-ok-key", async (c) => ({ n: c.n + 1 }));
  assert.deepStrictEqual(await dbGet("settings", "fail-then-ok-key"), { n: 1 });
});

test("dbUpdate: 未存在キーはmutatorにundefinedが渡る", async () => {
  const result = await dbUpdate("settings", "brand-new-key", async (current) => {
    assert.strictEqual(current, undefined);
    return { created: true };
  });
  assert.deepStrictEqual(result, { created: true });
  assert.deepStrictEqual(await dbGet("settings", "brand-new-key"), { created: true });
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
