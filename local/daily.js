/**
 * local/daily.js — 日次実績CRUD(daily.pyの移植)。
 *
 * 依存: local/store.js(window.checkStoreId)。<script>タグは
 * db.js → local-api.js → local/store.js → local/staff.js → local/daily.js
 * の順で読み込むこと。
 *
 * 移植元: JISSEKI_SRC/routers/daily.py (JISSEKI_SRC =
 * C:\Users\ghonf\cc-company\shisha\jisseki-app-standalone-build)。
 * ロジックは忠実に移植し、変更した箇所はコードコメントに理由を明記する。
 *
 * IndexedDBの"daily"ストアのキー構造: 年(number)をキーに
 * { date: { store_id: dayData } } を値として保存する(旧daily_<年>.jsonの
 * レコード構造と1対1対応)。local/store.jsのdeleteStoreが既にこの前提で
 * 書かれており(コメント参照)、本ファイルもそれに合わせた。
 *
 * 計画書(Task4)の移植対象外(今回は意図的に移植しない):
 * - `GET /{year}/annual`(get_annual): Produces一覧(計画書Task4)に含まれて
 *   いないため見送り。必要になれば別タスクで追加する。
 *
 * 新設(JISSEKI_SRCには存在しない): memoフィールド(自由記述、バリデーション無し)、
 * staff_entriesの各要素へのcatch_count/call_count/extension_count
 * (キャッチ・呼び・延長インセンティブ。計画書冒頭の「追加要件」参照)。
 */
(function (root) {
  "use strict";

  var DAILY_STORE = "daily";

  // daily.py の _NUMERIC_FIELDS (routers/sync.py からの輸入値)。
  // 日単位のPUT bodyでこれらが数値以外(文字列・bool等)だと、後続の給与集計
  // (int同士の加算)が丸ごと壊れるため型チェックする(2026-08-06確認)。
  var NUMERIC_FIELDS = ["sales_excl_tax", "customer_count", "card_sales"];

  // 新設: staff_entries要素のうち「回数」系で負数を拒否するフィールド。
  // ドリンク(drinks)と全く同じ扱いで良いとの計画書の指示通り、drinks自体には
  // Python側にも負数チェックが元々無い(忠実な移植として変更しない)。
  // catch_count/call_count/extension_countは新設フィールドなので、
  // 計画書の指示(「負数は拒否する程度」)に従いここでバリデーションを追加する。
  var NON_NEGATIVE_ENTRY_FIELDS = ["catch_count", "call_count", "extension_count"];

  // EMPTY_DAY(daily.py)の移植。呼ぶたびに新しいオブジェクトを返す
  // (Pythonの EMPTY_DAY.copy() 相当。同一オブジェクト参照を複数箇所で
  // 共有すると意図しない変更の伝播が起きるため)。
  // memoフィールドはJISSEKI_SRCには存在しない新設(日報の電子化、自由記述)。
  // 未入力時に空文字を返すことで、フロント側のtextareaが毎回undefinedチェックを
  // 書かずに済むようにする(意図的な追加。デフォルト0円のインセンティブ単価と
  // 同じく、既存挙動への影響は無い)。
  function emptyDay() {
    return {
      closed: false,
      sales_excl_tax: 0,
      customer_count: 0,
      card_sales: 0,
      staff_entries: [],
      memo: "",
    };
  }

  function _isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  function _isDigitsOnly(s) {
    return /^[0-9]+$/.test(s);
  }

  // Task6(payroll-admin.js)が window.isLocked(year, month) を定義するまでは
  // 常にfalse(ロック無し)を返す。local/staff.jsの_isLockedと同じ遅延バインディング
  // パターン(ファイル先頭のコメント参照)。
  function _isLocked(year, month) {
    if (typeof root.isLocked === "function") {
      return root.isLocked(year, month);
    }
    return false;
  }

  // _month_of(daily.py)の移植。
  // 2026-10-30バグハントで指摘(Important): 不正な形式のdateに対して無言で0を
  // 返していたため、is_locked(year, 0)が常にFalseになりロックチェックを
  // すり抜けられる余地があった。パースできなければ400で拒否する。
  function _monthOf(date) {
    var parts = String(date).split("-");
    var m = parseInt(parts[1], 10);
    if (parts.length < 2 || Number.isNaN(m)) {
      throw new ApiError(400, "date は YYYY-MM-DD 形式で指定してください。");
    }
    return m;
  }

  // _edited_fields(routers/sync.py)の移植。
  // 呼び出し元(daily.js等)が「実際に人が確定させた欄」を明示してきた場合はそれを、
  // 既存の確定済み欄(旧_user_editedのみのレコードは全欄確定とみなす)と合算する。
  function _entryEditedFields(entry) {
    if (entry && Object.prototype.hasOwnProperty.call(entry, "_edited_fields")) {
      var ef = entry._edited_fields;
      return new Set(Array.isArray(ef) ? ef : []);
    }
    if (entry && entry._user_edited) {
      return new Set(NUMERIC_FIELDS);
    }
    return new Set();
  }

  // URLのyearとdateの年が一致するかの検証(daily.py put_day/reset_day共通)。
  // Pythonは `date[:4].isdigit()` の場合のみ比較する(数字4文字でなければ
  // この時点ではチェックをスキップし、後続の_month_ofが不正な形式として
  // 400を返す役割を担う)。
  function _assertYearMatches(year, date) {
    var prefix = String(date).slice(0, 4);
    if (_isDigitsOnly(prefix) && parseInt(prefix, 10) !== year) {
      throw new ApiError(
        400,
        "URL の year (" + year + ") と date の年 (" + prefix + ") が一致しません"
      );
    }
  }

  // get_day(daily.py)の移植。
  async function getDay(year, date, storeId) {
    var yearData = await dbGet(DAILY_STORE, year);
    var dateEntry = yearData && _isPlainObject(yearData) ? yearData[date] : undefined;
    if (!_isPlainObject(dateEntry)) {
      return emptyDay();
    }
    var day = dateEntry[storeId];
    if (!_isPlainObject(day)) {
      return emptyDay();
    }
    return day;
  }

  // get_month(daily.py)の移植。
  async function getMonth(year, month, storeId) {
    var yearData = await dbGet(DAILY_STORE, year);
    if (!_isPlainObject(yearData)) {
      return [];
    }
    var prefix = year + "-" + String(month).padStart(2, "0") + "-";
    var dates = Object.keys(yearData).sort();
    var result = [];
    dates.forEach(function (dateStr) {
      var dayStores = yearData[dateStr];
      if (
        dateStr.indexOf(prefix) === 0 &&
        _isPlainObject(dayStores) &&
        Object.prototype.hasOwnProperty.call(dayStores, storeId)
      ) {
        var entry = dayStores[storeId];
        if (_isPlainObject(entry)) {
          result.push(Object.assign({ date: dateStr }, entry));
        }
      }
    });
    return result;
  }

  // get_month_all(daily.py)の移植。
  async function getMonthAll(year, ym) {
    var yearData = await dbGet(DAILY_STORE, year);
    if (!_isPlainObject(yearData)) {
      return {};
    }
    var prefix = ym + "-";
    var result = {};
    Object.keys(yearData).forEach(function (k) {
      if (k.indexOf(prefix) === 0) {
        result[k] = yearData[k];
      }
    });
    return result;
  }

  // put_dayのbody検証部分の移植。数値フィールド(sales_excl_tax等)に
  // 文字列・bool等が紛れ込むと後続の給与集計が壊れるため弾く。
  function _validateNumericFields(body) {
    NUMERIC_FIELDS.forEach(function (key) {
      if (key in body && body[key] !== null && body[key] !== undefined) {
        var v = body[key];
        if (typeof v !== "number" || Number.isNaN(v) || typeof v === "boolean") {
          throw new ApiError(400, key + " must be a number");
        }
      }
    });
  }

  // put_dayのstaff_entries検証部分の移植(hours 0-24)+ 新設フィールドの
  // 負数チェック(catch_count/call_count/extension_count)。
  function _validateStaffEntries(body) {
    var entries = body && body.staff_entries;
    if (!Array.isArray(entries)) {
      return;
    }
    entries.forEach(function (entry) {
      if (!_isPlainObject(entry)) {
        return;
      }
      var h = entry.hours;
      if (h !== null && h !== undefined) {
        if (typeof h !== "number" || typeof h === "boolean" || Number.isNaN(h) || h < 0 || h > 24) {
          throw new ApiError(400, "hours must be a number between 0 and 24 (got " + JSON.stringify(h) + ")");
        }
      }
      NON_NEGATIVE_ENTRY_FIELDS.forEach(function (field) {
        var v = entry[field];
        if (v === null || v === undefined) {
          return;
        }
        if (typeof v !== "number" || typeof v === "boolean" || Number.isNaN(v)) {
          throw new ApiError(400, field + " must be a number");
        }
        if (v < 0) {
          throw new ApiError(400, field + " must not be negative");
        }
      });
    });
  }

  // put_day(daily.py)の移植。
  async function putDay(year, date, storeId, body) {
    // 2026-10-30バグハントで指摘(Critical): store_idの検証が無く、任意の
    // store_idで恒久的なゴミデータが作成できた(実際に検証中の事故で実証済み)。
    await checkStoreId(storeId);
    _assertYearMatches(year, date);
    var month = _monthOf(date);
    if (_isLocked(year, month)) {
      throw new ApiError(423, year + "年" + month + "月は給与確定済みのため編集できません");
    }

    var reqBody = body || {};
    _validateNumericFields(reqBody);
    _validateStaffEntries(reqBody);

    var yearData = (await dbGet(DAILY_STORE, year)) || {};
    if (!_isPlainObject(yearData[date])) {
      yearData[date] = {};
    }
    var existing = yearData[date][storeId];
    if (!_isPlainObject(existing)) {
      existing = {};
    }
    // 画面がGETで読み込んだ_deleted:true付きのレコードをそのままbodyに
    // 積んでPUTしてくる経路があるため、existingだけでなく最終マージ結果からも
    // 消す(2026-08-18: 画面側の_deleted除去処理を撤廃した際に、existing側だけ
    // 消しても{...existing, ...body}のbodyがそれを持ち込めば残ることが判明)。
    delete existing._deleted;

    var priorEdited = _entryEditedFields(existing);
    var newEditedRaw = reqBody._edited_fields;
    var newEdited = Array.isArray(newEditedRaw) ? new Set(newEditedRaw) : new Set();
    var editedFields = Array.from(priorEdited);
    newEdited.forEach(function (f) {
      if (NUMERIC_FIELDS.indexOf(f) !== -1 && editedFields.indexOf(f) === -1) {
        editedFields.push(f);
      }
    });
    editedFields.sort();

    var mergedDay = Object.assign(
      {},
      existing,
      reqBody,
      { _user_edited: true, _edited_fields: editedFields }
    );
    delete mergedDay._deleted;

    yearData[date][storeId] = mergedDay;
    await dbPut(DAILY_STORE, year, yearData);
    return mergedDay;
  }

  // reset_day(daily.py)の移植。
  async function resetDay(year, date, storeId) {
    // 2026-10-30バグハントで指摘(Critical): 同上(putDay参照)。
    await checkStoreId(storeId);
    _assertYearMatches(year, date);
    var month = _monthOf(date);
    if (_isLocked(year, month)) {
      throw new ApiError(423, year + "年" + month + "月は給与確定済みのためリセットできません");
    }

    var yearData = (await dbGet(DAILY_STORE, year)) || {};
    var day = yearData[date];
    // {}を代入するのではなくキー自体を消す。{}が残っていると「触っていない日」
    // (EMPTY_DAYのデフォルト0が使われる)と「リセットした日」({}が実際に
    // storeに保存されている)がAPI応答の形として区別されてしまい、フロント側の
    // 表示が完全には揃わない(0が"入力済みの値"に見えてしまう)。キーごと消せば
    // 未タッチの日と完全に同じ応答になる。
    if (_isPlainObject(day)) {
      delete day[storeId];
      if (Object.keys(day).length === 0) {
        delete yearData[date];
      }
    }
    await dbPut(DAILY_STORE, year, yearData);
    return { reset: true, date: date, store_id: storeId };
  }

  root.dailyEmptyDay = emptyDay;
  root.getDay = getDay;
  root.getMonth = getMonth;
  root.getMonthAll = getMonthAll;
  root.putDay = putDay;
  root.resetDay = resetDay;

  // ルート登録順序の注意: "/daily/:year/ym/:ym" と "/daily/:year/:date/:store_id"
  // は同じセグメント数(5)のため、local-api.jsのルーター(先勝ち・パターンの
  // 具体性を見ない単純マッチ)では ym の方を先に登録しないと ":date"="ym",
  // ":store_id"="2026-06" のように汎用パターンに横取りされる
  // (daily.pyのコメント「specific patterns must come before
  // /{year}/{date}/{store_id} to avoid route shadowing」と同じ理由)。
  // "/daily/:year/month/:month/:store_id" はセグメント数が6で異なるため
  // 衝突しないが、分かりやすさのためここでもym・dayより先に置く。
  registerRoute("GET", "/daily/:year/month/:month/:store_id", function (params) {
    return getMonth(parseInt(params.year, 10), parseInt(params.month, 10), params.store_id);
  });
  registerRoute("GET", "/daily/:year/ym/:ym", function (params) {
    return getMonthAll(parseInt(params.year, 10), params.ym);
  });
  registerRoute("GET", "/daily/:year/:date/:store_id", function (params) {
    return getDay(parseInt(params.year, 10), params.date, params.store_id);
  });
  registerRoute("PUT", "/daily/:year/:date/:store_id", function (params, body) {
    return putDay(parseInt(params.year, 10), params.date, params.store_id, body);
  });
  registerRoute("POST", "/daily/:year/:date/:store_id/reset", function (params) {
    return resetDay(parseInt(params.year, 10), params.date, params.store_id);
  });
})(typeof window !== "undefined" ? window : globalThis);
