/**
 * local/shifts.js — シフト管理(routers/shifts.pyの移植)。
 *
 * 依存: db.js, local-api.js, local/store.js(window.checkStoreId)、
 * local/daily.js(window.getDay — getShiftGapsが実績データを読むのに使う)、
 * local/payroll-admin.js(window.isLocked — 確定済み月の編集拒否)。<script>タグは
 * db.js → local-api.js → local/store.js → local/staff.js → local/daily.js →
 * local/tax-table-r8.js → local/payroll.js → local/payroll-admin.js →
 * local/shifts.js の順で読み込むこと。isLockedはTask6で既に実体が定義される
 * ため直接呼んでも安全だが、スクリプトタグの読み込み順が将来入れ替わる事故を
 * 考慮し、local/daily.js・local/staff.jsと同じ「未定義なら常にfalse」の
 * 遅延バインディングパターンを踏襲する(_isLocked参照)。
 *
 * 移植元: JISSEKI_SRC/routers/shifts.py (JISSEKI_SRC =
 * C:\Users\ghonf\cc-company\shisha\jisseki-app-standalone-build)。
 * ロジックは忠実に移植し、変更した箇所はコードコメントに理由を明記する。
 *
 * ── 本番データ破壊事故の経緯(最重要・絶対に逆行しないこと) ──────────────
 * JISSEKI_SRC/routers/shifts.py::reconcile_shift_gaps_for_report のdocstring
 * 参照。2026-10-26判明(Critical): 以前は日報確認時にshifts.json自体を
 * その日の実績出勤者で丸ごと上書きする(sync_shift_to_report、旧実装)方式
 * だったが、確認済みの日報が「絶対に正しい実績」という前提で動いていた。
 * ところが確認時点でも日報の日付自体が誤っている場合があり(実例: 本来19日の
 * 実績が一時的に20日表記になっていたのを確認してしまった)、その誤った内容で
 * Excel由来の正しいシフト予定が丸ごと上書きされ、後で日報の日付を訂正しても
 * 予定は再同期されず永久に失われる事故が本番データで起きた。
 *
 * 現在の安全な実装(reconcile_shift_gaps_for_report)はシフト予定
 * (shifts/shift_requestsストア)を一切書き換えない。「予定されていたが出勤
 * しなかった人」の不足表示(gaps)をshift_gap_dismissedストアに記録して
 * 解消するだけであり、シフト予定の読み取り専用参照以外では一切触れない。
 * 本ファイルもこの安全な方式のみを移植する。前月コピー・実績による上書きのような
 * 「前回の事故の形」には絶対に戻さないこと(putShifts/putRequestsは常に
 * 明示的なユーザー編集専用のエンドポイントとして残し、reconcile系の内部処理が
 * これらを呼び出すことは無い)。
 *
 * ── IndexedDBのキー設計について ──────────────────────────────────────
 * 設計書(docs/superpowers/specs/2026-11-01-pwa-rewrite-design.md)の
 * オブジェクトストア表: shifts・shift_requestsともにキーは
 * `${year}-${month}-${store_id}`(月は2桁ゼロ埋め。local/payroll-admin.jsの
 * _lockKeyと同じ理由で、桁数が揺れると辞書順の前提が壊れるため統一する)。
 * IndexedDBのgetAll()は値しか返さずキー一覧を返せないため、年月での
 * 横断検索(getShifts/getShiftGapsが「指定した年月の全店舗分」を集める)を
 * 可能にするため、値自体にも{year, month, store_id, data}を埋め込んで保存する
 * (local/payroll-admin.jsのpayroll_snapshotsストアと同じパターン)。
 *
 * ── フロントエンドとの互換性について(重要) ──────────────────────────
 * 旧Python版はshifts.jsonという1つのファイルに、店舗の予定
 * (`shifts[ym][store_id]`)と希望(`shifts[ym][f"_req_{store_id}"]`)を
 * 同じym配下に混在させて保存していた。frontend/shift-app.js(本計画のどの
 * タスクでも改修対象になっていない既存コード)は今もこの混在構造を前提に、
 * `GET /shifts/{year}/{month}`レスポンスから直接
 * `data["_req_" + store]`を読む(_saLoadRequests参照)。設計書は内部の
 * IndexedDBストアをshifts/shift_requestsの2つに分けたが、これは内部保存先の
 * 分離に過ぎない。API応答の形(GET /shifts/{year}/{month}が返すオブジェクトの
 * 形)は旧フロントが無改修で動くよう、2つのストアの内容をgetShifts内で合成し、
 * 元の混在形式のまま返す。
 *
 * ── 今回移植しなかったもの(範囲外。理由をここに明記) ───────────────────
 * - apply_imported_shifts: Dropboxのシフト表.xlsmをmain.pyの定期実行(cron)で
 *   読み込み自動反映する機能。サーバー・ファイルシステム・定期実行が存在しない
 *   ブラウザ専用PWAには対応する仕組みが無く、計画書のGlobal Constraints
 *   (サーバー・外部ネットワーク通信は一切使わない)にも反するため移植しない。
 * - export_shift_editor: オフライン編集用の自己完結HTML書き出し機能。
 *   PWA化後はアプリ自体が常にオフラインで動作するため、別の自己完結HTMLを
 *   生成する意義が無くなっている。本計画のTask1〜16のいずれにも後続タスクが
 *   無く、frontend/shift-app.js(874行目付近)が今も
 *   `${API}/shifts/.../export-editor`という未移植のサーバーパスへの
 *   <a href>を残しているが、これは本タスクのFiles一覧(local/shifts.js・
 *   tests/のみ)の範囲外であり、Task11(フロントエンド結線)以降で判断すべき
 *   残課題として報告する。
 * - routers/sync.py::get_store_history / get_nippo_confirmed /
 *   set_nippo_confirmed: 本計画のどのタスクにも割り当てられていない
 *   (db.jsにはnippo_confirmedストアが予約されているが、対応するlocal/*.jsが
 *   計画に存在しない)。reconcile_shift_gaps_for_reportの唯一の呼び出し元は
 *   set_nippo_confirmed(sync.py)であり、本ファイルはreconcile関数自体を
 *   移植して公開するが、呼び出し元(日報確認フロー)は計画上の別タスク
 *   (未割当)の範囲とみなし、本タスクでは呼び出し箇所を作らない。
 */
(function (root) {
  "use strict";

  var SHIFTS_STORE = "shifts";
  var REQUESTS_STORE = "shift_requests";
  var DISMISSED_STORE = "shift_gap_dismissed";

  function _isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  function _pad2(n) {
    return String(n).padStart(2, "0");
  }

  function _shiftKey(year, month, storeId) {
    return year + "-" + _pad2(month) + "-" + storeId;
  }

  function _dismissedKey(date, storeId, staffId) {
    return date + "|" + storeId + "|" + staffId;
  }

  function _todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  // Task6(payroll-admin.js)のisLockedを遅延バインディングで呼ぶ
  // (local/daily.js・local/staff.jsと同じパターン。ファイル先頭コメント参照)。
  function _isLocked(year, month) {
    if (typeof root.isLocked === "function") {
      return root.isLocked(year, month);
    }
    return false;
  }

  // DismissRequest(shifts.py, Pydanticモデル)の移植。JSにはPydanticが無いため
  // 単なるバリデーション関数にする(計画書の指示通り)。
  // 注: FastAPI版はPydanticモデルの検証失敗で422を返すが、本リポジトリの
  // 他のlocal/*.js(staff.js・daily.js・store.js)は入力検証の失敗を一貫して
  // 400で表現しているため、その既存の慣習に合わせて400にする。
  function _validateDismissBody(body) {
    if (!_isPlainObject(body)) {
      throw new ApiError(400, "date, store_id, staff_id は必須です。");
    }
    ["date", "store_id", "staff_id"].forEach(function (key) {
      if (typeof body[key] !== "string" || body[key] === "") {
        throw new ApiError(400, key + " は必須の文字列です。");
      }
    });
  }

  // get_shift_gaps(shifts.py)の移植。
  // 2026-10-30バグハントで指摘(Important): 不正なymで素のValueErrorが伝播し
  // 500になっていた(他の書き込み系と同様に400へ変換する)。
  function _parseYm(ym) {
    var parts = String(ym).split("-");
    var year = parseInt(parts[0], 10);
    if (parts.length < 2 || Number.isNaN(year)) {
      throw new ApiError(400, "ym は YYYY-MM 形式で指定してください。");
    }
    // python版はym[:4]のみ検証し、月の妥当性は検証せずym文字列そのものを
    // dictキーとして使う(不正な月でもクラッシュせず、単に該当データが無い
    // ものとして扱われる)。本ファイルはym-store_id単位のIndexedDBキーを
    // 年・月の数値で合成するため月も数値化するが、不正な月(NaN)はどの
    // 保存済みキーにも一致しないため、結果的に python版と同じ
    // 「不正な月でもクラッシュせず単に該当データ無し」という挙動になる。
    var month = parseInt(parts[1], 10);
    return { year: year, month: month };
  }

  // dismiss_shift_gap(shifts.py)のdate検証部分の移植。
  function _parseDateYearMonth(date) {
    var year = parseInt(String(date).slice(0, 4), 10);
    var month = parseInt(String(date).slice(5, 7), 10);
    if (Number.isNaN(year) || Number.isNaN(month)) {
      throw new ApiError(400, "date は YYYY-MM-DD 形式で指定してください。");
    }
    return { year: year, month: month };
  }

  // get_shifts(shifts.py)の移植。
  // shifts/shift_requestsの2ストアの内容を、旧フロントが前提とする混在形式
  // ({store_id: dates, "_req_"+store_id: requests})に合成して返す
  // (ファイル先頭コメント「フロントエンドとの互換性について」参照)。
  async function getShifts(year, month) {
    var result = {};
    var scheduleRecords = await dbGetAll(SHIFTS_STORE);
    scheduleRecords.forEach(function (r) {
      if (_isPlainObject(r) && r.year === year && r.month === month && r.store_id) {
        result[r.store_id] = r.data;
      }
    });
    var requestRecords = await dbGetAll(REQUESTS_STORE);
    requestRecords.forEach(function (r) {
      if (_isPlainObject(r) && r.year === year && r.month === month && r.store_id) {
        result["_req_" + r.store_id] = r.data;
      }
    });
    return result;
  }

  // put_shifts(shifts.py)の移植。
  // date → [staffId, ...] | null(閉業日) の形式で受け取りshiftsストアに保存する。
  async function putShifts(year, month, storeId, body) {
    // 2026-10-30バグハントで指摘(Critical): store_idの検証が無かった。
    await checkStoreId(storeId);
    if (_isLocked(year, month)) {
      throw new ApiError(423, year + "年" + month + "月は給与確定済みのためシフト予定を変更できません");
    }
    await dbPut(SHIFTS_STORE, _shiftKey(year, month, storeId), {
      year: year,
      month: month,
      store_id: storeId,
      data: body || {},
    });
    return { ok: true };
  }

  // put_requests(shifts.py)の移植。
  // staffId → { want: [date, ...], ng: [date, ...] } の形式で希望を保存する。
  async function putRequests(year, month, storeId, body) {
    // 2026-10-30バグハントで指摘(Critical): 同上。
    await checkStoreId(storeId);
    if (_isLocked(year, month)) {
      throw new ApiError(423, year + "年" + month + "月は給与確定済みのためシフト希望を変更できません");
    }
    await dbPut(REQUESTS_STORE, _shiftKey(year, month, storeId), {
      year: year,
      month: month,
      store_id: storeId,
      data: body || {},
    });
    return { ok: true };
  }

  // get_shift_gaps(shifts.py)の移植。GET /shifts/gaps?ym=YYYY-MM
  // 予定(shifts)に居たが実績(daily.staff_entries)に出てこない人を列挙する。
  // 読み取り専用(shifts/shift_requestsストアには一切書き込まない)。
  async function getShiftGaps(ym) {
    var parsed = _parseYm(ym);
    var todayStr = _todayStr();

    var scheduleRecords = await dbGetAll(SHIFTS_STORE);
    var monthRecords = scheduleRecords.filter(function (r) {
      return (
        _isPlainObject(r) &&
        r.year === parsed.year &&
        r.month === parsed.month &&
        r.store_id &&
        _isPlainObject(r.data)
      );
    });

    var gaps = [];
    for (var i = 0; i < monthRecords.length; i++) {
      var record = monthRecords[i];
      var storeId = record.store_id;
      var dates = Object.keys(record.data);
      for (var j = 0; j < dates.length; j++) {
        var dateStr = dates[j];
        var scheduled = record.data[dateStr];
        // python版の `if not scheduled or date_str > today_str: continue` の
        // 移植。nullや空配列(=python的に"falsy")・未来日はスキップする。
        if (!Array.isArray(scheduled) || scheduled.length === 0 || dateStr > todayStr) {
          continue;
        }
        var day = await getDay(parseInt(dateStr.slice(0, 4), 10), dateStr, storeId);
        var entries = (day && day.staff_entries) || [];
        if (entries.length === 0) {
          continue; // 日報自体が無い日は対象外(不足チェック側の担当)
        }
        var reportedIds = new Set(
          entries
            .filter(function (e) {
              return _isPlainObject(e);
            })
            .map(function (e) {
              return e.staff_id;
            })
        );
        for (var k = 0; k < scheduled.length; k++) {
          var staffId = scheduled[k];
          if (reportedIds.has(staffId)) {
            continue;
          }
          var dismissed = await dbGet(DISMISSED_STORE, _dismissedKey(dateStr, storeId, staffId));
          if (dismissed !== undefined) {
            continue;
          }
          gaps.push({ date: dateStr, store_id: storeId, staff_id: staffId });
        }
      }
    }

    // python版の `gaps.sort(key=lambda g: (g["date"], g["store_id"], g["staff_id"]))` の移植。
    gaps.sort(function (a, b) {
      var ka = a.date + "|" + a.store_id + "|" + a.staff_id;
      var kb = b.date + "|" + b.store_id + "|" + b.staff_id;
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return 0;
    });
    return gaps;
  }

  // dismiss_shift_gap(shifts.py)の移植。POST /shifts/gaps/dismiss
  // 単発の不足表示解消。shifts/shift_requestsストアには一切書き込まない
  // (shift_gap_dismissedストアに記録するのみ)。
  async function dismissShiftGap(body) {
    _validateDismissBody(body);
    // 2026-10-30バグハントで指摘(Critical/Important): store_idの検証が無く、
    // また不正なdateで素のエラーが伝播し500になっていた。
    await checkStoreId(body.store_id);
    var parsed = _parseDateYearMonth(body.date);
    // 2026-10-26バグハントで指摘(Important): put_shifts等は給与確定済み月への
    // 書き込みを423で拒否するが、この関数だけ旧実装のままガードが無く、
    // (当時の)sync_shift_to_reportを経由してロック済み月のshifts.jsonを
    // 書き換えられた。現行版ではガードを追加済みであり、本移植でも維持する。
    if (_isLocked(parsed.year, parsed.month)) {
      throw new ApiError(423, parsed.year + "年" + parsed.month + "月は給与確定済みのため変更できません");
    }
    await dbPut(DISMISSED_STORE, _dismissedKey(body.date, body.store_id, body.staff_id), true);
    return { ok: true };
  }

  // reconcile_shift_gaps_for_report(shifts.py)の移植。
  // 確認済みの日報と、シフト予定(shiftsストア)を突き合わせ、予定されていたが
  // 出勤しなかった人の不足表示(getShiftGaps)だけを解消する。
  //
  // 絶対にshifts/shift_requestsストアへ書き込まないこと(ファイル先頭の
  // 「本番データ破壊事故の経緯」コメント参照)。本関数はshiftsストアを
  // 読み取り専用で参照し、変更はshift_gap_dismissedストアへの追記のみ。
  async function reconcileShiftGapsForReport(date, storeId, staffIds) {
    var year = parseInt(String(date).slice(0, 4), 10);
    var month = parseInt(String(date).slice(5, 7), 10);
    // python版はdateの形式を検証せず、不正な場合はshifts.get(ym, {})が
    // 単に空dictを返すだけで静かに終了する(呼び出し元のsync.pyもtry/exceptで
    // 全体を囲っている)。本実装も例外を投げず早期returnすることで同じ
    // 「呼び出し元を落とさない」挙動を保つ。
    if (Number.isNaN(year) || Number.isNaN(month)) {
      return;
    }
    var record = await dbGet(SHIFTS_STORE, _shiftKey(year, month, storeId));
    if (!record || !_isPlainObject(record.data)) {
      return;
    }
    var scheduled = record.data[date];
    if (!Array.isArray(scheduled)) {
      return;
    }
    var reported = new Set(staffIds || []);
    var missing = scheduled.filter(function (sid) {
      return !reported.has(sid);
    });
    if (missing.length === 0) {
      return;
    }
    for (var i = 0; i < missing.length; i++) {
      await dbPut(DISMISSED_STORE, _dismissedKey(date, storeId, missing[i]), true);
    }
  }

  root.getShifts = getShifts;
  root.putShifts = putShifts;
  root.putRequests = putRequests;
  root.getShiftGaps = getShiftGaps;
  root.dismissShiftGap = dismissShiftGap;
  root.reconcileShiftGapsForReport = reconcileShiftGapsForReport;

  // ルート登録順序の注意: "/shifts/gaps" と "/shifts/gaps/dismiss" は
  // "/shifts/:year/:month" (3セグメント) / "/shifts/:year/:month/:store_id"
  // (4セグメント)とセグメント数が異なる(2・3セグメント)ため、
  // local-api.jsのルーター(セグメント数で完全一致するもの以外マッチしない)
  // では衝突しない。daily.jsのym問題(同じセグメント数での横取り)とは異なる
  // ケースだが、念のため分かりやすさのため先に登録する。
  registerRoute("GET", "/shifts/gaps", function (params) {
    return getShiftGaps(params.ym);
  });
  registerRoute("POST", "/shifts/gaps/dismiss", function (params, body) {
    return dismissShiftGap(body);
  });
  registerRoute("GET", "/shifts/:year/:month", function (params) {
    return getShifts(parseInt(params.year, 10), parseInt(params.month, 10));
  });
  registerRoute("PUT", "/shifts/:year/:month/:store_id", function (params, body) {
    return putShifts(parseInt(params.year, 10), parseInt(params.month, 10), params.store_id, body);
  });
  registerRoute("PUT", "/shifts/:year/:month/:store_id/requests", function (params, body) {
    return putRequests(parseInt(params.year, 10), parseInt(params.month, 10), params.store_id, body);
  });
})(typeof window !== "undefined" ? window : globalThis);
