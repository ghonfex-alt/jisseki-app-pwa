"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("../local-api.js");

test.beforeEach(() => {
  // 各テストごとにルートテーブルを空にして、他テストの登録と干渉しないようにする。
  _resetRoutesForTest();
});

test("registerRoute + localApiCall: パスパラメータが渡され、戻り値がそのまま返る", async () => {
  registerRoute("GET", "/foo/:id", (params) => params.id);
  const result = await localApiCall("GET", "/foo/123");
  assert.strictEqual(result, "123");
});

test("localApiCall: 未登録パスはApiError(404)を投げる", async () => {
  await assert.rejects(
    async () => {
      await localApiCall("GET", "/no/such/path");
    },
    (err) => {
      assert.ok(err instanceof ApiError);
      assert.ok(err instanceof Error);
      assert.strictEqual(err.status, 404);
      assert.match(err.message, /not found: GET \/no\/such\/path/);
      return true;
    }
  );
});

test("localApiCall: メソッドが一致しないルートは404になる", async () => {
  registerRoute("GET", "/foo/:id", (params) => params.id);
  await assert.rejects(async () => {
    await localApiCall("POST", "/foo/123");
  }, ApiError);
});

test("registerRoute: method文字列の大文字小文字を問わない", async () => {
  registerRoute("get", "/bar", () => "ok");
  const result = await localApiCall("GET", "/bar");
  assert.strictEqual(result, "ok");
});

test("localApiCall: 複数のパスパラメータをキャプチャできる", async () => {
  registerRoute("GET", "/daily/:year/:date/:store_id", (params) => params);
  const result = await localApiCall("GET", "/daily/2026/2026-11-01/to");
  assert.deepStrictEqual(result, {
    year: "2026",
    date: "2026-11-01",
    store_id: "to",
  });
});

test("localApiCall: クエリ文字列がparamsに展開される", async () => {
  registerRoute("GET", "/items", (params) => params);
  const result = await localApiCall("GET", "/items?limit=100&offset=0");
  assert.deepStrictEqual(result, { limit: "100", offset: "0" });
});

test("localApiCall: パスパラメータはクエリ文字列より優先される(同名の場合)", async () => {
  registerRoute("GET", "/foo/:id", (params) => params);
  const result = await localApiCall("GET", "/foo/123?id=999&extra=1");
  assert.deepStrictEqual(result, { id: "123", extra: "1" });
});

test("localApiCall: bodyがそのままhandlerの第2引数に渡る", async () => {
  registerRoute("PUT", "/stores/:store_id", (params, body) => ({
    store_id: params.store_id,
    body: body,
  }));
  const result = await localApiCall("PUT", "/stores/to", { name: "テイクワン" });
  assert.deepStrictEqual(result, {
    store_id: "to",
    body: { name: "テイクワン" },
  });
});

test("localApiCall: handlerが投げたApiErrorはそのまま伝播する", async () => {
  registerRoute("DELETE", "/stores/:store_id", () => {
    throw new ApiError(409, "staff still active");
  });
  await assert.rejects(
    async () => {
      await localApiCall("DELETE", "/stores/to");
    },
    (err) => {
      assert.ok(err instanceof ApiError);
      assert.strictEqual(err.status, 409);
      assert.strictEqual(err.message, "staff still active");
      return true;
    }
  );
});

test("localApiCall: handlerが返すPromiseをawaitして解決した値を返す", async () => {
  registerRoute("GET", "/async/:id", async (params) => {
    return new Promise((resolve) => {
      setTimeout(() => resolve("resolved-" + params.id), 1);
    });
  });
  const result = await localApiCall("GET", "/async/42");
  assert.strictEqual(result, "resolved-42");
});

test("ApiError: statusとmessageを保持し、Errorのサブクラスである", () => {
  const err = new ApiError(423, "locked");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof ApiError);
  assert.strictEqual(err.status, 423);
  assert.strictEqual(err.message, "locked");
  assert.strictEqual(err.name, "ApiError");
});

test("localApiCall: 似た静的パスと動的パスが共存してもマッチ順に解決される", async () => {
  registerRoute("GET", "/daily/:year/month/:month", () => "dynamic");
  registerRoute("GET", "/daily/:year/ym/:ym", () => "ym");
  const result1 = await localApiCall("GET", "/daily/2026/month/11");
  const result2 = await localApiCall("GET", "/daily/2026/ym/2026-11");
  assert.strictEqual(result1, "dynamic");
  assert.strictEqual(result2, "ym");
});
