// frontend/setup.js — 初回セットアップ画面。
// ライセンスキー未入力 or 店舗が0件の場合、App起動時にこの画面へ誘導する。
App.register("setup", async function() {
  const main = document.getElementById("main");
  const licenseStatus = await App.api("GET", "/license/status");
  const stores = await App.api("GET", "/stores");

  main.innerHTML = `
    <div style="max-width:480px;margin:40px auto;padding:24px;background:#1f2937;border-radius:12px;">
      <h2 style="margin-top:0;">初期セットアップ</h2>

      <div id="setup-license-section" style="margin-bottom:24px;${licenseStatus.activated ? "display:none;" : ""}">
        <div class="label">ライセンスキー</div>
        <input type="text" id="setup-license-key" placeholder="XXXX-XXXX-XXXX" style="width:100%;margin-bottom:8px;">
        <button onclick="setupActivateLicense()" class="btn-primary">認証する</button>
        <div id="setup-license-msg" style="color:#f87171;font-size:12px;margin-top:4px;"></div>
      </div>

      <div id="setup-store-section" style="${Object.keys(stores).length > 0 ? "display:none;" : ""}">
        <div class="label">店舗名</div>
        <input type="text" id="setup-store-name" placeholder="例: 〇〇バー" style="width:100%;margin-bottom:8px;">
        <button onclick="setupCreateStore()" class="btn-primary">店舗を作成する</button>
        <div id="setup-store-msg" style="color:#f87171;font-size:12px;margin-top:4px;"></div>
      </div>

      <div id="setup-done-section" style="display:none;margin-top:16px;">
        <div style="color:#4ade80;margin-bottom:12px;">セットアップが完了しました。</div>
        <button onclick="setupFinish()" class="btn-primary">はじめる</button>
      </div>
    </div>`;

  await setupCheckDone();
});

async function setupActivateLicense() {
  const key = document.getElementById("setup-license-key").value.trim();
  const msg = document.getElementById("setup-license-msg");
  try {
    await App.api("POST", "/license/activate", { key });
    document.getElementById("setup-license-section").style.display = "none";
    msg.textContent = "";
    await setupCheckDone();
  } catch (e) {
    msg.textContent = "ライセンスキーが正しくありません。";
  }
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
    document.getElementById("setup-store-section").style.display = "none";
    msg.textContent = "";
    await setupCheckDone();
  } catch (e) {
    msg.textContent = "店舗の作成に失敗しました: " + e.message;
  } finally {
    _setupStoreInFlight = false;
  }
}

async function setupCheckDone() {
  const licenseStatus = await App.api("GET", "/license/status");
  const stores = await App.api("GET", "/stores");
  if (licenseStatus.activated && Object.keys(stores).length > 0) {
    await window._loadStoreInfo();
    document.getElementById("setup-done-section").style.display = "block";
  }
}

// window.STORE_NAME等は_loadStoreInfo()で更新済みだが、_initDropはDOMContentLoaded時に
// 未セットアップでsummaryへ進まなかった場合は一度も呼ばれていないため、
// summaryへ遷移する直前にここで確実に呼ぶ(写真ドラッグ&ドロップが当日中動かない事故防止)。
function setupFinish() {
  _initDrop();
  App.go('summary');
}
