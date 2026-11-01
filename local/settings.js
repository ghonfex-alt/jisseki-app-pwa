/**
 * local/settings.js — 店全体の設定値(settings.pyの移植)。
 *
 * 依存: db.js, local-api.js。<script>タグは db.js → local-api.js →
 * local/settings.js の順で読み込むこと。local/payroll.jsが本ファイルより先に
 * 読み込まれても問題無い(payroll.jsは"settings"ストアを直接dbGetしており、
 * 本ファイルの関数には依存しない。現状の<script>読み込み順序はdb.js →
 * local-api.js → local/store.js → local/staff.js → local/daily.js →
 * local/tax-table-r8.js → local/payroll.js → local/payroll-admin.js →
 * local/shifts.js → local/inventory.js → local/targets.js →
 * local/settings.js → local/license.js を想定)。
 *
 * Node.js (tests/setup.js 経由の環境) でも
 * require("../db.js"); require("../local-api.js"); require("../local/settings.js");
 * の順でrequireするだけで同じグローバル関数が使えるようにしてある。
 *
 * 移植元: JISSEKI_SRC/routers/settings.py (JISSEKI_SRC =
 * C:\Users\ghonf\cc-company\shisha\jisseki-app-standalone-build)。
 * ロジックは忠実に移植し、変更した箇所はコードコメントに理由を明記する。
 *
 * ── wanope_bonusの既定値0円について(過去の本番事故の教訓) ──────────────────
 * settings.pyの_DEFAULTSコメント通り、ワンオペ手当の既定値は絶対に0のまま
 * 変更しないこと(services/payroll.py::_get_wanope_bonus()・
 * local/payroll.js::getWanopeBonus()と既定値を揺れさせると画面の見積額と
 * 実際の給与計算がズレる)。
 *
 * ── 新設: incentive_rates(キャッチ・呼び・延長の単価、JISSEKI_SRCには存在しない) ──
 * 計画書冒頭の「追加要件」通り、`incentive_rates.{catch,call,extension}.yen_per_count`
 * を settings に追加する。既定値は全て0円(ワンオペ手当と全く同じ安全側既定値
 * ——単価が未確定の間は給与に一切影響しない)。local/payroll.js::getIncentiveRates()
 * が読む形(入れ子オブジェクト)と完全に一致させること(ズレると静かに単価が
 * 0円として扱われてしまうバグになる — ファイル先頭のgetIncentiveRates()実装
 * 参照)。
 *
 * PUTの部分更新について(incentive_ratesのみPythonに前例が無い新設部分の設計判断):
 * settings.pyのupdate_settingsは「_DEFAULTSに列挙されたキーのみ、bodyにその
 * キーが存在すれば値をそのまま上書き保存する」という浅い(1階層)dict.update。
 * wanope_bonus(フラットな数値)はこれで問題無いが、incentive_ratesは
 * catch/call/extensionの3つの単価を持つ入れ子オブジェクトのため、「bodyに
 * incentive_rates全体が来たら丸ごと上書き」という素朴な移植にすると、画面側が
 * 1項目だけ変更して送った場合に他の2項目の既存設定が消え、次のGETで0円
 * (既定値)に戻ってしまう——「単価が静かに書き換わる」という、この機能が
 * 警戒している事故と同種の問題を起こしかねない。そのため本ファイルは
 * catch/call/extensionを個別キーとしてフィールド単位でマージする(PUTで
 * 送られてきた項目だけ更新し、送られてこなかった項目は既存の保存値を保持する)。
 */
(function (root) {
  "use strict";

  var SETTINGS_STORE = "settings";
  var SETTINGS_KEY = "global"; // local/payroll.jsと同じ固定キー。

  var INCENTIVE_KEYS = ["catch", "call", "extension"];

  // settings.pyの_DEFAULTSの移植。wanope_bonusの既定値0は絶対に変更しないこと
  // (ファイル先頭コメント参照)。incentive_ratesは新設のためPythonに対応物は
  // 無いが、同じ安全側既定値の考え方(全て0円)でここに加える。
  var _DEFAULTS = {
    wanope_bonus: 0,
  };

  function _defaultIncentiveRates() {
    return {
      catch: { yen_per_count: 0 },
      call: { yen_per_count: 0 },
      extension: { yen_per_count: 0 },
    };
  }

  function _isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  // settings.pyのバリデーション
  // `isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0`
  // の移植。JSのtypeofはbooleanとnumberを元々区別するため`typeof v === "boolean"`
  // チェックは論理的には到達しないが、Python版のガード構成(bool除外・負数拒否)
  // と1対1対応させるため同じ形で明示的に書く。
  function _isValidNonNegativeNumber(v) {
    return typeof v === "number" && typeof v !== "boolean" && !Number.isNaN(v) && v >= 0;
  }

  // 保存済み設定からincentive_ratesを読み、3項目それぞれ個別に既定値0で
  // 補完して返す(片方だけ保存されている状態でも残りは安全に0円になる)。
  function _mergeIncentiveRates(saved) {
    var defaults = _defaultIncentiveRates();
    var result = {};
    INCENTIVE_KEYS.forEach(function (key) {
      var savedSub = saved && _isPlainObject(saved) && _isPlainObject(saved[key]) ? saved[key] : null;
      var yen = savedSub && savedSub.yen_per_count !== null && savedSub.yen_per_count !== undefined
        ? savedSub.yen_per_count
        : defaults[key].yen_per_count;
      result[key] = { yen_per_count: yen };
    });
    return result;
  }

  // get_settings(settings.py)の移植。
  async function getSettings() {
    var stored = await dbGet(SETTINGS_STORE, SETTINGS_KEY);
    stored = _isPlainObject(stored) ? stored : {};
    var wanope = stored.wanope_bonus !== null && stored.wanope_bonus !== undefined
      ? stored.wanope_bonus
      : _DEFAULTS.wanope_bonus;
    return {
      wanope_bonus: wanope,
      incentive_rates: _mergeIncentiveRates(stored.incentive_rates),
    };
  }

  // update_settings(settings.py)の移植 + incentive_ratesのフィールド単位マージ
  // (ファイル先頭コメント参照)。
  async function updateSettings(body) {
    var reqBody = body || {};

    // wanope_bonusのバリデーション(settings.pyと同じガード)。
    if (Object.prototype.hasOwnProperty.call(reqBody, "wanope_bonus")) {
      if (!_isValidNonNegativeNumber(reqBody.wanope_bonus)) {
        throw new ApiError(400, "wanope_bonus は0以上の数値である必要があります");
      }
    }

    // incentive_ratesのバリデーション(新設。catch/call/extensionそれぞれの
    // yen_per_countに同じガードを適用する)。
    var incomingRates = null;
    if (Object.prototype.hasOwnProperty.call(reqBody, "incentive_rates")) {
      if (!_isPlainObject(reqBody.incentive_rates)) {
        throw new ApiError(400, "incentive_rates はオブジェクトである必要があります");
      }
      incomingRates = reqBody.incentive_rates;
      INCENTIVE_KEYS.forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(incomingRates, key)) {
          return;
        }
        var sub = incomingRates[key];
        if (!_isPlainObject(sub) || !_isValidNonNegativeNumber(sub.yen_per_count)) {
          throw new ApiError(
            400,
            "incentive_rates." + key + ".yen_per_count は0以上の数値である必要があります"
          );
        }
      });
    }

    var stored = await dbGet(SETTINGS_STORE, SETTINGS_KEY);
    stored = _isPlainObject(stored) ? stored : {};

    if (Object.prototype.hasOwnProperty.call(reqBody, "wanope_bonus")) {
      stored.wanope_bonus = reqBody.wanope_bonus;
    }

    if (incomingRates) {
      var currentRates = _isPlainObject(stored.incentive_rates) ? stored.incentive_rates : {};
      var mergedRates = {};
      INCENTIVE_KEYS.forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(incomingRates, key)) {
          mergedRates[key] = { yen_per_count: incomingRates[key].yen_per_count };
        } else if (_isPlainObject(currentRates[key])) {
          mergedRates[key] = { yen_per_count: currentRates[key].yen_per_count };
        }
      });
      stored.incentive_rates = mergedRates;
    }

    await dbPut(SETTINGS_STORE, SETTINGS_KEY, stored);
    return getSettings();
  }

  root.getSettings = getSettings;
  root.updateSettings = updateSettings;

  registerRoute("GET", "/settings", function () {
    return getSettings();
  });
  registerRoute("PUT", "/settings", function (params, body) {
    return updateSettings(body);
  });
})(typeof window !== "undefined" ? window : globalThis);
