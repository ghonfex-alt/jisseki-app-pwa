/**
 * db.js — IndexedDBの薄いPromiseラッパー。
 *
 * モジュールバンドラは使わない。<script src="db.js"> で読み込むだけで
 * window.dbOpen / window.dbGet / window.dbPut / window.dbGetAll / window.dbDelete
 * がグローバルに使えるようになる(他のタスクのJSファイルはこれらを直接呼ぶ)。
 *
 * Node.js (tests/setup.js 経由で fake-indexeddb を読み込んだ環境) でも
 * require("../db.js") するだけで同じグローバル関数が使えるようにしてある。
 */
(function (root) {
  "use strict";

  var DB_NAME = "jisseki-db";
  var DB_VERSION = 1;

  // dbOpen の upgradeneeded で作成する全オブジェクトストア。
  var STORE_NAMES = [
    "stores",
    "staff",
    "daily",
    "shifts",
    "shift_requests",
    "shift_gap_dismissed",
    "inventory",
    "inventory_log",
    "settings",
    "license",
    "payroll_locks",
    "payroll_snapshots",
    "payroll_adjustments",
    "targets",
    "nippo_confirmed",
  ];

  // dbOpen() は何度呼ばれても同じ接続Promiseを返す(アプリ起動時に一度呼べば良い)。
  var dbPromise = null;

  function requestToPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  function dbOpen() {
    if (dbPromise) {
      return dbPromise;
    }
    dbPromise = new Promise(function (resolve, reject) {
      var request = root.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function () {
        var db = request.result;
        STORE_NAMES.forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name);
          }
        });
      };

      request.onsuccess = function () {
        resolve(request.result);
      };

      request.onerror = function () {
        dbPromise = null; // 失敗したら次回また開けるようにする
        reject(request.error);
      };
    });
    return dbPromise;
  }

  async function dbGet(storeName, key) {
    var db = await dbOpen();
    var tx = db.transaction(storeName, "readonly");
    var store = tx.objectStore(storeName);
    return requestToPromise(store.get(key));
  }

  async function dbGetAll(storeName) {
    var db = await dbOpen();
    var tx = db.transaction(storeName, "readonly");
    var store = tx.objectStore(storeName);
    return requestToPromise(store.getAll());
  }

  async function dbPut(storeName, key, value) {
    var db = await dbOpen();
    var tx = db.transaction(storeName, "readwrite");
    var store = tx.objectStore(storeName);
    await requestToPromise(store.put(value, key));
  }

  async function dbDelete(storeName, key) {
    var db = await dbOpen();
    var tx = db.transaction(storeName, "readwrite");
    var store = tx.objectStore(storeName);
    await requestToPromise(store.delete(key));
  }

  // dbGetAllは値だけを返しキーを失ってしまう(IndexedDBのgetAll()の仕様上、
  // out-of-lineキー——本アプリの全ストアがそう、createObjectStoreにkeyPathを
  // 指定していないため——はカーソルでしか読めない)。Task3(local/targets.js)・
  // Task6(local/payroll-admin.js)が個別にカーソルを書いて同じ問題を回避して
  // いたが、Task12(local/backup.js、全ストアの汎用バックアップ/リストア)でも
  // 同じ理由でキーが必須になり、3つ目の重複実装になりそうだったため、
  // ここで共通ヘルパーとして一本化する(db.js自体は小さく基盤的なファイルで、
  // 既存のdbGet/dbPut/dbGetAll/dbDelete/dbOpenの戻り値・挙動は一切変えていない
  // ので、Task1〜11のテストへの影響は無い——追加のみ)。
  async function dbGetAllWithKeys(storeName) {
    var db = await dbOpen();
    var tx = db.transaction(storeName, "readonly");
    var store = tx.objectStore(storeName);
    var result = [];
    return new Promise(function (resolve, reject) {
      var req = store.openCursor();
      req.onsuccess = function () {
        var cursor = req.result;
        if (cursor) {
          result.push({ key: cursor.key, value: cursor.value });
          cursor.continue();
        } else {
          resolve(result);
        }
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  // ストアの全件を削除する(backup.jsの「読み込み前に全件消してから書き戻す」
  // 用途のために追加。他タスクはこれまで使っていない)。
  async function dbClear(storeName) {
    var db = await dbOpen();
    var tx = db.transaction(storeName, "readwrite");
    var store = tx.objectStore(storeName);
    await requestToPromise(store.clear());
  }

  root.dbOpen = dbOpen;
  root.dbGet = dbGet;
  root.dbGetAll = dbGetAll;
  root.dbGetAllWithKeys = dbGetAllWithKeys;
  root.dbPut = dbPut;
  root.dbDelete = dbDelete;
  root.dbClear = dbClear;
  // 他タスク(例: backup.js のエクスポート/インポート)がストア一覧を
  // 二重管理せずに済むように公開しておく。
  root.DB_STORE_NAMES = STORE_NAMES.slice();
})(typeof window !== "undefined" ? window : globalThis);
