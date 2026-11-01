if ('serviceWorker' in navigator) {
  // 相対パスで登録する(GitHub Pagesがサブパス配信のため。絶対パス'/sw.js'だと
  // ドメインルート直下を探しにいき404になる)。index.htmlと同じディレクトリの
  // sw.jsを指す。
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW:', e));
}

// audit-loop(2026-11-02)の監査で指摘(設計批評・major): このアプリの全業務
// データ(売上・給与・スタッフ情報)は1台の端末のIndexedDBにしか存在せず、
// サーバー側の控えが無い。navigator.storage.persist()を一度も呼んでおらず、
// 端末のストレージ容量が逼迫した場合にブラウザがこのオリジンのデータを
// 勝手に消去しうる状態だった(「ホーム画面に追加したPWAは7日ルールの対象外」
// という説明は期限切れ削除だけの話で、容量逼迫時の削除とは別の話)。
// 呼ぶだけでよく、失敗してもアプリの動作に影響しない(ベストエフォート)ため、
// 起動時に一度呼んでおく。
//
// audit-loop(2026-11-02、2周目)の監査で指摘(Critical): 上の「失敗しても
// アプリの動作に影響しない」はPromiseのreject(.catchで吸収)しか想定して
// おらず、呼び出し自体が同期的に例外を投げるケース(買い手が実際に使う
// かもしれない古いAndroid WebViewや、ネイティブアプリでラップされた
// WKWebView等、Storage APIの実装が不完全な環境で起こりうる)を防げていなかった。
// このコードはファイル先頭・トップレベルにあり、ここで例外が飛ぶと
// このスクリプト自体の実行が止まり、下のDOMContentLoadedの登録
// (アプリ全体のUI初期化)まで巻き込んで動かなくなる——「ベストエフォートで
// 壊れない」というコメントの主張自体が嘘になってしまう。try/catchで
// 同期例外も確実に吸収する。
try {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
} catch (e) {
  console.warn('storage.persist failed synchronously (ignored):', e);
}

// 2026-11-01 PWA化: OCRアップロード(_uploadAndNavigate等、下記)は非ゴールとして
// サーバー側実装を移植していないため、このAPI定数へのfetchは現状どれも404になる
// (Task11の範囲外。OCR/日報写真機能自体を使わなければ影響しない)。
const API = window.location.origin;

// 全画面共通定数（/storesから動的構築、/configで上書き）
window.STORE_COLOR  = {};
window.STORE_NAME   = {};
// 既定はサーバー側(services/payroll._get_wanope_bonus・routers/settings._DEFAULTS)と
// 揃えて0。/settingsの取得に失敗した場合でも画面の見積額が実際の給与計算と
// ズレないようにする。
window.WANOPE_BONUS = 0;
// 新設: キャッチ・呼び・延長・ドリンクインセンティブの単価
// (local/settings.js::getSettings参照)。catch/call/extensionはWANOPE_BONUSと
// 同じ考え方で既定0円(未設定の間は見積額に影響しない)。drinkのみ既定70円
// (元々のDRINK_UNIT固定値を踏襲。local/payroll.js::getIncentiveRates参照。
// 2026-11-02、買い手の実際の単価100円が判明したため設定可能にした)。
window.INCENTIVE_RATES = {
  catch: { yen_per_count: 0 },
  call: { yen_per_count: 0 },
  extension: { yen_per_count: 0 },
  drink: { yen_per_count: 70 },
};
// 新設: 平均滞在時間の概算に使う基本セッション時間(分)。延長回数(30分単位)
// から逆算する(frontend/summary.js参照)。既定60分
// (local/settings.js::_DEFAULTS.base_session_minutes参照)。
window.BASE_SESSION_MINUTES = 60;

// 店舗名・スタッフ名はユーザーの自由入力なので、innerHTMLに差し込む前に必ず通す。
// index.htmlでapp.jsが最初に読み込まれるため、他の画面用JSからも利用できる。
// (textContent・prompt/confirm・canvasのfillTextに渡す場合はエスケープ不要)
window.escHtml = function (s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
};

// ネイティブprompt()はテキスト入力中は他の全イベント(クリック・スクリーンショット等)を
// ブロックし、ブラウザ自動化とも相性が悪い。inventory.js::_addModal/
// settings.js::_showBackupImportConfirmModalと同じオーバーレイ型モーダルに統一した、
// テキスト入力版の共通部品。呼び出し側はPromiseを待つだけでよく、
// キャンセル時はnull、確定時はfields配列と同じ順の文字列配列を返す(parseIntなどの
// 変換は呼び出し側で行う、prompt()と同じ契約)。
window.promptModal = function (title, fields) {
  return new Promise((resolve) => {
    document.getElementById("prompt-modal")?.remove();
    const modal = document.createElement("div");
    modal.id = "prompt-modal";
    Object.assign(modal.style, {
      position: "fixed", inset: "0", background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: "9999",
    });
    const fieldsHtml = fields.map((f, i) => `
      <div style="margin-bottom:10px;">
        <label style="font-size:11px;color:#9ca3af;">${window.escHtml(f.label)}</label>
        <input id="prompt-modal-field-${i}" type="${f.type || 'text'}"
          value="${window.escHtml(f.value ?? '')}"
          style="width:100%;background:#111827;border:1px solid #374151;border-radius:6px;color:#f3f4f6;padding:8px;font-size:14px;box-sizing:border-box;margin-top:4px;">
      </div>`).join("");
    modal.innerHTML = `
      <div style="background:#1f2937;border-radius:12px;padding:20px;max-width:360px;width:90%;">
        <div style="font-size:14px;font-weight:700;color:#f3f4f6;margin-bottom:16px;">${window.escHtml(title)}</div>
        ${fieldsHtml}
        <div style="display:flex;gap:8px;margin-top:6px;">
          <button id="prompt-modal-cancel"
            style="flex:1;padding:10px;background:#374151;border:none;border-radius:8px;color:#9ca3af;font-size:14px;cursor:pointer;">キャンセル</button>
          <button id="prompt-modal-ok"
            style="flex:1;padding:10px;background:#7c3aed;border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;">OK</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const cleanup = (result) => { modal.remove(); resolve(result); };
    document.getElementById("prompt-modal-cancel").onclick = () => cleanup(null);
    document.getElementById("prompt-modal-ok").onclick = () => {
      cleanup(fields.map((f, i) => document.getElementById(`prompt-modal-field-${i}`).value));
    };
    const firstInput = document.getElementById("prompt-modal-field-0");
    firstInput.focus();
    firstInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("prompt-modal-ok").click();
    });
  });
};

// _edited_fields(欄ごとの確定リスト)判定は routers/sync.py::_edited_fields() と
// 同じロジックをフロント各所(app.js/daily.js/nippo-log.js)で個別に再実装していて
// ドリフトの温床になっていた(2026-08-02の監査で指摘)。ここを唯一の実装元にし、
// 他のJSファイルは必ずこの関数を呼ぶ(index.htmlでapp.jsが最初に読み込まれるため
// グローバルとして利用可能)。
// 旧データ(_edited_fieldsが無い)は_user_editedがあれば全欄確定とみなす後方互換。
const NUMERIC_FIELDS = ["sales_excl_tax", "customer_count", "card_sales"];
function getEditedFieldsSet(entry) {
  if (!entry) return new Set();
  if (Array.isArray(entry._edited_fields)) return new Set(entry._edited_fields);
  return entry._user_edited === true ? new Set(NUMERIC_FIELDS) : new Set();
}

// OCR再取込ガード用: _user_editedはPUTを一度でも通れば常にtrueになる粗いフラグ
// (routers/daily.py::put_day)なので、これだけを見ると「OCR自動保存が1回走った
// だけ」でも以後の正しいOCR再読取まで「手入力済み」としてブロックされてしまう。
// 実際に人が確認・確定した欄があるかどうかは_edited_fields(欄ごとの確定リスト)
// またはローカルの財務値>0で判定する(サーバ側sync保護ロジックと同じ基準)。
function _hasReviewedFinancialData(existing) {
  if (!existing) return false;
  if (getEditedFieldsSet(existing).size > 0) return true;
  return NUMERIC_FIELDS.some(k => (existing[k] || 0) > 0);
}

// 2026-10-26整理: 時給制スタッフの実効時給(研修時給/rate_history)と1日の
// 支給額計算が、daily.js(_dailyGetRate/_calcEntryTotal)とnippo-log.js
// (_nlGetEffectiveRate/_nlCalcTotal)にほぼ同一のロジックで個別実装されて
// いた(_edited_fieldsと同種のドリフトリスク)。ここを唯一の実装元にする……
// はずだったが、audit-loop(2026-11-01)の監査で発覚(Critical、実害あり):
// local/payroll.js側にも同名のグローバル関数 `getEffectiveRate`(3引数目が
// 累計研修時間=数値)が既に存在しており、非モジュールの<script>タグ2本が
// 同じページに読み込まれるこのPWAでは、後から読み込まれるこのapp.js側の
// 定義(3引数目はキャッシュオブジェクト)が window.getEffectiveRate を
// 丸ごと上書きしていた。local/export.js(Excel出力)はpayroll.js側の実装に
// 依存してbareな`getEffectiveRate`を呼んでいるため、実際にはこのapp.js側の
// (シグネチャの異なる)関数が呼ばれてしまい、研修時給を卒業したスタッフの
// 時給が常に卒業前の金額で計算されていた(Node側テストはapp.jsを読み込まない
// ため検出されなかった)。この関数はフロント画面のリアルタイム見積表示専用
// なので、payroll.js側の正本と名前が衝突しないよう改名する
// (calcStaffDayTotal/daily.jsの呼び出し元も合わせて更新済み)。
function _estimateLiveEffectiveRate(staff, dateStr, trainingRateCache) {
  if (staff.training_rate) {
    const cached = trainingRateCache?.[`${staff.id}|${dateStr}`];
    if (typeof cached === "number") return cached;
    // フェッチ未完了・失敗時は昇給前提の単価を払わないよう安全側(base_rate)に倒す
    return staff.training_rate.base_rate ?? (staff.hourly_rate || 0);
  }
  const history = staff.rate_history || [];
  let rate = staff.hourly_rate || 0;
  const valid = history.filter(h => h && typeof h === 'object' && h.from != null);
  for (const h of valid.slice().sort((a, b) => String(a.from).localeCompare(String(b.from)))) {
    if (h.from <= dateStr) rate = h.rate;
  }
  return rate;
}

function calcStaffDayTotal(staff, entry, champMenu, wanope, dateStr, trainingRateCache) {
  const rate = staff.pay_type === "hourly"
    ? _estimateLiveEffectiveRate(staff, dateStr, trainingRateCache)
    : 0;
  const hourly    = (entry.hours || 0) * rate;
  // 2026-11-02: ドリンクバック単価を固定70円から設定可能なwindow.INCENTIVE_RATES.drink
  // に変更(local/payroll.js::calcDrinkBack参照。買い手の実際の単価100円が判明したため)。
  // ??を使う(||ではない): 単価0が設定されている場合に||だと固定値70へ
  // フォールバックしてしまい、実際の給与計算(0円)と画面の見積額が食い違う。
  const drinks    = (entry.drinks || 0) * (window.INCENTIVE_RATES?.drink?.yen_per_count ?? 70);
  const champ     = Object.entries(entry.champagne || {}).reduce((sum, [id, cnt]) => {
    const item = (champMenu || []).find(c => c.id === id);
    return sum + (item ? item.price * 0.1 * cnt : 0);
  }, 0);
  const transport = entry.okuri
    ? (staff.transport_one_way || 0)
    : (staff.transport_one_way || 0) * 2;
  // ??を使う(||ではない): 単価0(=ワンオペ手当を使わない既定の設定)のときに
  // ||だとフォールバック値が効いてしまい、サーバー側の給与計算(0円)と
  // 画面の見積額が食い違う。
  const wanopeBonus = wanope ? (entry.hours || 0) * (window.WANOPE_BONUS ?? 0) : 0;
  // 新設: キャッチ・呼び・延長インセンティブ(ドリンクバックと全く同じ形)。
  // local/payroll.js::calcIncentiveBackと計算式を一致させること
  // (単価はwindow.INCENTIVE_RATES、/settings取得失敗時や未設定時は既定0円)。
  const rates = window.INCENTIVE_RATES || {};
  const incentive =
    (entry.catch_count || 0) * (rates.catch?.yen_per_count ?? 0) +
    (entry.call_count || 0) * (rates.call?.yen_per_count ?? 0) +
    (entry.extension_count || 0) * (rates.extension?.yen_per_count ?? 0);
  return Math.round(hourly + drinks + champ + transport + wanopeBonus + incentive);
}

const App = {
  currentStore: null,  // _loadStoreInfo()が実際の店舗一覧から設定する
  screens: {},
  // 2026-10-17追加: 同一path宛てのGETが短時間に複数箇所から呼ばれる重複を
  // 防ぐ(実機で発覚: summary.js内の3つの独立した集計関数が、重なる月の
  // daily dataをそれぞれ個別にfetchしており、ダッシュボード1回の表示で
  // 同じ月のデータを最大3回リクエストしていた。「重い」原因の一つだった)。
  // 進行中の同一GETがあれば新規fetchを発行せず、そのPromiseを共有する。
  // 副作用のあるPUT/POST/DELETEは対象外(GETのみ)。
  _inFlightGets: {},
  // 2026-10-17追加: in-flight dedupだけでは拾いきれない「ほぼ同時だが
  // 完全には重ならない」GET重複(実機確認: 3関数が別々のタイミングで同じ
  // 月のdaily dataをfetchしていた)を減らすための短TTLキャッシュ。
  // {path: {value, ts}}。書き込み(PUT/POST/DELETE)が成功したら全体を
  // クリアする(個別パスの依存関係追跡を避け、安全側に倒す)。
  _getCache: {},
  _GET_CACHE_TTL_MS: 3000,
  register(name, fn) { this.screens[name] = fn; },
  go(name, params = {}) {
    document.getElementById("main").innerHTML = "";
    if (this.screens[name]) this.screens[name](params);
  },
  async api(method, path, body) {
    if (method === "GET" && body === undefined) {
      const cached = this._getCache[path];
      if (cached && (Date.now() - cached.ts) < this._GET_CACHE_TTL_MS) {
        return cached.value;
      }
      if (this._inFlightGets[path]) return this._inFlightGets[path];
      const p = this._rawApi(method, path, body).then(value => {
        this._getCache[path] = { value, ts: Date.now() };
        return value;
      }).finally(() => {
        delete this._inFlightGets[path];
      });
      this._inFlightGets[path] = p;
      return p;
    }
    const result = await this._rawApi(method, path, body);
    this._getCache = {};  // 書き込み成功後は古いキャッシュを信用しない
    return result;
  },
  // 2026-11-01 PWA化(Task11): fetchでのHTTPリクエストから、local-api.js
  // (サーバー不要・IndexedDB直結のローカルルーター)呼び出しへ差し替え。
  // App.api自体のキャッシュ・重複排除ロジック(_inFlightGets/_getCache)は
  // このメソッドの「中身」だけ差し替えれば動く設計なので、上のapi()は無改修。
  async _rawApi(method, path, body) {
    try {
      return await localApiCall(method, path, body);
    } catch (e) {
      // localApiCallが投げるApiErrorを、旧fetch版_rawApiが投げていたのと同じ
      // {message, status}形のErrorにマッピングする。呼び出し側は全箇所
      // `.catch(e => ...)`でe.statusを見て423(給与確定済み)等を判定しているため
      // (上のコメント・2026-08-06のレビュー参照)、ここで形を揃えないと
      // 既存のエラーハンドリングが静かに壊れる。
      if (e instanceof ApiError) {
        const err = new Error(e.message);
        err.status = e.status;
        throw err;
      }
      throw e;
    }
  }
};

// ---- グローバル画像ドロップ ----
// 2026-10-30 fix-wave: 店舗情報の取得・window.STORE_NAME等への反映を
// DOMContentLoaded専用のインライン処理から切り出し、setup.js側(初回セットアップで
// 店舗作成直後)からも呼べるようにした。これを呼ばないと、セットアップ直後の
// summary画面が店舗名でなくstore_idのまま表示され続ける(次回フルリロードまで)。
async function _loadStoreInfo() {
  const _PALETTE = ["#7c3aed", "#0891b2", "#dc2626", "#16a34a", "#d97706", "#db2777", "#4f46e5", "#0d9488"];
  let storeIds = [];
  try {
    const stores = await App.api("GET", "/stores");
    storeIds = Object.keys(stores);
    storeIds.forEach((id, i) => {
      window.STORE_NAME[id] = stores[id].name || id;
      window.STORE_COLOR[id] = stores[id].color || _PALETTE[i % _PALETTE.length];
    });
  } catch (e) {
    console.warn("店舗情報の取得に失敗:", e);
  }
  window._storeIds = storeIds;  // Task 8でセットアップ画面への遷移判定に使う
  // 2026-10-31のfix-wave再レビューで指摘: App.currentStoreが"to"固定だと、
  // ナビバーからparamsなしでinventory/dailyへ遷移した1店舗目(買い手の店舗)が
  // "to"という存在しないstore_idとして扱われ、在庫画面はエラー、日次入力は
  // 保存時400になっていた。実際の店舗一覧から動的に決める。
  App.currentStore = storeIds[0] || null;
  return storeIds;
}
window._loadStoreInfo = _loadStoreInfo;

window.addEventListener("DOMContentLoaded", async () => {
  // local/payroll-admin.jsのisLocked()は同期関数で、メモリキャッシュ
  // (_locksCache)だけを見る。キャッシュはIndexedDBからの非同期読み込みが
  // 終わるまで空のままなので、ここでawaitせずに画面を表に出すと、前回セッションで
  // 確定済みの月が一瞬「未確定」として読める競合状態になる(Task6の報告で
  // 明示的に指摘された既知のリスク)。ユーザー操作を許可する前に必ず完了させる。
  await ensureLocksLoaded();

  try {
    const settings = await App.api("GET", "/settings");
    // 0も正当な設定値(ワンオペ手当なし)なので、truthy判定ではなく
    // nullish判定で取り込む。
    if (settings.wanope_bonus != null) window.WANOPE_BONUS = settings.wanope_bonus;
    if (settings.incentive_rates) window.INCENTIVE_RATES = settings.incentive_rates;
    if (settings.base_session_minutes != null) window.BASE_SESSION_MINUTES = settings.base_session_minutes;
  } catch(e) { console.warn('settings fetch failed (fail-open):', e); }

  await _loadStoreInfo();

  const _licenseStatus = await App.api("GET", "/license/status").catch(() => ({ activated: false }));
  if (!_licenseStatus.activated || window._storeIds.length === 0) {
    App.go("setup");
    return;
  }

  App.go("summary");
  _initDrop();
});

function _initDrop() {
  const overlay = document.createElement("div");
  overlay.id = "drop-overlay";
  overlay.innerHTML = `
    <div style="text-align:center;">
      <div style="font-size:48px;margin-bottom:12px;">📷</div>
      <div style="font-size:20px;font-weight:700;color:#f3f4f6;">写真をドロップ</div>
      <div style="font-size:13px;color:#9ca3af;margin-top:6px;">EXIFの日付でページに自動反映します</div>
    </div>`;
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", background: "rgba(124,58,237,0.85)",
    display: "none", alignItems: "center", justifyContent: "center",
    zIndex: "9999", pointerEvents: "none",
  });
  document.body.appendChild(overlay);

  let dragCounter = 0;

  document.addEventListener("dragenter", e => {
    if ([...e.dataTransfer.types].includes("Files")) {
      dragCounter++;
      overlay.style.display = "flex";
    }
  });
  document.addEventListener("dragleave", () => {
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; overlay.style.display = "none"; }
  });
  document.addEventListener("dragover", e => e.preventDefault());
  document.addEventListener("drop", async e => {
    e.preventDefault();
    dragCounter = 0;
    overlay.style.display = "none";
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (!files.length) return;
    for (const file of files) {
      await _uploadAndNavigate(file);
    }
  });
}

async function _uploadAndNavigate(file) {
  const fd = new FormData();
  fd.append("file", file);
  const hintDate = (typeof _dailyState !== "undefined" && _dailyState.date) ? _dailyState.date : null;
  const storeId = (typeof _dailyState !== "undefined" && _dailyState.storeId) ? _dailyState.storeId : "to";
  if (hintDate) fd.append("hint_date", hintDate);
  fd.append("store_id", storeId);

  _showToast("📄 日報を読み取り中...");

  const res = await fetch(`${API}/upload`, { method: "POST", body: fd });
  if (!res.ok) { alert("アップロード失敗: " + await res.text()); return; }
  const data = await res.json();

  console.log("[OCR]", { method: data.method, ocr_raw: data.ocr_raw, form_data: data.form_data, ocr_error: data.ocr_error });

  if (data.ocr_error) {
    _showToast(`⚠️ OCRエラー: ${data.ocr_error}`);
  }

  const fd2 = data.form_data || {};
  const hasData = fd2.sales_excl_tax > 0 || fd2.customer_count > 0 || (fd2.staff_entries || []).length > 0;

  if (data.method === "ocr" && hasData) {
    const year = parseInt(data.date.split("-")[0]);
    // 既に手入力済み(_user_edited=true)の日はOCR自動保存をスキップして上書きを防ぐ
    let skipOcr = false;
    try {
      const existing = await fetch(`${API}/daily/${year}/${data.date}/${storeId}`).then(r => r.json());
      if (_hasReviewedFinancialData(existing)) skipOcr = true;
    } catch(e) { console.warn('OCR guard check failed, proceeding without guard:', e); }

    if (skipOcr) {
      _showToast(`📅 ${data.date} に移動（手入力済みデータを保護）`);
      App.go("daily", { date: data.date, storeId });
    } else {
      const putRes = await fetch(`${API}/daily/${year}/${data.date}/${storeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fd2),
      });
      if (putRes.ok) {
        _showToast(`✅ 読み取り完了 → ${data.date}`);
        App.go("daily", { date: data.date, storeId });
      } else {
        _showToast("⚠️ 保存失敗");
        App.go("daily", { date: data.date, storeId });
      }
    }
  } else if (data.method === "ocr") {
    _showToast(`📅 ${data.date} に移動（数値読み取り不可）`);
    App.go("daily", { date: data.date, storeId });
  } else {
    // 日付不明 → 確認ダイアログ（OCRデータがあれば一緒に渡す）
    _confirmDate(data.date, data.method, storeId, hasData ? fd2 : null);
  }
}

let _confirmFormData = null;

function _confirmDate(detectedDate, method, storeId, fd2) {
  _confirmFormData = fd2 || null;
  const labels = { exif: "📷 EXIF", page: "📅 現在のページ", today: "📅 今日" };
  const existing = document.getElementById("date-confirm-modal");
  if (existing) existing.remove();

  const hasData = fd2 && (fd2.sales_excl_tax > 0 || fd2.customer_count > 0 || (fd2.staff_entries || []).length > 0);
  const modal = document.createElement("div");
  modal.id = "date-confirm-modal";
  Object.assign(modal.style, {
    position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
    background: "#1f2937", border: "1px solid #7c3aed", borderRadius: "12px",
    padding: "14px 18px", zIndex: "9999", boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
    minWidth: "280px",
  });
  modal.innerHTML = `
    <div style="font-size:12px;color:#9ca3af;margin-bottom:8px;">${labels[method] || ""} — 日付を確認してください${hasData ? " <span style='color:#34d399'>（数値読み取り済み）</span>" : ""}</div>
    <div style="display:flex;gap:8px;align-items:center;">
      <input type="date" id="confirm-date-input" value="${detectedDate}"
        style="background:#111827;border:1px solid #374151;border-radius:6px;color:#f3f4f6;font-size:15px;padding:7px 10px;flex:1;">
      <button onclick="_applyDate(this)" data-store="${storeId}"
        style="background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer;font-size:14px;">
        移動
      </button>
      <button onclick="document.getElementById('date-confirm-modal').remove()"
        style="background:#374151;color:#9ca3af;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;">
        ✕
      </button>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById("confirm-date-input").focus();
}

async function _applyDate(btn) {
  const date = document.getElementById("confirm-date-input").value;
  const storeId = btn.dataset.store;
  const fd2 = _confirmFormData;
  _confirmFormData = null;
  document.getElementById("date-confirm-modal").remove();
  if (!date) return;
  if (fd2) {
    const year = parseInt(date.split("-")[0]);
    let skipOcr = false;
    try {
      const existing = await fetch(`${API}/daily/${year}/${date}/${storeId}`).then(r => r.json());
      if (_hasReviewedFinancialData(existing)) skipOcr = true;
    } catch(e) { console.warn('OCR guard check failed, proceeding without guard:', e); }
    if (skipOcr) {
      _showToast(`📅 ${date} に移動（手入力済みデータを保護）`);
    } else {
      const res = await fetch(`${API}/daily/${year}/${date}/${storeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fd2),
      });
      if (!res.ok) _showToast("⚠️ 保存失敗: " + await res.text());
    }
  }
  App.go("daily", { date, storeId });
}

function _showToast(msg) {
  const t = document.createElement("div");
  Object.assign(t.style, {
    position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
    background: "#1f2937", color: "#f3f4f6", padding: "10px 20px",
    borderRadius: "8px", fontSize: "13px", zIndex: "9999",
    border: "1px solid #374151", boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
    whiteSpace: "nowrap",
  });
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
