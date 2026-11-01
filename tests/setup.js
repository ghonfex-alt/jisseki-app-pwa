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

// local/export.js(SheetJS)用: 本番コードはXLSXを require() しない
// (ブラウザでは<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/...">
// タグで読み込まれる想定、local/export.js先頭コメント参照)。テストでのみ、
// devDependencyのnpm版xlsx(ブラウザCDN版と同じSheetJS本体)をグローバルに
// 注入し、本番コードからは`window.XLSX`として同じ形で見えるようにする。
// xlsxが未インストールの環境でも他のテストファイルが落ちないようにtry/catchする。
try {
  if (typeof globalThis.XLSX === "undefined") {
    globalThis.XLSX = require("xlsx");
  }
} catch (e) {
  // local/export.jsのテストだけ失敗する(xlsxが居ないことを示すエラーになる)。
}
