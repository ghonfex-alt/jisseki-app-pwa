// frontend/payroll.js

App.register("payroll", async function() {
  const now = new Date();
  // 10日以前は前月（締め処理中）、11日以降は当月（支払い済みで今月を確認）
  let prevMonth, prevYear;
  if (now.getDate() <= 10) {
    prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    prevYear  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  } else {
    prevMonth = now.getMonth() + 1;
    prevYear  = now.getFullYear();
  }
  const stores = await App.api("GET", "/stores");

  const main = document.getElementById("main");
  main.innerHTML = `
    <h2 style="color:#a78bfa;margin-bottom:16px;">月次給与確認</h2>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">
      <select id="pay-year" style="background:#1f2937;border:1px solid #374151;color:#f3f4f6;border-radius:6px;padding:7px;">
        ${(() => { const cur = new Date().getFullYear(); return Array.from({length: cur - 2024}, (_, i) => 2025 + i); })()
          .map(y => `<option value="${y}" ${y===prevYear?"selected":""}>${y}年</option>`).join("")}
      </select>
      <select id="pay-month" style="background:#1f2937;border:1px solid #374151;color:#f3f4f6;border-radius:6px;padding:7px;">
        ${Array.from({length:12},(_,i)=>i+1).map(m=>`<option value="${m}" ${m===prevMonth?"selected":""}>${m}月</option>`).join("")}
      </select>
      <button class="btn-primary" onclick="loadPayroll()">表示</button>
      <button onclick="exportExcel()"
        style="background:#1a3320;color:#86efac;border:1px solid #1a3320;border-radius:8px;padding:10px 20px;cursor:pointer;font-weight:700;font-size:14px;">
        📥 Excel出力
      </button>
      <button onclick="openPayrollPdf()"
        style="background:#1f2937;color:#fbbf24;border:1px solid #374151;border-radius:8px;padding:10px 20px;cursor:pointer;font-weight:700;font-size:14px;">
        📄 PDFサマリー
      </button>
      <button id="lock-btn" onclick="togglePayrollLock()"
        style="background:#1f2937;border:1px solid #374151;color:#f59e0b;border-radius:8px;padding:10px 20px;cursor:pointer;font-weight:700;font-size:14px;">
        🔓 給与確定
      </button>
    </div>
    <div id="lock-banner"></div>
    <div id="pay-tabs" style="display:flex;gap:6px;margin-bottom:16px;"></div>
    <div id="pay-content"></div>
  `;

  let activeStore = Object.keys(stores)[0];
  const tabsEl = document.getElementById("pay-tabs");
  for (const [sid, store] of Object.entries(stores)) {
    const btn = document.createElement("button");
    btn.className = `store-tab${sid===activeStore?" active":""}`;
    btn.textContent = store.name;
    btn.dataset.storeId = sid;
    btn.onclick = function() {
      document.querySelectorAll("#pay-tabs .store-tab").forEach(b => b.classList.remove("active"));
      this.classList.add("active");
      activeStore = this.dataset.storeId;
      loadPayroll();
    };
    tabsEl.appendChild(btn);
  }

  window._getPayYear = () => parseInt(document.getElementById("pay-year").value);
  window._getPayMonth = () => parseInt(document.getElementById("pay-month").value);
  window._getActiveStore = () => activeStore;

  loadPayroll();
});

async function _updateLockBanner(year, month) {
  const locks = await App.api("GET", "/payroll/locks").catch(() => ({}));
  const key   = `${year}-${String(month).padStart(2,"0")}`;
  const locked = !!(locks[key]);
  const banner = document.getElementById("lock-banner");
  const btn    = document.getElementById("lock-btn");
  if (!banner || !btn) return;
  if (locked) {
    banner.innerHTML = `<div style="background:#1c1a0e;border:1px solid #f59e0b;border-radius:8px;padding:8px 14px;margin-bottom:12px;color:#fbbf24;font-size:13px;">
      🔒 ${year}年${month}月は給与確定済みです。日次データの編集はできません。</div>`;
    btn.textContent = "🔒 確定解除";
    btn.style.color = "#f87171";
    btn.style.borderColor = "#7f1d1d";
  } else {
    banner.innerHTML = "";
    btn.textContent = "🔓 給与確定";
    btn.style.color = "#f59e0b";
    btn.style.borderColor = "#374151";
  }
}

// シフト実績(shifts.json、実績確定と同期される確定済みシフト)から、その月に
// 実際に出勤していた日数を数え、所定日数との差分を欠勤日数として自動入力する。
// 4週8休のような固定パターンの所定日数はstaff.jsonのdefault_scheduled_days
// (=「所定」欄の初期値)を基準にすればよく、ここでは追加のロジックは持たない。
async function autoCalcAbsence(staffId, year, month, storeId) {
  const note = document.getElementById(`absence-auto-note-${staffId}`);
  try {
    const shifts = await App.api("GET", `/shifts/${year}/${month}`);
    const storeShifts = shifts[storeId] || {};
    const workedDays = Object.values(storeShifts).filter(ids => Array.isArray(ids) && ids.includes(staffId)).length;

    const schedEl = document.getElementById(`sched-${staffId}`);
    const absenceEl = document.getElementById(`absence-${staffId}`);
    const schedNum = parseInt(schedEl?.value, 10);
    const scheduled = Number.isNaN(schedNum) ? 22 : schedNum;
    const absence = Math.max(0, scheduled - workedDays);

    if (absenceEl) absenceEl.value = absence;
    if (note) {
      note.textContent = `シフト実績: ${year}年${month}月の出勤${workedDays}日 → 所定${scheduled}日との差分${absence}日を欠勤欄に反映しました（保存前に内容をご確認ください）`;
      note.style.color = "#93c5fd";
    }
  } catch (e) {
    if (note) { note.textContent = `自動計算に失敗しました: ${e.message}`; note.style.color = "#f87171"; }
  }
}

async function loadPayroll() {
  const year = window._getPayYear ? window._getPayYear() : new Date().getFullYear();
  const month = window._getPayMonth ? window._getPayMonth() : new Date().getMonth() + 1;
  const storeId = window._getActiveStore ? window._getActiveStore() : "to";

  const el = document.getElementById("pay-content");
  el.innerHTML = `<div style="color:#6b7280;padding:20px;">読み込み中...</div>`;

  try {
    const data = await App.api("GET", `/payroll/${year}/${month}/${storeId}`);
    renderPayrollContent(data, year, month, storeId);
    _updateLockBanner(year, month);
  } catch(e) {
    el.innerHTML = `<div style="color:#f87171;padding:20px;">データ取得エラー: ${e.message}</div>`;
  }
}

function renderPayrollContent(data, year, month, storeId) {
  const el = document.getElementById("pay-content");
  // total_labor_costはオーナー分を含まない(staff_payroll側でオーナーは
  // 「給与ゼロ・指標のみ」の別枠として扱われているため)。Excel出力
  // (services/excel_writer.pyの_owner_labor)はここにオーナーの月給
  // (salary_store_idが自店舗の場合のみ)を足し戻しており、Web画面も
  // 同じ計算をしないと同じ月・同じ店舗で人件費/営業利益がExcelと
  // 食い違う(2026-08-12 auditloopで実データ上¥300,000の乖離を確認)。
  const ownerLabor = data.staff_payroll
    .filter(sp => sp.is_owner)
    .reduce((a, s) => a + (s.total || 0), 0);
  const totalLaborWithOwner = data.total_labor_cost + ownerLabor;
  const laborRate = data.total_sales > 0
    ? (totalLaborWithOwner / data.total_sales * 100).toFixed(1)
    : "0.0";
  const profit = data.total_sales - totalLaborWithOwner;

  const handTotal     = data.staff_payroll.reduce((a, s) => a + (s.hand_amount     || 0), 0);
  const transferTotal = data.staff_payroll.reduce((a, s) => a + (s.transfer_amount || 0), 0);
  const breakdownHtml = handTotal > 0 ? `
    <div style="font-size:11px;color:#9ca3af;margin-top:4px;">
      振込 ¥${transferTotal.toLocaleString()} / 手渡し ¥${handTotal.toLocaleString()}
    </div>` : "";

  el.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
      <div class="card" style="flex:1;min-width:140px;">
        <div class="label">総売上（税抜）</div>
        <div class="money-green" style="font-size:20px;">¥${data.total_sales.toLocaleString()}</div>
      </div>
      <div class="card" style="flex:1;min-width:140px;">
        <div class="label">人件費合計</div>
        <div class="money-red" style="font-size:20px;">¥${totalLaborWithOwner.toLocaleString()}</div>
        ${breakdownHtml}
      </div>
      <div class="card" style="flex:1;min-width:140px;">
        <div class="label">人件費率</div>
        <div style="font-size:20px;color:${parseFloat(laborRate)<50?"#34d399":"#fbbf24"};">${laborRate}%</div>
      </div>
      <div class="card" style="flex:1;min-width:140px;">
        <div class="label">営業利益</div>
        <div class="money-green" style="font-size:20px;">¥${profit.toLocaleString()}</div>
      </div>
    </div>
    <div id="staff-payroll-cards"></div>
  `;

  const container = document.getElementById("staff-payroll-cards");
  data.staff_payroll.filter(sp => !sp.is_owner).forEach(sp => {
    const isMonthly = !!sp.deductions;
    const isHandDelivery = !!sp.hand_delivery;
    const card = document.createElement("div");
    card.className = "card";
    card.style.marginBottom = "12px";

    const metricsHtml = sp.metrics ? `
      <div style="display:flex;gap:8px;margin-top:12px;">
        <div style="flex:1;background:#111827;border-radius:6px;padding:8px;text-align:center;">
          <div class="label">店平均比</div>
          <div style="font-size:10px;color:#4b5563;margin-bottom:2px;">自RPH ÷ 店RPH</div>
          <div style="font-size:18px;font-weight:700;color:${
            sp.metrics.performance_ratio >= 100 ? "#34d399" :
            sp.metrics.performance_ratio >= 70  ? "#fbbf24" : "#f87171"
          };">${sp.metrics.performance_ratio}%</div>
        </div>
        <div style="flex:1;background:#111827;border-radius:6px;padding:8px;text-align:center;">
          <div class="label">D/h</div>
          <div style="font-size:10px;color:#4b5563;margin-bottom:2px;">ドリンク÷勤務時間</div>
          <div style="font-size:18px;font-weight:700;">${sp.metrics.drinks_per_hour}</div>
        </div>
        <div style="flex:1;background:#111827;border-radius:6px;padding:8px;text-align:center;">
          <div class="label">シャンパン</div>
          <div style="font-size:10px;color:#4b5563;margin-bottom:2px;">${sp.metrics.champagne_total}本</div>
          <div style="font-size:18px;font-weight:700;color:#a78bfa;">¥${(sp.metrics.champagne_amount||0).toLocaleString()}</div>
        </div>
      </div>` : "";

    const deductionsHtml = isMonthly && sp.deductions ? `
      <div style="background:#111827;border-radius:6px;padding:10px;margin-top:8px;">
        <div class="label" style="margin-bottom:6px;">控除内訳</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:12px;">
          <div style="color:#9ca3af;">健康保険</div><div class="money-red" style="text-align:right;">-¥${sp.deductions.health_insurance.toLocaleString()}</div>
          <div style="color:#9ca3af;">子育て支援金</div><div class="money-red" style="text-align:right;">-¥${sp.deductions.childcare_support.toLocaleString()}</div>
          <div style="color:#9ca3af;">厚生年金</div><div class="money-red" style="text-align:right;">-¥${sp.deductions.pension.toLocaleString()}</div>
          <div style="color:#9ca3af;">雇用保険</div><div class="money-red" style="text-align:right;">-¥${sp.deductions.employment_insurance.toLocaleString()}</div>
          <div style="color:#9ca3af;">源泉徴収</div><div class="money-red" style="text-align:right;">-¥${sp.deductions.income_tax.toLocaleString()}</div>
          <div style="color:#f3f4f6;font-weight:700;border-top:1px solid #374151;padding-top:4px;">控除合計</div>
          <div class="money-red" style="text-align:right;font-weight:700;border-top:1px solid #374151;padding-top:4px;">-¥${sp.deductions.total.toLocaleString()}</div>
        </div>
      </div>` : "";

    const adjIsHand = !!sp.adjustment_hand_delivery;
    const adjHandCheckbox = isMonthly ? `
      <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#fbbf24;cursor:pointer;">
        <input type="checkbox" id="adj-hand-${sp.staff_id}" ${adjIsHand?"checked":""}>
        手渡し
      </label>` : "";
    // 月末退職の特例で自動計算された値がデフォルトのチェック状態。保存すると
    // この月について明示的に固定される(退職日が消し忘れられていても、翌月以降は
    // このチェックを外せば通常課税に戻せる。auto判定に永久に引きずられない)。
    // data-explicit: このスタッフ・この月に既に明示指定(手動固定)が保存済みかどうか。
    // 未指定(自動判定に従っている状態)のままなら、チェックボックスを触らずに
    // 他の調整項目だけ保存した場合はsocial_insurance_exemptをnull(自動判定のまま)
    // で送る。明示指定済み、またはチェックボックス自体を今回いじった場合のみ、
    // 表示中の値をそのまま明示指定として保存する(saveStaffPayroll参照)。
    const siExemptHtml = isMonthly ? `
      <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#f87171;cursor:pointer;margin-top:6px;">
        <input type="checkbox" id="adj-si-exempt-${sp.staff_id}" data-explicit="${sp.social_insurance_explicit?"1":"0"}" data-touched="0"
          ${sp.social_insurance_exempt?"checked":""} onchange="this.dataset.touched='1'">
        この月は社会保険（健保・厚生年金・子育て拠出金）を控除しない
        ${!sp.social_insurance_explicit ? `<span style="color:#4b5563;">（自動判定中）</span>` : ""}
      </label>` : "";
    const adjustmentHtml = `
      <div style="border-top:1px solid #374151;margin-top:10px;padding-top:10px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span class="label">${isHandDelivery ? "手渡し調整額" : "調整額"}</span>
          <span style="color:#4b5563;font-size:10px;">（税計算なし）</span>
          ${adjHandCheckbox}
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <select id="adj-sign-${sp.staff_id}"
            style="background:#1f2937;border:1px solid #374151;color:#f3f4f6;border-radius:6px;padding:6px;">
            <option value="1" ${(sp.adjustment||0)>=0?"selected":""}>+</option>
            <option value="-1" ${(sp.adjustment||0)<0?"selected":""}>−</option>
          </select>
          <input type="number" id="adj-amt-${sp.staff_id}"
            value="${Math.abs(sp.adjustment||0)}" placeholder="0" style="flex:1;">
          <input type="text" id="adj-memo-${sp.staff_id}"
            value="${sp.adjustment_memo||""}" placeholder="メモ" style="flex:2;">
        </div>
        ${siExemptHtml}
      </div>`;

    const absenceHtml = isMonthly ? `
      <div style="border-top:1px solid #374151;margin-top:10px;padding-top:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div class="label" style="margin-bottom:0;">欠勤控除 <span style="color:#4b5563;font-size:10px;">月給 ÷ 所定日数 × 欠勤日数</span></div>
          <button onclick="autoCalcAbsence('${sp.staff_id}',${year},${month},'${storeId}')"
            style="background:#1f2937;border:1px solid #374151;color:#93c5fd;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;">
            🔄 シフトから自動計算
          </button>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:4px;">
            <span style="font-size:12px;color:#9ca3af;">所定</span>
            <input type="number" id="sched-${sp.staff_id}" value="${sp.scheduled_days||22}" min="1" max="31"
              style="width:56px;text-align:center;">
            <span style="font-size:12px;color:#9ca3af;">日</span>
          </div>
          <div style="display:flex;align-items:center;gap:4px;">
            <span style="font-size:12px;color:#9ca3af;">欠勤</span>
            <input type="number" id="absence-${sp.staff_id}" value="${sp.absence_days||0}" min="0" max="31"
              style="width:56px;text-align:center;">
            <span style="font-size:12px;color:#9ca3af;">日</span>
          </div>
          <div style="font-size:13px;color:#f87171;font-weight:700;">
            ${sp.absence_deduction > 0 ? `-¥${sp.absence_deduction.toLocaleString()}` : "控除なし"}
          </div>
        </div>
        <div id="absence-auto-note-${sp.staff_id}" style="font-size:11px;color:#6b7280;margin-top:4px;"></div>
        ${sp.absence_days > 0 ? `<div style="font-size:11px;color:#6b7280;margin-top:4px;">¥${(sp.monthly_salary||0).toLocaleString()} ÷ ${sp.scheduled_days||22}日 × ${sp.absence_days}日 = ¥${(sp.absence_deduction||0).toLocaleString()}</div>` : ""}
      </div>` : "";

    const backsToggleHtml = isMonthly && (sp.drink_back_raw > 0 || sp.champagne_back_raw > 0) ? `
      <div style="margin-top:6px;font-size:11px;color:#4b5563;">
        ※ 未反映: D ¥${(sp.drink_back_raw - sp.drink_back).toLocaleString()}  /  シャンパン ¥${(sp.champagne_back_raw - sp.champagne_back).toLocaleString()}（日次入力でチェックした日のみ反映）
      </div>` : "";

    const totalLabel  = isHandDelivery ? "手渡し額" : "振込額";
    const transferAmt = sp.transfer_amount ?? (isHandDelivery ? 0 : sp.total);
    const handAmt     = sp.hand_amount ?? (isHandDelivery ? sp.total : 0);
    const splitHtml   = (transferAmt > 0 && handAmt > 0) ? `
      <div style="font-size:11px;color:#9ca3af;margin-top:2px;text-align:right;">
        振込 ¥${transferAmt.toLocaleString()} / 手渡し ¥${handAmt.toLocaleString()}
      </div>` : "";
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="color:#a78bfa;font-weight:700;font-size:15px;">
          ${sp.name}
          ${isMonthly ? `<span style="background:#1a3320;color:#4ade80;font-size:10px;padding:2px 6px;border-radius:4px;margin-left:6px;">月給</span>` : ""}
          ${isHandDelivery ? `<span style="background:#78350f;color:#fbbf24;font-size:10px;padding:2px 6px;border-radius:4px;margin-left:6px;">手渡し</span>` : ""}
        </div>
        <div>
          <div style="font-size:10px;color:#6b7280;text-align:right;">${totalLabel}</div>
          <div class="money-green" style="font-size:22px;">¥${sp.total.toLocaleString()}</div>
          ${splitHtml}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:12px;">
        <div><div class="label">出勤日数</div><div>${sp.work_days}日</div></div>
        <div><div class="label">${isMonthly?"月給手取り":"基本給"}</div><div>¥${((sp.take_home||sp.base_pay||0)).toLocaleString()}</div></div>
        <div>
          <div class="label">ドリンクバック</div>
          <div style="color:${sp.drink_back>0?"#f3f4f6":"#4b5563"};">
            ¥${sp.drink_back.toLocaleString()}
            ${sp.drink_back===0 && sp.drink_back_raw>0 ? `<span style="color:#4b5563;font-size:10px;">(¥${sp.drink_back_raw.toLocaleString()} 未反映)</span>` : ""}
          </div>
        </div>
        <div>
          <div class="label">シャンパンバック</div>
          <div style="color:${sp.champagne_back>0?"#f3f4f6":"#4b5563"};">
            ¥${sp.champagne_back.toLocaleString()}
            ${sp.champagne_back===0 && sp.champagne_back_raw>0 ? `<span style="color:#4b5563;font-size:10px;">(¥${sp.champagne_back_raw.toLocaleString()} 未反映)</span>` : ""}
          </div>
        </div>
        <div><div class="label">交通費</div><div>¥${sp.transport.toLocaleString()}</div></div>
        ${sp.wanope_days ? `<div><div class="label" style="color:#f59e0b;">ワンオペ</div><div style="color:#f59e0b;">${sp.wanope_days}日 +¥${sp.wanope_bonus.toLocaleString()}</div></div>` : ""}
        ${sp.total_hours ? `<div><div class="label">総勤務時間</div><div>${sp.total_hours}h</div></div>` : ""}
      </div>
      ${deductionsHtml}
      ${absenceHtml}
      ${backsToggleHtml}
      ${adjustmentHtml}
      <div style="margin-top:12px;">
        <div style="display:flex;gap:8px;">
          <button id="save-pay-${sp.staff_id}" onclick="saveStaffPayroll('${sp.staff_id}','${year}','${month}','${storeId}')"
            style="flex:1;background:#1f2937;border:1px solid #4b5563;color:#f3f4f6;border-radius:8px;padding:9px;cursor:pointer;font-weight:700;font-size:13px;">
            保存
          </button>
          <button onclick="openPayslipPdf('${sp.staff_id}','${year}','${month}','${storeId}')"
            style="background:#1a1f2e;border:1px solid #374151;color:#fbbf24;border-radius:8px;padding:9px 14px;cursor:pointer;font-size:12px;white-space:nowrap;">
            📄 明細PDF
          </button>
        </div>
      </div>
      ${metricsHtml}
    `;
    container.appendChild(card);
  });
}

async function saveStaffPayroll(staffId, year, month, storeId) {
  const btn     = document.getElementById(`save-pay-${staffId}`);
  const sign    = parseInt(document.getElementById(`adj-sign-${staffId}`)?.value || "1");
  const amt     = parseInt(document.getElementById(`adj-amt-${staffId}`)?.value || "0");
  const memo    = document.getElementById(`adj-memo-${staffId}`)?.value || "";
  const adjHand = document.getElementById(`adj-hand-${staffId}`)?.checked ?? false;
  const sched   = parseInt(document.getElementById(`sched-${staffId}`)?.value || "22");
  const absence = parseInt(document.getElementById(`absence-${staffId}`)?.value || "0");
  const siExemptEl = document.getElementById(`adj-si-exempt-${staffId}`);
  // チェックボックスを今回いじった場合、またはこの月に既に明示指定が保存済みの
  // 場合のみ現在の表示値を送る。触っておらず・未指定(自動判定中)のままなら
  // nullを送って退職日ベースの自動判定に委ねたままにする(他の調整項目だけの
  // 保存で自動判定を意図せず固定してしまわないように)。
  const siTouched  = siExemptEl?.dataset.touched === "1";
  const siWasExplicit = siExemptEl?.dataset.explicit === "1";
  const siExempt   = siExemptEl && (siTouched || siWasExplicit) ? siExemptEl.checked : null;

  if (btn) { btn.textContent = "保存中..."; btn.disabled = true; }
  try {
    await App.api("PUT", `/payroll/${year}/${month}/${storeId}/${staffId}/adjustment`, {
      amount:                    sign * amt,
      memo:                      memo,
      adjustment_hand_delivery:  adjHand,
      absence_days:              absence,
      scheduled_days:            sched,
      social_insurance_exempt:   siExempt,
    });
    await loadPayroll();
  } catch(e) {
    if (btn) {
      btn.textContent = "保存失敗";
      btn.style.borderColor = "#7f1d1d";
      btn.style.color = "#f87171";
      btn.disabled = false;
    }
    console.error("Save failed:", e);
    _showToast?.('⚠️ 勤怠保存失敗: ' + e.message);
  }
}

async function togglePayrollLock() {
  const year  = window._getPayYear?.()  ?? new Date().getFullYear();
  const month = window._getPayMonth?.() ?? new Date().getMonth() + 1;
  const locks = await App.api("GET", "/payroll/locks").catch(() => ({}));
  const key   = `${year}-${String(month).padStart(2,"0")}`;
  const btn   = document.getElementById("lock-btn");
  if (locks[key]) {
    if (!confirm(`${year}年${month}月の確定を解除しますか？`)) return;
    if (btn) btn.disabled = true;
    try {
      await App.api("DELETE", `/payroll/lock/${year}/${month}`);
      _showToast?.(`✅ ${year}年${month}月の確定を解除しました`);
    } catch (e) {
      _showToast?.(`⚠️ 確定解除に失敗しました: ${e.message}`);
      return;
    } finally {
      if (btn) btn.disabled = false;
    }
  } else {
    if (!confirm(`${year}年${month}月の給与を確定しますか？\n確定後は日次データを編集できなくなります。`)) return;
    if (btn) btn.disabled = true;
    try {
      await App.api("POST", `/payroll/lock/${year}/${month}`);
      _showToast?.(`🔒 ${year}年${month}月を確定しました`);
    } catch (e) {
      _showToast?.(`⚠️ 確定に失敗しました: ${e.message}`);
      return;
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  _updateLockBanner(year, month);
}

function openPayslipPdf(staffId, year, month, storeId) {
  window.open(`/export/payslip/${year}/${month}/${storeId}/${staffId}`, '_blank');
}

function openPayrollPdf() {
  const year  = window._getPayYear  ? window._getPayYear()  : new Date().getFullYear();
  const month = window._getPayMonth ? window._getPayMonth() : new Date().getMonth() + 1;
  window.open(`/export/pdf/${year}/${month}`, '_blank');
}

async function exportExcel() {
  const year  = window._getPayYear  ? window._getPayYear()  : new Date().getFullYear();
  const month = window._getPayMonth ? window._getPayMonth() : new Date().getMonth() + 1;

  try {
    _showToast("📊 Excel更新中...");
    const result = await App.api("POST", `/export/${year}/${month}`);
    _showToast(`✅ ${result.sheet} を保存しました。Excelを開いています...`);
    await App.api("POST", `/export/open/${year}`);
  } catch(e) {
    // サーバーからのエラー詳細をそのまま表示
    let msg = e.message || String(e);
    try { msg = JSON.parse(msg).detail || msg; } catch {}
    alert("Excel出力エラー:\n" + msg);
  }
}
