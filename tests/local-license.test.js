"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("./setup");
require("../db.js");
require("../local-api.js");
require("../local/license.js");

test.beforeEach(async () => {
  await dbDelete("license", "status");
});

test("getLicenseStatus: 未有効化時はactivated: false", async () => {
  const status = await getLicenseStatus();
  assert.deepStrictEqual(status, { activated: false });
});

test("activateLicense: 正しいデモキーで有効化できる", async () => {
  const result = await activateLicense({ key: "DEMO-0000-0000" });
  assert.deepStrictEqual(result, { activated: true });

  const status = await getLicenseStatus();
  assert.deepStrictEqual(status, { activated: true });
});

test("activateLicense: 前後の空白はtrimされる(正しいキーとして通る)", async () => {
  const result = await activateLicense({ key: "  DEMO-0000-0000  " });
  assert.deepStrictEqual(result, { activated: true });
});

test("activateLicense: 間違ったキーは400(有効化されない)", async () => {
  await assert.rejects(async () => activateLicense({ key: "WRONG-KEY" }), (err) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.status, 400);
    assert.match(err.message, /正しくありません/);
    return true;
  });
  const status = await getLicenseStatus();
  assert.strictEqual(status.activated, false);
});

// ── コミット96f8099(license.py)の移植確認: 文字列以外のkeyで500にならないこと ──
// (crypto.subtle.digest()に文字列以外・undefined/nullが渡って未捕捉の例外に
// なっていないかの確認を含む、このタスクの最重要ポイント)。

test("activateLicense: keyが数値(123)なら500ではなく400で拒否される", async () => {
  await assert.rejects(async () => activateLicense({ key: 123 }), (err) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.status, 400);
    assert.match(err.message, /正しくありません/);
    return true;
  });
});

test("activateLicense: keyがnullなら500ではなく400で拒否される", async () => {
  await assert.rejects(async () => activateLicense({ key: null }), (err) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("activateLicense: keyがundefined(bodyにkeyが無い)なら500ではなく400で拒否される", async () => {
  await assert.rejects(async () => activateLicense({}), (err) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("activateLicense: bodyそのものがundefined/nullでも500にならず400で拒否される", async () => {
  await assert.rejects(async () => activateLicense(undefined), (err) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.status, 400);
    return true;
  });
  await assert.rejects(async () => activateLicense(null), (err) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("activateLicense: keyが配列なら500ではなく400で拒否される", async () => {
  await assert.rejects(async () => activateLicense({ key: ["a", "b"] }), (err) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("activateLicense: keyが空配列(Python的にfalsy)でも500ではなく400で拒否される", async () => {
  // raw = body.get("key") or "" のPython移植: 空配列はPython的にfalsyなので
  // ""にフォールバックし、型ガードではなくハッシュ不一致で400になる経路。
  await assert.rejects(async () => activateLicense({ key: [] }), (err) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("activateLicense: keyが真偽値(true)なら500ではなく400で拒否される", async () => {
  await assert.rejects(async () => activateLicense({ key: true }), (err) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("activateLicense: keyがオブジェクトなら500ではなく400で拒否される", async () => {
  await assert.rejects(async () => activateLicense({ key: { not: "a string" } }), (err) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.status, 400);
    return true;
  });
});

test("localApiCall経由でのルーティング: GET /license/status, POST /license/activate", async () => {
  const before = await localApiCall("GET", "/license/status");
  assert.deepStrictEqual(before, { activated: false });

  const activated = await localApiCall("POST", "/license/activate", { key: "DEMO-0000-0000" });
  assert.deepStrictEqual(activated, { activated: true });

  const after = await localApiCall("GET", "/license/status");
  assert.deepStrictEqual(after, { activated: true });
});
