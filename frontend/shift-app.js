// frontend/shift-app.js — シフト管理（SPA統合版）v4
// v4: 希望入力モード / マトリクス一覧 / LINE用PNG出力

(function() {
const DOW     = ['日','月','火','水','木','金','土'];
const PALETTE = ['#7c3aed','#2563eb','#16a34a','#d97706','#e11d48','#0891b2','#f97316','#14b8a6','#a21caf'];
function _saStoreName(id) { return (window.STORE_NAME || {})[id] || id; }

const STAFF_COLOR_OVERRIDE = {};

const CSS = `<style id="shift-app-style">
.sa-wrap{display:flex;flex-direction:column;min-height:calc(100vh - 48px);overflow-x:hidden;max-width:100%;}
.sa-hdr{background:#111827;border:1px solid #1f2937;border-radius:8px;padding:10px 12px;margin-bottom:10px;display:flex;flex-direction:column;gap:8px;min-width:0;}
.sa-hdr-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.sa-store-tabs{display:flex;background:#1f2937;border-radius:8px;padding:3px;gap:3px;}
.sa-store-tab{flex:1;background:none;border:none;color:#6b7280;border-radius:6px;padding:5px 14px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;}
.sa-store-tab.active{background:#374151;color:#f3f4f6;}
.sa-month-nav{display:flex;align-items:center;}
.sa-mnav-btn{background:#1f2937;border:none;color:#9ca3af;border-radius:6px;padding:5px 11px;font-size:16px;cursor:pointer;line-height:1;}
.sa-month-lbl{color:#f3f4f6;font-weight:700;font-size:14px;min-width:76px;text-align:center;}
.sa-save-btn{background:#374151;border:none;color:#6b7280;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;margin-left:auto;transition:all .2s;}
.sa-save-btn.dirty{background:#7c3aed;color:#fff;}
/* モードタブ */
.sa-mode-tabs{display:flex;gap:3px;background:#0f172a;border-radius:8px;padding:3px;}
.sa-mode-tab{flex:1;background:none;border:none;color:#6b7280;border-radius:6px;padding:6px 4px;font-size:11px;font-weight:700;cursor:pointer;text-align:center;white-space:nowrap;}
.sa-mode-tab.active{background:#1f2937;color:#f3f4f6;}
/* 希望入力: スタッフ選択バー */
.sa-req-bar{display:flex;gap:6px;flex-wrap:wrap;padding:2px 0 4px;}
.sa-req-staff-btn{background:#1f2937;border:1.5px solid #374151;color:#6b7280;border-radius:20px;padding:5px 14px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .15s;}
.sa-req-staff-btn.active{border-color:var(--c);color:var(--c);background:var(--c)22;}
.sa-req-save-btn{background:#374151;border:none;color:#6b7280;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;transition:all .2s;white-space:nowrap;}
.sa-req-save-btn.dirty{background:#16a34a;color:#fff;}
/* 凡例 */
.sa-legend{display:flex;gap:6px;flex-wrap:wrap;padding:0 2px 2px;}
.sa-legend-chip{display:flex;align-items:center;gap:4px;font-size:10px;color:#9ca3af;}
.sa-legend-dot{width:10px;height:10px;border-radius:50%;}
.sa-legend-dot.light-bg{border:1px solid #4b5563;}
/* カレンダー */
.sa-cal-wrap{flex:1;overflow-y:auto;overflow-x:hidden;padding-bottom:20px;}
.sa-dow-row{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:3px;}
.sa-dow-c{text-align:center;font-size:10px;font-weight:700;padding:2px 0;color:#6b7280;}
.sa-dow-c.sun{color:#f87171;} .sa-dow-c.sat{color:#60a5fa;}
.sa-week-row{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:3px;}
.sa-day{background:#1f2937;border-radius:6px;min-height:64px;padding:4px 3px 4px;cursor:pointer;border:1.5px solid transparent;user-select:none;display:flex;flex-direction:column;gap:1px;position:relative;}
.sa-day:active{opacity:.7;}
.sa-day.empty{opacity:0;pointer-events:none;}
.sa-day.closed{background:#0a0a0a;border-color:#1f2937;}
.sa-day.today{border-color:#7c3aed55;}
/* 希望入力モードでの日付セルの色 */
.sa-day.req-want{background:#16a34a22 !important;border-color:#16a34a55 !important;}
.sa-day.req-ng{background:#7f1d1d22 !important;border-color:#f8717155 !important;}
.sa-dnum{font-size:10px;font-weight:700;color:#6b7280;line-height:1;display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;}
.sa-day.sun .sa-dnum{color:#f87171;} .sa-day.sat .sa-dnum{color:#60a5fa;}
.sa-day.closed .sa-dnum{color:#374151;}
.sa-closed-x{font-size:8px;color:#4b5563;}
/* チップ */
.sa-slots{display:flex;flex-wrap:wrap;gap:2px;}
.sa-chip{font-size:8px;font-weight:700;padding:1px 2px;border-radius:6px;white-space:nowrap;line-height:1.4;display:inline-block;width:28px;text-align:center;box-sizing:border-box;position:relative;}
.sa-chip-absent{display:inline-block;width:28px;height:14px;border-radius:6px;border:1px dashed #2d3748;opacity:0.5;position:relative;}
/* 希望インジケーター（チップの右上の小さい丸） */
.sa-chip-want-dot{position:absolute;top:-2px;right:-2px;width:5px;height:5px;border-radius:50%;background:#16a34a;border:1px solid #111827;}
.sa-chip-ng-dot{position:absolute;top:-2px;right:-2px;width:5px;height:5px;border-radius:50%;background:#f87171;border:1px solid #111827;}
/* 希望入力モードの日付ラベル */
.sa-req-label{font-size:8px;font-weight:700;text-align:center;line-height:1.2;margin-top:2px;}
.sa-req-label.want{color:#16a34a;}
.sa-req-label.ng{color:#f87171;}
/* 凡例: 合計日数 */
.sa-legend-days{color:#a78bfa;font-size:9px;margin-left:2px;}
/* PNG出力 / HTML書出 / JSON読込 */
.sa-export-btn{background:#0891b222;border:1px solid #0891b244;color:#38bdf8;border-radius:6px;padding:5px 9px;font-size:12px;font-weight:700;cursor:pointer;}
.sa-html-btn{background:#1e3a5f;border:1px solid #1e40af55;color:#60a5fa;border-radius:6px;padding:5px 9px;font-size:12px;font-weight:700;cursor:pointer;}
.sa-import-label{background:#1f2937;border:1px solid #374151;color:#9ca3af;border-radius:6px;padding:5px 9px;font-size:12px;font-weight:700;cursor:pointer;}
/* ボトムシート */
.sa-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:500;display:none;}
.sa-overlay.open{display:block;}
.sa-sheet{position:fixed;bottom:0;left:0;right:0;background:#111827;border-radius:16px 16px 0 0;border-top:1px solid #374151;z-index:501;transform:translateY(100%);transition:transform .25s cubic-bezier(.4,0,.2,1);max-height:85vh;display:flex;flex-direction:column;overflow-x:hidden;}
.sa-sheet.open{transform:translateY(0);}
.sa-sheet-handle{width:36px;height:4px;background:#374151;border-radius:2px;margin:10px auto 0;flex-shrink:0;}
.sa-sheet-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 16px 8px;flex-shrink:0;}
.sa-sheet-title{font-weight:700;font-size:14px;color:#f3f4f6;}
.sa-sheet-close{background:none;border:none;color:#4b5563;font-size:22px;cursor:pointer;line-height:1;padding:0 4px;}
.sa-sheet-body{overflow-y:auto;padding:0 16px 8px;flex:1;}
/* 希望インジケーター（ボトムシート内） */
.sa-req-badge{font-size:9px;padding:1px 5px;border-radius:4px;margin-left:4px;font-weight:700;}
.sa-req-badge.want{background:#16a34a33;color:#16a34a;}
.sa-req-badge.ng{background:#7f1d1d33;color:#f87171;}
.sa-staff-grid{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}
.sa-staff-btn{display:inline-flex;align-items:center;gap:5px;background:#1f2937;border:2px solid #374151;border-radius:12px;padding:8px 14px;cursor:pointer;font-size:13px;font-weight:700;color:#9ca3af;transition:all .15s;white-space:nowrap;}
.sa-staff-btn.on{color:#f3f4f6;}
.sa-staff-btn .sa-dot{width:8px;height:8px;border-radius:50%;background:var(--c);opacity:.5;transition:opacity .15s;}
.sa-staff-btn.on .sa-dot{opacity:1;}
.sa-sheet-footer{display:flex;gap:8px;flex-shrink:0;padding:0 16px 16px;}
.sa-closed-btn{background:#1f2937;border:1px solid #374151;color:#6b7280;border-radius:8px;padding:11px 14px;font-size:12px;cursor:pointer;white-space:nowrap;}
.sa-closed-btn.on{background:#7f1d1d22;border-color:#f87171;color:#f87171;}
.sa-confirm-btn{flex:1;background:#7c3aed;border:none;color:#fff;border-radius:8px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;}
/* マトリクス一覧 */
.sa-matrix-wrap{flex:1;overflow-x:auto;overflow-y:auto;padding-bottom:20px;}
.sa-matrix-tbl{border-collapse:collapse;font-size:10px;min-width:100%;}
.sa-matrix-tbl th,.sa-matrix-tbl td{border:1px solid #1f2937;padding:4px 3px;text-align:center;min-width:26px;white-space:nowrap;}
.sa-matrix-tbl .name-col{text-align:left;padding-left:8px;padding-right:8px;min-width:60px;font-weight:700;font-size:11px;position:sticky;left:0;z-index:1;background:#0f172a;}
.sa-matrix-tbl thead th{background:#1f2937;color:#9ca3af;font-weight:700;position:sticky;top:0;z-index:2;}
.sa-matrix-tbl thead th.name-col{z-index:3;}
.sa-matrix-tbl .total-col{font-weight:700;color:#a78bfa;min-width:32px;}
.sa-matrix-cell-on{font-weight:700;font-size:12px;}
.sa-matrix-cell-want{color:#16a34a;font-size:10px;}
.sa-matrix-cell-ng{color:#f87171;font-size:10px;opacity:0.7;}
.sa-matrix-cell-closed{color:#2d3748;font-size:10px;}
.sa-matrix-foot td{background:#1a1f2e;color:#6b7280;font-size:9px;font-weight:700;}
.sa-matrix-foot .name-col{background:#1a1f2e;}
/* PNG出力ボタン */
.sa-png-btns{display:flex;gap:8px;margin-top:12px;}
.sa-png-btn{flex:1;background:#0891b2;border:none;color:#fff;border-radius:8px;padding:10px 8px;font-size:12px;font-weight:700;cursor:pointer;}
</style>`;

const HTML = `
${CSS}
<div class="sa-wrap">
  <div class="sa-hdr">
    <div class="sa-hdr-row">
      <div class="sa-store-tabs" id="sa-store-tabs"></div>
      <div class="sa-month-nav">
        <button class="sa-mnav-btn" onclick="_saChangeMonth(-1)">‹</button>
        <span class="sa-month-lbl" id="sa-month-lbl">—</span>
        <button class="sa-mnav-btn" onclick="_saChangeMonth(1)">›</button>
      </div>
      <button class="sa-req-save-btn" id="sa-req-save-btn" onclick="_saSaveRequests()" style="display:none">希望保存</button>
      <button class="sa-export-btn" id="sa-export-btn" onclick="_saExportPNG()">PNG出力</button>
      <button class="sa-html-btn" id="sa-html-btn" onclick="_saExportEditorHTML()">HTML書出</button>
      <label class="sa-import-label" id="sa-import-label">JSON読込<input type="file" accept=".json" style="display:none" onchange="_saImportJSON(this)"></label>
      <button class="sa-save-btn" id="sa-save-btn" onclick="_saSaveShift()">保存</button>
    </div>
    <div class="sa-mode-tabs">
      <button class="sa-mode-tab active" id="sa-mode-build"   onclick="_saSetMode('build')">📅 シフト組み</button>
      <button class="sa-mode-tab"        id="sa-mode-request" onclick="_saSetMode('request')">🙋 希望入力</button>
      <button class="sa-mode-tab"        id="sa-mode-matrix"  onclick="_saSetMode('matrix')">🔲 月間一覧</button>
    </div>
    <div class="sa-req-bar" id="sa-req-bar" style="display:none"></div>
    <div class="sa-legend" id="sa-legend"></div>
  </div>
  <div class="sa-cal-wrap" id="sa-cal-wrap">
    <div class="sa-dow-row" id="sa-dow-row"></div>
    <div id="sa-cal-body"></div>
  </div>
  <div class="sa-matrix-wrap" id="sa-matrix-wrap" style="display:none">
    <div id="sa-matrix-body"></div>
  </div>
</div>

<div class="sa-overlay" id="sa-overlay" onclick="_saCloseSheet()"></div>
<div class="sa-sheet" id="sa-sheet">
  <div class="sa-sheet-handle"></div>
  <div class="sa-sheet-hdr">
    <span class="sa-sheet-title" id="sa-sheet-title">—</span>
    <button class="sa-sheet-close" onclick="_saCloseSheet()">✕</button>
  </div>
  <div class="sa-sheet-body">
    <div class="sa-staff-grid" id="sa-staff-grid"></div>
  </div>
  <div class="sa-sheet-footer">
    <button class="sa-closed-btn" id="sa-closed-btn" onclick="_saToggleClosed()">— 閉業日</button>
    <button class="sa-confirm-btn" onclick="_saCloseSheet()">確認</button>
  </div>
</div>`;

// ──────────────────────────────────────────────────────────────────
// 状態
// ──────────────────────────────────────────────────────────────────
const SA = {
  year:      new Date().getFullYear(),
  month:     new Date().getMonth() + 1,
  store:     null,
  shifts:    {},
  requests:  {},   // staffId → { want:[ds,...], ng:[ds,...] }
  allStaff:  [],
  colors:    {},
  dirty:     false,
  reqDirty:  false,
  mode:      'build',  // 'build' | 'request' | 'matrix'
  reqStaff:  null,     // 希望入力中のスタッフID
};
let _saSheetDate = null;

// 3ヶ月以上前の stale キャッシュを削除
(function _saPrune() {
  const c = new Date(); c.setMonth(c.getMonth() - 3);
  const cutoff = `shift_v2_${c.getFullYear()}_${String(c.getMonth()+1).padStart(2,'0')}`;
  for (const k of Object.keys(localStorage))
    if (k.startsWith('shift_v2_') && k < cutoff) localStorage.removeItem(k);
})();

// ──────────────────────────────────────────────────────────────────
// 初期化
// ──────────────────────────────────────────────────────────────────
App.register("shift", async function() {
  const main = document.getElementById("main");
  main.innerHTML = HTML;
  if (!SA.store) SA.store = (window._storeIds || [])[0] || null;
  _saRenderStoreTabs();
  try { SA.allStaff = await App.api("GET", "/staff") || []; }
  catch(e) { SA.allStaff = []; _showToast('⚠️ スタッフ読み込み失敗: ' + e.message); }
  _saAssignColors();
  _saRenderLegend();
  _saUpdateMonthLabel();
  await Promise.all([_saLoadShift(), _saLoadRequests()]);
  _saRenderDowRow();
  _saRenderCal();
});

// ──────────────────────────────────────────────────────────────────
// 色管理
// ──────────────────────────────────────────────────────────────────
function _saAssignColors() {
  const storeIds = window._storeIds || [];
  const fallbackSid = storeIds[storeIds.length - 1];
  const ordered = storeIds.flatMap(sid =>
    SA.allStaff
      .filter(s => s.active && (s.store_id === sid || (!s.store_id && sid === fallbackSid)))
      .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99))
  );
  ordered.forEach((s, i) => {
    SA.colors[s.id] = STAFF_COLOR_OVERRIDE[s.id] || { bg: PALETTE[i % PALETTE.length], text: '#fff' };
  });
}
function _saColor(sid) { return SA.colors[sid] || { bg: '#6b7280', text: '#fff' }; }

// ──────────────────────────────────────────────────────────────────
// 店舗タブ（window._storeIdsから動的に生成。1店舗のみならタブ非表示）
// ──────────────────────────────────────────────────────────────────
function _saRenderStoreTabs() {
  const el = document.getElementById('sa-store-tabs');
  if (!el) return;
  const ids = window._storeIds || [];
  if (ids.length <= 1) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  el.innerHTML = ids.map(id => `<button class="sa-store-tab${id===SA.store?' active':''}" id="sa-tab-${id}" onclick="_saSetStore('${id}')">${escHtml(_saStoreName(id))}</button>`).join('');
}

// ──────────────────────────────────────────────────────────────────
// 凡例
// ──────────────────────────────────────────────────────────────────
function _saRenderLegend() {
  const el = document.getElementById('sa-legend');
  if (!el) return;
  const staff = SA.allStaff.filter(s => s.active && (s.store_id === SA.store || s.is_owner))
    .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
  el.innerHTML = staff.map(s => {
    const c    = _saColor(s.id);
    const days = Object.values(SA.shifts).filter(v => Array.isArray(v) && v.includes(s.id)).length;
    const dtxt = days > 0 ? `<span class="sa-legend-days">${days}日</span>` : '';
    return `<span class="sa-legend-chip">
      <span class="sa-legend-dot${c.text==='#111827'?' light-bg':''}" style="background:${c.bg};"></span>
      ${s.name}${dtxt}
    </span>`;
  }).join('');
}

// ──────────────────────────────────────────────────────────────────
// データ: シフト
// ──────────────────────────────────────────────────────────────────
async function _saLoadShift() {
  const lsKey = `shift_v2_${SA.year}_${_pad(SA.month)}_${SA.store}`;
  try {
    const data = await App.api('GET', `/shifts/${SA.year}/${SA.month}`);
    const raw  = (data || {})[SA.store] || {};
    SA.shifts = {};
    for (const [d, v] of Object.entries(raw)) SA.shifts[d] = v;
    localStorage.setItem(lsKey, JSON.stringify(SA.shifts));
  } catch(e) {
    try { SA.shifts = JSON.parse(localStorage.getItem(lsKey) || '{}'); } catch { SA.shifts = {}; }
    const hasCache = Object.keys(SA.shifts).length > 0;
    _showToast(`⚠️ サーバー接続失敗 — ${hasCache ? 'キャッシュ表示中' : 'データなし'}`);
  }
  SA.dirty = false; _saUpdateSaveBtn();
}

async function _saSaveShift() {
  const btn = document.getElementById('sa-save-btn');
  if (!btn) return;
  btn.disabled = true; btn.textContent = '保存中…';
  const lsKey     = `shift_v2_${SA.year}_${_pad(SA.month)}_${SA.store}`;
  const pendingKey = `shift_pending_${lsKey}`;
  try {
    await App.api('PUT', `/shifts/${SA.year}/${SA.month}/${SA.store}`, SA.shifts);
    localStorage.setItem(lsKey, JSON.stringify(SA.shifts));
    localStorage.removeItem(pendingKey);
    SA.dirty = false; _showToast('✅ 保存しました');
  } catch(e) {
    if (e.status === 423) {
      // 給与確定済み月はサーバー側が恒久的に拒否するため、オフライン扱いで
      // リトライキューに入れても意味がない。従来はここも「オフライン保存」と
      // 表示してリトライし続け、変更が二度と反映されないのにユーザーには
      // 保存されたかのように見えていた(2026-08-06のレビューで発見)。
      _showToast('⚠️ 給与確定済み月のため保存できません');
    } else {
      localStorage.setItem(lsKey, JSON.stringify(SA.shifts));
      localStorage.setItem(pendingKey, '1');
      _showToast('⚠️ オフライン保存（復帰時に自動同期）');
    }
  } finally { btn.disabled = false; btn.textContent = '保存'; _saUpdateSaveBtn(); }
}

// ──────────────────────────────────────────────────────────────────
// データ: 希望
// ──────────────────────────────────────────────────────────────────
async function _saLoadRequests() {
  try {
    const data = await App.api('GET', `/shifts/${SA.year}/${SA.month}`);
    SA.requests = (data || {})[`_req_${SA.store}`] || {};
  } catch(e) { SA.requests = {}; console.warn('requests load failed:', e); }
  SA.reqDirty = false; _saUpdateReqSaveBtn();
}

async function _saSaveRequests() {
  const btn = document.getElementById('sa-req-save-btn');
  if (!btn) return;
  btn.disabled = true; btn.textContent = '保存中…';
  try {
    await App.api('PUT', `/shifts/${SA.year}/${SA.month}/${SA.store}/requests`, SA.requests);
    SA.reqDirty = false; _showToast('✅ 希望を保存しました');
  } catch(e) {
    _showToast('⚠️ 希望の保存失敗');
  } finally {
    btn.disabled = false; btn.textContent = '希望保存'; _saUpdateReqSaveBtn();
  }
}

function _saGetReq(staffId, ds) {
  const r = SA.requests[staffId] || {};
  if ((r.want || []).includes(ds)) return 'want';
  if ((r.ng   || []).includes(ds)) return 'ng';
  return null;
}

// ──────────────────────────────────────────────────────────────────
// モード切り替え
// ──────────────────────────────────────────────────────────────────
window._saSetMode = function(mode) {
  SA.mode = mode;
  ['build','request','matrix'].forEach(m => {
    document.getElementById(`sa-mode-${m}`)?.classList.toggle('active', m === mode);
  });
  const isRequest = mode === 'request';
  const isMatrix  = mode === 'matrix';
  document.getElementById('sa-req-bar')?.style.setProperty('display',      isRequest ? 'flex' : 'none');
  // 2026-09-27追加: 「🔲 月間一覧」は誰がいつ入っているかを一目で見るための
  // 読み取り専用ビュー。編集系ボタン（保存・希望保存・JSON読込）は意味を
  // 持たないため隠す。PNG出力・HTML書出はカレンダー形式の出力なので、一覧
  // モード中でも裏側のSA.shiftsから独立して生成できる（実害はないが、
  // 見た目の一貫性のためこちらも一覧モード中は隠す）。
  document.getElementById('sa-save-btn')?.style.setProperty('display',     (isRequest || isMatrix) ? 'none' : '');
  document.getElementById('sa-export-btn')?.style.setProperty('display',   (isRequest || isMatrix) ? 'none' : '');
  document.getElementById('sa-html-btn')?.style.setProperty('display',     isMatrix ? 'none' : '');
  document.getElementById('sa-import-label')?.style.setProperty('display', isMatrix ? 'none' : '');
  document.getElementById('sa-req-save-btn')?.style.setProperty('display', isRequest ? '' : 'none');
  document.getElementById('sa-cal-wrap')?.style.setProperty('display',    isMatrix ? 'none' : '');
  document.getElementById('sa-matrix-wrap')?.style.setProperty('display', isMatrix ? '' : 'none');
  if (isRequest) _saRenderReqBar();
  if (isMatrix) _saRenderMatrix(); else _saRenderCal();
};

// ──────────────────────────────────────────────────────────────────
// 希望入力: スタッフ選択バー
// ──────────────────────────────────────────────────────────────────
function _saRenderReqBar() {
  const el = document.getElementById('sa-req-bar');
  if (!el) return;
  el.innerHTML = _saStoreStaff().map(s => {
    const c = _saColor(s.id);
    const isActive = SA.reqStaff === s.id;
    return `<button class="sa-req-staff-btn${isActive?' active':''}"
      style="--c:${c.bg};" onclick="_saSelectReqStaff('${s.id}')">
      ${s.name}
    </button>`;
  }).join('');
}

window._saSelectReqStaff = function(sid) {
  SA.reqStaff = SA.reqStaff === sid ? null : sid;
  _saRenderReqBar();
  _saRenderCal();
};

// ──────────────────────────────────────────────────────────────────
// 希望入力: 日付トグル（なし → 希望 → 不可 → なし）
// ──────────────────────────────────────────────────────────────────
window._saToggleReqDay = function _saToggleReqDay(ds) {
  if (!SA.reqStaff) { _showToast('⬆️ スタッフを選んでください'); return; }
  if (!SA.requests[SA.reqStaff]) SA.requests[SA.reqStaff] = { want: [], ng: [] };
  const r = SA.requests[SA.reqStaff];
  const wi = r.want.indexOf(ds), ni = r.ng.indexOf(ds);
  if (wi >= 0)      { r.want.splice(wi, 1); r.ng.push(ds); }   // 希望 → 不可
  else if (ni >= 0) { r.ng.splice(ni, 1); }                     // 不可 → なし
  else              { r.want.push(ds); }                         // なし → 希望
  SA.reqDirty = true; _saUpdateReqSaveBtn();
  _saRenderCal();
}

// ──────────────────────────────────────────────────────────────────
// ストア / 月 切り替え
// ──────────────────────────────────────────────────────────────────
window._saSetStore = function(id) {
  if (SA.store === id) return;
  if (SA.dirty && !confirm('保存していない変更があります。切り替えますか？')) return;
  SA.store = id; SA.reqStaff = null;
  _saRenderStoreTabs();
  _saRenderLegend();
  Promise.all([_saLoadShift(), _saLoadRequests()]).then(() => {
    if (SA.mode === 'request') _saRenderReqBar();
    _saRenderLegend();
    if (SA.mode === 'matrix') _saRenderMatrix(); else _saRenderCal();
  });
};

window._saChangeMonth = function(d) {
  if (SA.dirty && !confirm('保存していない変更があります。続けますか？')) return;
  SA.month += d;
  if (SA.month > 12) { SA.month = 1; SA.year++; }
  if (SA.month < 1)  { SA.month = 12; SA.year--; }
  SA.reqStaff = null;
  _saUpdateMonthLabel();
  Promise.all([_saLoadShift(), _saLoadRequests()]).then(() => {
    if (SA.mode === 'request') _saRenderReqBar();
    _saRenderLegend();
    if (SA.mode === 'matrix') _saRenderMatrix(); else _saRenderCal();
  });
};

function _saUpdateMonthLabel() {
  const el = document.getElementById('sa-month-lbl');
  if (el) el.textContent = `${SA.year}年${SA.month}月`;
}
function _saUpdateSaveBtn() {
  document.getElementById('sa-save-btn')?.classList.toggle('dirty', SA.dirty);
}
function _saUpdateReqSaveBtn() {
  document.getElementById('sa-req-save-btn')?.classList.toggle('dirty', SA.reqDirty);
}

// ──────────────────────────────────────────────────────────────────
// カレンダー描画（モードで挙動変化）
// ──────────────────────────────────────────────────────────────────
function _saRenderDowRow() {
  const el = document.getElementById('sa-dow-row');
  if (!el) return;
  el.innerHTML = DOW.map((d, i) =>
    `<div class="sa-dow-c ${i===0?'sun':i===6?'sat':''}">${d}</div>`
  ).join('');
}

function _saStoreStaff() {
  return SA.allStaff
    .filter(s => s.active && (s.store_id === SA.store || s.is_owner))
    .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
}

function _saRenderCal() {
  const el = document.getElementById('sa-cal-body');
  if (!el || SA.mode === 'matrix') return;
  const today      = new Date().toISOString().slice(0, 10);
  const firstDow   = new Date(SA.year, SA.month - 1, 1).getDay();
  const daysInM    = new Date(SA.year, SA.month, 0).getDate();
  const storeStaff = _saStoreStaff();
  let html = '';

  for (let w = 0; w < 6; w++) {
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const n = w * 7 + d - firstDow + 1;
      if (n < 1 || n > daysInM) { cells.push(`<div class="sa-day empty"></div>`); continue; }
      const ds       = `${SA.year}-${_pad(SA.month)}-${_pad(n)}`;
      const isClosed = SA.shifts[ds] === null;
      const assigned = new Set(Array.isArray(SA.shifts[ds]) ? SA.shifts[ds] : []);

      // 希望入力モード: 選択スタッフの希望状態で色を変える
      let reqCls = '';
      if (SA.mode === 'request' && SA.reqStaff) {
        const r = _saGetReq(SA.reqStaff, ds);
        if (r === 'want') reqCls = ' req-want';
        if (r === 'ng')   reqCls = ' req-ng';
      }

      const cls = ['sa-day',
        d===0?'sun': d===6?'sat':'',
        ds===today?'today':'',
        isClosed?'closed':'',
        reqCls,
      ].filter(Boolean).join(' ');

      const tap = SA.mode === 'request'
        ? `_saToggleReqDay('${ds}')`
        : `_saOpenSheet('${ds}')`;

      let inner = '';
      if (SA.mode === 'request' && SA.reqStaff && !isClosed) {
        // 希望入力モード: 大きめなアイコンで状態表示
        const r = _saGetReq(SA.reqStaff, ds);
        const icon = r === 'want' ? '<span class="sa-req-label want">希望</span>'
                   : r === 'ng'   ? '<span class="sa-req-label ng">不可</span>'
                   : '';
        inner = icon;
      } else if (!isClosed) {
        // シフト組みモード: チップ + 希望インジケーター
        const slots = storeStaff.map(s => {
          const c  = _saColor(s.id);
          const nm = (s.name || s.id).slice(0, 3);
          if (assigned.has(s.id)) {
            // アサイン済み: 希望状態を右上の小丸で表示
            const req = SA.mode === 'build' ? _saGetReq(s.id, ds) : null;
            const dot = req === 'want' ? '<span class="sa-chip-want-dot"></span>'
                      : req === 'ng'   ? '<span class="sa-chip-ng-dot"></span>'
                      : '';
            return `<span class="sa-chip" style="background:${c.bg};color:${c.text};">${nm}${dot}</span>`;
          } else {
            const req = SA.mode === 'build' ? _saGetReq(s.id, ds) : null;
            const dot = req === 'want' ? '<span class="sa-chip-want-dot"></span>'
                      : req === 'ng'   ? '<span class="sa-chip-ng-dot"></span>'
                      : '';
            return `<span class="sa-chip-absent" style="border-color:${c.bg}55;" title="${s.name}">${dot}</span>`;
          }
        }).join('');
        inner = `<div class="sa-slots">${slots}</div>`;
      }

      cells.push(`
        <div class="${cls}" onclick="${tap}">
          <div class="sa-dnum">${n}${isClosed?'<span class="sa-closed-x">✕</span>':''}</div>
          ${inner}
        </div>`);
    }
    if (cells.some(c => !c.includes('class="sa-day empty"'))) {
      html += `<div class="sa-week-row">${cells.join('')}</div>`;
    }
  }
  el.innerHTML = html;
}

// ──────────────────────────────────────────────────────────────────
// マトリクス一覧（スタッフ×日付）
// ──────────────────────────────────────────────────────────────────
function _saRenderMatrix() {
  const el = document.getElementById('sa-matrix-body');
  if (!el) return;
  const staff    = _saStoreStaff();
  const daysInM  = new Date(SA.year, SA.month, 0).getDate();

  // ヘッダー行（日付）
  let thead = `<tr>
    <th class="name-col">名前</th>`;
  for (let d = 1; d <= daysInM; d++) {
    const dow = new Date(SA.year, SA.month - 1, d).getDay();
    const cls = dow === 0 ? 'style="color:#f87171"' : dow === 6 ? 'style="color:#60a5fa"' : '';
    thead += `<th ${cls}>${d}<br><span style="font-size:8px;font-weight:400">${DOW[dow]}</span></th>`;
  }
  thead += `<th class="total-col">計</th></tr>`;

  // スタッフ行
  let tbody = '';
  const dailyCounts = new Array(daysInM).fill(0);
  for (const s of staff) {
    const c = _saColor(s.id);
    let workDays = 0;
    let row = `<tr>
      <td class="name-col" style="border-left:3px solid ${c.bg};">${s.name}</td>`;
    for (let d = 1; d <= daysInM; d++) {
      const ds = `${SA.year}-${_pad(SA.month)}-${_pad(d)}`;
      const isClosed  = SA.shifts[ds] === null;
      const isOn      = !isClosed && Array.isArray(SA.shifts[ds]) && SA.shifts[ds].includes(s.id);
      const req       = _saGetReq(s.id, ds);
      if (isOn) { workDays++; dailyCounts[d-1]++; }
      let cell = '', cellCls = '';
      if (isClosed)     { cell = '—'; cellCls = 'sa-matrix-cell-closed'; }
      else if (isOn)    { cell = '○'; cellCls = 'sa-matrix-cell-on'; }
      else if (req==='want') { cell = '希'; cellCls = 'sa-matrix-cell-want'; }
      else if (req==='ng')   { cell = '✕'; cellCls = 'sa-matrix-cell-ng'; }
      const style = isOn ? `style="--c:${c.bg};color:${c.bg};"` : '';
      row += `<td class="${cellCls}" ${style}>${cell}</td>`;
    }
    row += `<td class="total-col">${workDays}</td></tr>`;
    tbody += row;
  }

  // フッター行（1日あたり出勤人数）
  let tfoot = `<tr class="sa-matrix-foot">
    <td class="name-col">人数</td>`;
  for (let d = 1; d <= daysInM; d++) {
    const ds = `${SA.year}-${_pad(SA.month)}-${_pad(d)}`;
    const isClosed = SA.shifts[ds] === null;
    tfoot += `<td>${isClosed ? '' : (dailyCounts[d-1] || '')}</td>`;
  }
  tfoot += `<td></td></tr>`;

  el.innerHTML = `
    <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">
      ${SA.year}年${SA.month}月　${escHtml(_saStoreName(SA.store))}
      <span style="color:#16a34a">希=希望</span>
      <span style="color:#f87171">✕=不可</span>
    </div>
    <table class="sa-matrix-tbl">
      <thead>${thead}</thead>
      <tbody>${tbody}</tbody>
      <tfoot>${tfoot}</tfoot>
    </table>`;
}

// ──────────────────────────────────────────────────────────────────
// PNG出力（カレンダーグリッド形式・スマホ縦向き最適化）
// ──────────────────────────────────────────────────────────────────
function _rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x+w, y,   x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x,   y+h, r);
  ctx.arcTo(x,   y+h, x,   y,   r);
  ctx.arcTo(x,   y,   x+w, y,   r);
  ctx.closePath();
}

window._saExportPNG = function() {
  const storeStaff = _saStoreStaff();
  const daysInM    = new Date(SA.year, SA.month, 0).getDate();
  const firstDow   = new Date(SA.year, SA.month - 1, 1).getDay();
  const weeks      = Math.ceil((firstDow + daysInM) / 7);
  const today      = new Date().toISOString().slice(0, 10);

  // スマホ縦向き想定サイズ
  const DPR    = 2;
  const PAD    = 10;
  const HDR_H  = 36;
  const DOW_H  = 20;
  const CELL_W = 50;
  const CELL_H = 74;
  const GAP    = 3;
  const CHIP_W = 23;
  const CHIP_H = 14;
  const CHIP_G = 2;

  const W = PAD * 2 + 7 * CELL_W + 6 * GAP;
  const H = PAD * 2 + HDR_H + DOW_H + weeks * (CELL_H + GAP) - GAP;

  const canvas = document.createElement('canvas');
  canvas.width  = W * DPR;
  canvas.height = H * DPR;
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);

  const JA = '-apple-system,"Hiragino Kaku Gothic Pro","Yu Gothic UI","Meiryo",sans-serif';

  // ── 背景 ──
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, H);

  // ── ヘッダー ──
  ctx.fillStyle = '#1e1060';
  ctx.fillRect(PAD, PAD, W - PAD*2, HDR_H);
  ctx.fillStyle = '#a78bfa';
  ctx.font = `bold 13px ${JA}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(`${_saStoreName(SA.store)}　${SA.year}年${SA.month}月　シフト表`, PAD + 8, PAD + HDR_H / 2);

  // ── 曜日ヘッダー ──
  const dowY = PAD + HDR_H;
  DOW.forEach((d, i) => {
    ctx.fillStyle = i === 0 ? '#f87171' : i === 6 ? '#60a5fa' : '#4b5563';
    ctx.font = `bold 11px ${JA}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d, PAD + i * (CELL_W + GAP) + CELL_W / 2, dowY + DOW_H / 2);
  });

  // ── セル ──
  const calY = PAD + HDR_H + DOW_H;

  for (let ci = 0; ci < weeks * 7; ci++) {
    const n   = ci - firstDow + 1;
    const col = ci % 7;
    const row = Math.floor(ci / 7);
    if (n < 1 || n > daysInM) continue;

    const ds       = `${SA.year}-${_pad(SA.month)}-${_pad(n)}`;
    const isClosed = SA.shifts[ds] === null;
    const assigned = !isClosed && Array.isArray(SA.shifts[ds])
      ? SA.shifts[ds].filter(sid => storeStaff.some(s => s.id === sid))
      : [];
    const dow = col;
    const x   = PAD + col * (CELL_W + GAP);
    const y   = calY + row * (CELL_H + GAP);

    // セル背景
    ctx.fillStyle = isClosed ? '#0a0a12' : '#1f2937';
    _rrect(ctx, x, y, CELL_W, CELL_H, 6);
    ctx.fill();

    // 今日の枠線
    if (ds === today) {
      ctx.strokeStyle = '#7c3aed';
      ctx.lineWidth = 1.5;
      _rrect(ctx, x, y, CELL_W, CELL_H, 6);
      ctx.stroke();
    }

    // 日付数字
    ctx.fillStyle = isClosed ? '#2d3748'
                  : dow === 0 ? '#f87171'
                  : dow === 6 ? '#60a5fa'
                  : '#6b7280';
    ctx.font = `bold 11px ${JA}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(String(n), x + 4, y + 4);

    if (isClosed) {
      ctx.fillStyle = '#2d3748';
      ctx.font = `10px ${JA}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('閉', x + CELL_W / 2, y + CELL_H / 2);
      continue;
    }

    // 固定スロット: 全スタッフを sort_order 順で同じ位置に配置
    // 出勤=塗りつぶしチップ、不在=点線枠（位置で誰か分かる）
    storeStaff.forEach((s, idx) => {
      if (idx >= 6) return;
      const isOn = assigned.includes(s.id);
      const c    = _saColor(s.id);
      const nm   = (s.name || s.id).slice(0, 3);
      const col2 = idx % 2;
      const row2 = Math.floor(idx / 2);
      const cx   = x + 3 + col2 * (CHIP_W + CHIP_G);
      const cy   = y + 18 + row2 * (CHIP_H + CHIP_G);

      if (isOn) {
        ctx.fillStyle = c.bg;
        _rrect(ctx, cx, cy, CHIP_W, CHIP_H, 3);
        ctx.fill();
        ctx.fillStyle = c.text;
        ctx.font = `bold 8px ${JA}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(nm, cx + CHIP_W / 2, cy + CHIP_H / 2);
      } else {
        ctx.strokeStyle = c.bg + '55';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([2, 2]);
        _rrect(ctx, cx, cy, CHIP_W, CHIP_H, 3);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  }

  // ダウンロード
  const link = document.createElement('a');
  link.download = `シフト表_${SA.year}${_pad(SA.month)}_${_saStoreName(SA.store)}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
};

// ──────────────────────────────────────────────────────────────────
// ボトムシート（シフト組みモードのみ）
// ──────────────────────────────────────────────────────────────────
window._saOpenSheet = function(ds) {
  if (SA.mode !== 'build') return;
  _saSheetDate = ds;
  const isClosed = SA.shifts[ds] === null;
  const assigned = new Set(Array.isArray(SA.shifts[ds]) ? SA.shifts[ds] : []);
  const d = new Date(ds + 'T00:00:00');
  const titleEl = document.getElementById('sa-sheet-title');
  if (titleEl) titleEl.textContent =
    `${SA.month}月${d.getDate()}日(${DOW[d.getDay()]}) ${_saStoreName(SA.store)}`;

  const gridEl = document.getElementById('sa-staff-grid');
  if (gridEl) gridEl.innerHTML = _saStoreStaff().map(s => {
    const on  = assigned.has(s.id);
    const c   = _saColor(s.id);
    const lgt = c.text === '#111827';
    const req = _saGetReq(s.id, ds);
    const badge = req === 'want' ? '<span class="sa-req-badge want">希望</span>'
                : req === 'ng'   ? '<span class="sa-req-badge ng">不可</span>'
                : '';
    return `<button class="sa-staff-btn ${on?'on':''}" data-sid="${s.id}"
      style="--c:${c.bg};${on?`border-color:${c.bg};background:${c.bg}${lgt?'33':'22'};color:${c.bg};`:''}"
      onclick="_saToggleStaff('${s.id}')">
      <span class="sa-dot"></span>${s.name}${badge}
    </button>`;
  }).join('');

  const cb = document.getElementById('sa-closed-btn');
  if (cb) { cb.classList.toggle('on', isClosed); cb.textContent = isClosed ? '✓ 閉業日' : '— 閉業日'; }
  _saSetStaffGridEnabled(!isClosed);
  document.getElementById('sa-overlay')?.classList.add('open');
  document.getElementById('sa-sheet')?.classList.add('open');
  document.body.style.overflow = 'hidden';
};

window._saCloseSheet = function() {
  document.getElementById('sa-overlay')?.classList.remove('open');
  document.getElementById('sa-sheet')?.classList.remove('open');
  document.body.style.overflow = '';
  _saSheetDate = null;
};

window._saToggleStaff = function(sid) {
  if (!_saSheetDate || SA.shifts[_saSheetDate] === null) return;
  if (!Array.isArray(SA.shifts[_saSheetDate])) SA.shifts[_saSheetDate] = [];
  const idx = SA.shifts[_saSheetDate].indexOf(sid);
  if (idx >= 0) SA.shifts[_saSheetDate].splice(idx, 1);
  else          SA.shifts[_saSheetDate].push(sid);
  if (SA.shifts[_saSheetDate].length === 0) delete SA.shifts[_saSheetDate];

  const isOn = Array.isArray(SA.shifts[_saSheetDate]) && SA.shifts[_saSheetDate].includes(sid);
  const btn  = document.querySelector(`[data-sid="${sid}"]`);
  const c    = _saColor(sid);
  const lgt  = c.text === '#111827';
  if (btn) {
    btn.classList.toggle('on', isOn);
    btn.style.borderColor = isOn ? c.bg : '#374151';
    btn.style.background  = isOn ? c.bg + (lgt ? '33' : '22') : '';
    btn.style.color       = isOn ? c.bg : '#9ca3af';
  }
  SA.dirty = true; _saUpdateSaveBtn();
  _saRenderLegend();
  _saRenderCal();
};

window._saToggleClosed = function() {
  if (!_saSheetDate) return;
  const nowClosed = SA.shifts[_saSheetDate] === null;
  if (nowClosed) delete SA.shifts[_saSheetDate];
  else           SA.shifts[_saSheetDate] = null;
  const isClosed = SA.shifts[_saSheetDate] === null;
  const cb = document.getElementById('sa-closed-btn');
  if (cb) { cb.classList.toggle('on', isClosed); cb.textContent = isClosed ? '✓ 閉業日' : '— 閉業日'; }
  _saSetStaffGridEnabled(!isClosed);
  SA.dirty = true; _saUpdateSaveBtn();
  _saRenderCal();
};

function _saSetStaffGridEnabled(enabled) {
  const g = document.getElementById('sa-staff-grid');
  if (g) { g.style.opacity = enabled ? '1' : '0.25'; g.style.pointerEvents = enabled ? '' : 'none'; }
}

function _pad(n) { return String(n).padStart(2, '0'); }

// ── window 公開（onclick属性から呼べるようにする）──
window._saSaveShift    = _saSaveShift;
window._saSaveRequests = _saSaveRequests;

// ── JSON読込（サーバーに PUT して必要なら画面を更新）──
window._saImportJSON = async function(input) {
  const file = input.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.shifts || !data.store) throw new Error('フォーマットエラー');
    await App.api('PUT', `/shifts/${data.year}/${data.month}/${data.store}`, data.shifts);
    if (data.requests)
      await App.api('PUT', `/shifts/${data.year}/${data.month}/${data.store}/requests`, data.requests);
    if (data.year === SA.year && data.month === SA.month && data.store === SA.store) {
      SA.shifts   = data.shifts;
      SA.requests = data.requests || {};
      SA.dirty    = false; _saUpdateSaveBtn(); _saRenderLegend(); _saRenderCal();
    }
    const sname = _saStoreName(data.store);
    _showToast(`✅ ${data.year}年${data.month}月 ${sname} を読み込みました`);
  } catch(e) { _showToast('⚠️ 読み込み失敗: ' + e.message); }
  input.value = '';
};

// ── HTML書出（最新データを保存してからダウンロード）──
window._saExportEditorHTML = async function() {
  if (SA.dirty) await _saSaveShift();
  const a = document.createElement('a');
  a.href = `${API}/shifts/${SA.year}/${SA.month}/${SA.store}/export-editor`;
  a.download = `shift_editor_${SA.year}${_pad(SA.month)}_${SA.store}.html`;
  document.body.appendChild(a); a.click(); a.remove();
};

// ── オンライン復帰時に pending 変更を自動同期 ──
window.addEventListener('online', async () => {
  const lsKey      = `shift_v2_${SA.year}_${_pad(SA.month)}_${SA.store}`;
  const pendingKey = `shift_pending_${lsKey}`;
  if (!localStorage.getItem(pendingKey)) return;
  const cached = localStorage.getItem(lsKey); if (!cached) return;
  _showToast('🔄 オフライン中の変更を同期中…');
  try {
    await App.api('PUT', `/shifts/${SA.year}/${SA.month}/${SA.store}`, JSON.parse(cached));
    localStorage.removeItem(pendingKey);
    SA.dirty = false; _saUpdateSaveBtn();
    _showToast('✅ 同期完了');
  } catch(e) { _showToast('⚠️ 同期失敗 — 後でもう一度お試しください'); }
});

})();
