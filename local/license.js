/**
 * local/license.js — 簡易ライセンスキー認証(license.pyの移植)。
 * 不正コピーの最低限の抑止であり、厳格な認証は行わない。固定の有効キー一覧
 * (ハッシュ化済み)に一致すれば有効化済みとして記録する。
 *
 * 依存: db.js, local-api.js。<script>タグは db.js → local-api.js →
 * local/license.js の順で読み込むこと。
 *
 * Node.js (tests/setup.js 経由の環境) でも
 * require("../db.js"); require("../local-api.js"); require("../local/license.js");
 * の順でrequireするだけで同じグローバル関数が使えるようにしてある。
 *
 * 移植元: JISSEKI_SRC/routers/license.py (JISSEKI_SRC =
 * C:\Users\ghonf\cc-company\shisha\jisseki-app-standalone-build)。
 * ロジックは忠実に移植し、変更した箇所はコードコメントに理由を明記する。
 *
 * ── コミット96f8099(license.py)の修正内容の移植について ──────────────────
 * 「ライセンスキーが文字列以外で送られた場合に500になる問題を修正」
 * (body["key"]が数値・配列等だと.strip()相当の処理でAttributeError→500に
 * なっていた。入力不正は500ではなく400で返すべき、という修正)。
 * 本ファイルのactivateLicense()は同じ2段構えのガードをそのまま移植する:
 *   1. `raw = body.get("key") or ""` — Pythonの`or`はbody["key"]がPython的に
 *      falsy(None/False/0/""/[]/{} など)なら無条件で""にフォールバックする。
 *      これをJSでも_isPythonTruthy()で再現する(素朴に`body.key || ""`と書くと
 *      JSのfalsy判定は{}/[]を含めないため、空配列・空dictが渡った場合に
 *      Python版と結果が変わってしまう)。
 *   2. `if not isinstance(raw, str): raise HTTPException(400, ...)` —
 *      上記1を通過してもなお文字列でない場合(truthyな数値・配列・true等)は
 *      ここで400として拒否する。
 * この2段構えにより、key に undefined/null/123/true/[]/{} 等、文字列以外の
 * 何を送っても最終的に「400(入力不正)」として安全に拒否され、
 * crypto.subtle.digest()に文字列以外の値や未定義値が渡って例外になることは無い
 * (タスクで特に念押しされているセキュリティゲート)。
 *
 * ── SHA-256実装のブラウザ/Node両対応について ──────────────────────────────
 * ブラウザ: Web Crypto API (`crypto.subtle.digest("SHA-256", ...)`、非同期)
 * で計算する。全モダンブラウザ標準搭載のため追加ライブラリは不要。
 * Node.js (tests/setup.js経由のテスト環境): Node v19以降はグローバルに
 * `globalThis.crypto`(Web Crypto実装)が存在し、`crypto.subtle.digest`は
 * ブラウザと全く同じAPI・同じ結果になる(本プロジェクトのNode v24で
 * `crypto.subtle.digest("SHA-256", ...)`の結果が`node:crypto`の
 * `createHash("sha256")`と完全に一致することを実測確認済み)。
 * そのため通常はブラウザ・Node共通のこの1本の実装(_sha256Hex)だけで動く。
 * ただし「Node環境にwindowが無い」ケースと同じ理由で、万一(より古いNode、
 * またはWeb Crypto未実装の非ブラウザ環境)`crypto.subtle`が無い場合に備えて、
 * Node組み込みの`node:crypto`モジュールへのフォールバックを用意する。
 * このフォールバック分岐はブラウザでは絶対に実行されない
 * (`crypto.subtle`が常に存在するため分岐に入らない)ので、ブラウザ上で
 * 存在しない`require`を参照してReferenceErrorになることもない。
 */
(function (root) {
  "use strict";

  var LICENSE_STORE = "license";
  var LICENSE_KEY = "status"; // license.jsonの代わりの固定キー。

  // 顧客ごとに発行する固定キーのSHA256ハッシュを並べる。
  // 平文のキー自体をコードに含めないことで、このファイルがソース公開されても
  // 有効なキーがそのまま漏れないようにする(license.pyと同じ方針)。
  //
  // 下記1件は sha256("DEMO-0000-0000") の16進文字列(license.pyの
  // `hashlib.sha256(b"DEMO-0000-0000").hexdigest()`と同じ値。入力が固定の
  // リテラルである以上SHA-256の結果は常に同じ値になるため、Python同様
  // 実行時に都度計算するのではなくここでは計算済みの値を定数として置く
  // ——license.activate実行時に毎回この定数をSetへ積み直す必要が無く、
  // Set自体をモジュール読み込み時に1回だけ同期的に作れる利点もある)。
  // 実販売前にdocs/seller-notes/相当の手順で顧客ごとの値に差し替える運用も
  // license.pyと同じく維持する。
  var _VALID_KEY_HASHES = new Set([
    "c4abef3e959c1dff2e00399f40227de37911852c65d74cba6bd6a83e28d5e7b0",
  ]);

  // Pythonの真偽判定(空dict/空listはfalsy)をJSで再現する
  // (local/store.jsの_isPythonTruthyと同じ考え方。各local/*.jsが独立した
  // 小さなprivateヘルパーを持つ既存の方針に合わせ、ここでも複製する)。
  function _isPythonTruthy(v) {
    if (v === null || v === undefined || v === false || v === 0 || v === "") {
      return false;
    }
    if (Array.isArray(v)) {
      return v.length > 0;
    }
    if (typeof v === "object") {
      return Object.keys(v).length > 0;
    }
    return true;
  }

  // SHA-256ハッシュを16進文字列で返す(ファイル先頭コメント参照)。
  async function _sha256Hex(text) {
    var g = typeof window !== "undefined" ? window : globalThis;
    var subtle = g.crypto && g.crypto.subtle;
    if (subtle) {
      var data = new TextEncoder().encode(text);
      var hashBuffer = await subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(hashBuffer))
        .map(function (b) { return b.toString(16).padStart(2, "0"); })
        .join("");
    }
    // フォールバック: crypto.subtleが使えないNode.js環境専用(ブラウザでは
    // 到達しない。ファイル先頭コメント参照)。
    var nodeCrypto = require("node:crypto");
    return nodeCrypto.createHash("sha256").update(text, "utf8").digest("hex");
  }

  // get_license_status(license.py)の移植。
  async function getLicenseStatus() {
    var data = await dbGet(LICENSE_STORE, LICENSE_KEY);
    return { activated: !!(data && data.activated) };
  }

  // activate_license(license.py)の移植。コミット96f8099のガードを含む
  // (ファイル先頭コメント参照)。
  async function activateLicense(body) {
    var reqBody = body || {};
    // raw = body.get("key") or "" の移植。
    var raw = _isPythonTruthy(reqBody.key) ? reqBody.key : "";
    // keyが文字列以外(数値・配列・true等)で送られた場合、Python版では
    // .strip()がAttributeErrorになり500を返していた。入力不正は500ではなく
    // 400で返す(crypto.subtle.digest()に文字列以外を渡さないための
    // 型ガードでもある——このタスクの最重要ポイント)。
    if (typeof raw !== "string") {
      throw new ApiError(400, "ライセンスキーが正しくありません。");
    }
    var key = raw.trim();
    var hashHex = await _sha256Hex(key);
    if (!_VALID_KEY_HASHES.has(hashHex)) {
      throw new ApiError(400, "ライセンスキーが正しくありません。");
    }
    await dbPut(LICENSE_STORE, LICENSE_KEY, { activated: true });
    return { activated: true };
  }

  root.getLicenseStatus = getLicenseStatus;
  root.activateLicense = activateLicense;

  registerRoute("GET", "/license/status", function () {
    return getLicenseStatus();
  });
  registerRoute("POST", "/license/activate", function (params, body) {
    return activateLicense(body);
  });
})(typeof window !== "undefined" ? window : globalThis);
