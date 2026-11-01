// frontend/annual.js — 年次サマリー v1

let _annualYear = new Date().getFullYear();

App.register("annual", async function(params = {}) {
  if (params.year) _annualYear = params.year;
  const main = document.getElementById("main");
  main.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:8px;">
        <button onclick="_annualNav(-1)" style="background:#374151;border:none;color:#f3f4f6;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:16px;">◀</button>
        <span style="color:#a78bfa;font-weight:700;font-size:16px;min-width:64px;text-align:center;">${_annualYear}年</span>
        <button onclick="_annualNav(1)" style="background:#374151;border:none;color:#f3f4f6;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:16px;">▶</button>
      </div>
      <button onclick="App.go('summary')" style="background:#1f2937;border:1px solid #374151;color:#9ca3af;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px;">← 月次</button>
    </div>
    <div id="annual-body" style="color:#6b7280;font-size:13px;">読み込み中...</div>`;
  try {
    await _loadAnnual(_annualYear);
  } catch(e) {
    const body = document.getElementById("annual-body");
    if (body) body.innerHTML = `<div style="color:#f87171;">読み込み失敗: ${e.message}</div>`;
  }
});

async function _loadAnnual(year) {
  const [stores, data] = await Promise.all([
    App.api("GET", "/stores"),
    App.api("GET", `/daily/${year}/annual`),
  ]);

  const body = document.getElementById("annual-body");
  if (!body) return;

  const SC = window.STORE_COLOR || {};
  const SN = window.STORE_NAME  || {};

  let combinedByMonth = {};

  const storeCards = Object.keys(stores).map(storeId => {
    const months = data[storeId] || [];
    if (!months.length) return `
      <div class="card" style="margin-bottom:20px;">
        <div style="color:${SC[storeId]||'#a78bfa'};font-weight:700;font-size:14px;margin-bottom:8px;">${escHtml(SN[storeId]||storeId)}</div>
        <div style="color:#4b5563;font-size:13px;">データなし</div>
      </div>`;

    months.forEach(m => {
      if (!combinedByMonth[m.month]) combinedByMonth[m.month] = { sales: 0, customers: 0 };
      combinedByMonth[m.month].sales     += m.sales;
      combinedByMonth[m.month].customers += m.customers;
    });

    const totalSales     = months.reduce((s, m) => s + m.sales, 0);
    const totalCustomers = months.reduce((s, m) => s + m.customers, 0);
    const totalDays      = months.reduce((s, m) => s + (m.open_days || 0), 0);
    const avgUnit        = totalCustomers > 0 ? Math.round(totalSales / totalCustomers) : 0;
    const avgDaily       = totalDays > 0 ? Math.round(totalSales / totalDays) : 0;
    const avgCust        = totalDays > 0 ? (totalCustomers / totalDays).toFixed(1) : "—";

    const rows = months.map(m => {
      const label     = parseInt(m.month.slice(5)) + "月";
      const mAvgDaily = m.open_days > 0 ? `¥${Math.round(m.sales / m.open_days).toLocaleString()}` : "—";
      const mAvgUnit  = m.customers > 0 ? `¥${Math.round(m.sales / m.customers).toLocaleString()}` : "—";
      const mAvgCust  = m.open_days > 0 ? (m.customers / m.open_days).toFixed(1) + "人" : "—";
      const dimStyle  = m.from_history ? "color:#6b7280;" : "";
      const dayCell   = m.open_days > 0 ? m.open_days + "日" : `<span style="color:#4b5563;">—</span>`;
      return `<tr>
        <td style="padding:5px 8px 5px 0;color:#9ca3af;white-space:nowrap;">${label}</td>
        <td style="text-align:right;padding:5px 8px;font-weight:600;${dimStyle}">¥${m.sales.toLocaleString()}</td>
        <td style="text-align:right;padding:5px 8px;${dimStyle}">${m.customers}人</td>
        <td style="text-align:right;padding:5px 8px;color:#6b7280;">${dayCell}</td>
        <td style="text-align:right;padding:5px 8px;color:#9ca3af;">${mAvgDaily}</td>
        <td style="text-align:right;padding:5px 8px;color:#9ca3af;">${mAvgUnit}</td>
        <td style="text-align:right;padding:5px 8px;color:#9ca3af;">${mAvgCust}</td>
      </tr>`;
    }).join("");

    return `
      <div class="card" style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
          <span style="background:${SC[storeId]||'#374151'};color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;">${escHtml(SN[storeId]||storeId)}</span>
          <span style="color:#6b7280;font-size:12px;">年間売上 <span style="color:#f3f4f6;font-weight:700;">¥${totalSales.toLocaleString()}</span></span>
          <span style="color:#6b7280;font-size:12px;">来客 <span style="color:#f3f4f6;font-weight:700;">${totalCustomers}人</span></span>
          <span style="color:#6b7280;font-size:12px;">客単価 <span style="color:#f3f4f6;">¥${avgUnit.toLocaleString()}</span></span>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="color:#4b5563;font-size:11px;border-bottom:1px solid #1f2937;">
                <th style="text-align:left;padding:3px 8px 6px 0;">月</th>
                <th style="text-align:right;padding:3px 8px 6px;white-space:nowrap;">売上</th>
                <th style="text-align:right;padding:3px 8px 6px;white-space:nowrap;">来客</th>
                <th style="text-align:right;padding:3px 8px 6px;white-space:nowrap;">日数</th>
                <th style="text-align:right;padding:3px 8px 6px;white-space:nowrap;">日平均</th>
                <th style="text-align:right;padding:3px 8px 6px;white-space:nowrap;">客単価</th>
                <th style="text-align:right;padding:3px 8px 6px;white-space:nowrap;">1日来客</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr style="border-top:1px solid #374151;">
                <td style="padding:6px 8px 0 0;color:#a78bfa;font-weight:700;">合計/平均</td>
                <td style="text-align:right;padding:6px 8px 0;color:#34d399;font-weight:700;">¥${totalSales.toLocaleString()}</td>
                <td style="text-align:right;padding:6px 8px 0;color:#f3f4f6;font-weight:700;">${totalCustomers}人</td>
                <td style="text-align:right;padding:6px 8px 0;color:#6b7280;">${totalDays > 0 ? totalDays + "日" : "—"}</td>
                <td style="text-align:right;padding:6px 8px 0;color:#9ca3af;">¥${avgDaily.toLocaleString()}</td>
                <td style="text-align:right;padding:6px 8px 0;color:#9ca3af;">¥${avgUnit.toLocaleString()}</td>
                <td style="text-align:right;padding:6px 8px 0;color:#9ca3af;">${avgCust}人</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>`;
  }).join("");

  // 全店合計カード
  const combEntries = Object.entries(combinedByMonth).sort(([a], [b]) => a.localeCompare(b));
  const combTotal   = combEntries.reduce((acc, [, v]) => ({ sales: acc.sales + v.sales, customers: acc.customers + v.customers }), { sales: 0, customers: 0 });
  const combRows    = combEntries.map(([ym, v]) => {
    const label   = parseInt(ym.slice(5)) + "月";
    const avgUnit = v.customers > 0 ? `¥${Math.round(v.sales / v.customers).toLocaleString()}` : "—";
    return `<tr>
      <td style="padding:5px 8px 5px 0;color:#9ca3af;">${label}</td>
      <td style="text-align:right;padding:5px 8px;color:#f3f4f6;font-weight:600;">¥${v.sales.toLocaleString()}</td>
      <td style="text-align:right;padding:5px 8px;color:#f3f4f6;">${v.customers}人</td>
      <td style="text-align:right;padding:5px 8px;color:#9ca3af;">${avgUnit}</td>
    </tr>`;
  }).join("");

  const combinedCard = `
    <div class="card" style="border-color:#7c3aed;background:linear-gradient(135deg,#1f1035,#111827);margin-bottom:20px;">
      <div style="color:#c4b5fd;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">全店合計</div>
      <div style="display:flex;gap:24px;align-items:baseline;margin-bottom:12px;">
        <div>
          <div style="font-size:24px;font-weight:700;color:#f3f4f6;">¥${combTotal.sales.toLocaleString()}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px;">年間売上</div>
        </div>
        <div>
          <div style="font-size:24px;font-weight:700;color:#f3f4f6;">${combTotal.customers}<span style="font-size:14px;">人</span></div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px;">年間来客</div>
        </div>
        <div>
          <div style="font-size:24px;font-weight:700;color:#f3f4f6;">¥${combTotal.customers > 0 ? Math.round(combTotal.sales / combTotal.customers).toLocaleString() : "—"}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px;">客単価</div>
        </div>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="color:#4b5563;font-size:11px;border-bottom:1px solid #374151;">
              <th style="text-align:left;padding:3px 8px 6px 0;">月</th>
              <th style="text-align:right;padding:3px 8px 6px;">全店売上</th>
              <th style="text-align:right;padding:3px 8px 6px;">全店来客</th>
              <th style="text-align:right;padding:3px 8px 6px;">客単価</th>
            </tr>
          </thead>
          <tbody>${combRows}</tbody>
        </table>
      </div>
    </div>`;

  body.innerHTML = combinedCard + storeCards;
}

function _annualNav(dir) {
  _annualYear += dir;
  App.go("annual", { year: _annualYear });
}
