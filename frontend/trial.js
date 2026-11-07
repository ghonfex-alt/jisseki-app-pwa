// frontend/trial.js — お試し期間の判定・終了画面(2026-11-07新設)。
//
// Cloudflare Access(このドメイン全体のログインゲート)とは別に、「登録から30日で
// 自動的に使えなくなるお試し」を実現する。判定の真実の記録はブラウザの外
// (functions/api/trial-status.js が読み書きするCloudflare KV)に置く——
// ブラウザのIndexedDBだけに記録すると、データを消されるだけで振り出しに戻って
// しまうため(旧local/license.jsと同じ限界、2026-11-07にユーザーと合意の上で
// この設計にした)。
//
// このファイルはApp.api(IndexedDB直結のローカルAPI層)を経由せず、本物の
// fetch()で同一オリジンの/api/*(Cloudflare Pages Functions)を直接呼ぶ
// (App.apiはlocalApiCall固定で、ネットワークには出ない設計のため)。

// サーバーから一度でも「期限切れ」と確認が取れた端末は、その事実をlocalStorageに
// 残しておく。機内モード等で意図的にオフラインにするだけで期限切れを回避できて
// しまうバイパスを防ぐため(audit-loopで発見・2026-11-07修正)。一度も確認が
// 取れていない端末(新規インストール直後の通信不良等)は従来通りfail-open。
const TRIAL_EXPIRED_CACHE_KEY = 'jisseki_trial_expired_cache';

function _readCachedExpired() {
  try {
    const raw = localStorage.getItem(TRIAL_EXPIRED_CACHE_KEY);
    return raw ? JSON.parse(raw).expired === true : false;
  } catch (e) {
    return false;
  }
}

function _writeCachedExpired(expired) {
  try {
    localStorage.setItem(TRIAL_EXPIRED_CACHE_KEY, JSON.stringify({ expired: !!expired, checked_at: new Date().toISOString() }));
  } catch (e) {
    // private browsing等でlocalStorageが使えない場合はキャッシュを諦めるだけ
    // (fail-openの既存挙動に戻る)。
  }
}

// 起動時に一度だけ呼ぶ。通信エラー時は直近に確認できた状態を踏まえて判定する
// (未確認ならfail-open、直近「期限切れ」確認済みならfail-closed)。
// 8秒でタイムアウトし、応答の遅いネットワークでアプリ起動がフリーズするのを防ぐ
// (audit-loopで発見・2026-11-07修正)。
async function checkTrialStatus() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('/api/trial-status', { credentials: 'same-origin', signal: controller.signal });
    if (!res.ok) return _readCachedExpired() ? { expired: true } : null;
    const data = await res.json();
    _writeCachedExpired(data && data.expired);
    return data;
  } catch (e) {
    console.warn('trial-status fetch failed:', e);
    return _readCachedExpired() ? { expired: true } : null;
  } finally {
    clearTimeout(timeoutId);
  }
}
window.checkTrialStatus = checkTrialStatus;

App.register("trial-ended", function () {
  const main = document.getElementById("main");
  main.innerHTML = `
    <div style="max-width:420px;margin:32px auto;padding:24px;background:#1f2937;border-radius:12px;">
      <h2 style="margin-top:0;margin-bottom:4px;">お試し期間が終了しました</h2>
      <div style="color:#6b7280;font-size:12px;margin-bottom:16px;line-height:1.6;">
        これまでに入力したデータは消えていません。購入後の解除コードを入力すると、
        そのまま続きから使えます。解除コードがまだの方・ご不明な点がある方は、
        ご購入時にご案内の連絡先までお問い合わせください。
      </div>
      <input type="text" id="trial-unlock-code" placeholder="XXXX-XXXX" style="width:100%;margin-bottom:8px;box-sizing:border-box;text-transform:uppercase;">
      <button onclick="submitTrialUnlock()" class="btn-primary" style="width:100%;">解除する</button>
      <div id="trial-unlock-msg" style="color:#f87171;font-size:12px;margin-top:8px;"></div>
    </div>`;
  const input = document.getElementById("trial-unlock-code");
  if (input) {
    input.focus();
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submitTrialUnlock(); });
  }
});

let _trialUnlockInFlight = false;

async function submitTrialUnlock() {
  if (_trialUnlockInFlight) return;
  const input = document.getElementById("trial-unlock-code");
  const msg = document.getElementById("trial-unlock-msg");
  const code = (input?.value || "").trim().toUpperCase();
  if (!code) { if (msg) msg.textContent = "解除コードを入力してください。"; return; }
  _trialUnlockInFlight = true;
  try {
    const res = await fetch('/api/unlock', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      if (msg) { msg.style.color = '#4ade80'; msg.textContent = '解除しました。'; }
      _writeCachedExpired(false);
      await window._loadStoreInfo();
      App.go(window._storeIds.length === 0 ? "setup" : "summary");
      return;
    }
    if (msg) msg.textContent = data.error || "解除コードが正しくありません。";
  } catch (e) {
    if (msg) msg.textContent = "通信エラーです。電波の良い場所でもう一度お試しください。";
  } finally {
    _trialUnlockInFlight = false;
  }
}
