/**
 * tests/setup.js — Node.jsのテスト環境にブラウザのIndexedDB相当のグローバルを注入する。
 *
 * 各テストファイルの先頭で `require("./setup")` してから
 * `require("../db.js")` (や他のlocal/*.js) を読み込むこと。
 */
"use strict";

// fake-indexeddb/auto は globalThis.indexedDB / IDBKeyRange 等をNode上に生やす。
require("fake-indexeddb/auto");

// db.js (および将来のlocal/*.js) は `window.xxx = ...` の形でグローバル関数を
// 公開する作りなので、Node上でも window を用意しておく。
if (typeof globalThis.window === "undefined") {
  globalThis.window = globalThis;
}
