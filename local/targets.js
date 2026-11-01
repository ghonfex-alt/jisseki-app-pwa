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
 * 訂正(audit-loop、2026-11-01の監査で指摘): 上のtargets.pyコメントを踏襲して
 * 「dbGet→update→dbPutの間に別のawaitを挟まなければ安全」と書いていたが、
 * これは誤り。db.jsのdbGet/dbPutはそれぞれ別のIndexedDBトランザクションを
 * 開く(db.js参照)ため、setTarget関数内に他のawaitが無くても、2つの
 * setTarget呼び出しが並行実行されれば一方のdbGetがもう一方のdbPutより先に
 * 走り、後勝ちで片方の更新を消しうる(この思い込みが実際に他のファイル
 * [local/settings.js]で実害事故を起こしたため、同じ説明をここに残さない)。
 * dbUpdate()(db.js)経由の直列化に変更し、安全性を保証する。
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
    await dbUpdate(TARGETS_STORE, storeId, async function (existing) {
      if (!_isPlainObject(existing)) {
        existing = {};
      }
      Object.assign(existing, body || {});
      return existing;
    });
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
