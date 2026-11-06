// frontend/setup.js — 初回セットアップ画面。
// 店舗が0件の場合、App起動時にこの画面へ誘導する。
//
// 2026-11-02改訂: 「ライセンスキー→店舗名→完了」の3画面がただ縦に並んでいる
// だけで、どこまで進んだか分からず、しかも「ホーム画面に追加」の案内は
// README(アプリの外)にしか無かった。ユーザーから「導線・使い勝手を突き詰めろ」
// との指示を受け、ステップ表示付きのウィザード形式に作り直し、ホーム画面追加の
// 案内をアプリ内の正式なステップとして組み込む。
//
// 2026-11-02 追記: Cloudflare Access(買い手のメールアドレス単位でログイン
// 自体をブロックする)を導入したことで、このページのJSに到達できている時点で
// 既にアクセス許可済みの買い手であることが保証される。local/license.jsの
// クライアント側ライセンスキー認証はAccessに対して何の追加の安全性も提供
// しない(むしろ公開ソース中のハッシュを読める・買い手が最初に入力する手間が
// 増えるだけ)ため撤去し、ウィザードを「店舗名→ホーム画面→完了」の3段階に
// 短縮した。

// _setupStep: 1=店舗名, 2=ホーム画面に追加, 3=完了
let _setupStep = 1;

function _isStandalone() {
  // iOS Safari(レガシー)はnavigator.standalone、それ以外はdisplay-modeメディア
  // クエリで判定する(どちらか一方しか真にならない環境差を両方カバーする)。
  return (
    (window.navigator && window.navigator.standalone === true) ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  );
}

function _isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

App.register("setup", async function() {
  const main = document.getElementById("main");
  const stores = await App.api("GET", "/stores");

  // 既に完了済みの項目があれば、該当ステップを飛ばして次へ進める
  // (例: 店舗は作成済みだがホーム画面未追加の状態で再度この画面に来た場合)。
  if (Object.keys(stores).length > 0) _setupStep = Math.max(_setupStep, 2);
  // 既にホーム画面(スタンドアロン)から開いている場合、ステップ2の案内は
  // 意味が無いので自動的に完了扱いにする。
  if (_isStandalone()) _setupStep = Math.max(_setupStep, 3);

  _renderSetup();
});

function _setupStepDotsInner() {
  const labels = ["①店舗", "②ホーム画面", "③完了"];
  return labels.map((label, i) => {
    const n = i + 1;
    const active = n === _setupStep;
    const done = n < _setupStep;
    const color = done ? "#4ade80" : active ? "#7c3aed" : "#374151";
    const textColor = done || active ? "#f3f4f6" : "#6b7280";
    return `<div style="flex:1;text-align:center;">
      <div style="height:4px;border-radius:2px;background:${color};margin-bottom:4px;"></div>
      <div style="font-size:10px;color:${textColor};">${label}</div>
    </div>`;
  }).join("");
}

// 2026-11-02の実機確認で発見(確定): ステップを進めてもインジケーターの
// 色が最初のステップのまま更新されていなかった(_renderSetupStepBody()は
// 本文だけを再描画し、ドットの再描画を呼んでいなかったため)。_setupStepを
// 変更する箇所は必ずこの関数も呼び、インジケーターを現在地と一致させる。
function _refreshSetupStepDots() {
  const dots = document.getElementById("setup-step-dots");
  if (dots) dots.innerHTML = _setupStepDotsInner();
}

function _renderSetup() {
  const main = document.getElementById("main");
  main.innerHTML = `
    <div style="max-width:420px;margin:32px auto;padding:24px;background:#1f2937;border-radius:12px;">
      <h2 style="margin-top:0;margin-bottom:4px;">初期セットアップ</h2>
      <div style="color:#6b7280;font-size:12px;margin-bottom:16px;">3つのステップで準備完了です</div>
      <div id="setup-step-dots" style="display:flex;gap:6px;margin-bottom:20px;">${_setupStepDotsInner()}</div>
      <div id="setup-step-body"></div>
    </div>`;
  _renderSetupStepBody();
}

function _renderSetupStepBody() {
  // 2026-11-02の実機確認で発見(確定): 本文だけ差し替えてドットの再描画を
  // 呼び忘れていたバグの再発防止として、この関数自身が常にドットも同期する
  // (呼び出し側が個別に覚えておく必要を無くす)。
  _refreshSetupStepDots();
  const body = document.getElementById("setup-step-body");
  if (!body) return;
  if (_setupStep === 1) {
    body.innerHTML = `
      <div class="label">店舗名</div>
      <div style="color:#6b7280;font-size:11px;margin-bottom:8px;">あとから設定画面で店舗を追加・変更できます</div>
      <input type="text" id="setup-store-name" placeholder="例: 〇〇バー" style="width:100%;margin-bottom:8px;box-sizing:border-box;">
      <button onclick="setupCreateStore()" class="btn-primary" style="width:100%;">店舗を作成する</button>
      <div id="setup-store-msg" style="color:#f87171;font-size:12px;margin-top:8px;"></div>
    `;
    const input = document.getElementById("setup-store-name");
    if (input) {
      input.focus();
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") setupCreateStore(); });
    }
  } else if (_setupStep === 2) {
    body.innerHTML = _setupHomeScreenStepHtml();
  } else {
    body.innerHTML = `
      <div style="text-align:center;padding:12px 0;">
        <div style="font-size:32px;margin-bottom:8px;">✅</div>
        <div style="color:#4ade80;font-weight:700;margin-bottom:4px;">セットアップが完了しました</div>
        <div style="color:#6b7280;font-size:12px;margin-bottom:16px;">このまま使い始められます</div>
        <button onclick="setupFinish()" class="btn-primary" style="width:100%;">はじめる</button>
      </div>`;
  }
}

// ── ステップ2: ホーム画面に追加 ──────────────────────────────────────────
// 2026-11-02新設。従来はREADME(アプリの外)にしか案内が無く、スタッフが
// 「ホーム画面に追加」を飛ばしてSafariのタブのまま使い続けると、iOSの
// 7日間ストレージ削除ルールの対象になってしまう(ホーム画面アプリとして
// 開けば対象外——frontend/app.jsのnavigator.storage.persist()のコメント参照)。
// アプリ内の正式なステップにすることで、この重要な一手間を迷わせない。
function _setupHomeScreenStepHtml() {
  const ios = _isIOS();
  const canNativePrompt = !!window._deferredInstallPrompt;

  let guide;
  if (canNativePrompt) {
    // Android Chrome等: ネイティブのインストールダイアログをワンタップで出せる。
    guide = `
      <div style="color:#d1d5db;font-size:13px;margin-bottom:14px;line-height:1.7;">
        ホーム画面に追加すると、普通のアプリと同じようにアイコンをタップするだけで
        開けるようになります（毎回URLを入力する必要がなくなります）。
      </div>
      <button onclick="_setupInstallNow()" class="btn-primary" style="width:100%;margin-bottom:8px;">
        📲 ホーム画面に追加する
      </button>
      <div id="setup-install-msg" style="color:#6b7280;font-size:11px;"></div>
    `;
  } else if (ios) {
    // iOS Safari: JSからインストールをトリガーするAPIが無いため、手順を案内する。
    guide = `
      <div style="color:#d1d5db;font-size:13px;margin-bottom:14px;line-height:1.7;">
        ホーム画面に追加すると、普通のアプリと同じようにアイコンをタップするだけで
        開けるようになります（毎回URLを入力する必要がなくなります）。
      </div>
      <div style="background:#111827;border:1px solid #374151;border-radius:8px;padding:14px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div style="flex-shrink:0;width:24px;height:24px;border-radius:50%;background:#7c3aed;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">1</div>
          <div style="font-size:13px;color:#f3f4f6;">画面下の共有ボタン（□に↑）をタップ</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="flex-shrink:0;width:24px;height:24px;border-radius:50%;background:#7c3aed;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">2</div>
          <div style="font-size:13px;color:#f3f4f6;">「ホーム画面に追加」を選んで「追加」をタップ</div>
        </div>
      </div>
    `;
  } else {
    // デスクトップ等: 必須ではないので軽い案内のみにし、スキップしやすくする。
    guide = `
      <div style="color:#d1d5db;font-size:13px;margin-bottom:14px;line-height:1.7;">
        スマホでこのアプリを開いている場合は、ホーム画面に追加しておくと
        毎回URLを入力せずアイコンから開けて便利です。パソコンで使う場合は
        このままで問題ありません。
      </div>
    `;
  }

  return `
    ${guide}
    <button onclick="_setupHomeScreenNext()" style="width:100%;background:#374151;border:none;color:#d1d5db;padding:10px;border-radius:8px;cursor:pointer;font-size:13px;">
      ${canNativePrompt ? "あとで追加する" : "追加した（または後で追加する）→ 次へ"}
    </button>
  `;
}

async function _setupInstallNow() {
  const prompt = window._deferredInstallPrompt;
  const msg = document.getElementById("setup-install-msg");
  if (!prompt) {
    // ボタン描画後にイベントが失われる(ブラウザ側の制約等)ケースへの保険。
    if (msg) msg.textContent = "お使いのブラウザのメニューから「ホーム画面に追加」を選んでください。";
    return;
  }
  try {
    // prompt()自体も同期的にInvalidStateError等を投げうる(例: 既に使用済みの
    // イベントを誤って再利用した場合)。try内に含めないとここで未捕捉の例外になり、
    // ボタンが何の反応もせず固まって見える(2026-11-06、audit-loopで発見)。
    prompt.prompt();
    const choice = await prompt.userChoice;
    window._deferredInstallPrompt = null;
    if (choice && choice.outcome === "accepted") {
      _setupHomeScreenNext();
      return;
    }
  } catch (e) {
    // ユーザーがダイアログを閉じた、または上記のprompt()失敗等。次へ進むボタンは
    // そのまま使えるようにする。
    window._deferredInstallPrompt = null;
  }
  if (msg) msg.textContent = "いつでも後から追加できます。";
}

function _setupHomeScreenNext() {
  _setupStep = 3;
  _renderSetupStepBody();
}

// 二重クリックで同名の店舗が2つ作られるのを防ぐ(settings.js::addStoreと同じ理由。
// 店舗idが "store_" + Date.now() なので2回目は別idになり、サーバー側の
// 重複idチェックでは止まらない)。
let _setupStoreInFlight = false;

async function setupCreateStore() {
  if (_setupStoreInFlight) return;
  const name = document.getElementById("setup-store-name").value.trim();
  const msg = document.getElementById("setup-store-msg");
  if (!name) { msg.textContent = "店舗名を入力してください。"; return; }
  _setupStoreInFlight = true;
  try {
    const id = "store_" + Date.now();
    await App.api("POST", "/stores", { id, name });
    msg.textContent = "";
    // 既にホーム画面から起動済みなら、案内ステップを飛ばして完了へ。
    _setupStep = _isStandalone() ? 3 : 2;
    _renderSetupStepBody();
  } catch (e) {
    msg.textContent = "店舗の作成に失敗しました: " + e.message;
  } finally {
    _setupStoreInFlight = false;
  }
}

// window.STORE_NAME等は_loadStoreInfo()で更新済みだが、_initDropはDOMContentLoaded時に
// 未セットアップでsummaryへ進まなかった場合は一度も呼ばれていないため、
// summaryへ遷移する直前にここで確実に呼ぶ(写真ドラッグ&ドロップが当日中動かない事故防止)。
async function setupFinish() {
  await window._loadStoreInfo();
  _initDrop();
  App.go('summary');
}
