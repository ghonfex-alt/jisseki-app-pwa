// frontend/summary.js — 月次サマリー v11（全店舗・カレンダービュー・全体ランキング）

let _summaryMonth = (() => {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
})();

App.register("summary", async function(params = {}) {
  if (params.year)  _summaryMonth.year  = params.year;
  if (params.month) _summaryMonth.month = params.month;

  const { year, month } = _summaryMonth;
  const main = document.getElementById("main");
  const monthLabel = `${year}年${month}月`;

  main.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      <button onclick="_summaryNav(-1)" style="background:#374151;border:none;color:#f3f4f6;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:16px;flex-shrink:0;">◀</button>
      <span style="color:#a78bfa;font-weight:700;font-size:15px;text-align:center;flex:1;">${monthLabel}</span>
      <button onclick="_summaryNav(1)" style="background:#374151;border:none;color:#f3f4f6;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:16px;flex-shrink:0;">▶</button>
      <button onclick="_checkAttendance()" id="attendance-btn"
        style="background:#1f2937;border:1px solid #374151;color:#f59e0b;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px;flex-shrink:0;">
        出勤チェック
      </button>
    </div>
    <div id="attendance-panel"></div>
    <div id="summary-body" style="color:#6b7280;font-size:13px;">読み込み中...</div>`;

  try {
    await _loadSummary(year, month);
  } catch(e) {
    const body = document.getElementById("summary-body");
    if (body) body.innerHTML = `<div style="color:#f87171;font-size:13px;">読み込み失敗: ${e.message}</div>`;
  }
});

const _SUMMARY_DOW = ["日","月","火","水","木","金","土"];
const _SC = () => window.STORE_COLOR || {};
const _SN = () => window.STORE_NAME  || {};

// 店舗名・スタッフ名はユーザーが自由に入力した文字列なので、innerHTMLに
// そのまま差し込むと "<" を含む名前(例: "<新>さくら")でレイアウトが壊れ、
// onerror付きのタグを書けば任意のHTML/JSが動いてしまう
// (settings.js::_settingsEscAttr、reflections.js::_reflEscAttrと同じ対処)。
function _sumEsc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

async function _loadSummary(year, month) {
  const ym = `${year}-${String(month).padStart(2,"0")}`;

  // dowAvgHtml/rankingは後段でしか使わないが、bulkData等と依存関係がないため
  // ここで並行して開始しておき、直列待ちによる無駄なウォーターフォールを避ける。
  const dowAvgPromise = _buildDowAvgHtml(year, month).catch(() => "");
  const rankingPromise = App.api("GET", `/payroll/${year}/${month}/ranking`);
  rankingPromise.catch(() => {}); // 実際のエラー処理は下のtry/catchで行う。ここでは
  // awaitするまでの間unhandled rejection警告が出ないようにするためだけの空catch。

  const [stores, bulkData, targets] = await Promise.all([
    App.api("GET", "/stores"),
    App.api("GET", `/daily/${year}/ym/${ym}`),
    App.api("GET", "/targets").catch(() => ({})),
  ]);
  const storeIds = Object.keys(stores);
  const _histByStore = Object.fromEntries(
    await Promise.all(storeIds.map(async id =>
      [id, await App.api("GET", `/sync/history/${id}`).catch(() => null)]
    ))
  );

  // bulk → store別の日配列（既存フォーマット互換）
  const results = storeIds.map(id =>
    Object.entries(bulkData)
      .filter(([, sm]) => sm && typeof sm === 'object' && sm[id])
      .map(([date, sm]) => ({ date, ...sm[id] }))
      .sort((a, b) => a.date.localeCompare(b.date))
  );

  const body = document.getElementById("summary-body");
  if (!body) return;

  let combinedSales = 0, combinedCustomers = 0;

  // ── 月次目標バー ─────────────────────────────────────────────
  const _tgtNow        = new Date();
  const isCurrentMonth = _tgtNow.getFullYear() === year && _tgtNow.getMonth() + 1 === month;
  const daysInMonth    = new Date(year, month, 0).getDate();
  const daysElapsed    = isCurrentMonth ? _tgtNow.getDate() : daysInMonth;
  const daysPct        = Math.round(daysElapsed / daysInMonth * 100);
  const COLORS = _SC(), NAMES = _SN();

  const targetBars = (() => {
    const bars = storeIds.map(id => {
      const tgt   = (targets[id] || {}).monthly;
      const idx   = storeIds.indexOf(id);
      const sales = results[idx].reduce((s, d) => s + (d.sales_excl_tax || 0), 0);
      const color = COLORS[id] || '#7c3aed';
      const pct   = tgt ? Math.round(sales / tgt * 100) : 0;
      const projected = (tgt && daysElapsed > 0) ? Math.round(sales / daysElapsed * daysInMonth) : 0;
      const projPct   = tgt ? Math.round(projected / tgt * 100) : 0;
      const projColor = projPct >= 100 ? '#16a34a' : projPct >= 80 ? '#f59e0b' : '#f87171';
      const barW  = Math.min(pct, 100);
      const setBtn = `<button onclick="_setTarget('${id}')" style="background:none;border:none;color:#4b5563;font-size:10px;cursor:pointer;padding:0;margin-left:6px;">✎</button>`;

      // 昨年同月
      const lyData  = (_histByStore[id]?.months || []).find(h => h.month === `${year-1}-${String(month).padStart(2,'0')}`);
      const lyRow   = lyData ? (() => {
        const lyS = lyData.sales || 0;
        const lyPct = tgt && lyS > 0 ? Math.round(lyS / tgt * 100) : null;
        const yoyPct = (sales > 0 && lyS > 0) ? Math.round(sales / lyS * 100) : null;
        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;padding-top:4px;border-top:1px solid #374151;">
          <span style="font-size:10px;color:#4b5563;">昨年同月 ¥${lyS.toLocaleString()}${lyPct ? ` (目標比${lyPct}%)` : ''}</span>
          ${yoyPct ? `<span style="font-size:10px;font-weight:700;color:${yoyPct>=100?'#34d399':'#f87171'};">前年比 ${yoyPct}%</span>` : ''}
        </div>`;
      })() : '';

      return `
        <div style="background:#1f2937;border:1px solid #374151;border-radius:8px;padding:10px 12px;flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:12px;font-weight:700;color:${color}">${_sumEsc(NAMES[id] || id)}</span>
            <span style="font-size:10px;color:#6b7280;">
              ${tgt ? `${setBtn}` : `<button onclick="_setTarget('${id}')" style="background:none;border:1px solid #374151;color:#6b7280;border-radius:4px;padding:1px 6px;font-size:10px;cursor:pointer;">目標</button>`}
            </span>
          </div>
          ${tgt ? `
          <div style="font-size:10px;color:#6b7280;margin-bottom:4px;">目標 ¥${tgt.toLocaleString()}</div>
          <div style="position:relative;background:#374151;border-radius:4px;height:6px;margin-bottom:4px;">
            <div style="background:${color};border-radius:4px;height:6px;width:${barW}%;"></div>
            ${isCurrentMonth ? `<div style="position:absolute;top:-2px;left:${daysPct}%;width:2px;height:10px;background:#6b7280;border-radius:1px;"></div>` : ''}
          </div>
          <div style="font-size:13px;font-weight:700;color:${pct>=100?'#16a34a':'#f3f4f6'};">¥${sales.toLocaleString()} <span style="font-size:11px;color:${pct>=100?'#16a34a':pct>=daysPct?'#34d399':'#f87171'}">${pct}%</span></div>
          ${isCurrentMonth ? `<div style="font-size:10px;color:${projColor};margin-top:2px;">→ ¥${projected.toLocaleString()} (${projPct}%)</div>` : ''}
          ` : ''}
          ${lyRow}
        </div>`;
    }).join('');
    return `<div style="display:flex;gap:8px;margin-bottom:12px;">${bars}</div>`;
  })();

  const currentYm = ym;

  const cards = storeIds.map((id, i) => {
    const days      = results[i];
    const openDays  = days.filter(d => !d.closed).length;
    const salesDays = days.filter(d => !d.closed && d.sales_excl_tax > 0).length;
    const sales     = days.reduce((s, d) => s + (d.sales_excl_tax || 0), 0);
    const customers = days.reduce((s, d) => s + (d.customer_count || 0), 0);
    const avgSales  = salesDays > 0 ? Math.round(sales / salesDays) : 0;
    const avgUnit   = customers > 0 ? Math.round(sales / customers) : 0;
    const avgCust   = salesDays > 0 ? (customers / salesDays).toFixed(1) : "—";

    // 2026-11-02追加: 平均滞在時間の概算(入店・退店時刻は記録していないため、
    // 延長回数[30分単位]から逆算する——基本時間＋延長回数×30分÷客数。
    // 実測ではなく概算値であることをUI側にも明記する(frontend/settings.js参照)。
    const extensionTotal = days.reduce((s, d) =>
      s + (d.staff_entries || []).reduce((s2, e) => s2 + ((e && e.extension_count) || 0), 0), 0);
    const avgStayMin = customers > 0
      ? Math.round((window.BASE_SESSION_MINUTES ?? 60) + (extensionTotal * 30 / customers))
      : null;

    combinedSales     += sales;
    combinedCustomers += customers;

    const allHist      = _histByStore[id]?.months || [];
    const lastYearYm   = `${year - 1}-${String(month).padStart(2, "0")}`;
    const lastYearData = allHist.find(h => h.month === lastYearYm);

    // 直近12ヶ月（当月除く）
    const recent12 = allHist
      .filter(h => h.month < currentYm)
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, 12);
    const avg12 = recent12.length >= 3 ? {
      sales:     Math.round(recent12.reduce((s, h) => s + (h.sales || 0), 0) / recent12.length),
      customers: Math.round(recent12.reduce((s, h) => s + (h.customers || 0), 0) / recent12.length),
      count:     recent12.length,
    } : null;

    const histRow = (sales > 0 || lastYearData) ? (() => {
      const parts = [];
      if (lastYearData) {
        const lyS = lastYearData.sales || 0;
        const lyC = lastYearData.customers || 0;
        const pct = lyS > 0 ? (sales / lyS * 100).toFixed(0) : null;
        parts.push(`<span style="color:#4b5563;font-size:10px;">前年同月</span>
          <span>売上 <span style="color:#6b7280;">¥${lyS.toLocaleString()}</span></span>
          <span>来客 <span style="color:#6b7280;">${lyC}人</span></span>
          ${pct ? `<span style="color:${pct >= 100 ? '#34d399' : '#f87171'};font-weight:700;">前年比 ${pct}%</span>` : ''}`);
      }
      if (avg12) {
        const pct12 = avg12.sales > 0 ? (sales / avg12.sales * 100).toFixed(0) : null;
        parts.push(`<span style="color:#4b5563;font-size:10px;">直近${avg12.count}ヶ月平均</span>
          <span>売上 <span style="color:#6b7280;">¥${avg12.sales.toLocaleString()}</span></span>
          <span>来客 <span style="color:#6b7280;">${avg12.customers}人</span></span>
          ${pct12 ? `<span style="color:${pct12 >= 100 ? '#34d399' : '#f87171'};font-weight:700;">${pct12}%</span>` : ''}`);
      }
      if (!parts.length) return '';
      return parts.map(p => `
        <div style="display:flex;gap:10px;font-size:11px;border-top:1px solid #1f2937;padding-top:5px;margin-top:4px;flex-wrap:wrap;align-items:center;">
          ${p}
        </div>`).join('');
    })() : "";

    return `
      <div class="card" style="flex:1;min-width:0;margin-bottom:0;">
        <div style="color:${COLORS[id]||'#a78bfa'};font-weight:700;font-size:12px;margin-bottom:8px;">${_sumEsc(stores[id].name)}</div>
        ${openDays === 0 ? `<div style="color:#4b5563;font-size:12px;">データなし</div>` : `
        <div style="font-size:16px;font-weight:700;color:#f3f4f6;margin-bottom:2px;">¥${sales.toLocaleString()}</div>
        <div style="font-size:10px;color:#6b7280;margin-bottom:6px;">累計売上</div>
        <div style="display:flex;gap:8px;font-size:11px;color:#9ca3af;flex-wrap:wrap;">
          <span>${customers}人</span>
          <span>${openDays}日</span>
          <span>単 ¥${avgUnit.toLocaleString()}</span>
          ${avgStayMin !== null ? `<span title="延長回数からの概算値（実測ではありません）">滞在 約${avgStayMin}分</span>` : ''}
        </div>
        ${histRow}`}
      </div>`;
  }).join("");

  const combined = `
    <div class="card" style="border-color:#7c3aed;background:linear-gradient(135deg,#1f1035,#111827);margin-top:8px;margin-bottom:8px;">
      <div style="display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;">
        <div style="font-size:10px;color:#c4b5fd;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-right:4px;">全店合計</div>
        <div>
          <span style="font-size:20px;font-weight:700;color:#f3f4f6;">¥${combinedSales.toLocaleString()}</span>
          <span style="font-size:10px;color:#6b7280;margin-left:4px;">売上</span>
        </div>
        <div>
          <span style="font-size:20px;font-weight:700;color:#f3f4f6;">${combinedCustomers}</span>
          <span style="font-size:10px;color:#6b7280;margin-left:2px;">人</span>
        </div>
      </div>
    </div>`;

  const dowAvgHtml = await dowAvgPromise;

  // 日別カレンダー（当月全日付を表示、データなし日はグレー）
  const today  = new Date();
  const isCurrent = year === today.getFullYear() && month === today.getMonth() + 1;
  const isFuture  = year > today.getFullYear() || (year === today.getFullYear() && month > today.getMonth() + 1);
  const endDay = isFuture ? 0 : isCurrent ? today.getDate() : new Date(year, month, 0).getDate();

  const calRows = Array.from({length: endDay}, (_, i) => {
    const day  = endDay - i;
    const date = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const dow  = _SUMMARY_DOW[new Date(date + "T00:00:00").getDay()];
    const cells = storeIds.map(sid => {
      const d     = (bulkData[date] || {})[sid];
      const color = _SC()[sid] || "#374151";
      const label = _sumEsc(_SN()[sid] || sid);   // そのままinnerHTMLに入るのでエスケープ必須
      if (!d) {
        const dowNum = new Date(date + "T00:00:00").getDay();
        const isRegularClosed = ((stores[sid] || {}).regular_closed_days || []).includes(dowNum);
        return `<span onclick="App.go('daily',{date:'${date}',storeId:'${sid}'})"
          style="display:inline-flex;align-items:center;gap:3px;padding:2px 5px;
                 border-radius:5px;cursor:pointer;opacity:${isRegularClosed ? '0.5' : '0.28'};"
          onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='${isRegularClosed ? '0.5' : '0.28'}'">
          <span style="background:${color};color:#fff;font-size:9px;font-weight:700;
                       padding:1px 4px;border-radius:3px;">${label}</span>
          ${isRegularClosed
            ? `<span style="color:#6b7280;font-size:11px;">定休日</span>`
            : `<span style="color:#4b5563;font-size:11px;">—</span>`}
        </span>`;
      }
      if (d.closed) {
        return `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 5px;opacity:0.4;">
          <span style="background:${color};color:#fff;font-size:9px;font-weight:700;
                       padding:1px 4px;border-radius:3px;">${label}</span>
          <span style="color:#f87171;font-size:11px;">休業</span>
        </span>`;
      }
      return `<span onclick="App.go('daily',{date:'${date}',storeId:'${sid}'})"
        style="display:inline-flex;align-items:center;gap:3px;padding:2px 5px;
               border-radius:5px;cursor:pointer;"
        onmouseover="this.style.background='#1f2937'" onmouseout="this.style.background=''">
        <span style="background:${color};color:#fff;font-size:9px;font-weight:700;
                     padding:1px 4px;border-radius:3px;">${label}</span>
        <span style="color:#f3f4f6;font-size:11px;font-weight:600;">¥${(d.sales_excl_tax||0).toLocaleString()}</span>
        <span style="color:#6b7280;font-size:10px;">${d.customer_count||0}人</span>
      </span>`;
    }).join("");
    const isWeekend = new Date(date + "T00:00:00").getDay() % 6 === 0;
    return `<div style="display:flex;align-items:center;padding:4px 8px;
                        border-bottom:1px solid #0f172a;
                        background:${isWeekend ? '#0d1117' : ''};">
      <span style="color:${isWeekend ? '#a78bfa' : '#6b7280'};font-size:11px;width:58px;min-width:0;flex-shrink:0;">
        ${date.slice(5)} (${dow})
      </span>
      <div style="display:flex;gap:2px;flex-wrap:wrap;min-width:0;flex:1;">${cells}</div>
    </div>`;
  }).join("");

  const calList = endDay > 0 ? `
    <div style="margin-top:4px;">
      <div style="color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;
                  letter-spacing:1px;margin-bottom:8px;">日別明細</div>
      <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;overflow:hidden;">
        ${calRows}
      </div>
    </div>` : "";

  // ── 全体ランキング（全店合算）── Excel出力(calc_company_ranking)と同一の算出元 ──
  let rankingHtml = "";
  try {
    const ranking = await rankingPromise;
    const ranked  = (ranking.ranked || []).filter(s => s.score > 0);

    if (ranked.length > 0) {
      const _fg = v => v >= 100 ? "#34d399" : v >= 70 ? "#fbbf24" : "#f87171";
      const COL = "20px 1fr 48px 60px 60px 56px";
      const rows = ranked.map((s, i) => `
        <div style="display:grid;grid-template-columns:${COL};
                    gap:3px;padding:5px 8px;border-bottom:1px solid #0f172a;
                    align-items:center;${i===0?'background:#1a1030;':''}">
          <span style="color:#6b7280;font-size:10px;text-align:center;">${i+1}</span>
          <span>
            <span style="font-size:13px;font-weight:700;color:${s.is_owner ? '#34d399' : '#f3f4f6'};">${_sumEsc(s.name)}</span>
            <span style="font-size:9px;color:#4b5563;margin-left:4px;">${s.store}</span>
          </span>
          <span style="font-size:11px;font-weight:700;color:${_fg(s.score)};text-align:right;">${s.score.toFixed(1)}</span>
          <span style="font-size:10px;color:${_fg(s.rph_ratio)};text-align:right;">${s.rph_ratio.toFixed(0)}%</span>
          <span style="font-size:10px;color:${_fg(s.drink_ratio)};text-align:right;">${s.drink_ratio.toFixed(0)}%</span>
          <span style="font-size:10px;color:#a78bfa;text-align:right;">${s.champagne_amount > 0 ? '¥'+Math.round(s.champagne_amount/1000)+'k' : '—'}</span>
        </div>`).join("");

      rankingHtml = `
        <div style="margin-top:16px;">
          <div style="color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;
                      letter-spacing:1px;margin-bottom:4px;">全スタッフ 売上貢献ランキング（全店合算）</div>
          <div style="color:#4b5563;font-size:10px;margin-bottom:8px;">
            総合 = 全店RPH比80%＋ドリンク換算比20%（ドリンク杯数＋シャン売上÷700円換算、全店平均比＝100%）。全店平均RPH ¥${ranking.company_rph.toLocaleString()}/h。Excel帳簿と同じ算出方法
          </div>
          <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;overflow:hidden;overflow-x:auto;">
            <div style="display:grid;grid-template-columns:${COL};
                        gap:3px;padding:5px 8px;background:#1f2937;">
              <span style="font-size:9px;color:#6b7280;text-align:center;">#</span>
              <span style="font-size:9px;color:#6b7280;">名前</span>
              <span style="font-size:9px;color:#6b7280;text-align:right;">総合</span>
              <span style="font-size:9px;color:#6b7280;text-align:right;">RPH比</span>
              <span style="font-size:9px;color:#6b7280;text-align:right;">D換算比</span>
              <span style="font-size:9px;color:#6b7280;text-align:right;">シャン</span>
            </div>
            ${rows}
          </div>
        </div>`;
    }
  } catch(e) {
    console.error("ranking error:", e);
    _showToast(`⚠️ ランキング読み込みエラー: ${e.message}`);
  }

  // ── 客層構成トレンド ─────────────────────────────────────────
  // 以前は特定の店舗idでしか来店者区分(visitors)を記録しておらず、その店舗id
  // 固定の実装になっていたが、店舗idは動的に作られるため、sm内のどの店舗に
  // visitorsデータがあるかで判定する(_visitorEntryヘルパー)。
  let visitorTrendHtml = "";
  try {
    const visitorEntries = Object.entries(bulkData)
      .filter(([, sm]) => _visitorEntry(sm))
      .sort(([a], [b]) => a.localeCompare(b));
    if (visitorEntries.length > 0) {
      let totalNew = 0, totalSecond = 0, totalRegular = 0;
      const dayRows = visitorEntries.map(([date, sm]) => {
        const v = _visitorEntry(sm).visitors || {};
        const n = (v.new || {}).people || 0;
        const s = (v.second || {}).people || 0;
        const r = (v.regular || {}).people || 0;
        totalNew += n; totalSecond += s; totalRegular += r;
        const total = n + s + r;
        const day = date.slice(8, 10);
        const barTotal = total || 1;
        return `<div style="display:flex;align-items:center;gap:6px;padding:0;line-height:1;">
          <span style="font-size:9px;color:#6b7280;width:22px;">${day}日</span>
          <div style="flex:1;display:flex;height:7px;border-radius:3px;overflow:hidden;background:#1f2937;">
            <div style="width:${n/barTotal*100}%;background:#34d399;"></div>
            <div style="width:${s/barTotal*100}%;background:#fbbf24;"></div>
            <div style="width:${r/barTotal*100}%;background:#7c3aed;"></div>
          </div>
          <span style="font-size:9px;color:#6b7280;width:24px;text-align:right;">${total}人</span>
        </div>`;
      }).join("");
      const grandTotal = totalNew + totalSecond + totalRegular || 1;
      const { scoreCard, trendSvg } = await _buildVisitorMonthTrend(year, month);
      const dayRowsBox = `
        <div style="flex:1;min-width:0;background:#111827;border:1px solid #1f2937;border-radius:8px;padding:8px 14px;display:flex;flex-direction:column;gap:3px;">
          ${dayRows}
        </div>`;
      const trendCol = trendSvg
        ? `<div style="flex:1;min-width:0;">${trendSvg}</div>`
        : "";
      visitorTrendHtml = `
        <div style="margin-top:16px;">
          <div style="color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">
            客層構成トレンド
          </div>
          ${scoreCard}
          <div style="color:#4b5563;font-size:10px;margin:0 0 8px;">
            今月合計: 新規${totalNew}人(${Math.round(totalNew/grandTotal*100)}%)　2回目${totalSecond}人(${Math.round(totalSecond/grandTotal*100)}%)　常連${totalRegular}人(${Math.round(totalRegular/grandTotal*100)}%)
            　<span style="color:#34d399;">■新規</span> <span style="color:#fbbf24;">■2回目</span> <span style="color:#7c3aed;">■常連</span>
          </div>
          <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;">
            ${trendCol}
            ${dayRowsBox}
          </div>
        </div>`;
    }
  } catch (e) {
    console.error("visitor trend error:", e);
    _showToast(`⚠️ 客層構成トレンドの表示に失敗しました: ${e.message}`);
  }

  const storeRow = `<div style="display:flex;gap:8px;margin-bottom:0;">${cards}</div>`;
  body.innerHTML = targetBars + storeRow + combined + dowAvgHtml + rankingHtml + visitorTrendHtml + calList;
}

// ── 客層構成トレンド: 月またぎの新規/2回目/常連 比率推移 ───────────
const _VISITOR_SERIES = [
  { key: "new",     label: "新規",   color: "#34d399" },
  { key: "second",  label: "2回目",  color: "#fbbf24" },
  { key: "regular", label: "常連",   color: "#7c3aed" },
];

// sm(1日分の{store_id: dayData})の中から来店者区分(visitors)を記録している
// 店舗のdayDataを返す。固定の'to'ではなく、window._storeIdsの並び順で
// 実際にvisitorsを持つ店舗を探す(複数店舗が同時にvisitorsを持つケースは
// 現状の入力UIでは発生しないが、念のため先着優先)。
function _visitorEntry(sm) {
  if (!sm) return null;
  for (const id of (window._storeIds || Object.keys(sm))) {
    if (sm[id] && sm[id].visitors) return sm[id];
  }
  return null;
}

async function _fetchVisitorMonths(year, month, span = 6) {
  // 対象月を含む直近 span ヶ月分を取得
  const targets = [];
  let y = year, m = month;
  for (let i = 0; i < span; i++) {
    targets.unshift({ y, m });
    m--;
    if (m < 1) { m = 12; y--; }
  }

  const results = await Promise.all(targets.map(({ y, m }) =>
    App.api("GET", `/daily/${y}/ym/${String(y)}-${String(m).padStart(2,"0")}`).catch(() => ({}))
  ));

  return targets.map(({ y, m }, i) => {
    const ym = `${y}-${String(m).padStart(2,"0")}`;
    const bulk = results[i] || {};
    const counts = { new: 0, second: 0, regular: 0 };
    for (const sm of Object.values(bulk)) {
      const entry = _visitorEntry(sm);
      const v = entry && entry.visitors;
      if (!v) continue;
      counts.new     += (v.new || {}).people || 0;
      counts.second  += (v.second || {}).people || 0;
      counts.regular += (v.regular || {}).people || 0;
    }
    const total = counts.new + counts.second + counts.regular;
    return { ym, counts, total };
  }).filter(mo => mo.total > 0);
}

function _visitorScoreCardHtml(months) {
  if (months.length === 0) return "";
  const cur = months[months.length - 1];
  const prev = months.length >= 2 ? months[months.length - 2] : null;
  const pct = (mo, key) => mo.total > 0 ? mo.counts[key] / mo.total * 100 : 0;

  const tiles = _VISITOR_SERIES.map(s => {
    const curPct = pct(cur, s.key);
    const deltaHtml = prev ? (() => {
      const d = curPct - pct(prev, s.key);
      const sign = d > 0 ? "+" : "";
      const color = d > 0 ? "#34d399" : d < 0 ? "#f87171" : "#6b7280";
      const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "―";
      return `<span style="color:${color};font-size:11px;font-weight:700;">${arrow} ${sign}${d.toFixed(1)}pt</span>`;
    })() : `<span style="color:#4b5563;font-size:11px;">前月データなし</span>`;
    return `
      <div style="flex:1;background:#111827;border:1px solid #1f2937;border-radius:8px;padding:10px 12px;">
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:4px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${s.color};display:inline-block;"></span>
          <span style="font-size:11px;color:#9ca3af;">${s.label}比率</span>
        </div>
        <div style="font-size:22px;font-weight:700;color:#f3f4f6;line-height:1.2;">${curPct.toFixed(0)}<span style="font-size:13px;color:#6b7280;">%</span></div>
        <div style="margin-top:2px;">${deltaHtml}</div>
      </div>`;
  }).join("");

  return `
    <div style="display:flex;gap:8px;margin-bottom:10px;">${tiles}</div>`;
}

async function _buildVisitorMonthTrend(year, month, span = 6) {
  const months = await _fetchVisitorMonths(year, month, span);
  if (months.length === 0) return { scoreCard: "", trendSvg: "" };
  const scoreCard = _visitorScoreCardHtml(months);
  // トレンド線は2ヶ月未満だと意味が薄いので省略
  const trendSvg = months.length < 2 ? "" : _renderVisitorTrendSvg(months);
  return { scoreCard, trendSvg };
}

function _renderVisitorTrendSvg(months) {
  const W = 320, H = 150;
  const padL = 28, padR = 8, padT = 10, padB = 22;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const stepX = months.length > 1 ? plotW / (months.length - 1) : 0;
  const xAt = i => padL + stepX * i;
  const yAt = pct => padT + plotH * (1 - pct / 100);

  // グリッド線(0/50/100%、控えめなグレー)
  const gridLines = [0, 50, 100].map(pct => `
    <line x1="${padL}" y1="${yAt(pct)}" x2="${W - padR}" y2="${yAt(pct)}"
          stroke="#1f2937" stroke-width="1" />
    <text x="${padL - 5}" y="${yAt(pct) + 3}" text-anchor="end" font-size="8" fill="#4b5563">${pct}</text>`).join("");

  const monthLabels = months.map((mo, i) => `
    <text x="${xAt(i)}" y="${H - 6}" text-anchor="middle" font-size="8" fill="#6b7280">${mo.ym.slice(5)}月</text>`).join("");

  // 系列ごとのpolyline・マーカー・終端ラベル(衝突する場合は省略して凡例に任せる)
  const endYs = _VISITOR_SERIES.map(series => {
    const last = months[months.length - 1];
    const pct = last.total > 0 ? (last.counts[series.key] / last.total * 100) : 0;
    return { series, pct, y: yAt(pct) };
  }).sort((a, b) => a.y - b.y);
  const labelOk = endYs.every((e, i) => i === 0 || Math.abs(e.y - endYs[i-1].y) >= 12);

  let seriesSvg = "";
  for (const series of _VISITOR_SERIES) {
    const pts = months.map((mo, i) => {
      const pct = mo.total > 0 ? (mo.counts[series.key] / mo.total * 100) : 0;
      return { x: xAt(i), y: yAt(pct), pct, mo };
    });
    const pointsAttr = pts.map(p => `${p.x},${p.y}`).join(" ");
    const dots = pts.map(p => `
      <circle cx="${p.x}" cy="${p.y}" r="4" fill="${series.color}" stroke="#111827" stroke-width="2">
        <title>${p.mo.ym} ${series.label}: ${p.pct.toFixed(0)}%（${p.mo.counts[series.key]}人 / 計${p.mo.total}人）</title>
      </circle>`).join("");
    const last = pts[pts.length - 1];
    const endLabel = labelOk
      ? `<text x="${last.x + 6}" y="${last.y + 3}" font-size="9" font-weight="700" fill="${series.color}">${series.label} ${last.pct.toFixed(0)}%</text>`
      : "";
    seriesSvg += `
      <polyline points="${pointsAttr}" fill="none" stroke="${series.color}" stroke-width="2"
                stroke-linejoin="round" stroke-linecap="round" />
      ${dots}${endLabel}`;
  }

  const legend = _VISITOR_SERIES.map(s => `
    <span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;">
      <span style="width:8px;height:8px;border-radius:50%;background:${s.color};display:inline-block;"></span>
      <span style="font-size:10px;color:#9ca3af;">${s.label}</span>
    </span>`).join("");

  return `
    <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:10px 14px 6px;">
      <svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible;">
        ${gridLines}
        ${seriesSvg}
        ${monthLabels}
      </svg>
      <div style="margin-top:2px;">${legend}</div>
    </div>`;
}

// ── 曜日別平均売上（店舗別・参考程度の小さい表示、閉店日は分母から除外） ──
function _dowMiniSvg(totals, counts, color) {
  const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
  if (counts.every(c => c === 0)) return "";
  const avgs = totals.map((t, i) => counts[i] > 0 ? t / counts[i] : 0);
  const maxAvg = Math.max(...avgs, 1);
  const maxIdx = avgs.indexOf(maxAvg);

  const W = 150, H = 56;
  const padL = 2, padR = 2, padT = 10, padB = 9;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const barGap = 2;
  const barW = (plotW - barGap * 6) / 7;

  const bars = avgs.map((v, i) => {
    const x = padL + i * (barW + barGap);
    const hasData = counts[i] > 0;
    const h = hasData ? Math.max((v / maxAvg) * plotH, 1) : 1;
    const y = padT + plotH - h;
    const dowColor = i === 0 ? "#f87171" : i === 6 ? "#60a5fa" : "#6b7280";
    const isPeak = hasData && i === maxIdx && v > 0;
    const valueLabel = hasData
      ? `<text x="${x + barW / 2}" y="${y - 2}" text-anchor="middle" font-size="6" font-weight="${isPeak ? 700 : 400}" fill="${isPeak ? '#f3f4f6' : '#9ca3af'}">${Math.round(v / 1000)}k</text>`
      : "";
    const title = hasData ? `<title>${DOW_LABELS[i]}曜 平均¥${Math.round(v).toLocaleString()}</title>` : "";
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="1.5" fill="${hasData ? color : '#1f2937'}">${title}</rect>
      ${valueLabel}
      <text x="${x + barW / 2}" y="${H - 1}" text-anchor="middle" font-size="6.5" fill="${dowColor}">${DOW_LABELS[i]}</text>`;
  }).join("");

  return `<svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block;">${bars}</svg>`;
}

async function _fetchDowBulkData(year, month, span = 3) {
  // 1ヶ月だけだと曜日ごとのサンプル数が2〜3件しかなく不安定なので、直近spanヶ月分を合算する
  const targets = [];
  let y = year, m = month;
  for (let i = 0; i < span; i++) {
    targets.unshift({ y, m });
    m--;
    if (m < 1) { m = 12; y--; }
  }
  const results = await Promise.all(targets.map(({ y, m }) =>
    App.api("GET", `/daily/${y}/ym/${String(y)}-${String(m).padStart(2, "0")}`).catch(() => ({}))
  ));
  const merged = {};
  for (const bulk of results) Object.assign(merged, bulk);
  return merged;
}

async function _buildDowAvgHtml(year, month) {
  const _names  = _SN(), _colors = _SC();
  const STORE_META = (window._storeIds || []).map(id => ({
    // labelはSVG/HTMLにそのまま差し込まれるためエスケープ済みの文字列を持たせる
    id, label: _sumEsc(_names[id] || id), color: _colors[id] || "#a78bfa",
  }));
  const DOW_SPAN = 3;
  const bulkData = await _fetchDowBulkData(year, month, DOW_SPAN);
  const perStore = {};
  for (const { id } of STORE_META) perStore[id] = { totals: new Array(7).fill(0), counts: new Array(7).fill(0) };

  for (const [date, stores] of Object.entries(bulkData || {})) {
    const dow = new Date(date + "T00:00:00").getDay();
    for (const { id } of STORE_META) {
      const s = stores && stores[id];
      if (s && !s.closed) {
        perStore[id].totals[dow] += s.sales_excl_tax || 0;
        perStore[id].counts[dow] += 1;
      }
    }
  }

  const cols = STORE_META.map(({ id, label, color }) => {
    const svg = _dowMiniSvg(perStore[id].totals, perStore[id].counts, color);
    if (!svg) return "";
    return `
      <div style="flex:1;min-width:0;">
        <div style="font-size:9px;color:${color};margin-bottom:2px;">${label} 曜日別平均（直近${DOW_SPAN}ヶ月）</div>
        ${svg}
      </div>`;
  }).join("");
  if (!cols.trim()) return "";

  return `
    <div style="display:flex;gap:12px;background:#111827;border:1px solid #1f2937;border-radius:8px;padding:8px 12px;margin-top:8px;margin-bottom:8px;">
      ${cols}
    </div>`;
}

function _summaryNav(dir) {
  let { year, month } = _summaryMonth;
  month += dir;
  if (month > 12) { month = 1; year++; }
  if (month < 1)  { month = 12; year--; }
  App.go("summary", { year, month });
}

async function _checkAttendance() {
  const btn   = document.getElementById("attendance-btn");
  const panel = document.getElementById("attendance-panel");
  if (!btn || !panel) return;
  if (panel.dataset.loaded === "1") {
    panel.innerHTML = "";
    panel.dataset.loaded = "";
    btn.textContent = "出勤チェック";
    return;
  }
  btn.disabled = true;
  btn.textContent = "確認中...";
  try {
    const { year, month } = _summaryMonth;
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    const [gaps, staffList] = await Promise.all([
      App.api("GET", `/shifts/gaps?ym=${ym}`),
      App.api("GET", "/staff"),
    ]);
    const NAMES = _SN();
    const nameById = {};
    for (const s of staffList) nameById[s.id] = s.name;

    let gapsHtml = `<div style="color:#f87171;font-weight:700;font-size:13px;margin-bottom:4px;">シフト予定はあったのに日報に出てこないスタッフ</div>`;
    if (gaps.length === 0) {
      gapsHtml += `<div style="color:#6b7280;font-size:12px;">今月のシフト抜けはありません</div>`;
    } else {
      // 2026-10-28修正: 以前はボタンを押すとシフト予定(shifts.json)自体からも
      // 削除していたが、確認済み日報による誤ったシフト上書き事故を受けて廃止
      // (shifts.jsonはExcel取込/シフト画面での明示編集以外では変更しない)。
      // 今はこの不足表示だけを消す。シフト予定を直したい場合はシフト画面で
      // 編集するよう案内する。
      gapsHtml += `<div style="color:#6b7280;font-size:11px;margin-bottom:8px;">ボタンを押すとこの不足表示だけ消えます(シフト予定自体は変わりません。予定を直す場合はシフト画面で編集してください)</div>`;
      gapsHtml += gaps.map(g => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1f2937;">
          <span style="font-size:13px;color:#f3f4f6;">${g.date}（${_sumEsc(NAMES[g.store_id] || g.store_id)}） ${_sumEsc(nameById[g.staff_id] || g.staff_id)}</span>
          <button onclick="_dismissShiftGap('${g.date}','${g.store_id}','${g.staff_id}')"
            style="background:#374151;border:none;color:#9ca3af;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:11px;">実際は休み・表示を消す</button>
        </div>`).join("");
    }

    panel.innerHTML = `<div style="background:#1f2937;border:1px solid #374151;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
      ${gapsHtml}
    </div>`;
    panel.dataset.loaded = "1";
    const issueCount = gaps.length;
    btn.textContent = issueCount > 0 ? `出勤チェック (${issueCount})` : "出勤チェック";
  } catch (e) {
    panel.innerHTML = `<div style="color:#f87171;font-size:12px;">確認失敗: ${e.message}</div>`;
    btn.textContent = "出勤チェック";
  } finally {
    btn.disabled = false;
  }
}

async function _dismissShiftGap(date, storeId, staffId) {
  try {
    await App.api("POST", "/shifts/gaps/dismiss", { date, store_id: storeId, staff_id: staffId });
  } catch (e) {
    _showToast?.(`⚠️ シフト抜けの解除に失敗しました: ${e.message}`);
    return;
  }
  const panel = document.getElementById("attendance-panel");
  if (panel) {
    panel.innerHTML = "";
    panel.dataset.loaded = "";
  }
  await _checkAttendance();
}

async function _setTarget(storeId) {
  const targets = await App.api("GET", "/targets").catch(() => ({}));
  const current = (targets[storeId] || {}).monthly || '';
  const result = await window.promptModal(`${_SN()[storeId] || storeId} の月次目標`, [
    { label: "月次目標（円）", value: String(current), type: "number" },
  ]);
  if (!result) return;
  const [input] = result;
  const val = parseInt(String(input).replace(/[^0-9]/g, ''));
  if (!val || val <= 0) return;
  try {
    await App.api("PUT", `/targets/${storeId}`, { monthly: val });
  } catch (e) {
    _showToast?.(`⚠️ 目標の保存に失敗しました: ${e.message}`);
    return;
  }
  await _loadSummary(_summaryMonth.year, _summaryMonth.month);
}
