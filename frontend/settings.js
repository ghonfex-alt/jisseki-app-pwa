// frontend/settings.js

// 2026-10-30バグハントで指摘(確定): スタッフ名・シャンパンメニュー名を
// value属性に無エスケープで埋め込んでおり、名前に"を含むと属性が壊れ
// 任意HTML注入が可能だった(他ファイルのreflections.js::_reflEscAttr等と
// 同じ対処)。
function _settingsEscAttr(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML.replace(/"/g, "&quot;");
}

App.register("settings", async function() {
  const main = document.getElementById("main");
  const [stores, allStaff, incentiveSettings] = await Promise.all([
    App.api("GET", "/stores"),
    App.api("GET", "/staff"),
    App.api("GET", "/settings"),
  ]);

  main.innerHTML = `
    <h2 style="color:#a78bfa;margin-bottom:16px;">設定</h2>
    <div style="display:flex;gap:16px;flex-wrap:wrap;">
      <div style="flex:1;min-width:280px;" id="store-settings"></div>
      <div style="flex:1;min-width:280px;" id="staff-settings"></div>
    </div>
    <div class="card" style="margin-top:16px;" id="incentive-settings"></div>
    <div class="card" style="margin-top:16px;">
      <h3 style="color:#6b7280;font-size:12px;text-transform:uppercase;margin-bottom:12px;">データのバックアップ</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <button class="btn-primary" style="font-size:12px;padding:8px 16px;"
          onclick="exportBackupData()">データを書き出す</button>
        <button style="background:#374151;border:none;color:#f3f4f6;font-size:12px;padding:8px 16px;border-radius:6px;cursor:pointer;"
          onclick="document.getElementById('backup-import-input').click()">データを読み込む</button>
        <input type="file" id="backup-import-input" accept="application/json,.json" style="display:none;"
          onchange="_onBackupFileSelected(this.files)">
      </div>
      <div style="color:#6b7280;font-size:11px;margin-top:8px;">
        書き出したJSONファイルは端末に保存してください。読み込みは現在アプリに保存されている
        全データを上書きします。
      </div>
    </div>
  `;

  renderStoreSettings(stores);
  renderStaffSettings(allStaff, stores);
  renderIncentiveSettings(incentiveSettings);
});

// ── ワンオペ手当・キャッチ/呼び/延長インセンティブ単価の設定UI(新設) ──────────
// local/settings.js::getSettings/updateSettings(Task9)が返す/受け取る
// {wanope_bonus, incentive_rates:{catch,call,extension}.yen_per_count} を
// 編集する画面。既存のワンオペ手当(window.WANOPE_BONUS)はこれまでapp.js起動時に
// GET /settingsで読み込むだけで、変更できるUIがどこにも無かった
// (frontend全体をgrepして確認済み)。キャッチ/呼び/延長単価の設定UIを追加する
// この計画書Task13の指示に合わせて、ワンオペ手当も同じ画面・同じ保存パターン
// (App.api("PUT","/settings",...))で初めて編集可能にする。
// 初期値は全て0円(計画書冒頭の「追加要件」通り、単価未確定の間は給与に
// 影響しない安全な既定値)。
function renderIncentiveSettings(settings) {
  const el = document.getElementById("incentive-settings");
  if (!el) return;
  const wanope = settings?.wanope_bonus ?? 0;
  const rates = settings?.incentive_rates || {};
  const catchRate = rates.catch?.yen_per_count ?? 0;
  const callRate = rates.call?.yen_per_count ?? 0;
  const extRate = rates.extension?.yen_per_count ?? 0;
  el.innerHTML = `
    <h3 style="color:#6b7280;font-size:12px;text-transform:uppercase;margin-bottom:12px;">手当・インセンティブ設定</h3>
    <div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:14px;">
      <div style="flex:1;max-width:160px;">
        <div class="label">ワンオペ手当（1時間あたり）</div>
        <input type="number" min="0" id="setting-wanope" value="${wanope}" style="width:100%;"
          onchange="updateWanopeBonus(this.value)">
      </div>
      <span style="color:#6b7280;font-size:12px;padding-bottom:9px;">円/h</span>
    </div>
    <div class="label" style="margin-bottom:8px;">インセンティブ単価（1回あたり）</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <div style="flex:1;min-width:110px;">
        <div class="label">キャッチ（1回あたり）</div>
        <input type="number" min="0" id="setting-catch" value="${catchRate}" style="width:100%;"
          onchange="updateIncentiveRate('catch', this.value)">
      </div>
      <div style="flex:1;min-width:110px;">
        <div class="label">呼び（1回あたり）</div>
        <input type="number" min="0" id="setting-call" value="${callRate}" style="width:100%;"
          onchange="updateIncentiveRate('call', this.value)">
      </div>
      <div style="flex:1;min-width:110px;">
        <div class="label">延長（1回あたり）</div>
        <input type="number" min="0" id="setting-extension" value="${extRate}" style="width:100%;"
          onchange="updateIncentiveRate('extension', this.value)">
      </div>
    </div>
    <div style="color:#6b7280;font-size:11px;margin-top:8px;">
      いずれも単位は「円」。0円のままの項目は給与・日次見積額に影響しません。
    </div>
  `;
}

async function updateWanopeBonus(value) {
  const n = parseInt(value, 10);
  const bonus = Number.isNaN(n) || n < 0 ? 0 : n;
  try {
    const result = await App.api("PUT", "/settings", { wanope_bonus: bonus });
    // app.js起動時に一度だけ読み込んだキャッシュ(window.WANOPE_BONUS)を
    // ここで即時更新しないと、再読み込みするまで日次入力画面の見積額が
    // 古い単価のままになる(ワンオペ手当は今回初めて編集可能になった値なので
    // 特に気づかれにくい)。
    window.WANOPE_BONUS = result.wanope_bonus;
    _showToast?.("✓ 保存しました");
  } catch (e) {
    _showToast?.("⚠️ 保存失敗: " + e.message);
  }
}

async function updateIncentiveRate(kind, value) {
  const n = parseInt(value, 10);
  const yen = Number.isNaN(n) || n < 0 ? 0 : n;
  try {
    const result = await App.api("PUT", "/settings", { incentive_rates: { [kind]: { yen_per_count: yen } } });
    // updateWanopeBonusと同じ理由(日次入力画面の見積額キャッシュを即時更新)。
    window.INCENTIVE_RATES = result.incentive_rates;
    _showToast?.("✓ 保存しました");
  } catch (e) {
    _showToast?.("⚠️ 保存失敗: " + e.message);
  }
}

// ── データのエクスポート/インポート(新設。local/backup.js参照) ─────────────

async function exportBackupData() {
  try {
    const result = await App.api("POST", "/backup/export");
    _showToast?.(`✓ 書き出しました（${result.filename}）`);
  } catch (e) {
    _showToast?.("⚠️ 書き出し失敗: " + e.message);
  }
}

// FileReaderで読み込んだ内容を、ユーザーがモーダルで確認するまで保持する一時変数。
let _pendingBackupImportData = null;

function _onBackupFileSelected(files) {
  const file = files && files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (e) {
      alert("JSONファイルの読み込みに失敗しました。ファイルが壊れている可能性があります。");
      return;
    }
    _pendingBackupImportData = data;
    _showBackupImportConfirmModal();
  };
  reader.onerror = () => {
    alert("ファイルの読み込みに失敗しました。");
  };
  reader.readAsText(file);
  // 同じファイルを選び直した場合もonchangeが発火するよう、選択状態をリセットする。
  const input = document.getElementById("backup-import-input");
  if (input) input.value = "";
}

// 「現在のデータを上書きします。よろしいですか」の確認。
// このプロジェクトはネイティブのconfirm()を多くの画面で使っているが、
// データの読み込み(全ストア上書き・元に戻せない)はそれよりもう一段重い操作のため、
// frontend/app.js::_confirmDateやfrontend/inventory.js::_addModalと同じ、
// 画面内に生成するオーバーレイ型のモーダルで実装する(計画書Task12の明示指示)。
function _showBackupImportConfirmModal() {
  const existing = document.getElementById("backup-import-modal");
  if (existing) existing.remove();
  const modal = document.createElement("div");
  modal.id = "backup-import-modal";
  Object.assign(modal.style, {
    position: "fixed", inset: "0", background: "rgba(0,0,0,0.7)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: "9999",
  });
  modal.innerHTML = `
    <div style="background:#1f2937;border-radius:12px;padding:20px;max-width:360px;width:90%;">
      <div style="font-size:14px;font-weight:700;color:#f87171;margin-bottom:10px;">データを読み込みますか？</div>
      <div style="font-size:13px;color:#d1d5db;margin-bottom:16px;">
        現在アプリに保存されている全データ（店舗・スタッフ・実績・シフト・在庫・設定など）が、
        選択したファイルの内容で上書きされます。この操作は元に戻せません。
      </div>
      <div style="display:flex;gap:8px;">
        <button onclick="_cancelBackupImport()"
          style="flex:1;padding:10px;background:#374151;border:none;border-radius:8px;color:#9ca3af;font-size:14px;cursor:pointer;">キャンセル</button>
        <button onclick="_confirmBackupImport()"
          style="flex:1;padding:10px;background:#7c3aed;border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;">上書きして読み込む</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function _cancelBackupImport() {
  _pendingBackupImportData = null;
  document.getElementById("backup-import-modal")?.remove();
}

async function _confirmBackupImport() {
  const data = _pendingBackupImportData;
  _pendingBackupImportData = null;
  document.getElementById("backup-import-modal")?.remove();
  if (!data) return;
  try {
    await App.api("POST", "/backup/import", data);
    _showToast?.("✓ データを読み込みました。再読み込みします…");
    // インポートは全ストアを書き換えるため、他モジュールが保持するメモリ上の
    // キャッシュ(local/payroll-admin.jsの確定月キャッシュ、App._getCache、
    // window.STORE_NAME等)が古いままになる。個別に全部洗い出して無効化するより、
    // ページ全体をリロードして確実に最新状態から始める方が安全(local/backup.js
    // 先頭コメント参照)。
    setTimeout(() => location.reload(), 1200);
  } catch (e) {
    alert("読み込みに失敗しました: " + e.message);
  }
}

const _DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function renderStoreSettings(stores) {
  const el = document.getElementById("store-settings");
  el.innerHTML = `<h3 style="color:#6b7280;font-size:12px;text-transform:uppercase;margin-bottom:12px;">店舗設定</h3>`;
  for (const [storeId, store] of Object.entries(stores)) {
    const closedDays = store.regular_closed_days || [];
    el.innerHTML += `
      <div class="card" style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <div style="color:#a78bfa;font-weight:700;">${_settingsEscAttr(store.name || "")}</div>
          <button onclick="deleteStore('${storeId}')"
            style="background:none;border:none;color:#f87171;font-size:11px;cursor:pointer;">削除</button>
        </div>
        <div class="label">定休日</div>
        <div style="display:flex;gap:6px;margin-bottom:16px;">
          ${_DOW_LABELS.map((label, dow) => `
            <label style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;">
              <span style="font-size:11px;color:${closedDays.includes(dow) ? '#f87171' : '#6b7280'};">${label}</span>
              <input type="checkbox" ${closedDays.includes(dow) ? "checked" : ""}
                onchange="toggleRegularClosedDay('${storeId}',${dow},this.checked)">
            </label>`).join("")}
        </div>
        <div class="label">シャンパンメニュー</div>
        <div id="champ-${storeId}"></div>
        <button class="btn-primary" style="margin-top:8px;font-size:12px;padding:6px 14px;"
          onclick="addChampagne('${storeId}')">+ 追加</button>
      </div>`;
    renderChampMenu(storeId, store.champagne_menu);
  }
  el.innerHTML += `
    <div class="card" style="margin-bottom:12px;">
      <div class="label">店舗を追加</div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
        <input type="text" id="new-store-name" placeholder="店舗名" style="flex:1;">
        <button class="btn-primary" style="font-size:12px;padding:6px 14px;"
          onclick="addStore()">追加</button>
      </div>
    </div>`;
}

// 「追加」の二重クリック対策。店舗idは "store_" + Date.now() で作るため
// 2回目のクリックは別idになり、サーバー側の重複idチェックに引っかからず
// 同名の店舗が2つできてしまう(見分けがつかず、片方に実績を入れ始めると
// 削除ガードで消せなくなる)。送信中フラグで2回目以降を捨てる。
let _storeAddInFlight = false;

async function addStore() {
  if (_storeAddInFlight) return;
  const input = document.getElementById("new-store-name");
  const name = (input?.value || "").trim();
  if (!name) return;
  _storeAddInFlight = true;
  const id = "store_" + Date.now();
  try {
    await App.api("POST", "/stores", { id, name });
    if (input) input.value = "";
    // 店舗一覧のキャッシュ(window.STORE_NAME/_storeIds/App.currentStore)を
    // 更新しないと、在庫画面など window._storeIds を見る画面に新しい店舗が
    // 画面再読込まで出てこない(エラーも出ないので気づけない)。
    await window._loadStoreInfo?.();
    App.go("settings");
  } catch (e) {
    _showToast?.("⚠️ 追加失敗: " + e.message);
  } finally {
    _storeAddInFlight = false;
  }
}

async function deleteStore(storeId) {
  // 店舗削除は元に戻せないうえ、確認なしの1クリックで消える位置にある。
  // (実績・在籍スタッフが残っていればサーバー側が409で止めるが、
  //  作ったばかりの空の店舗は何の警告もなく消えてしまう)
  const storeName = (window.STORE_NAME || {})[storeId] || storeId;
  if (!confirm(`店舗「${storeName}」を削除します。\n元に戻せません。よろしいですか？`)) return;
  try {
    await App.api("DELETE", `/stores/${storeId}`);
    await window._loadStoreInfo?.();
    App.go("settings");
  } catch (e) {
    _showToast?.("⚠️ 削除失敗: " + e.message);
    App.go("settings");
  }
}

async function toggleRegularClosedDay(storeId, dow, checked) {
  try {
    const store = await App.api("GET", `/stores/${storeId}`);
    let days = store.regular_closed_days || [];
    days = checked ? [...new Set([...days, dow])] : days.filter(d => d !== dow);
    days.sort();
    await App.api("PUT", `/stores/${storeId}`, { regular_closed_days: days });
    _showToast?.(`✓ ${store.name}の定休日を更新しました`);
  } catch (e) {
    _showToast?.("⚠️ 保存失敗: " + e.message);
    App.go("settings");
  }
}

function renderChampMenu(storeId, menu) {
  const el = document.getElementById(`champ-${storeId}`);
  el.innerHTML = menu.map(c => `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
      <input type="text" value="${_settingsEscAttr(c.name)}" style="flex:1;"
        onchange="updateChamp('${storeId}','${c.id}','name',this.value)">
      <input type="number" value="${c.price}" style="width:90px;text-align:right;"
        onchange="updateChamp('${storeId}','${c.id}','price',parseInt(this.value))">
      <span style="color:#6b7280;font-size:12px;">円</span>
      <button onclick="deleteChamp('${storeId}','${c.id}')"
        style="background:#374151;border:none;color:#f87171;border-radius:4px;padding:4px 8px;cursor:pointer;">✕</button>
    </div>`).join("");
}

async function updateChamp(storeId, champId, field, value) {
  try {
    await App.api("PUT", `/stores/${storeId}/champagne/${champId}`, {[field]: value});
  } catch(e) {
    _showToast?.("⚠️ 保存失敗: " + e.message);
  }
}

async function deleteChamp(storeId, champId) {
  try {
    await App.api("DELETE", `/stores/${storeId}/champagne/${champId}`);
    App.go("settings");
  } catch(e) {
    _showToast?.("⚠️ 削除失敗: " + e.message);
  }
}

async function addChampagne(storeId) {
  const result = await window.promptModal("シャンパン追加", [
    { label: "銘柄名", value: "" },
    { label: "価格（円）", value: "0", type: "number" },
  ]);
  if (!result) return;
  const [name, priceStr] = result;
  if (!name) return;
  const price = parseInt(priceStr) || 0;
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, "_") + "_" + Date.now();
  try {
    await App.api("POST", `/stores/${storeId}/champagne`, {id, name, price});
    App.go("settings");
  } catch(e) {
    _showToast?.("⚠️ 追加失敗: " + e.message);
  }
}

function renderStaffSettings(allStaff, stores) {
  const el = document.getElementById("staff-settings");
  el.innerHTML = `<h3 style="color:#6b7280;font-size:12px;text-transform:uppercase;margin-bottom:12px;">スタッフ設定</h3>`;
  for (const [storeId, store] of Object.entries(stores)) {
    const storeStaff = allStaff
      .filter(s => s.store_id === storeId && s.active)
      .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
    const resignedStaff = allStaff
      .filter(s => s.store_id === storeId && !s.active)
      .sort((a, b) => String(b.resignation_date || "").localeCompare(String(a.resignation_date || "")));
    const resignedHtml = resignedStaff.length > 0 ? `
      <div style="margin-top:14px;border-top:1px solid #1f2937;padding-top:10px;">
        <button id="toggle-resigned-${storeId}" onclick="toggleResignedList('${storeId}')"
          style="background:none;border:1px solid #374151;color:#9ca3af;font-size:11px;padding:5px 10px;border-radius:6px;cursor:pointer;">
          退職者一覧を表示（${resignedStaff.length}名）
        </button>
        <div id="resigned-list-${storeId}" style="display:none;margin-top:8px;">
          ${resignedStaff.map(s => `
            <div style="display:flex;justify-content:space-between;align-items:center;background:#111827;border-radius:6px;padding:8px 10px;margin-bottom:6px;font-size:12px;">
              <div>
                <span style="color:#f3f4f6;">${_settingsEscAttr(s.name || "")}</span>
                <span style="color:#6b7280;margin-left:8px;">退職日: ${s.resignation_date || "未設定"}</span>
              </div>
              <button onclick="reactivateStaff('${s.id}','${(s.name||"").replace(/'/g,"\\'")}')"
                style="background:#1f2937;border:1px solid #374151;color:#93c5fd;font-size:11px;padding:4px 10px;border-radius:4px;cursor:pointer;">再雇用</button>
            </div>`).join("")}
        </div>
      </div>` : "";
    el.innerHTML += `
      <div class="card" style="margin-bottom:12px;">
        <div style="color:#a78bfa;font-weight:700;margin-bottom:12px;">${_settingsEscAttr(store.name || "")}</div>
        ${storeStaff.map((s, i) => renderStaffCard(s, i, storeStaff.length)).join("")}
        <button class="btn-primary" style="font-size:12px;padding:6px 14px;margin-top:6px;"
          onclick="addStaff('${storeId}')">+ スタッフ追加</button>
        ${resignedHtml}
      </div>`;
  }
  // 2026-10-02発見: 店舗ごとのループ内で el.innerHTML += を複数回行うと、
  // 2店舗目以降の追記のたびに直前までの内容(1店舗目のカード含む)ごと
  // 文字列化→再パースされ、既存のDOMノードが丸ごと新しい別ノードに
  // 置き換わる(innerHTML+=の仕様)。ループ内でそのタイミングに
  // document.getElementByIdしたtraining-progress要素への参照は、
  // 後続店舗の追記で即座に無効(デタッチ)になり、fetch完了後に
  // そこへ書き込んでも画面には反映されない(「読み込み中...」のまま
  // 固まって見えるだけでエラーにもならない)。全店舗のinnerHTML組み立てが
  // 完全に終わった後、ループの外でまとめて呼ぶことで回避する。
  for (const s of allStaff) {
    if (s.active && s.training_rate) {
      _loadTrainingProgress(s.id, s.training_rate.threshold_hours ?? _DEFAULT_TRAINING_THRESHOLD);
    }
  }
}

function toggleResignedList(storeId) {
  const list = document.getElementById(`resigned-list-${storeId}`);
  const btn = document.getElementById(`toggle-resigned-${storeId}`);
  if (!list) return;
  const willShow = list.style.display === "none";
  list.style.display = willShow ? "block" : "none";
  if (btn) {
    const count = list.children.length;
    btn.textContent = willShow ? "退職者一覧を隠す" : `退職者一覧を表示（${count}名）`;
  }
}

function renderStaffCard(s, idx, total) {
  const isMonthly = s.pay_type === "monthly";
  const rateHistory = (s.rate_history || [])
    .filter(h => h && typeof h === 'object' && h.from != null)
    .sort((a, b) => String(a.from).localeCompare(String(b.from)));
  return `
    <div style="background:#111827;border-radius:8px;padding:12px;margin-bottom:8px;">
      <div style="display:flex;gap:4px;margin-bottom:8px;align-items:center;">
        <div style="display:flex;flex-direction:column;gap:2px;margin-right:4px;">
          <button onclick="moveStaff('${s.id}','${s.store_id}',-1)"
            ${idx===0?"disabled":""}
            style="background:${idx===0?"#1f2937":"#374151"};border:none;color:${idx===0?"#4b5563":"#f3f4f6"};border-radius:4px;padding:1px 7px;cursor:pointer;font-size:11px;line-height:1.4;">▲</button>
          <button onclick="moveStaff('${s.id}','${s.store_id}',1)"
            ${idx===total-1?"disabled":""}
            style="background:${idx===total-1?"#1f2937":"#374151"};border:none;color:${idx===total-1?"#4b5563":"#f3f4f6"};border-radius:4px;padding:1px 7px;cursor:pointer;font-size:11px;line-height:1.4;">▼</button>
        </div>
        <input type="text" value="${_settingsEscAttr(s.name)}" style="flex:1;"
          onchange="updateStaff('${s.id}','name',this.value)">
        <select style="background:#1f2937;border:1px solid #374151;color:#f3f4f6;border-radius:6px;padding:7px;"
          onchange="updateStaff('${s.id}','pay_type',this.value)">
          <option value="hourly" ${!isMonthly?"selected":""}>時給</option>
          <option value="monthly" ${isMonthly?"selected":""}>月給</option>
        </select>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <div style="flex:1;">
          <div class="label">${isMonthly?"月給（額面）":"時給（現在）"}</div>
          ${isMonthly ? `<input type="number" value="${s.monthly_salary}" style="width:100%;"
            onchange="updateStaff('${s.id}','monthly_salary',parseInt(this.value))">` :
            (() => {
              // 表示はservices.payroll.get_effective_rateと同じ考え方に揃える:
              // rate_historyがあれば必ずその最新値を「現在」として表示する。
              // hourly_rateフィールドを直接出すと、rate_historyがJSON直接編集等
              // (addRateHistory以外の経路)で更新された場合に古い値が表示され続け、
              // 実際の給与計算(常にrate_history優先)と食い違って見える
              // (実例: 時給が実際は1,350円なのに設定画面が1,250円のままに
              // なっていた。給与計算自体は正しかったが表示だけズレていた)。
              const current = rateHistory.length > 0 ? rateHistory[rateHistory.length - 1].rate : (s.hourly_rate || 0);
              return `<div style="padding:7px 10px;background:#0f172a;border:1px solid #374151;border-radius:6px;color:#f3f4f6;font-size:14px;">
              ¥${(current||0).toLocaleString()}<span style="color:#6b7280;font-size:11px;margin-left:4px;">現在適用中</span>
            </div>`;
            })()}
        </div>
        <div style="flex:1;">
          <div class="label">交通費（片道）</div>
          <input type="number" value="${s.transport_one_way ?? 0}" style="width:100%;"
            onchange="updateStaff('${s.id}','transport_one_way',parseInt(this.value))">
        </div>
      </div>
      ${!isMonthly ? `
      <div style="margin-bottom:8px;background:#0f172a;border:1px solid #1f2937;border-radius:6px;padding:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div class="label" style="margin:0;">時給履歴</div>
          <button onclick="toggleRateAddForm('${s.id}')"
            style="background:#1f2937;border:1px solid #374151;color:#a78bfa;font-size:11px;padding:3px 10px;border-radius:4px;cursor:pointer;">
            ＋ 時給変更を追加
          </button>
        </div>
        <div id="rate-add-form-${s.id}" style="display:none;background:#0f172a;border:1px solid #1f2937;border-radius:6px;padding:8px;margin-bottom:8px;">
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="date" id="rate-from-${s.id}" style="flex:1;">
            <input type="number" id="rate-amount-${s.id}" placeholder="時給(円)" style="width:90px;">
            <button onclick="submitRateHistory('${s.id}')"
              style="background:#1a3320;border:1px solid #4ade80;color:#4ade80;font-size:11px;padding:5px 10px;border-radius:4px;cursor:pointer;">追加</button>
          </div>
        </div>
        ${rateHistory.length === 0 ? `<div style="color:#6b7280;font-size:12px;">履歴なし（現在の時給のみ適用）</div>` :
          rateHistory.map((h, i) => {
            const isCurrent = i === rateHistory.length - 1;
            const nextFrom = rateHistory[i+1] ? rateHistory[i+1].from : null;
            const period = nextFrom ? `${h.from} 〜 ${nextFrom}` : `${h.from} 〜 現在`;
            return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #1f2937;font-size:12px;">
              <span style="color:#9ca3af;min-width:180px;">${period}</span>
              <span style="font-weight:${isCurrent?'700':'400'};color:${isCurrent?'#a78bfa':'#f3f4f6'};">
                ¥${(h.rate ?? 0).toLocaleString()}${isCurrent?' ← 現在':''}
              </span>
              <button onclick="deleteRateHistory('${s.id}','${h.from}')"
                style="background:none;border:none;color:#4b5563;font-size:10px;cursor:pointer;margin-left:auto;">✕</button>
            </div>`;
          }).join("")
        }
      </div>` : ""}
      <div style="margin-bottom:8px;">
        <div class="label">退職日${s.resignation_date ? `<span style="color:#f87171;font-weight:400;margin-left:6px;">設定済み</span>` : ""}</div>
        <input type="date" id="resign-date-${s.id}" value="${s.resignation_date || ""}" style="width:100%;"
          onchange="updateStaff('${s.id}','resignation_date',this.value || null)">
        <div style="color:#6b7280;font-size:11px;margin-top:3px;">
          月給者の健康保険・厚生年金・子育て拠出金は「月末退職の特例」で自動判定されます。
          退職日が月末日ならその月分あり、月の途中ならその月分は控除なしになります（雇用保険料は対象外・通常通り控除）。
        </div>
      </div>
      ${!isMonthly ? renderTrainingRateSection(s) : ""}
      <div style="display:flex;gap:16px;align-items:center;margin-top:6px;">
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
          <input type="checkbox" ${s.hand_delivery?"checked":""}
            onchange="updateStaff('${s.id}','hand_delivery',this.checked)">
          <span style="font-size:12px;color:#fbbf24;">手渡し</span>
        </label>
        <button onclick="resignStaff('${s.id}','${(s.name||"").replace(/'/g,"\\'")}',${s.pay_type==="monthly"?"true":"false"})"
          style="background:none;border:none;color:#f87171;font-size:11px;cursor:pointer;">退職処理</button>
      </div>
    </div>`;
}

// 研修時給(新人が累計◯時間を超えたら自動昇給する仕組み)の設定UI。
// しきい値は一般的な運用に合わせて100時間をデフォルト値にして
// 毎回入力しなくても済むようにし、必要な時だけ変更できる形にする。
const _DEFAULT_TRAINING_THRESHOLD = 100;

function renderTrainingRateSection(s) {
  const tr = s.training_rate;
  const current = s.hourly_rate || 0;
  if (!tr) {
    return `
    <div style="margin-bottom:8px;background:#0f172a;border:1px solid #1f2937;border-radius:6px;padding:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div class="label" style="margin:0;">研修時給</div>
        <button onclick="toggleTrainingForm('${s.id}')"
          style="background:#1f2937;border:1px solid #374151;color:#a78bfa;font-size:11px;padding:3px 10px;border-radius:4px;cursor:pointer;">
          ＋ 研修時給を設定（新人用）
        </button>
      </div>
      <div id="training-form-${s.id}" style="display:none;margin-top:8px;">
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;color:#9ca3af;width:70px;">研修中</span>
          <input type="number" id="training-base-${s.id}" value="${current}" style="width:90px;">
          <span style="font-size:11px;color:#6b7280;">円/h</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;color:#9ca3af;width:70px;">卒業後</span>
          <input type="number" id="training-raised-${s.id}" value="${current + 100}" style="width:90px;">
          <span style="font-size:11px;color:#6b7280;">円/h</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
          <span style="font-size:11px;color:#9ca3af;width:70px;">卒業条件</span>
          <span style="font-size:11px;color:#6b7280;">累計</span>
          <input type="number" id="training-threshold-${s.id}" value="${_DEFAULT_TRAINING_THRESHOLD}" style="width:60px;">
          <span style="font-size:11px;color:#6b7280;">時間（通常は100のままでOK）</span>
        </div>
        <button onclick="submitTrainingRate('${s.id}')"
          style="background:#1a3320;border:1px solid #4ade80;color:#4ade80;font-size:11px;padding:5px 10px;border-radius:4px;cursor:pointer;">設定する</button>
      </div>
    </div>`;
  }
  return `
    <div style="margin-bottom:8px;background:#0f172a;border:1px solid #1f2937;border-radius:6px;padding:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div class="label" style="margin:0;">研修時給</div>
        <button onclick="removeTrainingRate('${s.id}','${(s.name||"").replace(/'/g,"\\'")}')"
          style="background:none;border:none;color:#4b5563;font-size:10px;cursor:pointer;">解除</button>
      </div>
      <div style="font-size:12px;color:#f3f4f6;">
        研修中 ¥${tr.base_rate?.toLocaleString() ?? 0} → 累計${tr.threshold_hours ?? 0}時間で ¥${tr.raised_rate?.toLocaleString() ?? 0}
      </div>
      <div id="training-progress-${s.id}" style="font-size:11px;color:#6b7280;margin-top:4px;">読み込み中...</div>
    </div>`;
}

function toggleTrainingForm(staffId) {
  const form = document.getElementById(`training-form-${staffId}`);
  if (!form) return;
  form.style.display = form.style.display === "none" ? "block" : "none";
}

async function submitTrainingRate(staffId) {
  const base = parseInt(document.getElementById(`training-base-${staffId}`)?.value || "0");
  const raised = parseInt(document.getElementById(`training-raised-${staffId}`)?.value || "0");
  const threshold = parseInt(document.getElementById(`training-threshold-${staffId}`)?.value || String(_DEFAULT_TRAINING_THRESHOLD));
  if (!base || !raised) {
    alert("研修中・卒業後の時給を入力してください。");
    return;
  }
  try {
    await App.api("PUT", `/staff/${encodeURIComponent(staffId)}`, {
      training_rate: { base_rate: base, raised_rate: raised, threshold_hours: threshold }
    });
    App.go("settings");
  } catch (e) {
    _showToast?.("⚠️ 研修時給の設定失敗: " + e.message);
  }
}

async function removeTrainingRate(staffId, staffName) {
  if (!confirm(`${staffName}の研修時給設定を解除しますか？\n以後は通常の時給（履歴）で計算されます。`)) return;
  try {
    await App.api("PUT", `/staff/${encodeURIComponent(staffId)}`, { training_rate: null });
    App.go("settings");
  } catch (e) {
    _showToast?.("⚠️ 解除失敗: " + e.message);
  }
}

async function _loadTrainingProgress(staffId, threshold) {
  const el = document.getElementById(`training-progress-${staffId}`);
  if (!el) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await App.api("GET", `/payroll/effective-rate/${encodeURIComponent(staffId)}/${today}`);
    const hrs = res.cumulative_hours ?? 0;
    if (hrs >= threshold) {
      el.innerHTML = `<span style="color:#4ade80;">✓ 卒業済み（累計${hrs.toFixed(1)}時間）現在 ¥${res.rate.toLocaleString()}</span>`;
    } else {
      el.textContent = `累計${hrs.toFixed(1)}時間 / ${threshold}時間（あと${(threshold - hrs).toFixed(1)}時間で昇給）`;
    }
  } catch (e) {
    el.textContent = "";
  }
}

async function updateStaff(staffId, field, value) {
  try {
    await App.api("PUT", `/staff/${encodeURIComponent(staffId)}`, {[field]: value});
    _showToast?.("✓ 保存しました");
  } catch(e) {
    _showToast?.("⚠️ 保存失敗: " + e.message);
  }
}

async function moveStaff(staffId, storeId, dir) {
  try {
    const allStaff = await App.api("GET", `/staff?store_id=${storeId}`);
    const sorted = allStaff
      .filter(s => s.active)
      .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
    const idx = sorted.findIndex(s => s.id === staffId);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx], b = sorted[swapIdx];
    const ao = a.sort_order ?? idx, bo = b.sort_order ?? swapIdx;
    await Promise.all([
      App.api("PUT", `/staff/${encodeURIComponent(a.id)}`, {sort_order: bo}),
      App.api("PUT", `/staff/${encodeURIComponent(b.id)}`, {sort_order: ao}),
    ]);
    App.go("settings");
  } catch(e) {
    _showToast?.("⚠️ 並び替え失敗: " + e.message);
  }
}

async function resignStaff(staffId, staffName, isMonthly) {
  // テキストプロンプトではなく、カード上部に既にあるネイティブの日付ピッカー
  // (id="resign-date-${staffId}")の入力値をそのまま使う(2026-09-11、
  // 「もっと視覚的な入力にして」との要望への対応)。未入力のまま押された場合は
  // 非アクティブ化せず、その場でカレンダー入力にフォーカスを戻して促す
  // (退職日を設定せずに退職処理が完了してしまう抜け道を塞ぐのが目的なので、
  // ここを素通りさせない)。
  const dateInput = document.getElementById(`resign-date-${staffId}`);
  const date = dateInput?.value || "";
  if (!date) {
    alert(`先に上の「退職日」欄で日付を選択してください。`);
    dateInput?.focus();
    return;
  }
  const note = isMonthly
    ? "\n（月末退職の特例による社会保険自動判定に使われます）"
    : "";
  if (!confirm(`${staffName}を${date}付で退職処理し、非アクティブ化します。${note}\nよろしいですか？`)) return;
  try {
    // 日付欄自体は既にonchangeで保存済みのはずだが、値だけ変更してonchangeを
    // 経由せずボタンを押したケースに備えて明示的に送り直してから非アクティブ化する。
    await App.api("PUT", `/staff/${encodeURIComponent(staffId)}`, {resignation_date: date});
    await App.api("DELETE", `/staff/${encodeURIComponent(staffId)}`);
    App.go("settings");
  } catch(e) {
    _showToast?.("⚠️ 退職処理失敗: " + e.message);
  }
}

async function reactivateStaff(staffId, staffName) {
  // 再雇用時。退職日を残したまま再アクティブ化すると、月末退職特例の自動判定が
  // 復職後の月もずっと「退職済み」扱いのままになり社保が0円になり続ける
  // (2026-09-10の設計批評で指摘された再雇用トラップ)。ここで退職日を
  // 明示的にクリアすることで、その場で問題の芽を摘む。
  if (!confirm(`${staffName}を再雇用（アクティブ化）しますか？\n退職日はクリアされます。`)) return;
  try {
    await App.api("PUT", `/staff/${encodeURIComponent(staffId)}`, {active: true, resignation_date: null});
    App.go("settings");
  } catch(e) {
    _showToast?.("⚠️ 再雇用処理失敗: " + e.message);
  }
}

function toggleRateAddForm(staffId) {
  const form = document.getElementById(`rate-add-form-${staffId}`);
  if (!form) return;
  form.style.display = form.style.display === "none" ? "block" : "none";
}

async function submitRateHistory(staffId) {
  // テキストプロンプト2連発(適用日→時給)をやめ、カレンダーピッカー＋数値入力の
  // インラインフォームに置き換えた(2026-09-11、退職日と同じ「視覚的な入力」の
  // 要望への対応)。
  const from = document.getElementById(`rate-from-${staffId}`)?.value || "";
  const rate = parseInt(document.getElementById(`rate-amount-${staffId}`)?.value || "0");
  if (!from) {
    alert("適用開始日を選択してください。");
    return;
  }
  if (!rate) {
    alert("時給を入力してください。");
    return;
  }
  try {
    const staff = await App.api("GET", `/staff/${encodeURIComponent(staffId)}`);
    const history = (staff.rate_history || []).filter(h => h && typeof h === 'object' && h.from != null && h.from !== from);
    history.push({ from, rate });
    history.sort((a, b) => String(a.from).localeCompare(String(b.from)));
    const latestRate = history[history.length - 1].rate;
    await App.api("PUT", `/staff/${encodeURIComponent(staffId)}`, { rate_history: history, hourly_rate: latestRate });
    App.go("settings");
  } catch(e) {
    _showToast?.("⚠️ 時給履歴の更新失敗: " + e.message);
  }
}

async function deleteRateHistory(staffId, fromDate) {
  try {
    const staff = await App.api("GET", `/staff/${encodeURIComponent(staffId)}`);
    const history = (staff.rate_history || []).filter(h => h && typeof h === 'object' && h.from != null && h.from !== fromDate);
    const patch = { rate_history: history };
    if (history.length > 0) {
      patch.hourly_rate = history[history.length - 1].rate ?? 0;
    }
    await App.api("PUT", `/staff/${encodeURIComponent(staffId)}`, patch);
    App.go("settings");
  } catch(e) {
    _showToast?.("⚠️ 時給履歴の削除失敗: " + e.message);
  }
}

async function addStaff(storeId) {
  const nameResult = await window.promptModal("スタッフ追加", [
    { label: "スタッフ名", value: "" },
  ]);
  if (!nameResult) return;
  const [nameRaw] = nameResult;
  if (!nameRaw) return;
  const trimmed = nameRaw.trim();
  if (!trimmed) return;
  // 名前はそのままstaff_id(name + "_" + timestamp)に埋め込まれ、その後
  // HTML属性(data-sid等)やCSSセレクタ、onclick文字列など複数箇所に
  // そのまま展開される。引用符・バッククォートを許すと個別のエスケープ漏れで
  // 表示崩れやクリック不能になりうるため、入力時点で弾く。
  if (/["'`]/.test(trimmed)) {
    alert(`スタッフ名に引用符（" ' \`）は使用できません。`);
    return;
  }

  // 同じ店舗に同名スタッフが既にいる場合、新規IDを別途発行すると過去の
  // 実績(staff_entries)が旧IDのまま残り、非アクティブ化した瞬間に日次・
  // 給与・シフト画面からその人のデータが全部消えて見える事故になる
  // (過去に実際に発生した事故)。名前が被ったら必ず確認を挟む。
  // 以降は常にtrimmed(前後空白除去済み)を保存する。生のnameRawをそのまま
  // 保存すると、次に同名スタッフを探すこのdupeチェック自体が一致しなくなり
  // (nippo-log.jsの完全一致マッチングも同様)、同じ事故が形を変えて再発する。
  let existingStaff = [];
  try { existingStaff = await App.api("GET", "/staff"); } catch (e) { existingStaff = []; }
  const dupes = existingStaff.filter(s =>
    s && typeof s === 'object' && s.store_id === storeId &&
    (s.name || "").trim() === trimmed
  );
  if (dupes.length) {
    const inactiveDupes = dupes.filter(s => !s.active);
    if (inactiveDupes.length === 1 && dupes.every(s => !s.active)) {
      const reactivate = confirm(
        `「${trimmed}」は既に登録済み（非アクティブ）です。\n` +
        `新規追加すると過去の実績データが別人扱いになります。\n` +
        `OK: 既存スタッフを復帰させる / キャンセル: このまま新規追加する`
      );
      if (reactivate) {
        await App.api("PUT", `/staff/${encodeURIComponent(inactiveDupes[0].id)}`, { active: true });
        App.go("settings");
        return;
      }
      // キャンセル時はこのまま下の新規追加処理へフォールスルー
    } else if (inactiveDupes.length >= 2) {
      // 非アクティブな同名候補が複数いて、どちらを復帰させるべきか自動判断
      // できないケース。誤って違う人を復帰させるより、設定画面での手動対応に倒す。
      const proceed = confirm(
        `「${trimmed}」という名前の非アクティブなスタッフが既に${inactiveDupes.length}件登録されています。\n` +
        `どれを復帰させるべきか自動判断できないため、新規追加するか設定画面で個別に確認してください。\n` +
        `別人の場合のみ「OK」で新規追加してください。`
      );
      if (!proceed) return;
    } else {
      // アクティブな同名が既にいるケース。
      const proceed = confirm(
        `「${trimmed}」は既にこの店舗に登録されています。\n` +
        `別人の場合のみ「OK」で新規追加してください。`
      );
      if (!proceed) return;
    }
  }

  const payResult = await window.promptModal("スタッフ追加", [
    { label: "時給（円）", value: "1100", type: "number" },
    { label: "交通費（片道・円）", value: "500", type: "number" },
  ]);
  if (!payResult) return;
  const [rateStr, transportStr] = payResult;
  const rateNum = parseInt(rateStr);
  const rate = Number.isNaN(rateNum) ? 1100 : rateNum;
  const transportNum = parseInt(transportStr);
  const transport = Number.isNaN(transportNum) ? 500 : transportNum;
  const id = trimmed + "_" + Date.now();
  try {
    await App.api("POST", "/staff", {
      id, name: trimmed, store_id: storeId, pay_type: "hourly",
      monthly_salary: null, hourly_rate: rate, transport_one_way: transport,
      active: true, deduction: null
    });
  } catch (e) {
    _showToast?.("⚠️ 追加失敗: " + e.message);
    return;
  }
  App.go("settings");
}
