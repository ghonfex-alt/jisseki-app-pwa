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

  root.dbOpen = dbOpen;
  root.dbGet = dbGet;
  root.dbGetAll = dbGetAll;
  root.dbPut = dbPut;
  root.dbDelete = dbDelete;
  // 他タスク(例: backup.js のエクスポート/インポート)がストア一覧を
  // 二重管理せずに済むように公開しておく。
  root.DB_STORE_NAMES = STORE_NAMES.slice();
})(typeof window !== "undefined" ? window : globalThis);
