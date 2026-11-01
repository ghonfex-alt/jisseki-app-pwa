/**
 * local/targets.js — 月次売上目標の管理(targets.pyの移植)。
 *
 * 依存: local/store.js(window.checkStoreId)。<script>タグは
 * db.js → local-api.js → local/store.js → local/targets.js の順で読み込むこと。
 *
 * Node.js (tests/setup.js 経由の環境) でも
 * require("../db.js"); require("../local-api.js"); require("../local/store.js");
 * require("../local/targets.js"); の順でrequireするだけで同じグローバル関数が
 * 使えるようにしてある。
 *
 * 移植元: JISSEKI_SRC/routers/targets.py (JISSEKI_SRC =
 * C:\Users\ghonf\cc-company\shisha\jisseki-app-standalone-build)。
 * ロジックは忠実に移植し、変更した箇所はコードコメントに理由を明記する。
 *
 * targets.pyのコメントが指摘する「IndexedDB移植によりTOCTOU(read→update→write
 * の間に他の書き込みが割り込むロストアップデート)の心配が無くなる」点は
 * そのまま当てはまる: IndexedDBの単一トランザクション(dbPut)で書き込みが
 * アトミックに行われるため、targets.pyの_data_lock相当のロックは不要
 * (db.jsのdbPut自体がreadwriteトランザクションとして完結する)。
 * ただし本関数は dbGet→(メモリ上でupdate)→dbPut の間に別のawaitを挟まない
 * ようにしてあるので、同じ安全性が保たれている。
 */
(function (root) {
  "use strict";

  var TARGETS_STORE = "targets";

  function _isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  // get_targets(targets.py)の移植。
  // IndexedDBの"targets"ストアはstore_idをキーに個別保存されているため、
  // targets.jsonと同じ { store_id: {...} } 形(dict)に組み立てて返す。
  // db.jsのdbGetAllは値だけを返しキー(store_id)を失ってしまうため
  // (targets自体の値はstore.pyのstoreオブジェクトのようにidフィールドを
  // 自前で持たない)、ここだけカーソルでキー・値を一緒に読み出す
  // (db.jsは変更しない方針のため、本ファイル内に閉じて実装する)。
  async function getTargets() {
    var db = await dbOpen();
    var tx = db.transaction(TARGETS_STORE, "readonly");
    var store = tx.objectStore(TARGETS_STORE);
    var result = {};
    return new Promise(function (resolve, reject) {
      var req = store.openCursor();
      req.onsuccess = function () {
        var cursor = req.result;
        if (cursor) {
          if (_isPlainObject(cursor.value)) {
            result[cursor.key] = cursor.value;
          }
          cursor.continue();
        } else {
          resolve(result);
        }
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  // set_target(targets.py)の移植。
  // { "monthly": 1200000 } の形式で目標を設定する。dict.update相当の部分更新
  // (浅いマージ)。2026-10-30バグハント指摘のstore_id検証も忠実に移植する。
  async function setTarget(storeId, body) {
    await checkStoreId(storeId);
    var existing = await dbGet(TARGETS_STORE, storeId);
    if (!_isPlainObject(existing)) {
      existing = {};
    }
    Object.assign(existing, body || {});
    await dbPut(TARGETS_STORE, storeId, existing);
    return { ok: true };
  }

  root.getTargets = getTargets;
  root.setTarget = setTarget;

  registerRoute("GET", "/targets", function () {
    return getTargets();
  });
  registerRoute("PUT", "/targets/:store_id", function (params, body) {
    return setTarget(params.store_id, body);
  });
})(typeof window !== "undefined" ? window : globalThis);
