/**
 * local-api.js — サーバーを使わないローカルAPIルーター。
 *
 * モジュールバンドラは使わない。<script src="local-api.js"> で読み込むだけで
 * window.ApiError / window.registerRoute / window.localApiCall がグローバルに
 * 使えるようになる(他タスクのlocal/*.jsは<script>タグで読み込まれた時点で
 * registerRouteを呼び、自分のルートを自己登録する)。
 *
 * Node.js (tests/setup.js 経由の環境) でも require("../local-api.js") するだけで
 * 同じグローバル関数が使えるようにしてある。
 */
(function (root) {
  "use strict";

  /**
   * App.api(method, path, body) 相当のエラー型。
   * HTTPのステータスコードに対応する`status`を持つ(404, 409, 423等)。
   */
  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }

  // 登録済みルート一覧。{ method, regex, paramNames, handler } の配列。
  var routes = [];

  // ":name" のようなコロン記法のパスパターンを正規表現へ変換する。
  // 戻り値: { regex, paramNames }
  function compilePattern(pattern) {
    var paramNames = [];
    var regexStr = pattern
      .split("/")
      .map(function (segment) {
        if (segment.charAt(0) === ":") {
          paramNames.push(segment.slice(1));
          return "([^/]+)";
        }
        // リテラル部分は正規表現の特殊文字をエスケープする。
        return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    return {
      regex: new RegExp("^" + regexStr + "$"),
      paramNames: paramNames,
    };
  }

  /**
   * ルートを登録する。
   * @param {string} method - "GET"/"PUT"/"POST"/"DELETE"等(大文字小文字は問わない)。
   * @param {string} pattern - 例: "/stores/:store_id"
   * @param {function(params, body): any} handler - マッチ時に呼ばれる関数。
   *   paramsはパスパラメータ+クエリ文字列パラメータを合わせたオブジェクト。
   *   戻り値はPromiseでもそのままの値でもよい(localApiCallはawaitする)。
   */
  function registerRoute(method, pattern, handler) {
    var compiled = compilePattern(pattern);
    routes.push({
      method: String(method).toUpperCase(),
      regex: compiled.regex,
      paramNames: compiled.paramNames,
      handler: handler,
    });
  }

  /**
   * 登録済みルートの中からmethod・pathが一致するものを探し、
   * handler(params, body) を呼んでその戻り値を返す。
   * 一致するルートが無ければ ApiError(404) を投げる。
   */
  async function localApiCall(method, path, body) {
    var upperMethod = String(method).toUpperCase();

    var queryIndex = path.indexOf("?");
    var pathname = queryIndex === -1 ? path : path.slice(0, queryIndex);
    var queryString = queryIndex === -1 ? "" : path.slice(queryIndex + 1);

    // クエリ文字列(?limit=100等)をまずparamsに展開する。
    var params = {};
    if (queryString) {
      var searchParams = new URLSearchParams(queryString);
      searchParams.forEach(function (value, key) {
        params[key] = value;
      });
    }

    for (var i = 0; i < routes.length; i++) {
      var route = routes[i];
      if (route.method !== upperMethod) {
        continue;
      }
      var match = route.regex.exec(pathname);
      if (!match) {
        continue;
      }
      // パスパラメータはクエリ文字列より優先する(同名なら上書き)。
      route.paramNames.forEach(function (name, idx) {
        params[name] = decodeURIComponent(match[idx + 1]);
      });
      return route.handler(params, body);
    }

    throw new ApiError(404, "not found: " + upperMethod + " " + path);
  }

  // テスト・ホットリロード等でルートテーブルを空にしたい場合に使う
  // (本番コードパスでは呼ばない)。
  function _resetRoutesForTest() {
    routes = [];
  }

  root.ApiError = ApiError;
  root.registerRoute = registerRoute;
  root.localApiCall = localApiCall;
  root._resetRoutesForTest = _resetRoutesForTest;
})(typeof window !== "undefined" ? window : globalThis);
