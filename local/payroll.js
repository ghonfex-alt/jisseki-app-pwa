/**
 * local/payroll.js — 給与計算ロジック本体(services/payroll.py + routers/payroll.pyの移植)。
 *
 * **最重要・最複雑**: 実際の金銭(給与)に関わる計算のため、1行ずつPython側と
 * 対応を確認しながら移植してある。ロジックを変えた箇所は各関数のコメントに
 * 理由を明記する(Global Constraints参照)。
 *
 * 依存: db.js, local-api.js, local/store.js(window.checkStoreId),
 * local/tax-table-r8.js(window.TAX_TABLE_R8)。<script>タグは
 * db.js → local-api.js → local/store.js → local/staff.js → local/daily.js →
 * local/tax-table-r8.js → local/payroll.js の順で読み込むこと。
 *
 * 移植元: JISSEKI_SRC/services/payroll.py, JISSEKI_SRC/routers/payroll.py
 * (JISSEKI_SRC = C:\Users\ghonf\cc-company\shisha\jisseki-app-standalone-build)。
 *
 * ── ワンオペ手当の既定値0円について(過去の本番事故の教訓) ──────────────────
 * ワンオペ手当(時給スタッフが1人だけ出勤した日に自動加算される手当)の既定値は
 * 過去の本番運用で0以外の値になっていたことがあり、「単体出勤日に勝手に手当が
 * 付く」実被害(給与過払い)が発生した。これを受けて既定値は必ず0円にすることが
 * 決まっている。本ファイルの getWanopeBonus() はこの既定値0を絶対に変更しない
 * こと(services/payroll.py::_get_wanope_bonus()のコメント参照)。
 *
 * ── 新設: キャッチ・呼び・延長インセンティブ(JISSEKI_SRCには存在しない) ───────
 * 計画書冒頭の「追加要件」通り、ドリンクバック(drinks * 70固定)と全く同じ形で、
 * entry.catch_count/call_count/extension_count にそれぞれ設定画面の単価
 * (incentive_rates、既定0円)を掛けて日給に加算する。単価は settings ストア
 * (Task9で実装予定)から読み、未設定の間は必ず0円(ワンオペ手当と同じ安全側既定値)。
 * include_drink/include_champagneのような「月給スタッフは個別に反映チェックする」
 * ゲート機構は計画書に明記が無いため、既存の交通費(transport)と同じく常に
 * 日給・月給どちらにも無条件で加算する扱いとした(ドリンク/シャンパンのみ
 * 月給側で個別反映チェックが要る理由は「売上の種類によって経理上扱いが違う」
 * ためと推測されるが、キャッチ/呼び/延長はその区別が計画書に無いため)。
 */
(function (root) {
  "use strict";

  var SETTINGS_STORE = "settings";
  var SETTINGS_KEY = "global"; // 設計書: 「settings | settings.json | 固定キー'global'」
  var PAYROLL_ADJUSTMENTS_STORE = "payroll_adjustments";

  // ── 定数(services/payroll.py) ──────────────────────────────────────
  var DRINK_UNIT = 70;
  var CHAMPAGNE_BACK_RATE = 0.10;
  var DRINK_UNIT_PRICE = 700;
  var COMPANY_RANKING_DEFAULT_COEFFICIENTS = { rph: 0.80, drinks: 0.20 };
  var MIN_WORK_DAYS_FOR_RANKING = 3;

  // Pythonの dict.get(key, default) 相当(キーが無い場合のみdefaultを返す。
  // 値がnull/undefinedでもキーが存在するなら素通りさせる)。
  function _get(obj, key, def) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
      return obj[key];
    }
    return def;
  }

  function _isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  function _round1(v) {
    return Math.round(v * 10) / 10;
  }

  function _roundN(v, n) {
    var m = Math.pow(10, n);
    return Math.round(v * m) / m;
  }

  // ── 設定値の読み込み(settingsストア、固定キー'global') ───────────────
  async function _readSettings() {
    var settings = await dbGet(SETTINGS_STORE, SETTINGS_KEY);
    return _isPlainObject(settings) ? settings : {};
  }

  // _get_wanope_bonus(services/payroll.py)の移植。
  // 既定値は絶対に0のまま変更しないこと(ファイル先頭コメント参照)。
  async function getWanopeBonus() {
    var settings = await _readSettings();
    var v = settings.wanope_bonus;
    return v === null || v === undefined ? 0 : v;
  }

  // 新設: incentive_rates(キャッチ・呼び・延長の単価)。Task9(local/settings.js)が
  // settingsストアに書き込むまでは常に未設定 = 全て0円として扱う(安全側既定値)。
  async function getIncentiveRates() {
    var settings = await _readSettings();
    var rates = _isPlainObject(settings.incentive_rates) ? settings.incentive_rates : {};
    function _rate(key) {
      var r = rates[key];
      var yen = r && typeof r === "object" ? r.yen_per_count : undefined;
      return yen === null || yen === undefined ? 0 : yen;
    }
    return {
      catch: { yen_per_count: _rate("catch") },
      call: { yen_per_count: _rate("call") },
      extension: { yen_per_count: _rate("extension") },
    };
  }

  // calc_drink_back(services/payroll.py)の移植。
  function calcDrinkBack(drinks) {
    return (drinks || 0) * DRINK_UNIT;
  }

  // calc_champagne_back(services/payroll.py)の移植。
  function calcChampagneBack(champagne, menu) {
    if (!_isPlainObject(champagne)) {
      return 0;
    }
    var priceMap = {};
    (menu || []).forEach(function (c) {
      if (c && typeof c === "object" && c.id) {
        priceMap[c.id] = c.price || 0;
      }
    });
    var total = 0;
    Object.keys(champagne).forEach(function (champId) {
      var count = champagne[champId];
      var price = Object.prototype.hasOwnProperty.call(priceMap, champId) ? priceMap[champId] : 0;
      total += Math.trunc(price * CHAMPAGNE_BACK_RATE * count);
    });
    return total;
  }

  // calc_transport(services/payroll.py)の移植。
  function calcTransport(oneWay, okuri) {
    return okuri ? oneWay : oneWay * 2;
  }

  // 新設: キャッチ・呼び・延長インセンティブ(ドリンクバックと全く同じ形)。
  function calcIncentiveBack(entry, rates) {
    var catchCount = (entry && entry.catch_count) || 0;
    var callCount = (entry && entry.call_count) || 0;
    var extensionCount = (entry && entry.extension_count) || 0;
    return Math.trunc(
      catchCount * rates.catch.yen_per_count +
      callCount * rates.call.yen_per_count +
      extensionCount * rates.extension.yen_per_count
    );
  }

  // is_wanope_day(services/payroll.py)の移植。
  function isWanopeDay(dayEntries, ownerIds) {
    var entries = dayEntries || [];
    var paidEntries = entries.filter(function (e) {
      return !ownerIds.has((e && e.staff_id) || "");
    });
    var ownerPresent = entries.some(function (e) {
      return ownerIds.has((e && e.staff_id) || "");
    });
    return paidEntries.length === 1 && !ownerPresent;
  }

  // ── 月額源泉徴収税額表(令和8年分、甲欄) ───────────────────────────────
  function _loadTaxTable() {
    return Array.isArray(root.TAX_TABLE_R8) ? root.TAX_TABLE_R8 : [];
  }

  // _employment_income_deduction(services/payroll.py)の移植。
  function _employmentIncomeDeduction(annual) {
    if (annual <= 1625000) return Math.max(650000, Math.trunc(annual * 0.4));
    if (annual <= 1800000) return 725000;
    if (annual <= 3600000) return Math.trunc(annual * 0.3) + 80000;
    if (annual <= 6600000) return Math.trunc(annual * 0.2) + 440000;
    if (annual <= 8500000) return Math.trunc(annual * 0.1) + 1100000;
    return 1950000;
  }

  // _income_tax_annual(services/payroll.py)の移植。
  function _incomeTaxAnnual(taxable) {
    var brackets = [
      [1950000, 0.05, 0],
      [3300000, 0.10, 97500],
      [6950000, 0.20, 427500],
      [9000000, 0.23, 636000],
      [18000000, 0.33, 1536000],
      [40000000, 0.40, 2796000],
      [Infinity, 0.45, 4796000],
    ];
    for (var i = 0; i < brackets.length; i++) {
      var limit = brackets[i][0], rate = brackets[i][1], ded = brackets[i][2];
      if (taxable <= limit) {
        return Math.max(0, Math.trunc(taxable * rate) - ded);
      }
    }
    return 0;
  }

  // _calc_source_withholding_formula(services/payroll.py)の移植。
  function _calcSourceWithholdingFormula(monthlyAfterSocial, dependents) {
    dependents = dependents || 0;
    var annual = monthlyAfterSocial * 12;
    var empDed = _employmentIncomeDeduction(annual);
    var basicDed = 580000;
    var depDed = dependents * 380000;
    var taxableRaw = Math.max(0, annual - empDed - basicDed - depDed);
    var taxable = Math.trunc(taxableRaw / 1000) * 1000;
    var annualTax = Math.trunc(_incomeTaxAnnual(taxable) * 1.021);
    return Math.trunc(annualTax / 12);
  }

  // calc_source_withholding(services/payroll.py)の移植。
  function calcSourceWithholding(monthlyAfterSocial, dependents) {
    dependents = dependents || 0;
    var table = _loadTaxTable();
    if (table.length) {
      // bisect.bisect_right(lowers, monthly_after_social) - 1 相当(下限が
      // 昇順に並んでいる前提。元データはソート済み)。
      var idx = -1;
      for (var i = 0; i < table.length; i++) {
        if (table[i][0] <= monthlyAfterSocial) {
          idx = i;
        } else {
          break;
        }
      }
      if (idx >= 0 && idx < table.length) {
        var lo = table[idx][0], hi = table[idx][1], taxes = table[idx][2];
        if (lo <= monthlyAfterSocial && monthlyAfterSocial < hi) {
          var depIdx = Math.min(dependents, taxes.length - 1);
          return taxes[depIdx];
        }
      }
    }
    // 表の範囲外(極めて高額)または読み込み失敗時はフォールバック算定式。
    console.warn(
      "源泉徴収税額表の範囲外(社保控除後 " + monthlyAfterSocial + "円)のため算定式にフォールバックしました。"
    );
    return _calcSourceWithholdingFormula(monthlyAfterSocial, dependents);
  }

  // shakaihoken_applies(services/payroll.py)の移植。月末退職の特例。
  function _parseIsoDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) return null;
    var year = parseInt(m[1], 10), month = parseInt(m[2], 10), day = parseInt(m[3], 10);
    var d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
      return null;
    }
    return { year: year, month: month, day: day };
  }

  function _lastDayOfMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function shakaihokenApplies(resignationDate, year, month) {
    if (!resignationDate || year === null || year === undefined || month === null || month === undefined) {
      return true;
    }
    var r = _parseIsoDate(resignationDate);
    if (!r) return true;
    if (r.year > year || (r.year === year && r.month > month)) return true;
    if (r.year < year || (r.year === year && r.month < month)) return false;
    return r.day === _lastDayOfMonth(r.year, r.month);
  }

  // calc_monthly_deductions(services/payroll.py)の移植。
  function calcMonthlyDeductions(monthlySalary, deduction, standardRemuneration, applySocialInsurance) {
    if (applySocialInsurance === undefined || applySocialInsurance === null) {
      applySocialInsurance = true;
    }
    var sr = (standardRemuneration !== null && standardRemuneration !== undefined) ? standardRemuneration : monthlySalary;
    var d = deduction || {};
    var health, childcare, pension;
    if (applySocialInsurance) {
      health = Math.ceil(sr * (d.health_insurance_rate || 0));
      childcare = Math.ceil(sr * (d.childcare_support_rate || 0));
      pension = Math.ceil(sr * (d.pension_rate || 0));
    } else {
      health = childcare = pension = 0;
    }
    var employment = Math.ceil(monthlySalary * (d.employment_insurance_rate || 0));
    var socialTotal = health + childcare + pension + employment;
    var taxableMonthly = Math.max(0, monthlySalary - socialTotal);
    var manual = d.manual_income_tax;
    var dependents = d.dependents || 0;
    var incomeTax;
    if (manual !== null && manual !== undefined) {
      var n = Number(manual);
      incomeTax = Number.isFinite(n) ? Math.trunc(n) : calcSourceWithholding(taxableMonthly, dependents);
    } else {
      incomeTax = calcSourceWithholding(taxableMonthly, dependents);
    }
    return {
      health_insurance: health,
      childcare_support: childcare,
      pension: pension,
      employment_insurance: employment,
      income_tax: incomeTax,
      total: socialTotal + incomeTax,
    };
  }

  // _rate_history_value(services/payroll.py)の移植。
  function _rateHistoryValue(staff, dateStr) {
    var history = staff.rate_history || [];
    var rate = staff.hourly_rate || 0;
    var valid = history.filter(function (h) {
      return h && typeof h === "object" && h.from && h.rate !== null && h.rate !== undefined;
    });
    valid = valid.slice().sort(function (a, b) {
      return String(a.from).localeCompare(String(b.from));
    });
    valid.forEach(function (h) {
      if (String(h.from) <= dateStr) rate = h.rate;
    });
    return rate;
  }

  // get_effective_rate(services/payroll.py)の移植。
  function getEffectiveRate(staff, dateStr, cumulativeHours) {
    var historyValue = _rateHistoryValue(staff, dateStr);
    var training = staff.training_rate;
    if (_isPlainObject(training)) {
      var base = (training.base_rate !== null && training.base_rate !== undefined) ? training.base_rate : (staff.hourly_rate || 0);
      var raised = (training.raised_rate !== null && training.raised_rate !== undefined) ? training.raised_rate : base;
      var threshold = training.threshold_hours || 0;
      var hours = (cumulativeHours !== null && cumulativeHours !== undefined) ? cumulativeHours : 0;
      if (hours >= threshold) {
        return Math.max(raised, historyValue);
      }
      return base;
    }
    return historyValue;
  }

  // cumulative_hours_before(services/payroll.py)の移植。
  function cumulativeHoursBefore(staffId, aliasGroup, beforeDate, allStaff, dailyDatasets) {
    var matchIds = new Set();
    Object.keys(allStaff || {}).forEach(function (sid) {
      var s = allStaff[sid];
      if (s && typeof s === "object" && (sid === staffId || (aliasGroup && s.alias_group === aliasGroup))) {
        matchIds.add(sid);
      }
    });
    matchIds.add(staffId);
    var total = 0;
    (dailyDatasets || []).forEach(function (dailyData) {
      Object.keys(dailyData || {}).forEach(function (dateStr) {
        if (dateStr >= beforeDate) return;
        var dateEntry = dailyData[dateStr];
        if (!_isPlainObject(dateEntry)) return;
        Object.keys(dateEntry).forEach(function (storeId) {
          var storeDay = dateEntry[storeId];
          if (!_isPlainObject(storeDay)) return;
          (storeDay.staff_entries || []).forEach(function (e) {
            if (e && typeof e === "object" && matchIds.has(e.staff_id)) {
              total += e.hours || 0;
            }
          });
        });
      });
    });
    return total;
  }

  // calc_hourly_payroll(services/payroll.py)の移植。
  async function calcHourlyPayroll(staff, entries, champMenu) {
    entries = entries || [];
    var workDays = entries.length;
    var totalHours = entries.reduce(function (s, e) { return s + ((e && e.hours) || 0); }, 0);
    var wanopeDays = entries.filter(function (e) { return e && e.wanope; }).length;
    var wanopeHours = entries.reduce(function (s, e) { return s + (e && e.wanope ? (e.hours || 0) : 0); }, 0);
    var basePay = Math.trunc(entries.reduce(function (s, e) {
      var rate = (e && Object.prototype.hasOwnProperty.call(e, "effective_rate")) ? e.effective_rate : (staff.hourly_rate || 0);
      return s + rate * ((e && e.hours) || 0);
    }, 0));
    var wanopeBonusRate = await getWanopeBonus();
    var wanopeBonus = Math.trunc(wanopeHours * wanopeBonusRate);
    var drinkBack = entries.reduce(function (s, e) { return s + calcDrinkBack(e && e.drinks); }, 0);
    var champagneBack = entries.reduce(function (s, e) { return s + calcChampagneBack((e && e.champagne) || {}, champMenu); }, 0);
    var transport = entries.reduce(function (s, e) { return s + calcTransport(staff.transport_one_way || 0, (e && e.okuri) || false); }, 0);
    var incentiveRates = await getIncentiveRates();
    var incentiveBack = entries.reduce(function (s, e) { return s + calcIncentiveBack(e, incentiveRates); }, 0);
    var total = basePay + wanopeBonus + drinkBack + champagneBack + transport + incentiveBack;
    var hand = staff.hand_delivery || false;
    return {
      staff_id: _get(staff, "id", ""),
      work_days: workDays,
      total_hours: totalHours,
      wanope_days: wanopeDays,
      wanope_bonus: wanopeBonus,
      base_pay: basePay,
      drink_back: drinkBack,
      champagne_back: champagneBack,
      incentive_back: incentiveBack,
      transport: transport,
      adjustment: 0,
      adjustment_memo: "",
      total: total,
      transfer_amount: hand ? 0 : total,
      hand_amount: hand ? total : 0,
    };
  }

  // calc_absence_deduction(services/payroll.py)の移植。
  function calcAbsenceDeduction(monthlySalary, scheduledDays, absenceDays, baseSalary) {
    if (scheduledDays <= 0 || absenceDays <= 0) return 0;
    absenceDays = Math.min(absenceDays, scheduledDays);
    var basis = (baseSalary !== null && baseSalary !== undefined) ? baseSalary : monthlySalary;
    var deduction = Math.trunc((basis / scheduledDays) * absenceDays);
    return Math.min(deduction, monthlySalary);
  }

  // calc_monthly_payroll(services/payroll.py)の移植。
  async function calcMonthlyPayroll(staff, entries, champMenu, opts) {
    opts = opts || {};
    entries = entries || [];
    var adjustment = opts.adjustment || 0;
    var adjustmentMemo = opts.adjustment_memo || "";
    var absenceDays = opts.absence_days || 0;
    var scheduledDays = opts.scheduled_days || 0;
    var adjustmentHandDelivery = opts.adjustment_hand_delivery || false;
    var year = opts.year;
    var month = opts.month;
    var socialInsuranceOverride = opts.social_insurance_override;

    var monthlySalary = staff.monthly_salary || 0;
    var deductionCfg = staff.deduction || {};
    var applyShakaihoken;
    if (socialInsuranceOverride !== null && socialInsuranceOverride !== undefined) {
      applyShakaihoken = socialInsuranceOverride;
    } else {
      applyShakaihoken = shakaihokenApplies(staff.resignation_date, year, month);
    }
    var deductions;
    if (deductionCfg && Object.keys(deductionCfg).length > 0) {
      deductions = calcMonthlyDeductions(monthlySalary, deductionCfg, staff.standard_remuneration, applyShakaihoken);
    } else {
      deductions = { health_insurance: 0, childcare_support: 0, pension: 0, employment_insurance: 0, income_tax: 0, total: 0 };
    }
    var takeHome = monthlySalary - deductions.total;
    var drinkBackRaw = entries.reduce(function (s, e) { return s + calcDrinkBack(e && e.drinks); }, 0);
    var champBackRaw = entries.reduce(function (s, e) { return s + calcChampagneBack((e && e.champagne) || {}, champMenu); }, 0);
    var drinkBack = entries.reduce(function (s, e) { return s + ((e && e.include_drink) ? calcDrinkBack(e.drinks) : 0); }, 0);
    var champagneBack = entries.reduce(function (s, e) { return s + ((e && e.include_champagne) ? calcChampagneBack(e.champagne || {}, champMenu) : 0); }, 0);
    var transport = entries.reduce(function (s, e) { return s + calcTransport(staff.transport_one_way || 0, (e && e.okuri) || false); }, 0);
    var incentiveRates = await getIncentiveRates();
    var incentiveBack = entries.reduce(function (s, e) { return s + calcIncentiveBack(e, incentiveRates); }, 0);
    var sched = scheduledDays > 0 ? scheduledDays : (staff.default_scheduled_days || 22);
    var absenceDed = calcAbsenceDeduction(monthlySalary, sched, absenceDays, staff.absence_base_salary);
    var workDays = entries.length;
    var subtotal = takeHome + drinkBack + champagneBack + transport + incentiveBack - absenceDed;
    var total = subtotal + adjustment;
    total = Math.max(0, total);

    var handAmount = adjustmentHandDelivery ? Math.max(0, adjustment) : 0;
    var transferAmount = Math.max(0, total - handAmount);

    var laborCost = Math.max(0, monthlySalary - absenceDed + adjustment + drinkBack + champagneBack + transport + incentiveBack);

    return {
      staff_id: _get(staff, "id", ""),
      work_days: workDays,
      monthly_salary: _get(staff, "monthly_salary", 0),
      deductions: deductions,
      social_insurance_exempt: !applyShakaihoken,
      take_home: takeHome,
      drink_back: drinkBack,
      drink_back_raw: drinkBackRaw,
      champagne_back: champagneBack,
      champagne_back_raw: champBackRaw,
      incentive_back: incentiveBack,
      transport: transport,
      absence_days: absenceDays,
      scheduled_days: sched,
      absence_deduction: absenceDed,
      adjustment: adjustment,
      adjustment_memo: adjustmentMemo,
      adjustment_hand_delivery: adjustmentHandDelivery,
      total: total,
      transfer_amount: transferAmount,
      hand_amount: handAmount,
      labor_cost: laborCost,
    };
  }

  // calc_store_metrics(services/payroll.py)の移植。
  function calcStoreMetrics(staffHours, staffShiftSales, storeTotalSales, storeTotalHours,
    totalDrinks, champagneBottles, champagneAmount, opts) {
    opts = opts || {};
    champagneAmount = champagneAmount || 0;
    var storeAvgDph = opts.store_avg_dph || 0;
    var storeAvgRph = opts.store_avg_rph || 0;
    var staffShiftCustomers = opts.staff_shift_customers || 0;
    var storeTotalCustomers = opts.store_total_customers || 0;
    var workDays = opts.work_days || 0;
    var storeBusinessDays = opts.store_business_days || 0;
    var storeAvgChampPerHour = opts.store_avg_champ_per_hour || 0;

    var storeRph = storeAvgRph > 0 ? storeAvgRph : (storeTotalHours > 0 ? storeTotalSales / storeTotalHours : 0);
    var staffRph = staffHours > 0 ? staffShiftSales / staffHours : 0;
    var ratio = storeRph > 0 ? (staffRph / storeRph * 100) : 0;
    var dph = staffHours > 0 ? totalDrinks / staffHours : 0;
    var dphRatio = storeAvgDph > 0 ? (dph / storeAvgDph * 100) : 0;
    var staffEffectiveDph = dph + (staffHours > 0 ? champagneAmount / staffHours / DRINK_UNIT_PRICE : 0);
    var storeEffectiveAvgDph = storeAvgDph + storeAvgChampPerHour / DRINK_UNIT_PRICE;
    var effectiveDphRatio = storeEffectiveAvgDph > 0 ? (staffEffectiveDph / storeEffectiveAvgDph * 100) : 0;
    var composite = workDays >= MIN_WORK_DAYS_FOR_RANKING
      ? _round1(ratio * COMPANY_RANKING_DEFAULT_COEFFICIENTS.rph + effectiveDphRatio * COMPANY_RANKING_DEFAULT_COEFFICIENTS.drinks)
      : 0;
    var drinkValue = totalDrinks * DRINK_UNIT_PRICE + champagneAmount;
    var drinkValuePerHour = staffHours > 0 ? drinkValue / staffHours : 0;
    var champPerHour = staffHours > 0 ? champagneAmount / staffHours : 0;
    var champRatio = storeAvgChampPerHour > 0 ? (champPerHour / storeAvgChampPerHour * 100) : 0;
    var storeAvgDrinkValuePerHour = storeAvgDph * DRINK_UNIT_PRICE + storeAvgChampPerHour;
    var drinkValueRatio = storeAvgDrinkValuePerHour > 0 ? (drinkValuePerHour / storeAvgDrinkValuePerHour * 100) : 0;
    var storeAvgBill = storeTotalCustomers > 0 ? storeTotalSales / storeTotalCustomers : 0;
    var staffAvgBill = staffShiftCustomers > 0 ? staffShiftSales / staffShiftCustomers : 0;
    var unitPriceRatio = storeAvgBill > 0 ? (staffAvgBill / storeAvgBill * 100) : 0;
    var attendanceRatio = storeBusinessDays > 0 ? (workDays / storeBusinessDays * 100) : 0;

    return {
      performance_ratio: _round1(ratio),
      dph_ratio: _round1(dphRatio),
      composite_score: composite,
      drinks_per_hour: _roundN(dph, 2),
      total_drinks: totalDrinks,
      drink_value_per_hour: Math.round(drinkValuePerHour),
      champagne_total: champagneBottles,
      champagne_amount: champagneAmount,
      shift_sales: staffShiftSales,
      champagne_per_hour_ratio: _round1(champRatio),
      drink_value_ratio: _round1(drinkValueRatio),
      unit_price_ratio: _round1(unitPriceRatio),
      attendance_ratio: _round1(attendanceRatio),
    };
  }

  // calc_company_ranking(services/payroll.py)の移植。全店舗合算の総合ランキング。
  function calcCompanyRanking(storesPayroll, coefficients) {
    var coef = Object.assign({}, COMPANY_RANKING_DEFAULT_COEFFICIENTS, coefficients || {});

    var companyTotalSales = (storesPayroll || []).reduce(function (s, p) { return s + (p.total_sales || 0); }, 0);
    var companyTotalHours = (storesPayroll || []).reduce(function (s, p) { return s + (p.total_hours_all || 0); }, 0);
    var companyRph = companyTotalHours > 0 ? companyTotalSales / companyTotalHours : 0;

    var merged = {};
    (storesPayroll || []).forEach(function (payroll) {
      var storeNm = payroll.store_name || "";
      (payroll.staff_payroll || []).forEach(function (sp) {
        var metrics = sp.metrics || {};
        var key = sp.alias_group || sp.staff_id || "";
        var m = merged[key];
        if (!m) {
          m = merged[key] = {
            staff_id: sp.staff_id || "",
            name: sp.name || sp.staff_id || "",
            stores: [],
            is_owner: false,
            work_days: 0,
            hours: 0,
            shift_sales: 0,
            total_drinks: 0,
            champagne_amount: 0,
            hand_delivery: sp.hand_delivery || false,
          };
        }
        m.stores.push(storeNm);
        m.is_owner = m.is_owner || !!sp.is_owner;
        m.work_days += sp.work_days || 0;
        m.hours += sp.total_hours || 0;
        m.shift_sales += metrics.shift_sales || 0;
        m.total_drinks += metrics.total_drinks || 0;
        m.champagne_amount += metrics.champagne_amount || 0;
      });
    });

    var raw = [];
    var companyTotalEffectiveDrinks = 0;
    var companyEligibleHours = 0;
    Object.keys(merged).forEach(function (key) {
      var m = merged[key];
      var hours = m.hours;
      var shiftS = m.shift_sales;
      var champAmt = m.champagne_amount;
      var eligible = hours > 0 && shiftS > 0 && m.work_days >= MIN_WORK_DAYS_FOR_RANKING;
      var effectiveDrinks = m.total_drinks + champAmt / DRINK_UNIT_PRICE;
      if (eligible) {
        companyTotalEffectiveDrinks += effectiveDrinks;
        companyEligibleHours += hours;
      }
      var storeSet = Array.from(new Set(m.stores));
      raw.push({
        staff_id: m.staff_id,
        name: m.name,
        store: storeSet.length > 1 ? "全店" : (storeSet[0] || ""),
        is_owner: m.is_owner,
        work_days: m.work_days,
        hours: hours,
        eligible: eligible,
        abs_rph: hours > 0 ? Math.trunc(shiftS / hours) : 0,
        champagne_amount: champAmt,
        drinks_per_hour: hours > 0 ? (m.total_drinks / hours) : 0,
        effective_drinks_per_hour: hours > 0 ? (effectiveDrinks / hours) : 0,
        hand_delivery: m.hand_delivery,
      });
    });

    var companyAvgEffectiveDph = companyEligibleHours > 0 ? companyTotalEffectiveDrinks / companyEligibleHours : 0;

    var ranked = raw.map(function (r) {
      var rphRatio = 0, drinkRatio = 0, score = 0;
      if (r.eligible) {
        rphRatio = (companyRph > 0 && r.abs_rph > 0) ? _round1(r.abs_rph / companyRph * 100) : 0;
        drinkRatio = companyAvgEffectiveDph > 0 ? _round1(r.effective_drinks_per_hour / companyAvgEffectiveDph * 100) : 0;
        score = _round1(rphRatio * coef.rph + drinkRatio * coef.drinks);
      }
      return {
        staff_id: r.staff_id,
        name: r.name,
        store: r.store,
        is_owner: r.is_owner,
        work_days: r.work_days,
        hours: r.hours,
        score: score,
        rph_ratio: rphRatio,
        drink_ratio: drinkRatio,
        abs_rph: r.abs_rph,
        champagne_amount: r.champagne_amount,
        drinks_per_hour: r.drinks_per_hour,
        hand_delivery: r.hand_delivery,
      };
    });

    ranked.sort(function (a, b) {
      var av = a.score > 0 ? a.score : -1;
      var bv = b.score > 0 ? b.score : -1;
      return bv - av;
    });

    return {
      company_rph: Math.round(companyRph),
      company_avg_effective_dph: _roundN(companyAvgEffectiveDph, 2),
      company_total_sales: companyTotalSales,
      company_total_hours: companyTotalHours,
      ranked: ranked,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // ── ルーター層(routers/payroll.pyの移植) ──────────────────────────────
  // ════════════════════════════════════════════════════════════════════

  var DAILY_STORE = "daily";
  var STAFF_STORE = "staff";
  var STORES_STORE = "stores";

  // Task6(payroll-admin.js)が window.isLocked/window.getSnapshot を定義するまでは
  // 「ロック無し・スナップショット無し」として扱う(local/staff.js・local/daily.jsと
  // 同じ遅延バインディングパターン)。
  function _isLocked(year, month) {
    if (typeof root.isLocked === "function") {
      return root.isLocked(year, month);
    }
    return false;
  }
  async function _getSnapshot(year, month, storeId) {
    if (typeof root.getSnapshot === "function") {
      return root.getSnapshot(year, month, storeId);
    }
    return undefined;
  }

  function _adjustmentKey(year, month, storeId, staffId) {
    return year + "_" + month + "_" + storeId + "_" + staffId;
  }

  async function _loadAdjustment(year, month, storeId, staffId) {
    var adj = await dbGet(PAYROLL_ADJUSTMENTS_STORE, _adjustmentKey(year, month, storeId, staffId));
    return _isPlainObject(adj) ? adj : {};
  }

  function _champagneAmount(entries, priceMap) {
    var total = 0;
    (entries || []).forEach(function (e) {
      var champ = (e && e.champagne) || {};
      if (!_isPlainObject(champ)) return;
      Object.keys(champ).forEach(function (k) {
        total += (priceMap[k] || 0) * champ[k];
      });
    });
    return total;
  }

  // get_staff_effective_rate(routers/payroll.py)の移植。
  // GET /payroll/effective-rate/{staff_id}/{date}
  async function getStaffEffectiveRate(staffId, date) {
    var staff = await dbGet(STAFF_STORE, staffId);
    if (!_isPlainObject(staff)) {
      throw new ApiError(404, "staff not found: " + staffId);
    }
    if (staff.training_rate) {
      var allStaff = await _loadAllStaffMap();
      var dailyDatasets = await _loadAllDailyDatasets();
      var hrsBefore = cumulativeHoursBefore(staffId, staff.alias_group, date, allStaff, dailyDatasets);
      var rate = getEffectiveRate(staff, date, hrsBefore);
      var threshold = (staff.training_rate && staff.training_rate.threshold_hours) || 0;
      return { rate: rate, cumulative_hours: hrsBefore, threshold_hours: threshold };
    }
    return { rate: getEffectiveRate(staff, date) };
  }

  // staff.jsonの代わりに、"staff"ストア全件を { id: staffObj } の形に組み立てる。
  async function _loadAllStaffMap() {
    var all = await dbGetAll(STAFF_STORE);
    var result = {};
    all.forEach(function (s) {
      if (s && typeof s === "object" && s.id) result[s.id] = s;
    });
    return result;
  }

  // data_io.all_daily_filenames()で読み込む全年分のdaily_*.json相当。
  // "daily"ストアは年をキーに保存されているため、全件(=全年分)を取得する。
  async function _loadAllDailyDatasets() {
    var all = await dbGetAll(DAILY_STORE);
    return all.filter(function (d) { return _isPlainObject(d); });
  }

  // get_monthly_payroll(routers/payroll.py)の移植。最も複雑なエンドポイント。
  // GET /payroll/{year}/{month}/{store_id}
  async function getMonthlyPayroll(year, month, storeId, ownerDph) {
    ownerDph = ownerDph || 0;

    if (ownerDph === 0 && _isLocked(year, month)) {
      var snap = await _getSnapshot(year, month, storeId);
      if (snap !== undefined && snap !== null) {
        return snap;
      }
    }

    var dailyData = (await dbGet(DAILY_STORE, year)) || {};
    var allStaff = await _loadAllStaffMap();
    var stores = await getStores();
    var champMenu = (stores[storeId] && stores[storeId].champagne_menu) || [];
    var priceMap = {};
    champMenu.forEach(function (c) {
      if (c && typeof c === "object" && c.id) priceMap[c.id] = c.price || 0;
    });

    var prefix = year + "-" + String(month).padStart(2, "0") + "-";

    // 非アクティブ化後も対象月に実績が残っているスタッフは給与計算から漏れない
    // ようにする(staff.py同様の「名前重複で別IDが新規作成」ケースの救済)。
    var referencedIds = new Set();
    Object.keys(dailyData).forEach(function (dateStr) {
      if (dateStr.indexOf(prefix) !== 0) return;
      var dateEntry = dailyData[dateStr];
      if (!_isPlainObject(dateEntry)) return;
      var day = dateEntry[storeId];
      if (!_isPlainObject(day)) return;
      (day.staff_entries || []).forEach(function (e) {
        if (e && typeof e === "object" && e.staff_id) referencedIds.add(e.staff_id);
      });
    });

    var storeStaff = Object.keys(allStaff)
      .map(function (sid) { return allStaff[sid]; })
      .filter(function (s) {
        return s && typeof s === "object" && s.store_id === storeId
          && (s.active || referencedIds.has(s.id)) && !s.is_owner && s.id;
      });
    var staffById = {};
    storeStaff.forEach(function (s) { staffById[s.id] = s; });

    var totalSales = 0;
    var totalCustomersAll = 0;
    var totalHours = 0;
    var totalHoursAll = 0;
    var totalDrinksAll = 0;
    var totalChampagneAll = 0;
    var storeBusinessDays = 0;
    var ownerDrinksRaw = 0;
    var ownerHoursRaw = 0;
    var staffEntries = {};
    storeStaff.forEach(function (s) { staffEntries[s.id] = []; });
    var staffShiftSales = {};
    var staffShiftCustomers = {};
    storeStaff.forEach(function (s) { staffShiftSales[s.id] = 0; staffShiftCustomers[s.id] = 0; });

    var ownerIds = new Set();
    Object.keys(allStaff).forEach(function (sid) {
      var s = allStaff[sid];
      if (s && typeof s === "object" && s.is_owner && s.id) ownerIds.add(s.id);
    });

    var hasTrainees = storeStaff.some(function (s) { return s && s.training_rate; });
    var dailyDatasets = hasTrainees ? await _loadAllDailyDatasets() : [];

    Object.keys(dailyData).sort().forEach(function (dateStr) {
      if (dateStr.indexOf(prefix) !== 0) return;
      var dateEntry = dailyData[dateStr];
      if (!_isPlainObject(dateEntry)) return;
      var day = dateEntry[storeId];
      if (!_isPlainObject(day)) return;
      if (day.closed) return;

      if ((day.sales_excl_tax || 0) > 0) storeBusinessDays += 1;
      var daySales = day.sales_excl_tax || 0;
      var dayCustomers = day.customer_count || 0;
      totalSales += daySales;
      totalCustomersAll += dayCustomers;
      var dayEntries = (day.staff_entries || []).filter(function (e) { return e && typeof e === "object"; });
      var paidEntries = dayEntries.filter(function (e) { return !ownerIds.has(e.staff_id || ""); });
      var isWanope = isWanopeDay(dayEntries, ownerIds);
      var dayHoursAll = dayEntries.reduce(function (s, e) { return s + (e.hours || 0); }, 0);
      totalHoursAll += dayHoursAll;
      dayEntries.forEach(function (e) {
        totalDrinksAll += e.drinks || 0;
        totalChampagneAll += _champagneAmount([e], priceMap);
        if (ownerIds.has(e.staff_id || "")) {
          ownerDrinksRaw += e.drinks || 0;
          ownerHoursRaw += e.hours || 0;
        }
      });
      var dayHoursTotal = dayHoursAll;
      paidEntries.forEach(function (entry) {
        var sid = entry.staff_id || "";
        if (!(sid in staffEntries)) return;
        var staffConf = staffById[sid] || {};
        var effRate;
        if (staffConf.training_rate) {
          var hrsBefore = cumulativeHoursBefore(sid, staffConf.alias_group, dateStr, allStaff, dailyDatasets);
          effRate = getEffectiveRate(staffConf, dateStr, hrsBefore);
        } else {
          effRate = getEffectiveRate(staffConf, dateStr);
        }
        var entryWanope = isWanope || !!entry.wanope_manual;
        staffEntries[sid].push(Object.assign({}, entry, { wanope: entryWanope, date: dateStr, effective_rate: effRate }));
        totalHours += entry.hours || 0;
        if (dayHoursTotal > 0) {
          var share = (entry.hours || 0) / dayHoursTotal;
          staffShiftSales[sid] += Math.trunc(daySales * share);
          staffShiftCustomers[sid] += Math.round(dayCustomers * share);
        } else {
          staffShiftSales[sid] += daySales;
          staffShiftCustomers[sid] += dayCustomers;
        }
      });
    });

    if (ownerDph > 0 && ownerHoursRaw > 0) {
      totalDrinksAll = totalDrinksAll - ownerDrinksRaw + Math.trunc(ownerHoursRaw * ownerDph);
    }

    var storeAvgRph = totalHoursAll > 0 ? totalSales / totalHoursAll : 0;
    var storeAvgDph = totalHoursAll > 0 ? totalDrinksAll / totalHoursAll : 0;
    var storeAvgChampPerHour = totalHoursAll > 0 ? totalChampagneAll / totalHoursAll : 0;

    var storeName = (stores[storeId] && stores[storeId].name) || storeId;

    var results = [];
    for (var si = 0; si < storeStaff.length; si++) {
      var staff = storeStaff[si];
      var sid2 = staff.id;
      var entries = staffEntries[sid2];
      var adj = await _loadAdjustment(year, month, storeId, sid2);

      var result;
      if (staff.pay_type === "monthly") {
        var siExempt = _get(adj, "social_insurance_exempt", null);
        var siOverride = (siExempt === null || siExempt === undefined) ? null : !siExempt;
        result = await calcMonthlyPayroll(staff, entries, champMenu, {
          adjustment: adj.amount || 0,
          adjustment_memo: adj.memo || "",
          absence_days: adj.absence_days || 0,
          scheduled_days: adj.scheduled_days || 0,
          adjustment_hand_delivery: adj.adjustment_hand_delivery || false,
          year: year, month: month,
          social_insurance_override: siOverride,
        });
        result.social_insurance_explicit = siExempt !== null && siExempt !== undefined;
      } else {
        result = await calcHourlyPayroll(staff, entries, champMenu);
        result.adjustment = adj.amount || 0;
        result.adjustment_memo = adj.memo || "";
        result.total = Math.max(0, result.total + (adj.amount || 0));
        var hand = staff.hand_delivery || false;
        result.transfer_amount = hand ? 0 : result.total;
        result.hand_amount = hand ? result.total : 0;
      }

      var staffHours = entries.reduce(function (s, e) { return s + (e.hours || 0); }, 0);
      var totalDrinks = entries.reduce(function (s, e) { return s + (e.drinks || 0); }, 0);
      var totalBottles = entries.reduce(function (s, e) {
        var champ = e.champagne || {};
        return s + Object.keys(champ).reduce(function (ss, k) { return ss + champ[k]; }, 0);
      }, 0);
      var champAmount = _champagneAmount(entries, priceMap);
      result.metrics = calcStoreMetrics(
        staffHours, staffShiftSales[sid2],
        totalSales, totalHoursAll,
        totalDrinks, totalBottles, champAmount,
        {
          store_avg_dph: storeAvgDph,
          store_avg_rph: storeAvgRph,
          staff_shift_customers: staffShiftCustomers[sid2],
          store_total_customers: totalCustomersAll,
          work_days: entries.length,
          store_business_days: storeBusinessDays,
          store_avg_champ_per_hour: storeAvgChampPerHour,
        }
      );
      if (!("total_hours" in result)) result.total_hours = staffHours;
      result.name = staff.name || staff.id || "";
      result.hand_delivery = staff.hand_delivery || false;
      if (staff.alias_group) result.alias_group = staff.alias_group;
      results.push(result);
    }

    // オーナーのメトリクスのみ追加(給与ゼロ・指標のみ)
    var ownerIdsArr = Array.from(ownerIds);
    for (var oi = 0; oi < ownerIdsArr.length; oi++) {
      var oid = ownerIdsArr[oi];
      var ownerStaff = allStaff[oid] || {};
      var oEntries = [];
      var oShiftSales = 0;
      var oShiftCustomers = 0;
      Object.keys(dailyData).sort().forEach(function (dateStr) {
        if (dateStr.indexOf(prefix) !== 0) return;
        var dateEntryO = dailyData[dateStr];
        if (!_isPlainObject(dateEntryO)) return;
        var day = dateEntryO[storeId];
        if (!_isPlainObject(day)) return;
        if (day.closed) return;
        var daySales = day.sales_excl_tax || 0;
        var dayCustomers = day.customer_count || 0;
        var dayEntries = (day.staff_entries || []).filter(function (e) { return e && typeof e === "object"; });
        var dayHrsAll = dayEntries.reduce(function (s, e) { return s + (e.hours || 0); }, 0);
        dayEntries.forEach(function (entry) {
          if (entry.staff_id === oid) {
            oEntries.push(Object.assign({}, entry, { date: dateStr }));
            if (dayHrsAll > 0) {
              var share = (entry.hours || 0) / dayHrsAll;
              oShiftSales += Math.trunc(daySales * share);
              oShiftCustomers += Math.round(dayCustomers * share);
            }
          }
        });
      });
      if (oEntries.length === 0) continue;
      var oHours = oEntries.reduce(function (s, e) { return s + (e.hours || 0); }, 0);
      var oDrinks = ownerDph > 0 ? Math.trunc(oHours * ownerDph) : oEntries.reduce(function (s, e) { return s + (e.drinks || 0); }, 0);
      var oBottles = oEntries.reduce(function (s, e) {
        var champ = e.champagne || {};
        return s + Object.keys(champ).reduce(function (ss, k) { return ss + champ[k]; }, 0);
      }, 0);
      var oChamp = _champagneAmount(oEntries, priceMap);
      var salaryStore = ownerStaff.salary_store_id;
      var ownerEquiv = (salaryStore === null || salaryStore === undefined || salaryStore === storeId)
        ? (ownerStaff.monthly_salary || 0) : 0;
      results.push({
        staff_id: oid,
        name: ownerStaff.name || "オーナー",
        is_owner: true,
        work_days: oEntries.length,
        total_hours: oHours,
        total: ownerEquiv,
        transfer_amount: 0,
        hand_amount: 0,
        metrics: calcStoreMetrics(
          oHours, oShiftSales,
          totalSales, totalHoursAll,
          oDrinks, oBottles, oChamp,
          {
            store_avg_dph: storeAvgDph, store_avg_rph: storeAvgRph,
            staff_shift_customers: oShiftCustomers,
            store_total_customers: totalCustomersAll,
            work_days: oEntries.length,
            store_business_days: storeBusinessDays,
            store_avg_champ_per_hour: storeAvgChampPerHour,
          }
        ),
      });
    }

    return {
      year: year, month: month, store_id: storeId,
      store_name: storeName,
      total_sales: totalSales,
      total_hours_all: totalHoursAll,
      total_customers_all: totalCustomersAll,
      total_drinks_all: totalDrinksAll,
      total_champagne_all: totalChampagneAll,
      store_business_days: storeBusinessDays,
      total_labor_cost: results.reduce(function (s, r) {
        return s + (r.is_owner ? 0 : _get(r, "labor_cost", r.total || 0));
      }, 0),
      staff_payroll: results,
    };
  }

  // get_company_ranking(routers/payroll.py)の移植。GET /payroll/{year}/{month}/ranking
  async function getCompanyRanking(year, month) {
    var stores = await getStores();
    var storesPayroll = [];
    var storeIds = Object.keys(stores);
    for (var i = 0; i < storeIds.length; i++) {
      storesPayroll.push(await getMonthlyPayroll(year, month, storeIds[i]));
    }
    return calcCompanyRanking(storesPayroll);
  }

  // set_adjustment(routers/payroll.py)の移植。
  // PUT /payroll/{year}/{month}/{store_id}/{staff_id}/adjustment
  async function setAdjustment(year, month, storeId, staffId, body) {
    await checkStoreId(storeId);
    if (_isLocked(year, month)) {
      throw new ApiError(423, year + "年" + month + "月は給与確定済みのため調整額を変更できません");
    }
    var reqBody = body || {};
    var adj = {
      amount: _get(reqBody, "amount", 0),
      memo: _get(reqBody, "memo", ""),
      absence_days: _get(reqBody, "absence_days", 0),
      scheduled_days: _get(reqBody, "scheduled_days", 0),
      adjustment_hand_delivery: _get(reqBody, "adjustment_hand_delivery", false),
      social_insurance_exempt: _get(reqBody, "social_insurance_exempt", null),
    };
    await dbPut(PAYROLL_ADJUSTMENTS_STORE, _adjustmentKey(year, month, storeId, staffId), adj);
    return adj;
  }

  root.getWanopeBonus = getWanopeBonus;
  root.getIncentiveRates = getIncentiveRates;
  root.calcDrinkBack = calcDrinkBack;
  root.calcChampagneBack = calcChampagneBack;
  root.calcTransport = calcTransport;
  root.calcIncentiveBack = calcIncentiveBack;
  root.isWanopeDay = isWanopeDay;
  root.calcSourceWithholding = calcSourceWithholding;
  root.shakaihokenApplies = shakaihokenApplies;
  root.calcMonthlyDeductions = calcMonthlyDeductions;
  root.getEffectiveRate = getEffectiveRate;
  root.cumulativeHoursBefore = cumulativeHoursBefore;
  root.calcHourlyPayroll = calcHourlyPayroll;
  root.calcAbsenceDeduction = calcAbsenceDeduction;
  root.calcMonthlyPayroll = calcMonthlyPayroll;
  root.calcStoreMetrics = calcStoreMetrics;
  root.calcCompanyRanking = calcCompanyRanking;
  root.getStaffEffectiveRate = getStaffEffectiveRate;
  root.getMonthlyPayroll = getMonthlyPayroll;
  root.getCompanyRanking = getCompanyRanking;
  root.setAdjustment = setAdjustment;

  // ルート登録順序の注意(local/daily.jsと同じ理由): 固定パス("effective-rate",
  // "ranking")は動的パス(:year/:month/:store_id)より前に登録しないと、
  // ジェネリックなパターンに横取りされる(:yearが"effective-rate"や:monthが
  // "ranking"にマッチしてしまう)。
  registerRoute("GET", "/payroll/effective-rate/:staff_id/:date", function (params) {
    return getStaffEffectiveRate(params.staff_id, params.date);
  });
  registerRoute("GET", "/payroll/:year/:month/ranking", function (params) {
    return getCompanyRanking(parseInt(params.year, 10), parseInt(params.month, 10));
  });
  registerRoute("GET", "/payroll/:year/:month/:store_id", function (params) {
    var ownerDph = params.owner_dph !== undefined ? parseFloat(params.owner_dph) : 0;
    return getMonthlyPayroll(parseInt(params.year, 10), parseInt(params.month, 10), params.store_id, ownerDph);
  });
  registerRoute("PUT", "/payroll/:year/:month/:store_id/:staff_id/adjustment", function (params, body) {
    return setAdjustment(parseInt(params.year, 10), parseInt(params.month, 10), params.store_id, params.staff_id, body);
  });
})(typeof window !== "undefined" ? window : globalThis);
