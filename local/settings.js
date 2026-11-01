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
 * catch/call/extension/drinkの単価を持つ入れ子オブジェクトのため、「bodyに
 * incentive_rates全体が来たら丸ごと上書き」という素朴な移植にすると、画面側が
 * 1項目だけ変更して送った場合に他の項目の既存設定が消え、次のGETで既定値に
 * 戻ってしまう——「単価が静かに書き換わる」という、この機能が警戒している
 * 事故と同種の問題を起こしかねない(2026-11-01のaudit-loopでも、この直列化
 * 漏れが原因の実害事故を確認・修正済み)。そのため本ファイルはcatch/call/
 * extension/drinkを個別キーとしてフィールド単位でマージする(PUTで送られて
 * きた項目だけ更新し、送られてこなかった項目は既存の保存値を保持する)。
 *
 * ── 追記(2026-11-02、買い手から実際の単価の連絡を受けて追加) ──────────────
 * - incentive_rates.drink: ドリンクバックの単価。元々local/payroll.jsに
 *   DRINK_UNIT=70円固定で移植していたが、買い手の実際の単価(100円)が判明し、
 *   他の単価と同じく設定画面から変更できる必要が出たため、catch/call/
 *   extensionと同じ仕組みに統合する。catch/call/extensionは「元々存在しない
 *   新機能」なので安全側の既定値0円だが、drinkは「元々存在していた機能の
 *   単価を設定可能にしただけ」なので、未設定時の既定値は0円ではなく、移植元
 *   (services/payroll.py)の値である70円のままにする(0円がデフォルトだと、
 *   設定を一度もいじっていない状態で金額が静かに0円になり、ワンオペ手当と
 *   同種の過少/過大支給事故になりかねないため)。
 * - base_session_minutes: 平均滞在時間の概算に使う「基本セッション時間(分)」。
 *   延長回数(30分単位)から平均滞在時間を逆算する用途(frontend/summary.js
 *   参照)。店舗の基本営業ルールに依存する値のため設定画面で変更可能にする。
 *   既定値60分(シーシャバーの一般的な1コマ時間)。
 */
(function (root) {
  "use strict";

  var SETTINGS_STORE = "settings";
  var SETTINGS_KEY = "global"; // local/payroll.jsと同じ固定キー。

  var INCENTIVE_KEYS = ["catch", "call", "extension", "drink"];

  // settings.pyの_DEFAULTSの移植。wanope_bonusの既定値0は絶対に変更しないこと
  // (ファイル先頭コメント参照)。incentive_rates/base_session_minutesは新設の
  // ためPythonに対応物は無いが、同じ考え方でここに加える。
  var _DEFAULTS = {
    wanope_bonus: 0,
    base_session_minutes: 60,
  };

  // drinkだけ既定値70円(元々のDRINK_UNIT固定値、ファイル先頭コメント参照)。
  // catch/call/extensionは新設機能なので安全側の0円。
  function _defaultIncentiveRates() {
    return {
      catch: { yen_per_count: 0 },
      call: { yen_per_count: 0 },
      extension: { yen_per_count: 0 },
      drink: { yen_per_count: 70 },
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
    var baseSessionMinutes = stored.base_session_minutes !== null && stored.base_session_minutes !== undefined
      ? stored.base_session_minutes
      : _DEFAULTS.base_session_minutes;
    return {
      wanope_bonus: wanope,
      incentive_rates: _mergeIncentiveRates(stored.incentive_rates),
      base_session_minutes: baseSessionMinutes,
      // システム管理の読み取り専用フィールド(local/backup.js::_recordBackupExported
      // が書き込む)。ユーザーが編集するものではないためupdateSettingsの
      // バリデーション対象には含めない——未バックアップ時はnull。
      last_backup_at: stored.last_backup_at !== undefined ? stored.last_backup_at : null,
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

    // base_session_minutesのバリデーション(同じガード)。
    if (Object.prototype.hasOwnProperty.call(reqBody, "base_session_minutes")) {
      if (!_isValidNonNegativeNumber(reqBody.base_session_minutes)) {
        throw new ApiError(400, "base_session_minutes は0以上の数値である必要があります");
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

    // audit-loop(2026-11-01)の監査で指摘(root cause): この関数のdbGet→
    // マージ→dbPutが直列化されておらず、キャッチ/呼び/延長の単価を連続編集
    // すると後勝ちで片方のフィールドの保存が消える実害が出ていた
    // (frontend/settings.js側に専用の直列化キュー`_queueSettingsWrite`を
    // 応急的に追加して対処したが、設計批評で「この関数自体がdbUpdate()経由で
    // ないのは一貫性が無く、frontend側の対策を忘れた別の呼び出し経路があれば
    // 再発する」と指摘された)。根本の直列化をこちら側にも持たせることで、
    // frontend側の対策の有無にかかわらず安全にする。
    await dbUpdate(SETTINGS_STORE, SETTINGS_KEY, async function (stored) {
      stored = _isPlainObject(stored) ? stored : {};

      if (Object.prototype.hasOwnProperty.call(reqBody, "wanope_bonus")) {
        stored.wanope_bonus = reqBody.wanope_bonus;
      }

      if (Object.prototype.hasOwnProperty.call(reqBody, "base_session_minutes")) {
        stored.base_session_minutes = reqBody.base_session_minutes;
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

      return stored;
    });
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
