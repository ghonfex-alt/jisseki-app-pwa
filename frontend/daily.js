// frontend/daily.js

// 2026-10-30バグハントで指摘(確定): reflections.js/nippo-log.js/register.js/
// shishamart.js/shishamart-expenses.jsは全て専用のHTMLエスケープ関数を持つが、
// daily.jsだけ無く、スタッフ名をinnerHTMLへ無エスケープで埋め込んでいた
// (現状はオーナーが設定画面から入力する名前のみが経路のためセルフXSS範囲だが、
// 他ファイルとの一貫性のため追加する)。
function _dailyEsc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

let _dailyDirty = false;

function _dailyMarkDirty() {
  if (_dailyDirty) return;
  _dailyDirty = true;
  const btn = document.getElementById("save-btn");
  if (btn) btn.textContent = "保存 ●";
}

// ユーザーが実際にその欄を編集した(＝値を確定させる意思がある)ことを記録する。
// _dailyState.data自体がPUTボディそのものなので、ここに積んでおけばsaveDay側で
// 何もしなくても送信される。
function _dailyMarkFieldEdited(field) {
  if (!Array.isArray(_dailyState.data._edited_fields)) _dailyState.data._edited_fields = [];
  if (!_dailyState.data._edited_fields.includes(field)) _dailyState.data._edited_fields.push(field);
}

function _dailyMarkClean() {
  _dailyDirty = false;
}

let _dailyState = {
  date: _todayStr(),
  storeId: null,  // App.register("daily", ...)がApp.currentStore/window._storeIdsから設定する
  stores: null,
  staff: null,
  data: null,
};

function _todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function _weekdayStr(dateStr) {
  return ["日","月","火","水","木","金","土"][new Date(dateStr + "T00:00:00").getDay()];
}

function _dailyGetRate(staff, dateStr) {
  // 2026-10-26整理: 唯一の実装元(app.js::getEffectiveRate)に委譲。
  return getEffectiveRate(staff, dateStr, _dailyState.trainingRateCache);
}

function _dailyIsWanope() {
  const s = _dailyState;
  const entries = (s.data?.staff_entries || []).filter(e => e && typeof e === 'object');
  const ownerIn = entries.some(e => s.staff?.find(x => x.id === e.staff_id)?.is_owner);
  const paid = entries.filter(e => !s.staff?.find(x => x.id === e.staff_id)?.is_owner);
  return paid.length === 1 && !ownerIn;
}

App.register("daily", async function(params = {}) {
  _dailyDirty = false;
  if (params.date) _dailyState.date = params.date;
  if (params.storeId) _dailyState.storeId = params.storeId;
  if (!_dailyState.storeId) _dailyState.storeId = App.currentStore || (window._storeIds || [])[0] || null;

  const [stores, allStaff] = await Promise.all([
    App.api("GET", "/stores"),
    App.api("GET", "/staff"),
  ]);
  _dailyState.stores = stores;
  _dailyState.staff = allStaff;

  // 研修時給(training_rate)スタッフの当日有効単価を事前フェッチしてキャッシュする。
  // レンダリング前にawaitすることで、初回表示から正しい単価が出る
  // (rate_historyだけを見ていた旧実装は累計勤務時間を知らず、卒業後も
  // 見積もり額が古い単価のままになるバグがあった)。
  _dailyState.trainingRateCache = {};
  const trainingStaff = allStaff.filter(st => st.pay_type === "hourly" && st.training_rate);
  if (trainingStaff.length) {
    const rates = await Promise.all(trainingStaff.map(st =>
      App.api("GET", `/payroll/effective-rate/${st.id}/${_dailyState.date}`).catch(() => null)
    ));
    trainingStaff.forEach((st, i) => {
      if (rates[i] && typeof rates[i].rate === "number") {
        _dailyState.trainingRateCache[`${st.id}|${_dailyState.date}`] = rates[i].rate;
      }
    });
  }

  const year = parseInt(_dailyState.date.split("-")[0]);
  const [dayData, images] = await Promise.all([
    App.api("GET", `/daily/${year}/${_dailyState.date}/${_dailyState.storeId}`),
    fetch(`${API}/upload/list/${_dailyState.date}`).then(r => r.json()).catch(() => []),
  ]);
  _dailyState.data = dayData;
  // _user_editedは「保存ボタンを押したことがあるか」だけを見る粗いフラグで、
  // 出勤者だけ入力して保存した場合など、売上欄を一切さわっていなくても
  // 一律に立ってしまう。それだと「本当に0円だった」のか「まだ売上を
  // 入力していないだけ」なのかsync側で区別できず、意図せず0円が永久保護
  // されたり、逆に本物の0円が後からsyncで上書きされたりしうる。
  // _edited_fieldsで実際に手で触った欄だけを個別に記録し、区別できるようにする。
  // 判定自体はapp.js::getEditedFieldsSet(唯一の実装元)に委譲する。
  if (!Array.isArray(_dailyState.data._edited_fields)) {
    _dailyState.data._edited_fields = Array.from(getEditedFieldsSet(_dailyState.data));
  }
  if (_dailyState.data.staff_entries) {
    _dailyState.data.staff_entries = _dailyState.data.staff_entries.filter(e => e && typeof e === 'object');
  }
  _dailyState.images = images;

  _renderDailyScreen();
});

function _renderDailyScreen() {
  const s = _dailyState;
  const selectedIds = (s.data.staff_entries || []).filter(e => e && typeof e === 'object').map(e => e.staff_id);
  // is_owner は全店表示（store_idに依らず出勤チップに常時表示）。
  // 非アクティブになったスタッフでも、この日に既に記録が残っている場合は
  // チップごと消えると給与未反映に気づけないため表示だけは残す
  // （新規追加は選べないよう toggleStaff 側でガードする）。
  const allStoreStaff = s.staff
    .filter(st => (st.active || selectedIds.includes(st.id)) && (st.store_id === s.storeId || st.is_owner))
    .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
  const storeStaff = [
    ...allStoreStaff.filter(st => !st.pin_last),
    ...allStoreStaff.filter(st => st.pin_last),
  ];

  const main = document.getElementById("main");
  main.innerHTML = `
    <div class="store-tabs" id="store-tabs"></div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      <button onclick="navigateDay(-1)" style="background:#374151;border:none;color:#f3f4f6;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:18px;">◀</button>
      <div style="flex:1;text-align:center;position:relative;">
        <div onclick="openDatePicker()" style="color:#7c3aed;font-weight:700;font-size:16px;cursor:pointer;user-select:none;" title="クリックでカレンダーを開く">
          ${s.date} (${_weekdayStr(s.date)}) 📅
        </div>
        <input type="date" id="date-picker" value="${s.date}"
          onchange="jumpToDate(this.value)"
          style="position:absolute;opacity:0;pointer-events:none;top:0;left:50%;width:1px;height:1px;">
      </div>
      <button onclick="navigateDay(1)" style="background:#374151;border:none;color:#f3f4f6;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:18px;">▶</button>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:-8px;margin-bottom:16px;">
      <button onclick="resetDay()" id="reset-day-btn"
        style="background:#1f2937;border:1px solid #92400e55;color:#fbbf24;font-size:11px;
               padding:4px 10px;border-radius:4px;cursor:pointer;"
        title="この日・この店舗のローカルデータをクリアする">
        ↩ リセット
      </button>
    </div>

    ${s.images && s.images.length ? `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">写真 ${s.images.length}枚</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${s.images.map(img => `
          <div style="position:relative;">
            <img src="${API}${img.url}" onclick="viewImage('${API}${img.url}')"
              style="width:80px;height:80px;object-fit:cover;border-radius:8px;cursor:pointer;border:2px solid #374151;">
            <button onclick="deleteImage('${img.url.split('/').slice(-2).join('/')}',this)"
              style="position:absolute;top:-4px;right:-4px;background:#f87171;border:none;color:#fff;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;line-height:18px;padding:0;">✕</button>
          </div>`).join("")}
      </div>
    </div>` : ""}

    <div class="card" style="margin-bottom:12px;">
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;cursor:pointer;">
        <input type="checkbox" id="closed-cb" ${s.data.closed?"checked":""}
          onchange="toggleClosed(this.checked)" style="width:16px;height:16px;">
        <span style="color:#f87171;font-weight:600;">臨時休業</span>
      </label>
      <div id="open-content" ${s.data.closed?'style="display:none"':""}>
        <div style="display:flex;gap:10px;margin-bottom:12px;">
          ${(() => {
            const edited = s.data._edited_fields || [];
            const fieldLabel = (label, field) => `<div class="label">${label}${edited.includes(field)
              ? ` <span style="color:#4ade80;font-size:9px;font-weight:700;" title="この欄は手入力で確定済み(syncで上書きされません)">✓確定</span>` : ""}</div>`;
            // 未入力(0がデフォルト値として入っているだけで、まだ誰も触っていない)の欄は
            // 空欄で表示する。「0と入力した」のか「まだ何も入力していない」のかを
            // 見分けられないと、リセット直後の画面が「0円だった」ように誤解される。
            // 実際に0円だったと確定させた場合は_edited_fieldsに乗るのでその時だけ0を表示する。
            const dispVal = (field) => {
              const v = s.data[field];
              return (v || edited.includes(field)) ? (v ?? "") : "";
            };
            return `
          <div style="flex:2;">
            ${fieldLabel("売上（税抜）", "sales_excl_tax")}
            <input type="number" id="f-sales" value="${dispVal("sales_excl_tax")}"
              placeholder="0" tabindex="1"
              onchange="_dailyState.data.sales_excl_tax = parseInt(this.value)||0; _dailyMarkFieldEdited('sales_excl_tax'); _dailyMarkDirty()">
          </div>
          <div style="flex:2;">
            ${fieldLabel("カード", "card_sales")}
            <input type="number" id="f-card" value="${dispVal("card_sales")}"
              placeholder="0" tabindex="2"
              onchange="_dailyState.data.card_sales = parseInt(this.value)||0; _dailyMarkFieldEdited('card_sales'); _dailyMarkDirty()">
          </div>
          <div style="flex:1;">
            ${fieldLabel("客数", "customer_count")}
            <input type="number" id="f-customers" value="${dispVal("customer_count")}"
              placeholder="0" tabindex="3"
              onchange="_dailyState.data.customer_count = parseInt(this.value)||0; _dailyMarkFieldEdited('customer_count'); _dailyMarkDirty()">
          </div>`;
          })()}
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span class="label" style="margin-bottom:0;">出勤者</span>
          <span id="wanope-badge" style="display:${(()=>{
          const entries = (s.data.staff_entries||[]).filter(e=>e && typeof e === 'object');
          const ownerIn = entries.some(e=>s.staff.find(x=>x.id===e.staff_id)?.is_owner);
          const paid = entries.filter(e=>!s.staff.find(x=>x.id===e.staff_id)?.is_owner);
          return paid.length===1 && !ownerIn?"inline":"none";
        })()};background:#f59e0b;color:#111;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;">ワンオペ +¥200/h</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
          ${storeStaff.map((st, i) => {
            const prevSt = storeStaff[i - 1];
            const divider = st.pin_last && prevSt && !prevSt.pin_last
              ? `<span style="width:1px;height:28px;background:#374151;margin:0 4px;"></span>`
              : "";
            return `${divider}<button class="staff-chip ${selectedIds.includes(st.id)?"active":""}"
              id="chip-${st.id}" onclick="toggleStaff('${st.id}')"
              style="${st.active ? "" : "opacity:.6;"}" title="${st.active ? "" : "退職・非アクティブ"}">
              ${_dailyEsc(st.name)}${st.active ? "" : " (元)"}
            </button>`;
          }).join("")}
        </div>
        <div id="staff-inputs"></div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn-primary" id="save-btn" style="flex:1;" onclick="saveDay()">
            保存
          </button>
          <button id="next-btn" onclick="saveAndNext()"
            style="flex:2;background:#1f2937;border:1px solid #374151;color:#f3f4f6;border-radius:8px;padding:10px;cursor:pointer;font-weight:700;">
            次の日へ（Enter）
          </button>
        </div>
      </div>
    </div>
  `;

  // 店舗タブ
  const tabsEl = document.getElementById("store-tabs");
  for (const [sid, store] of Object.entries(s.stores)) {
    const btn = document.createElement("button");
    btn.className = `store-tab${sid === s.storeId ? " active" : ""}`;
    btn.textContent = store.name;
    btn.onclick = () => App.go("daily", {date: s.date, storeId: sid});
    tabsEl.appendChild(btn);
  }

  _renderStaffInputs();
  _setupKeys();
}

function _renderStaffInputs() {
  const s = _dailyState;
  const champ = s.stores[s.storeId]?.champagne_menu || [];
  const selectedIds = (s.data.staff_entries || []).filter(e => e && typeof e === 'object').map(e => e.staff_id);
  // is_owner はstore_idに関わらず、選択されていれば入力フォームを表示。
  // 非アクティブでも選択済み（＝記録が残っている）なら入力欄は出す。
  const storeStaff = s.staff.filter(
    st => selectedIds.includes(st.id)
      && (st.store_id === s.storeId || st.is_owner)
  );

  const container = document.getElementById("staff-inputs");
  if (!container) return;
  container.innerHTML = "";

  const wanope = _dailyIsWanope();
  let tabIdx = 4;
  storeStaff.forEach((st, idx) => {
    const entry = (s.data.staff_entries || []).filter(e => e && typeof e === 'object').find(e => e.staff_id === st.id) || {
      staff_id: st.id, hours: "", drinks: 0, champagne: {}, okuri: false,
      include_drink: false, include_champagne: false
    };
    const isOwner = !!st.is_owner;
    const total = _calcEntryTotal(st, entry, champ, (wanope || entry.wanope_manual) && !isOwner);

    const el = document.createElement("div");
    el.className = "card";
    el.style.cssText = "margin-bottom:8px;border-left:3px solid #7c3aed;";

    const isLast = idx === storeStaff.length - 1;
    // オーナー入力: 時間・ドリンク・シャンパンを記録（バック計算・送りは不要）
    const ownerInputHtml = isOwner ? `
      <div style="display:flex;gap:10px;margin-bottom:10px;">
        <div style="flex:1;">
          <div class="label">勤務時間</div>
          <input type="number" step="0.5" min="0" id="hours-${st.id}"
            value="${entry.hours||""}" placeholder="0" tabindex="${tabIdx++}"
            oninput="onStaffInput('${st.id}','hours',parseFloat(this.value)||0)">
        </div>
        <div style="flex:1;">
          <div class="label">ドリンク（杯）</div>
          <input type="number" min="0" id="drinks-${st.id}"
            value="${entry.drinks||""}" placeholder="0" tabindex="${tabIdx++}"
            oninput="onStaffInput('${st.id}','drinks',parseInt(this.value)||0)"
            ${isLast ? `onkeydown="if(event.key==='Tab'){event.preventDefault();saveAndNext();}"` : ""}>
        </div>
      </div>
      <div class="label" style="margin-bottom:6px;">シャンパン</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:4px;">
        ${champ.map(c => {
          const cnt = entry.champagne?.[c.id] || 0;
          return `<div style="display:flex;align-items:center;gap:2px;margin-bottom:4px;">
            <button onclick="cycleChamp('${st.id}','${c.id}',-1)"
              style="background:#374151;border:none;color:#f3f4f6;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:14px;line-height:1;">−</button>
            <button class="champ-btn ${cnt>0?"selected":""}" id="champ-${st.id}-${c.id}"
              onclick="cycleChamp('${st.id}','${c.id}',1)" style="min-width:56px;">
              <div style="font-size:11px;">${_dailyEsc(c.name)}</div>
              <div style="font-size:9px;opacity:0.7;">¥${(c.price||0).toLocaleString()}</div>
              <div style="font-weight:700;margin-top:2px;" id="champ-cnt-${st.id}-${c.id}">×${cnt}</div>
            </button>
            <button onclick="cycleChamp('${st.id}','${c.id}',1)"
              style="background:#374151;border:none;color:#f3f4f6;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:14px;line-height:1;">＋</button>
          </div>`;
        }).join("")}
      </div>` : "";
    el.innerHTML = isOwner ? `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="color:#6b7280;font-weight:700;font-size:12px;">${_dailyEsc(st.name)} <span style="color:#4b5563;font-size:10px;">（オーナー・集計のみ）</span></div>
      </div>
      ${ownerInputHtml}
    ` : `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="color:#a78bfa;font-weight:700;">${_dailyEsc(st.name)}${st.active ? "" : ` <span style="color:#f87171;font-size:11px;font-weight:400;">(元・非アクティブ)</span>`}</div>
        <div class="money-green" id="total-${st.id}">¥${total.toLocaleString()}</div>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:10px;">
        <div style="flex:1;">
          <div class="label">勤務時間</div>
          <input type="number" step="0.5" min="0" id="hours-${st.id}"
            value="${entry.hours||""}" placeholder="0" tabindex="${tabIdx++}"
            oninput="onStaffInput('${st.id}','hours',parseFloat(this.value)||0)">
        </div>
        <div style="flex:1;">
          <div class="label">ドリンク（杯）</div>
          <input type="number" min="0" id="drinks-${st.id}"
            value="${entry.drinks||""}" placeholder="0" tabindex="${tabIdx++}"
            oninput="onStaffInput('${st.id}','drinks',parseInt(this.value)||0)"
            ${isLast ? `onkeydown="if(event.key==='Tab'){event.preventDefault();saveAndNext();}"` : ""}>
        </div>
      </div>
      <div class="label" style="margin-bottom:6px;">シャンパン</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;">
        ${champ.map(c => {
          const cnt = entry.champagne?.[c.id] || 0;
          return `<div style="display:flex;align-items:center;gap:2px;margin-bottom:4px;">
            <button onclick="cycleChamp('${st.id}','${c.id}',-1)"
              style="background:#374151;border:none;color:#f3f4f6;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:14px;line-height:1;">−</button>
            <button class="champ-btn ${cnt>0?"selected":""}" id="champ-${st.id}-${c.id}"
              onclick="cycleChamp('${st.id}','${c.id}',1)"
              style="min-width:56px;">
              <div style="font-size:11px;">${_dailyEsc(c.name)}</div>
              <div style="font-size:9px;opacity:0.7;">¥${(c.price||0).toLocaleString()}</div>
              <div style="font-weight:700;margin-top:2px;" id="champ-cnt-${st.id}-${c.id}">×${cnt}</div>
            </button>
            <button onclick="cycleChamp('${st.id}','${c.id}',1)"
              style="background:#374151;border:none;color:#f3f4f6;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:14px;line-height:1;">＋</button>
          </div>`;
        }).join("")}
      </div>
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
        <input type="checkbox" id="okuri-${st.id}" ${entry.okuri?"checked":""}
          onchange="onStaffInput('${st.id}','okuri',this.checked)">
        <span style="font-size:12px;color:#9ca3af;">送りあり（片道のみ）</span>
      </label>
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px;">
        <input type="checkbox" id="wanope-manual-${st.id}" ${entry.wanope_manual?"checked":""}
          onchange="_dailyToggleWanope('${st.id}',this.checked)">
        <span style="font-size:12px;color:#f59e0b;">ワンオペ扱いにする（+¥${window.WANOPE_BONUS||200}/h）</span>
      </label>
      ${st.pay_type === "monthly" ? `
      <div style="display:flex;gap:12px;margin-top:8px;padding-top:8px;border-top:1px solid #374151;">
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
          <input type="checkbox" id="inc-drink-${st.id}" ${entry.include_drink?"checked":""}
            onchange="onStaffInput('${st.id}','include_drink',this.checked)">
          <span style="font-size:12px;color:#a78bfa;">ドリンクバック反映</span>
        </label>
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
          <input type="checkbox" id="inc-champ-${st.id}" ${entry.include_champagne?"checked":""}
            onchange="onStaffInput('${st.id}','include_champagne',this.checked)">
          <span style="font-size:12px;color:#a78bfa;">シャンパンバック反映</span>
        </label>
      </div>` : ""}
    `;
    container.appendChild(el);
  });
}

function _calcEntryTotal(staff, entry, champMenu, wanope = false) {
  // 2026-10-26整理: 唯一の実装元(app.js::calcStaffDayTotal)に委譲。
  return calcStaffDayTotal(staff, entry, champMenu, wanope, _dailyState.date, _dailyState.trainingRateCache);
}

function _getOrCreateEntry(staffId) {
  const s = _dailyState;
  if (!s.data.staff_entries) s.data.staff_entries = [];
  let entry = s.data.staff_entries.find(e => e.staff_id === staffId);
  if (!entry) {
    entry = {staff_id: staffId, hours: 0, drinks: 0, champagne: {}, okuri: false};
    s.data.staff_entries.push(entry);
  }
  return entry;
}

function onStaffInput(staffId, field, value) {
  const s = _dailyState;
  const entry = _getOrCreateEntry(staffId);
  entry[field] = value;
  _dailyMarkDirty();
  const st = s.staff.find(st => st.id === staffId);
  const champ = s.stores[s.storeId]?.champagne_menu || [];
  const isOwner = !!st?.is_owner;
  const total = _calcEntryTotal(st, entry, champ, (_dailyIsWanope() || entry.wanope_manual) && !isOwner);
  const el = document.getElementById(`total-${staffId}`);
  if (el) el.textContent = `¥${total.toLocaleString()}`;
}

function _dailyToggleWanope(staffId, checked) {
  const s = _dailyState;
  const entry = _getOrCreateEntry(staffId);
  entry.wanope_manual = checked;
  _dailyMarkDirty();
  const st = s.staff.find(st => st.id === staffId);
  const champ = s.stores[s.storeId]?.champagne_menu || [];
  const isOwner = !!st?.is_owner;
  const total = _calcEntryTotal(st, entry, champ, (_dailyIsWanope() || entry.wanope_manual) && !isOwner);
  const el = document.getElementById(`total-${staffId}`);
  if (el) el.textContent = `¥${total.toLocaleString()}`;
}

function cycleChamp(staffId, champId, dir = 1) {
  const s = _dailyState;
  _dailyMarkDirty();
  const entry = _getOrCreateEntry(staffId);
  if (!entry.champagne) entry.champagne = {};
  const cur = entry.champagne[champId] || 0;
  const next = Math.max(0, cur + dir);
  if (next === 0) delete entry.champagne[champId];
  else entry.champagne[champId] = next;

  const btn = document.getElementById(`champ-${staffId}-${champId}`);
  if (btn) {
    const cntEl = document.getElementById(`champ-cnt-${staffId}-${champId}`) || btn.querySelector("div:last-child");
    if (cntEl) cntEl.textContent = `×${next}`;
    btn.classList.toggle("selected", next > 0);
  }
  const st = s.staff.find(st => st.id === staffId);
  const champ = s.stores[s.storeId]?.champagne_menu || [];
  const isOwner = !!st?.is_owner;
  const total = _calcEntryTotal(st, entry, champ, (_dailyIsWanope() || entry.wanope_manual) && !isOwner);
  const el = document.getElementById(`total-${staffId}`);
  if (el) el.textContent = `¥${total.toLocaleString()}`;
}

function toggleStaff(staffId) {
  const s = _dailyState;
  if (!s.data.staff_entries) s.data.staff_entries = [];
  const idx = s.data.staff_entries.findIndex(e => e.staff_id === staffId);
  if (idx < 0) {
    // 非アクティブなスタッフは既存記録がある場合のみチップが出るが、
    // 新規追加(=まだ記録が無い状態からON)はここでブロックする。
    const st = s.staff.find(x => x.id === staffId);
    if (st && !st.active) {
      _showToast?.("⚠️ 退職・非アクティブなスタッフです。追加するには先にスタッフ設定で復帰させてください。");
      return;
    }
  }
  _dailyMarkDirty();
  if (idx >= 0) {
    s.data.staff_entries.splice(idx, 1);
  } else {
    s.data.staff_entries.push({
      staff_id: staffId, hours: 0, drinks: 0, champagne: {}, okuri: false
    });
  }
  const chip = document.getElementById(`chip-${staffId}`);
  if (chip) chip.classList.toggle("active");
  const badge = document.getElementById("wanope-badge");
  if (badge) {
    const entries   = s.data.staff_entries || [];
    const ownerIn   = entries.some(e => s.staff.find(x => x.id === e.staff_id)?.is_owner);
    const paidCount = entries.filter(e => !s.staff.find(x => x.id === e.staff_id)?.is_owner).length;
    badge.style.display = paidCount === 1 && !ownerIn ? "inline" : "none";
  }
  _renderStaffInputs();
}

function toggleClosed(closed) {
  _dailyMarkDirty();
  _dailyState.data.closed = closed;
  const el = document.getElementById("open-content");
  if (el) el.style.display = closed ? "none" : "";
}

// 削除・リセット処理中は保存/ページ送りと競合させない(互いに古いデータで
// 上書きし合うのを防ぐ)。ボタン操作全般に効くシンプルな排他フラグ。
let _dailyBusy = false;

function _dailyApiErrMsg(e) {
  let msg = e.message || String(e);
  try { msg = JSON.parse(msg).detail || msg; } catch {}
  return msg;
}

async function saveDay() {
  if (_dailyBusy) return;
  const s = _dailyState;
  const year = parseInt(s.date.split("-")[0]);
  const btn = document.getElementById("save-btn");
  try {
    await App.api("PUT", `/daily/${year}/${s.date}/${s.storeId}`, s.data);
    _dailyMarkClean();
    if (btn) {
      btn.textContent = "✓ 保存済";
      btn.style.background = "#166534";
      setTimeout(() => { btn.textContent = "保存"; btn.style.background = ""; }, 2000);
    }
  } catch(e) {
    if (btn) { btn.textContent = "保存失敗"; btn.style.background = "#7f1d1d"; }
    console.error("Save failed:", e);
    _showToast('⚠️ 日次保存失敗: ' + _dailyApiErrMsg(e));
  }
}

async function resetDay() {
  if (_dailyBusy) return;
  const s = _dailyState;
  const storeName = (s.stores[s.storeId] || {}).name || s.storeId;
  if (!confirm(`${s.date}（${storeName}）のローカルデータをリセットします。\n元に戻せません。よろしいですか？`)) return;
  _dailyBusy = true;
  const resetBtn = document.getElementById("reset-day-btn");
  if (resetBtn) resetBtn.disabled = true;
  const year = parseInt(s.date.split("-")[0]);
  try {
    await App.api("POST", `/daily/${year}/${s.date}/${s.storeId}/reset`);
    _dailyMarkClean();
    _showToast?.(`↩ ${s.date}（${storeName}）をリセットしました`);
    // App.go(GET再取得)だと、直後の同一URLへのGETがブラウザ側で稀に
    // キャッシュから返り、消えたはずのデータが残って見えることがあるため、
    // サーバーの実データ形状(空の日)をそのままローカルに反映して再描画する。
    s.data = { closed: false, sales_excl_tax: 0, customer_count: 0, card_sales: 0, staff_entries: [] };
    _renderDailyScreen();
  } catch(e) {
    _showToast?.('⚠️ リセット失敗: ' + _dailyApiErrMsg(e));
  } finally {
    _dailyBusy = false;
    // 2026-10-30バグハントで指摘(Important): 失敗時にボタンが無効化されたまま
    // 戻らず、その日の画面内では二度と押せなくなっていた(他の画面は全て
    // finally/catchで.disabledを戻す一貫した実装になっている)。
    if (resetBtn) resetBtn.disabled = false;
  }
}

async function saveAndNext() {
  if (_dailyBusy) return;
  const s = _dailyState;
  const year = parseInt(s.date.split("-")[0]);
  try {
    await App.api("PUT", `/daily/${year}/${s.date}/${s.storeId}`, s.data);
  } catch(e) {
    _showToast("⚠️ 保存失敗。ネット接続を確認してください");
    return;
  }
  const d = new Date(s.date + "T00:00:00");
  d.setDate(d.getDate() + 1);
  const next = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  App.go("daily", {date: next, storeId: s.storeId});
}

async function navigateDay(delta) {
  if (_dailyBusy) return;
  if (_dailyDirty) {
    const s = _dailyState;
    const year = parseInt(s.date.split("-")[0]);
    try {
      await App.api("PUT", `/daily/${year}/${s.date}/${s.storeId}`, s.data);
    } catch(e) {
      _showToast("⚠️ 保存失敗。ネット接続を確認してください");
      return;
    }
  }
  const d = new Date(_dailyState.date + "T00:00:00");
  d.setDate(d.getDate() + delta);
  const next = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  App.go("daily", {date: next, storeId: _dailyState.storeId});
}

function openDatePicker() {
  const picker = document.getElementById("date-picker");
  if (!picker) return;
  picker.style.pointerEvents = "auto";
  picker.showPicker ? picker.showPicker() : picker.click();
  picker.style.pointerEvents = "none";
}

function jumpToDate(dateStr) {
  if (!dateStr) return;
  App.go("daily", {date: dateStr, storeId: _dailyState.storeId});
}

function viewImage(url) {
  const modal = document.createElement("div");
  Object.assign(modal.style, {
    position: "fixed", inset: "0", background: "rgba(0,0,0,0.92)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: "9998", cursor: "zoom-out",
  });
  modal.innerHTML = `<img src="${url}" style="max-width:95vw;max-height:95vh;border-radius:8px;object-fit:contain;">`;
  modal.onclick = () => modal.remove();
  document.body.appendChild(modal);
}

async function deleteImage(dateFile, btn) {
  if (!confirm("この写真を削除しますか？")) return;
  const res = await fetch(`${API}/upload/img/${dateFile}`, { method: "DELETE" });
  if (!res.ok) {
    _showToast?.("⚠️ 写真の削除に失敗しました");
    return;
  }
  App.go("daily", { date: _dailyState.date, storeId: _dailyState.storeId });
}

let _keyHandler = null;
function _setupKeys() {
  if (_keyHandler) document.removeEventListener("keydown", _keyHandler);
  _keyHandler = (e) => {
    if (e.key === "Enter" && e.target.id !== "next-btn" && e.target.tagName !== "BUTTON") {
      e.preventDefault();
      saveAndNext();
    }
  };
  document.addEventListener("keydown", _keyHandler);
}
