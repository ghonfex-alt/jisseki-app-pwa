/**
 * local/export.js — Excel月次帳簿出力(services/excel_writer.py + routers/export.pyの移植)。
 *
 * 依存: db.js, local-api.js, local/store.js(window.getStores),
 * local/daily.js(window.getMonth), local/payroll.js(window.getMonthlyPayroll,
 * window.getWanopeBonus, window.getIncentiveRates, window.calcDrinkBack,
 * window.calcChampagneBack, window.calcTransport, window.calcIncentiveBack,
 * window.isWanopeDay, window.getEffectiveRate, window.cumulativeHoursBefore,
 * window.calcCompanyRanking)。<script>タグは db.js → local-api.js →
 * local/store.js → local/staff.js → local/daily.js → local/tax-table-r8.js →
 * local/payroll.js → local/payroll-admin.js → local/export.js の順で
 * 読み込むこと。
 *
 * 移植元: JISSEKI_SRC/services/excel_writer.py, JISSEKI_SRC/routers/export.py
 * (JISSEKI_SRC = C:\Users\ghonf\cc-company\shisha\jisseki-app-standalone-build)。
 *
 * ── SheetJS(XLSX)の読み込みについて ─────────────────────────────────────
 * 本ファイルは`require("xlsx")`しない。グローバルの`XLSX`オブジェクトを
 * 参照するだけで、本番(ブラウザ)では`<script src="https://cdnjs.cloudflare.com/
 * ajax/libs/xlsx/0.18.5/xlsx.full.min.js">`で読み込まれたものを、テスト
 * (Node.js)ではtests/setup.jsがnpmの`xlsx`パッケージ(同じSheetJS本体)を
 * `global.XLSX`に注入したものを、それぞれ区別なく使う。
 *
 * ── 書式(色)について: 意図的な省略 ────────────────────────────────────────
 * npm版・CDN版ともに無料のSheetJS Community Editionは、セルの塗り色
 * (fill)・フォント色・ボーダーの**書き込み**をサポートしない(読み込みは
 * できるが、書き込み時は常に無視される。実機検証済み: cell.sにfill/fontを
 * 設定してXLSX.writeし、XLSX.readで読み直すと`{patternType:"none"}`に
 * なり反映されていないことを確認した)。そのため本ファイルは、元レイアウトの
 * 色分け(BG_ROW1/BG_ROW2/FG_RED等)を再現しない。列構成・見出し・値・
 * セル結合・数値書式(number_format、桁区切り等)・列幅は忠実に再現する。
 * 将来SheetJS Pro等で色を復元したい場合は、本ファイル内のコメント
 * "(色は書き込み非対応のため省略)" の箇所にfill/font指定を追加すればよい。
 *
 * ── 「同ファイルに月ごとに追加」の仕様について ─────────────────────────────
 * Python版(write_combined_sheet)はローカルファイルシステム上の
 * 実績帳簿<year>.xlsxを都度load_workbookして月のシートを追加/上書きする。
 * ブラウザにはファイルシステムが無いため、本ファイルのwriteCombinedSheetは
 * 「既存ワークブックのバイト列(省略可)」を引数で受け取り、渡されていれば
 * そこに月のシートを追加/上書きし、渡されなければ新規ワークブックを作る
 * 設計にした(Interfaces外だが、Global Constraintsの「ロジックを変える場合は
 * 理由を明記する」に従った明記)。実際にどこからバイト列を取得するか
 * (前回ダウンロードしたファイルをユーザーに選び直してもらう等)はUI層の
 * 判断であり、本タスク(Task10)の範囲外。
 *
 * ── 新設: キャッチ・呼び・延長インセンティブの日別人件費内訳への反映 ────────
 * JISSEKI_SRCには存在しない追加要件(計画書冒頭参照)。buildDayLaborMapは
 * ドリンクバック・シャンパンバック・交通費と全く同じ扱いでcalcIncentiveBackを
 * 日別人件費に加算する。これはPython版には存在しない計算項目だが、
 * 省略すると「月給計算(getMonthlyPayroll)が返すtotal_labor_cost」と
 * 「Excelの日別内訳の合計」が単価設定時に食い違う——まさにこのファイルの
 * 移植元コメントに記録されている過去のaudit-loop発覚バグ(ドリンク/シャンパン/
 * 交通費/調整額の組み込み漏れ)と同じ種類の不整合になるため、新設項目についても
 * 同じ原則(全ての人件費コンポーネントを日別内訳に反映する)を適用した。
 */
(function (root) {
  "use strict";

  var DAILY_STORE = "daily";
  var STAFF_STORE = "staff";

  function _isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  function _xlsx() {
    var XLSX = root.XLSX;
    if (!XLSX) {
      throw new Error(
        "SheetJS(XLSX)が読み込まれていません。ブラウザでは<script src=\"https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js\">を、" +
        "テストではtests/setup.jsがnpmのxlsxパッケージを注入している必要があります。"
      );
    }
    return XLSX;
  }

  // ── カラー定数(色は書き込み非対応のためFG/BGは使わない。ファイル先頭コメント参照) ──
  var WEEKDAY_JP = ["月", "火", "水", "木", "金", "土", "日"];
  var FMT_INT = "#,##0";
  var OWNER_ASSUMED_COST = 300000; // services/excel_writer.py: config.OWNER_ASSUMED_COSTが無い場合のフォールバック値

  // 左エリア 列番号(1始まり、openpyxlのws.cell(row, col, ...)と同じ添字系)
  var C_DATE = 1, C_DOW = 2, C_CUST = 3, C_SALES = 4, C_CASH = 5, C_CARD = 6,
    C_LABOR = 7, C_LRATE = 8, C_PROFIT = 9, C_ATTEND = 10, C_HAND = 11;

  // 右エリア 列番号
  var R_NAME = 13, R_VAL1 = 14, R_VAL2 = 15, R_VAL3 = 16, R_VAL4 = 17;

  function _round1(v) {
    return Math.round(v * 10) / 10;
  }

  function _ownerLabor(payroll) {
    return (payroll.staff_payroll || []).reduce(function (s, sp) {
      return s + (sp.is_owner ? (sp.total || 0) : 0);
    }, 0);
  }

  // date.fromisoformat(date_str) + date.weekday()の移植。
  // weekday: 0=月, ..., 6=日 (Pythonのdatetime.date.weekday()と同じ基準)。
  function _parseIsoDate(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
    if (!m) return null;
    var year = parseInt(m[1], 10), month = parseInt(m[2], 10), day = parseInt(m[3], 10);
    var d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
      return null;
    }
    var jsDay = d.getUTCDay(); // 0=日,...,6=土
    var weekday = (jsDay + 6) % 7; // 0=月,...,6=日
    return { year: year, month: month, day: day, weekday: weekday };
  }

  // ── シートビルダー(cursor-styleのセル書き込みヘルパー) ───────────────────
  // openpyxlの ws.cell(row, col, value) / merge_cells 相当を、SheetJSの
  // "A1"形式セル参照に変換する薄いラッパー。state.maxRow/maxColで!refを追跡する。
  function _newSheetState() {
    return { ws: {}, maxRow: 1, maxCol: 1 };
  }

  function _setCell(state, row, col, value, z) {
    var XLSX = _xlsx();
    var ref = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
    var cell;
    if (value === "" || value === null || value === undefined) {
      cell = { t: "s", v: "" };
    } else if (typeof value === "number" && !Number.isNaN(value)) {
      cell = { t: "n", v: value };
      if (z) cell.z = z;
    } else {
      cell = { t: "s", v: String(value) };
    }
    state.ws[ref] = cell;
    if (row > state.maxRow) state.maxRow = row;
    if (col > state.maxCol) state.maxCol = col;
    return cell;
  }

  function _merge(state, r1, c1, r2, c2) {
    state.ws["!merges"] = state.ws["!merges"] || [];
    state.ws["!merges"].push({ s: { r: r1 - 1, c: c1 - 1 }, e: { r: r2 - 1, c: c2 - 1 } });
    if (r2 > state.maxRow) state.maxRow = r2;
    if (c2 > state.maxCol) state.maxCol = c2;
  }

  // ── 日次セクション(_write_daily_sectionの移植) ──────────────────────────
  function _writeDailySection(state, dailyRows, payroll, dayLaborMap, startRow, fullNameMap) {
    var month = payroll.month || "";
    var storeName = payroll.store_name || payroll.store_id || "";
    var title = (payroll.year || "") + "年" + month + "月 実績帳簿 — " + storeName;
    var nameMap = fullNameMap || (function () {
      var m = {};
      (payroll.staff_payroll || []).forEach(function (sp) {
        if (sp.staff_id) m[sp.staff_id] = sp.name;
      });
      return m;
    })();

    _merge(state, startRow + 1, 1, startRow + 1, C_HAND);
    _setCell(state, startRow + 1, 1, title);

    var hdrs = ["日付", "曜", "客数", "売上(税抜)", "現金", "カード", "人件費", "人件費率", "営業利益", "出勤者", ""];
    hdrs.forEach(function (h, i) {
      if (h) _setCell(state, startRow + 2, i + 1, h);
    });

    var totalSales = 0, totalCust = 0, totalCard = 0;
    var cur = startRow + 3;

    (dailyRows || []).forEach(function (day) {
      var dateStr = day.date || "";
      var closed = !!day.closed;

      if (closed) {
        _merge(state, cur, 1, cur, C_HAND);
        var dc = _parseIsoDate(dateStr);
        var label = dc
          ? (dc.month + "/" + dc.day + "(" + WEEKDAY_JP[dc.weekday] + ") 臨時休業")
          : (dateStr + " 臨時休業");
        _setCell(state, cur, 1, label);
      } else {
        var sales = day.sales_excl_tax || 0;
        var customers = day.customer_count || 0;
        var card = day.card_sales || 0;
        var cash = Math.max(0, sales - card);
        var labor = dayLaborMap[dateStr] || 0;
        var lrate = (sales > 0 && labor > 0) ? (((labor / sales) * 100).toFixed(1) + "%") : (sales > 0 ? "-" : "");
        var profit = sales - labor;
        var staffNames = (day.staff_entries || [])
          .filter(function (e) { return _isPlainObject(e); })
          .map(function (e) { return nameMap[e.staff_id || ""] || e.staff_id || ""; })
          .join(", ");
        totalSales += sales; totalCust += customers; totalCard += card;

        var d = _parseIsoDate(dateStr);
        var dateDisp = d ? (d.month + "/" + d.day) : dateStr;
        var dowDisp = d ? WEEKDAY_JP[d.weekday] : "";

        var vals = [
          dateDisp, dowDisp, customers, sales, cash, card,
          labor > 0 ? labor : "", lrate, labor > 0 ? profit : "", staffNames, "",
        ];
        vals.forEach(function (v, i) {
          var ci = i + 1;
          var z = null;
          if ([4, 5, 6, 7, 9].indexOf(ci) !== -1 && typeof v === "number") z = FMT_INT;
          _setCell(state, cur, ci, v, z);
        });
      }
      cur += 1;
    });

    // 月合計行
    var totalLabor = (payroll.total_labor_cost || 0) + _ownerLabor(payroll);
    var totalCash = Math.max(0, totalSales - totalCard);
    var laborRatio = totalSales > 0 ? (((totalLabor / totalSales) * 100).toFixed(1) + "%") : "-";
    var profitTotal = totalSales - totalLabor;
    var totals = ["合計", "", totalCust, totalSales, totalCash, totalCard, totalLabor, laborRatio, profitTotal, "", ""];
    totals.forEach(function (v, i) {
      var ci = i + 1;
      var z = ([3, 4, 5, 6, 7, 9].indexOf(ci) !== -1 && typeof v === "number") ? FMT_INT : null;
      _setCell(state, cur, ci, v, z);
    });
    cur += 2;

    // 給与明細
    var payHdrs = ["スタッフ", "出勤", "時間", "基本給(手取)", "控除", "ドリンク", "シャンパン", "交通費", "調整", "振込額", "手渡し額"];
    payHdrs.forEach(function (h, i) { _setCell(state, cur, i + 1, h); });
    cur += 1;

    (payroll.staff_payroll || []).filter(function (p) { return !p.is_owner; }).forEach(function (sp) {
      var takeHome = sp.take_home || sp.base_pay || 0;
      var hours = sp.total_hours;
      var hoursDisp = (hours !== null && hours !== undefined) ? (hours.toFixed(1) + "h") : "-";
      var adj = sp.adjustment || 0;
      var adjDisp = adj !== 0 ? adj : "";
      var deduct = sp.deductions ? (sp.deductions.total || 0) : "";
      var transfer = sp.transfer_amount || 0;
      var hand = sp.hand_amount || 0;
      var nameDisp = sp.name || sp.staff_id || "";

      var vals = [
        nameDisp, sp.work_days || 0, hoursDisp, takeHome, deduct,
        sp.drink_back || 0, sp.champagne_back || 0, sp.transport || 0,
        adjDisp, transfer || "", hand || "",
      ];
      vals.forEach(function (v, i) {
        var ci = i + 1;
        var z = ([4, 5, 6, 7, 8, 9, 10, 11].indexOf(ci) !== -1 && typeof v === "number") ? FMT_INT : null;
        _setCell(state, cur, ci, v, z);
      });
      cur += 1;
    });

    // 給与合計行
    var spList = (payroll.staff_payroll || []).filter(function (sp) { return !sp.is_owner; });
    var totalTh = spList.reduce(function (s, sp) { return s + (sp.take_home || sp.base_pay || 0); }, 0);
    var totalDed = spList.reduce(function (s, sp) { return s + (sp.deductions ? (sp.deductions.total || 0) : 0); }, 0);
    var totalDrink = spList.reduce(function (s, sp) { return s + (sp.drink_back || 0); }, 0);
    var totalChamp = spList.reduce(function (s, sp) { return s + (sp.champagne_back || 0); }, 0);
    var totalTrans = spList.reduce(function (s, sp) { return s + (sp.transport || 0); }, 0);
    var totalAdj = spList.reduce(function (s, sp) { return s + (sp.adjustment || 0); }, 0);
    var totalXfer = spList.reduce(function (s, sp) { return s + (sp.transfer_amount || 0); }, 0);
    var totalHand = spList.reduce(function (s, sp) { return s + (sp.hand_amount || 0); }, 0);
    var totalsPay = ["合計", "", "", totalTh, totalDed || "", totalDrink, totalChamp, totalTrans,
      totalAdj !== 0 ? totalAdj : "", totalXfer, totalHand];
    totalsPay.forEach(function (v, i) {
      var ci = i + 1;
      var z = ([4, 5, 6, 7, 8, 9, 10, 11].indexOf(ci) !== -1 && typeof v === "number") ? FMT_INT : null;
      _setCell(state, cur, ci, v, z);
    });
    return cur;
  }

  // ── 右エリア: KPI + スタッフ指標 + 出勤詳細 + ランキング(_write_kpi_sectionの移植) ──
  function _writeKpiSection(state, dailyRows, payroll, startRow) {
    function kHdr(row, label) {
      _setCell(state, row, R_NAME, label);
      _setCell(state, row, R_VAL1, "");
    }
    function kRow(row, label, value) {
      _setCell(state, row, R_NAME, label);
      _setCell(state, row, R_VAL1, value, typeof value === "number" ? FMT_INT : null);
    }

    var totalSales = payroll.total_sales || 0;
    var totalLabor = (payroll.total_labor_cost || 0) + _ownerLabor(payroll);
    var salesTax = Math.trunc(totalSales * 1.1);
    var laborRatio = totalSales > 0 ? (((totalLabor / totalSales) * 100).toFixed(1) + "%") : "-";
    var opProfit = totalSales - totalLabor;
    var openDays = (dailyRows || []).filter(function (d) { return !d.closed; }).length;
    var totalCust = (dailyRows || []).filter(function (d) { return !d.closed; })
      .reduce(function (s, d) { return s + (d.customer_count || 0); }, 0);
    var avgSpend = totalCust > 0 ? Math.round(totalSales / totalCust) : 0;
    var avgDaily = openDays > 0 ? Math.round(totalSales / openDays) : 0;
    var handTotal = (payroll.staff_payroll || []).reduce(function (s, sp) { return s + (sp.hand_amount || 0); }, 0);
    var xferTotal = (payroll.staff_payroll || []).reduce(function (s, sp) { return s + (sp.transfer_amount || 0); }, 0);

    var r = startRow + 2;
    kHdr(r, "月次KPI"); r += 1;
    kRow(r, "総売上(税抜)", totalSales); r += 1;
    kRow(r, "総売上(税込)", salesTax); r += 1;
    kRow(r, "人件費合計", totalLabor); r += 1;
    kRow(r, "人件費率", laborRatio); r += 1;
    kRow(r, "営業利益", opProfit); r += 1;
    kRow(r, "営業日数", openDays + "日"); r += 1;
    kRow(r, "総客数", totalCust); r += 1;
    kRow(r, "平均客単価", avgSpend); r += 1;
    kRow(r, "1日平均売上", avgDaily); r += 1;
    if (handTotal > 0) {
      kRow(r, "振込合計", xferTotal); r += 1;
      kRow(r, "手渡し合計", handTotal); r += 1;
    }
    r += 1; // 空白

    // スタッフ指標ヘッダー
    _setCell(state, r, R_NAME, "スタッフ指標");
    [[R_VAL1, "RPH比"], [R_VAL2, "ドリンク/h"], [R_VAL3, "シャン本"], [R_VAL4, "シャン売上"]].forEach(function (p) {
      _setCell(state, r, p[0], p[1]);
    });
    r += 1;

    // RPH比説明行
    _setCell(state, r, R_NAME, "RPH比: 自分の時間売上 ÷ 店平均時間売上。100%超 = 店平均より貢献が高い（高いほど良い）");
    _merge(state, r, R_NAME, r, R_VAL4);
    r += 1;

    (payroll.staff_payroll || []).forEach(function (sp) {
      var metrics = sp.metrics || {};
      var ratio = metrics.performance_ratio || 0;
      var dph = metrics.drinks_per_hour || 0;
      var champ = metrics.champagne_total || 0;
      var chamt = metrics.champagne_amount || 0;

      _setCell(state, r, R_NAME, sp.name || sp.staff_id || "");
      _setCell(state, r, R_VAL1, ratio.toFixed(1) + "%");
      _setCell(state, r, R_VAL2, dph.toFixed(2));
      _setCell(state, r, R_VAL3, champ);
      _setCell(state, r, R_VAL4, chamt || "", chamt ? FMT_INT : null);
      r += 1;
    });
    r += 1; // 空白

    // 出勤詳細
    _setCell(state, r, R_NAME, "出勤詳細");
    [[R_VAL1, "出勤日数"], [R_VAL2, "時間"], [R_VAL3, "基本給/手取"], [R_VAL4, "控除合計"]].forEach(function (p) {
      _setCell(state, r, p[0], p[1]);
    });
    r += 1;

    (payroll.staff_payroll || []).forEach(function (sp) {
      var takeHome = sp.take_home || sp.base_pay || 0;
      var hours = sp.total_hours || 0;
      var deductTot = sp.deductions ? (sp.deductions.total || 0) : 0;

      _setCell(state, r, R_NAME, sp.name || sp.staff_id || "");
      _setCell(state, r, R_VAL1, sp.work_days || 0);
      _setCell(state, r, R_VAL2, hours ? (hours.toFixed(1) + "h") : "-");
      _setCell(state, r, R_VAL3, takeHome, FMT_INT);
      _setCell(state, r, R_VAL4, deductTot || "", deductTot ? FMT_INT : null);
      r += 1;
    });
    r += 1; // 空白

    // 売上貢献度ランキング(当店内)
    _setCell(state, r, R_NAME, "売上貢献度ランキング");
    [[R_VAL1, "RPH比"], [R_VAL2, "ドリンク/h"], [R_VAL3, "貢献売上"], [R_VAL4, "占有率"]].forEach(function (p) {
      _setCell(state, r, p[0], p[1]);
    });
    r += 1;

    var ranked = (payroll.staff_payroll || []).slice().sort(function (a, b) {
      return (((b.metrics || {}).performance_ratio) || 0) - (((a.metrics || {}).performance_ratio) || 0);
    });
    var totalSalesVal = payroll.total_sales || 1;

    ranked.forEach(function (sp, idx) {
      var rank = idx + 1;
      var metrics = sp.metrics || {};
      var ratio = metrics.performance_ratio || 0;
      var dph = metrics.drinks_per_hour || 0;
      var shiftS = metrics.shift_sales || 0;
      var occupy = shiftS ? (((shiftS / totalSalesVal) * 100).toFixed(1) + "%") : "-";

      var nameDisp = sp.name || sp.staff_id || "";
      _setCell(state, r, R_NAME, "#" + rank + " " + nameDisp);
      _setCell(state, r, R_VAL1, ratio.toFixed(1) + "%");
      _setCell(state, r, R_VAL2, dph.toFixed(2));
      _setCell(state, r, R_VAL3, shiftS || "", shiftS ? FMT_INT : null);
      _setCell(state, r, R_VAL4, occupy);
      r += 1;
    });

    return r;
  }

  // ── 全店合算比較 + 全スタッフランキング(_write_comparison_sectionの移植) ──
  // storesData: [(payroll, storeName), ...] (python版と同じ引数形: 呼び出し元参照)
  function _writeComparisonSection(storesDataPairs, startRow, state) {
    var r = startRow + 1; // row_dimensions[r].height=6相当の空白行を飛ばす

    _setCell(state, r, R_NAME, "全店合算サマリー");
    _merge(state, r, R_NAME, r, R_VAL4);
    r += 1;

    var storeNames = storesDataPairs.map(function (pair) { return pair[1]; });
    [" 項目"].concat(storeNames, ["合計"]).forEach(function (label, i) {
      _setCell(state, r, R_NAME + i, label);
    });
    r += 1;

    function sumRow(row, label, values) {
      _setCell(state, row, R_NAME, label);
      var total = 0;
      values.forEach(function (v, i) {
        _setCell(state, row, R_VAL1 + i, v, FMT_INT);
        if (typeof v === "number") total += v;
      });
      _setCell(state, row, R_VAL1 + values.length, total, FMT_INT);
    }
    function ratioRow(row, label, ratios, combined) {
      _setCell(state, row, R_NAME, label);
      ratios.forEach(function (rv, i) { _setCell(state, row, R_VAL1 + i, rv); });
      _setCell(state, row, R_VAL1 + ratios.length, combined);
    }

    var salesVals = storesDataPairs.map(function (p) { return p[0].total_sales || 0; });
    var laborVals = storesDataPairs.map(function (p) { return (p[0].total_labor_cost || 0) + _ownerLabor(p[0]); });
    var profitVals = salesVals.map(function (s, i) { return s - laborVals[i]; });
    var xferVals = storesDataPairs.map(function (p) {
      return (p[0].staff_payroll || []).reduce(function (s, sp) { return s + (sp.transfer_amount || 0); }, 0);
    });
    var handVals = storesDataPairs.map(function (p) {
      return (p[0].staff_payroll || []).reduce(function (s, sp) { return s + (sp.hand_amount || 0); }, 0);
    });
    var totalS = salesVals.reduce(function (a, b) { return a + b; }, 0);
    var totalL = laborVals.reduce(function (a, b) { return a + b; }, 0);
    var laborRatios = salesVals.map(function (s, i) {
      return s > 0 ? (((laborVals[i] / s) * 100).toFixed(1) + "%") : "-";
    });
    var combinedRatio = totalS > 0 ? (((totalL / totalS) * 100).toFixed(1) + "%") : "-";

    sumRow(r, "総売上(税抜)", salesVals); r += 1;
    sumRow(r, "人件費合計", laborVals); r += 1;
    sumRow(r, "営業利益", profitVals); r += 1;
    if (handVals.some(function (h) { return h > 0; })) {
      sumRow(r, "振込合計", xferVals); r += 1;
      sumRow(r, "手渡し合計", handVals); r += 1;
    }
    ratioRow(r, "人件費率", laborRatios, combinedRatio); r += 1;

    r += 1; // 空白

    _setCell(state, r, R_NAME, "全スタッフ 売上貢献ランキング（全店合算）");
    _merge(state, r, R_NAME, r, R_VAL4);
    r += 1;

    _setCell(state, r, R_NAME, "総合 = 全店RPH比80%＋ドリンク換算比20%（ドリンク杯数＋シャン売上÷700円換算、全店平均比）");
    _merge(state, r, R_NAME, r, R_VAL4);
    r += 1;

    [[R_NAME, "スタッフ（店舗）"], [R_VAL1, "総合"], [R_VAL2, "全店RPH比"], [R_VAL3, "D換算比"], [R_VAL4, "シャン売上"]]
      .forEach(function (p) { _setCell(state, r, p[0], p[1]); });
    r += 1;

    var payrolls = storesDataPairs.map(function (p) { return p[0]; });
    var ranking = root.calcCompanyRanking(payrolls);
    var companyRph = ranking.company_rph;
    var companyTotalSales = ranking.company_total_sales;
    var companyTotalHours = ranking.company_total_hours;

    _setCell(state, r, R_NAME,
      "全店平均RPH: " + Math.trunc(companyRph).toLocaleString("ja-JP") + "円/h  （全売上 " +
      companyTotalSales.toLocaleString("ja-JP") + "円 ÷ 全時間 " + companyTotalHours.toFixed(0) + "h）");
    _merge(state, r, R_NAME, r, R_VAL4);
    r += 1;

    ranking.ranked.forEach(function (s, idx) {
      var rank = idx + 1;
      var nameDisp = "#" + rank + " " + s.name + "（" + s.store + "）";
      _setCell(state, r, R_NAME, nameDisp);
      _setCell(state, r, R_VAL1, s.score ? (s.score.toFixed(1) + "%") : "-");
      _setCell(state, r, R_VAL2, s.rph_ratio ? (s.rph_ratio.toFixed(1) + "%") : "-");
      _setCell(state, r, R_VAL3, s.drink_ratio ? (s.drink_ratio.toFixed(1) + "%") : "-");
      _setCell(state, r, R_VAL4, s.champagne_amount || "", s.champagne_amount ? FMT_INT : null);
      r += 1;
    });

    return r;
  }

  // ── 店舗対決セクション(_write_store_battle_sectionの移植) ────────────────
  // stores_data: [(dailyRows, payroll, dayLaborMap[, nameMap]), ...]
  function _writeStoreBattleSection(storesData, startRow, state) {
    var r = startRow + 1; // 空白行

    _setCell(state, r, R_NAME, "店舗対決 ― 今月の成績");
    _merge(state, r, R_NAME, r, R_VAL4);
    r += 1;

    var storeMetrics = storesData.map(function (item) {
      var dailyRows = item[0], payroll = item[1];
      var openDays = dailyRows.filter(function (d) { return !d.closed; }).length;
      var totalCust = dailyRows.filter(function (d) { return !d.closed; })
        .reduce(function (s, d) { return s + (d.customer_count || 0); }, 0);
      var totalSales = payroll.total_sales || 0;
      var totalHours = payroll.total_hours_all || 0;
      var laborCost = payroll.total_labor_cost || 0;
      var hasOwner = (payroll.staff_payroll || []).some(function (sp) {
        return sp.is_owner && (sp.total || 0) > 0;
      });
      var laborWithOwner = hasOwner ? laborCost + OWNER_ASSUMED_COST : laborCost;

      var staffRows = (payroll.staff_payroll || []).slice().sort(function (a, b) {
        return (((b.metrics || {}).shift_sales) || 0) - (((a.metrics || {}).shift_sales) || 0);
      }).map(function (sp) {
        var m = sp.metrics || {};
        var hours = sp.total_hours || 0;
        var rph = hours ? Math.trunc((m.shift_sales || 0) / hours) : 0;
        return {
          name: sp.name || sp.staff_id || "",
          days: sp.work_days || 0,
          hours: hours,
          rph: rph,
          ratio: m.performance_ratio || 0,
          dph: m.drinks_per_hour || 0,
          is_owner: !!sp.is_owner,
        };
      });

      return {
        name: payroll.store_name || "",
        open_days: openDays,
        total_sales: totalSales,
        avg_sales: openDays ? totalSales / openDays : 0,
        total_cust: totalCust,
        avg_cust: openDays ? totalCust / openDays : 0,
        unit_price: totalCust ? totalSales / totalCust : 0,
        store_rph: totalHours ? totalSales / totalHours : 0,
        labor_cost: laborCost,
        labor_with_owner: laborWithOwner,
        has_owner: hasOwner,
        staff_rows: staffRows,
      };
    });

    function battleHdr(row, labels) {
      labels.forEach(function (label, i) { _setCell(state, row, R_NAME + i, label); });
    }
    function battleRow(row, label, values, fmt) {
      _setCell(state, row, R_NAME, label);
      values.forEach(function (v, i) { _setCell(state, row, R_VAL1 + i, v, fmt && typeof v === "number" ? fmt : null); });
    }

    battleHdr(r, [" 指標"].concat(storeMetrics.map(function (m) { return m.name; }))); r += 1;

    battleRow(r, "営業日数（日）", storeMetrics.map(function (m) { return m.open_days; }), FMT_INT); r += 1;
    battleRow(r, "月間売上（円）", storeMetrics.map(function (m) { return m.total_sales; }), FMT_INT); r += 1;
    battleRow(r, "月間利益（月30万換算後）",
      storeMetrics.map(function (m) { return m.total_sales - m.labor_with_owner; }), FMT_INT); r += 1;

    r += 1; // 空白

    _setCell(state, r, R_NAME, "─── 1日あたり（日数差を除いた公平比較）───");
    _merge(state, r, R_NAME, r, R_VAL4);
    r += 1;

    battleRow(r, "1日平均売上（円）", storeMetrics.map(function (m) { return Math.trunc(m.avg_sales); }), FMT_INT); r += 1;
    battleRow(r, "1日平均客数（人）", storeMetrics.map(function (m) { return _round1(m.avg_cust); })); r += 1;
    battleRow(r, "客単価（円）", storeMetrics.map(function (m) { return Math.trunc(m.unit_price); }), FMT_INT); r += 1;
    battleRow(r, "店舗平均RPH（円/h）", storeMetrics.map(function (m) { return Math.trunc(m.store_rph); }), FMT_INT); r += 1;
    battleRow(r, "1日平均人件費（月30万換算）", storeMetrics.map(function (m) {
      return m.open_days ? Math.trunc(m.labor_with_owner / m.open_days) : 0;
    }), FMT_INT); r += 1;
    battleRow(r, "1日平均利益", storeMetrics.map(function (m) {
      return m.open_days ? Math.trunc((m.total_sales - m.labor_with_owner) / m.open_days) : 0;
    }), FMT_INT); r += 1;

    r += 1; // 空白

    battleRow(r, "人件費（月30万換算）", storeMetrics.map(function (m) { return m.labor_with_owner; }), FMT_INT); r += 1;

    _setCell(state, r, R_NAME, "人件費率");
    storeMetrics.forEach(function (m, i) {
      var v = m.total_sales ? (m.labor_with_owner / m.total_sales) : 0;
      _setCell(state, r, R_VAL1 + i, (v * 100).toFixed(1) + "%");
    });
    r += 1;

    r += 1; // 空白

    storeMetrics.forEach(function (m) {
      _setCell(state, r, R_NAME, m.name + "  スタッフRPH（店平均 " + Math.trunc(m.store_rph).toLocaleString("ja-JP") + "円/h）");
      [[R_VAL1, "出勤"], [R_VAL2, "時間"], [R_VAL3, "RPH"], [R_VAL4, "店比"]].forEach(function (p) {
        _setCell(state, r, p[0], p[1]);
      });
      r += 1;

      m.staff_rows.forEach(function (s) {
        _setCell(state, r, R_NAME, s.name);
        _setCell(state, r, R_VAL1, s.days + "日");
        _setCell(state, r, R_VAL2, s.hours.toFixed(1) + "h");
        _setCell(state, r, R_VAL3, s.rph || "", s.rph ? FMT_INT : null);
        _setCell(state, r, R_VAL4, s.ratio.toFixed(1) + "%");
        r += 1;
      });
      r += 1;
    });

    _setCell(state, r, R_NAME,
      "※ 人件費は「やぶ・オーナーともに月30万（月給25万＋手渡し5万相当）」として統一比較。オーナー実人件費は0円。");
    _merge(state, r, R_NAME, r, R_VAL4);
    r += 1;

    return r;
  }

  function _setColumnWidths(state) {
    var widths = {
      1: 10, 2: 4, 3: 5, 4: 12, 5: 10, 6: 10, 7: 10, 8: 8, 9: 11, 10: 11, 11: 10,
      12: 2, 13: 18, 14: 12, 15: 11, 16: 10, 17: 12,
    };
    var cols = [];
    var maxCol = Math.max(state.maxCol, 17);
    for (var c = 1; c <= maxCol; c++) {
      cols.push({ wch: widths[c] || 9 });
    }
    state.ws["!cols"] = cols;
  }

  // ── 既存ワークブックの読み込み(無ければnull) ────────────────────────────
  function _readWorkbook(existing) {
    if (existing === null || existing === undefined) return null;
    var XLSX = _xlsx();
    try {
      if (typeof Buffer !== "undefined" && Buffer.isBuffer(existing)) {
        return XLSX.read(existing, { type: "buffer" });
      }
      if (existing instanceof ArrayBuffer) {
        return XLSX.read(new Uint8Array(existing), { type: "array" });
      }
      if (existing instanceof Uint8Array) {
        return XLSX.read(existing, { type: "array" });
      }
      if (_isPlainObject(existing) && existing.SheetNames) {
        return existing; // すでにXLSX.readしたワークブックオブジェクトを直接渡すケース
      }
    } catch (e) {
      return null; // 壊れたファイル等。openpyxlがExceptionで新規作成にフォールバックするのと同様
    }
    return null;
  }

  // ── write_combined_sheetの移植。外部API ───────────────────────────────
  // existingWorkbook: 省略可。前回ダウンロードしたxlsxのバイト列(ArrayBuffer/
  // Buffer/Uint8Array)、または既にXLSX.readしたワークブックオブジェクト。
  function writeCombinedSheet(existingWorkbook, sheetName, storesData, fullNameMap) {
    var XLSX = _xlsx();
    var wb = _readWorkbook(existingWorkbook) || XLSX.utils.book_new();

    // 同月の旧シート(例: 5月_TO, 5月_西中)をすべて削除
    var monthPrefix = sheetName.split("_")[0];
    (wb.SheetNames || []).slice().forEach(function (oldName) {
      if (oldName.indexOf(monthPrefix) === 0) {
        delete wb.Sheets[oldName];
        var idx = wb.SheetNames.indexOf(oldName);
        if (idx !== -1) wb.SheetNames.splice(idx, 1);
      }
    });

    var state = _newSheetState();
    var cur = 1;
    var rightEnd = 1;

    storesData.forEach(function (item) {
      if (!item || item.length < 3) return;
      var dailyRows = item[0], payroll = item[1], dayLaborMap = item[2];
      var nm = item.length > 3 ? item[3] : fullNameMap;
      var endRow = _writeDailySection(state, dailyRows, payroll, dayLaborMap, cur, nm);
      var kpiEndRow = _writeKpiSection(state, dailyRows, payroll, cur);
      rightEnd = Math.max(rightEnd, kpiEndRow);
      cur = Math.max(endRow, kpiEndRow) + 4;
    });

    var pairs = storesData.map(function (item) { return [item[1], item[1].store_name || ""]; });
    var compEnd = _writeComparisonSection(pairs, rightEnd + 2, state);
    _writeStoreBattleSection(storesData, compEnd + 2, state);
    _setColumnWidths(state);

    var ws = state.ws;
    ws["!ref"] = XLSX.utils.encode_range(
      { r: 0, c: 0 },
      { r: state.maxRow - 1, c: state.maxCol - 1 }
    );

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return wb;
  }

  function workbookToArray(wb) {
    var XLSX = _xlsx();
    return XLSX.write(wb, { type: "array", bookType: "xlsx" });
  }

  // ── _build_day_labor_mapの移植 ───────────────────────────────────────
  async function buildDayLaborMap(year, month, storeId, dailyRows, payroll) {
    var allStaffList = await dbGetAll(STAFF_STORE);
    var allStaff = {};
    allStaffList.forEach(function (s) { if (s && s.id) allStaff[s.id] = s; });

    var stores = await getStores();
    var champMenu = (stores[storeId] && stores[storeId].champagne_menu) || [];
    var ownerIds = new Set();
    Object.keys(allStaff).forEach(function (sid) {
      var s = allStaff[sid];
      if (s.is_owner && s.id) ownerIds.add(s.id);
    });

    var hasTrainees = Object.keys(allStaff).some(function (sid) {
      var s = allStaff[sid];
      return s.store_id === storeId && s.training_rate;
    });
    var dailyDatasets = hasTrainees
      ? (await dbGetAll(DAILY_STORE)).filter(function (d) { return _isPlainObject(d); })
      : [];

    var wanopeBonusRate = await getWanopeBonus();
    var incentiveRates = await getIncentiveRates();

    var dayMap = {};
    (dailyRows || []).forEach(function (day) {
      if (day.closed) return;
      var dateStr = day.date;
      var dayEntries = (day.staff_entries || []).filter(function (e) { return _isPlainObject(e); });
      var isWanope = isWanopeDay(dayEntries, ownerIds);
      var cost = 0;
      dayEntries.forEach(function (entry) {
        var sid = entry.staff_id || "";
        if (!sid) return;
        var staff = allStaff[sid];
        if (!_isPlainObject(staff)) return;
        if (staff.pay_type === "hourly") {
          var rate;
          if (staff.training_rate) {
            var hrsBefore = cumulativeHoursBefore(sid, staff.alias_group, dateStr, allStaff, dailyDatasets);
            rate = getEffectiveRate(staff, dateStr, hrsBefore);
          } else {
            rate = getEffectiveRate(staff, dateStr);
          }
          var hours = entry.hours || 0;
          var basePay = Math.trunc(hours * rate);
          var entryWanope = isWanope || !!entry.wanope_manual;
          var wanopeBonus = (entryWanope && !ownerIds.has(sid)) ? Math.trunc(hours * wanopeBonusRate) : 0;
          var drinkBack = calcDrinkBack(entry.drinks || 0);
          var champagneBack = calcChampagneBack(entry.champagne || {}, champMenu);
          var transport = calcTransport(staff.transport_one_way || 0, entry.okuri || false);
          var incentiveBack = calcIncentiveBack(entry, incentiveRates);
          cost += basePay + wanopeBonus + drinkBack + champagneBack + transport + incentiveBack;
        }
      });
      dayMap[dateStr] = cost;
    });

    function workDates(staffId) {
      return (dailyRows || [])
        .filter(function (day) {
          return !day.closed && (day.staff_entries || []).some(function (e) { return e.staff_id === staffId; });
        })
        .map(function (day) { return day.date; });
    }

    (payroll.staff_payroll || []).forEach(function (sp) {
      if (!sp.deductions) return;
      var dates = workDates(sp.staff_id);
      if (dates.length === 0) return;
      var dailyCost = (sp.labor_cost !== undefined ? sp.labor_cost : (sp.total || 0)) / dates.length;
      dates.forEach(function (d) { dayMap[d] = (dayMap[d] || 0) + Math.trunc(dailyCost); });
    });

    (payroll.staff_payroll || []).forEach(function (sp) {
      if (sp.deductions || sp.is_owner) return;
      var adjustment = sp.adjustment || 0;
      if (!adjustment) return;
      var dates = workDates(sp.staff_id);
      if (dates.length === 0) return;
      var dailyAdj = adjustment / dates.length;
      dates.forEach(function (d) { dayMap[d] = (dayMap[d] || 0) + Math.trunc(dailyAdj); });
    });

    return dayMap;
  }

  // ── _recalc_compositeの移植 ─────────────────────────────────────────
  async function recalcComposite(storesData) {
    var allStaffList = await dbGetAll(STAFF_STORE);
    var idToKey = {};
    allStaffList.forEach(function (s) {
      if (s && s.id) idToKey[s.id] = s.alias_group || s.id;
    });

    var storesPayroll = storesData.map(function (item) { return item[1]; });
    var ranking = calcCompanyRanking(storesPayroll);
    var rankedByKey = {};
    ranking.ranked.forEach(function (r) {
      var key = idToKey[r.staff_id] || r.staff_id;
      rankedByKey[key] = r;
    });

    storesData.forEach(function (item) {
      var payroll = item[1];
      (payroll.staff_payroll || []).forEach(function (sp) {
        var m = sp.metrics;
        if (!m) return;
        var key = idToKey[sp.staff_id] || sp.staff_id;
        var r = rankedByKey[key];
        if (!r) {
          m.composite_score = 0;
          return;
        }
        m.dph_ratio = r.drink_ratio;
        m.composite_score = r.score;
      });
    });
  }

  // ── export_month(routers/export.py)の移植。トップレベルのオーケストレーション ──
  // existingWorkbook: 省略可(ファイル先頭コメント参照)。
  async function exportMonth(year, month, existingWorkbook) {
    var stores = await getStores();
    var allStaffList = await dbGetAll(STAFF_STORE);
    var fullNameMap = {};
    allStaffList.forEach(function (s) { if (s && s.id) fullNameMap[s.id] = s.name; });

    var storesData = [];
    var storeIds = Object.keys(stores);
    for (var i = 0; i < storeIds.length; i++) {
      var storeId = storeIds[i];
      var dailyRows = await getMonth(year, month, storeId);
      var payroll = await getMonthlyPayroll(year, month, storeId);
      payroll.store_id = storeId;
      var dayLaborMap = await buildDayLaborMap(year, month, storeId, dailyRows, payroll);
      storesData.push([dailyRows, payroll, dayLaborMap, fullNameMap]);
    }

    // 全社平均D/hでcompositeを統一(ExcelとWeb画面の評価基準を一致させる)
    await recalcComposite(storesData);

    var sheetName = month + "月_合算";
    var wb = writeCombinedSheet(existingWorkbook, sheetName, storesData, fullNameMap);
    var array = workbookToArray(wb);
    var filename = "実績帳簿" + year + ".xlsx";

    var result = {
      year: year, month: month, filename: filename, sheet: sheetName,
      workbook: wb, array: array,
    };
    if (typeof Blob !== "undefined") {
      result.blob = new Blob([array], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    }
    return result;
  }

  // ── ダウンロード(navigator.share優先、フォールバックは<a>クリック) ────────
  // ブラウザのDOM/Web APIが無い環境(Node.jsのテスト)では何もしない。
  function downloadWorkbook(blob, filename) {
    if (typeof blob === "undefined" || blob === null) return;
    if (typeof navigator !== "undefined" && navigator.share && typeof File !== "undefined") {
      try {
        var file = new File([blob], filename, { type: blob.type });
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] }).catch(function () {
            _downloadViaAnchor(blob, filename);
          });
          return;
        }
      } catch (e) {
        // navigator.shareが使えない/失敗した場合は<a>フォールバックへ
      }
    }
    _downloadViaAnchor(blob, filename);
  }

  function _downloadViaAnchor(blob, filename) {
    if (typeof document === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return;
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  root.buildDayLaborMap = buildDayLaborMap;
  root.recalcComposite = recalcComposite;
  root.writeCombinedSheet = writeCombinedSheet;
  root.workbookToArray = workbookToArray;
  root.exportMonth = exportMonth;
  root.downloadWorkbook = downloadWorkbook;

  // POST /export/{year}/{month}(export_month)の移植。
  // Python版は生成したファイルをOSで直接開く別エンドポイント(/export/open)も
  // 提供していたが、ブラウザには「OSでファイルを開く」に相当するAPIが無いため、
  // ここではダウンロード(downloadWorkbook)をもって代替する。
  // /export/download, /export/open, /export/payslip, /export/pdf は、
  // PDF生成(services/pdf_writer.py)がTask10のPort対象(Excel出力のみ)に
  // 含まれていないため未移植(計画書Tech Stackの「Excel出力のみ」参照)。
  registerRoute("POST", "/export/:year/:month", async function (params) {
    var year = parseInt(params.year, 10);
    var month = parseInt(params.month, 10);
    var result = await exportMonth(year, month);
    downloadWorkbook(result.blob, result.filename);
    return { path: result.filename, sheet: result.sheet };
  });
})(typeof window !== "undefined" ? window : globalThis);
