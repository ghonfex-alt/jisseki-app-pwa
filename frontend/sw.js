// jisseki-app PWA サービスワーカー。
//
// このアプリはサーバー・外部API無しで完全にブラウザ内完結する(Global Constraints参照)。
// 唯一の外部通信はlocal/export.jsが使うSheetJS(CDN、xlsx.full.min.js)のみ。
// そのため、他の全アプリシェルファイル(HTML/JS/CSS/manifest/アイコン)をcache-firstで
// キャッシュすれば、それだけで初回アクセス後は完全オフライン動作になる。
//
// デプロイごとにCACHEの末尾の数字を上げること(例: v1 → v2)。
// activateイベントで、新しい番号と一致しない古いキャッシュを破棄する(旧shift-sw.jsの
// バージョニング方式を踏襲)。
const CACHE = 'jisseki-pwa-v13';

// コアアセット: 1つでも取得に失敗したらSW自体のインストールを失敗させる
// (cache.addAllは原子的)。index.html/shift.htmlの<script>/<link>タグに実際に
// 列挙されているファイルと一致させること(推測やshift-sw.jsの旧リストの流用はしない)。
//
// sw.jsはfrontend/に置かれているため、相対パスの解決基準はfrontend/。
// db.js・local-api.js・local/*.jsはリポジトリ直下(frontend/の1階層上)にあるため
// '../'を使う(frontend/index.htmlの<script src="../db.js">等と同じ解決結果になる)。
const CORE_ASSETS = [
  './',
  './index.html',
  './shift.html',
  './style.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',

  // frontend/*.js (index.htmlの画面側スクリプト一覧と一致させる)
  './app.js',
  './trial.js',
  './setup.js',
  './summary.js',
  './settings.js',
  './daily.js',
  './payroll.js',
  './annual.js',
  './shift-app.js',
  './inventory.js',

  // ローカルAPI層 (db.js → local-api.js → local/*.js、リポジトリ直下)
  '../db.js',
  '../local-api.js',
  '../local/store.js',
  '../local/staff.js',
  '../local/daily.js',
  '../local/tax-table-r8.js',
  '../local/payroll.js',
  '../local/payroll-admin.js',
  '../local/export.js',
  '../local/backup.js',
  '../local/shifts.js',
  '../local/inventory.js',
  '../local/targets.js',
  '../local/settings.js',
];

// SheetJS(CDN、Excel出力専用)。ピン留めバージョンはindex.htmlの<script src>と
// 完全に一致させること。
//
// これはオフライン必須パス(Excel出力は「保存されたExcelデータを開く」わけではなく
// 「今ある実績データから新規にExcelを作る」機能なので、そもそもオフラインで完結できる
// 操作ではない=コアのオフライン要件ではない)ではないため、CORE_ASSETSとは別枠にし、
// 取得失敗してもSWのインストール自体は失敗させない(try/catchで個別に扱う)。
// 一方で、一度オンラインで取得できればcache-firstで永続的に使えるようにし、2回目以降は
// オフラインでもExcel出力が使えるようにする(「真のオフライン対応」としてはキャッシュする
// 方が望ましいため、キャッシュ対象に含める)。
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(CORE_ASSETS);

      await Promise.all(CDN_ASSETS.map(async (url) => {
        try {
          const res = await fetch(url, { mode: 'cors' });
          if (res && res.ok) {
            await cache.put(url, res);
          }
        } catch (err) {
          // CDNが落ちていてもコアのオフライン機能は使えるようにする。
          // 次回オンライン時のfetchハンドラでリトライ・キャッシュされる。
          console.warn('SW install: CDN asset caching failed (will retry at runtime):', url, err);
        }
      }));

      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (e) => {
  // non-GET(このアプリはGETのみ使う想定だが念のため)はスルーし、ブラウザの通常動作に委ねる。
  if (e.request.method !== 'GET') return;

  // ナビゲーション(画面遷移)リクエストはSWで一切intercept しない(2026-11-07、
  // redirect:'manual'+opaqueredirect pass-throughによる対処から方針変更)。
  //
  // 理由: 「新しいSW(v12)のコードは正しい」ことをDevTools Sourcesで確認した
  // 直後にも関わらず、同じERR_FAILED("a redirected response was used for a
  // request whose redirect mode is not 'follow'")が実機で再発した。原因は
  // コードの誤りではなく、SWの更新(install→activate→clients.claim)が完了する
  // 前のタイミングで新しいナビゲーションが飛んでくると、まだ古い版のfetch
  // ハンドラがそのナビゲーションを処理してしまう競合(タイミング依存で再現性が
  // 不安定)と推測される。この種のタイミング競合を完全に塞ぎ込むより、
  // そもそも「SWがナビゲーションに手を出さない」設計にする方が頑丈(ブラウザの
  // 素のナビゲーション処理は、Cloudflare Pagesのパス正規化リダイレクトや
  // Cloudflare Accessのログインリダイレクトを、curl/PowerShellでの素の
  // リクエストと同様、常に問題なく処理できることを本セッションで確認済み)。
  //
  // トレードオフ: オフライン時の「直接URLへの再読み込み(F5)」はキャッシュに
  // フォールバックできなくなる(ブラウザ標準のオフライン画面になる)。
  // ただしこのアプリは起動後は index.html 内でApp.go()によるクライアント側
  // ルーティングのみを行い、ブラウザの実ナビゲーションは発生しない設計のため、
  // 実運用上の影響は「アプリを開いた状態のまま電波が切れても使える」という
  // 本来のオフライン要件には影響しない。
  if (e.request.mode === 'navigate') return;

  // /api/*(functions/api/*.js、Cloudflare Pages Functions)はcache-firstの
  // 対象から完全に除外し、常にネットワークへ素通しする(2026-11-07追加)。
  // 特に/api/trial-statusをキャッシュしてしまうと、お試し期限切れの判定が
  // 最初の1回の応答のまま一生更新されなくなり、判定機能そのものが無意味になる。
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    (async () => {
      // cache-first: キャッシュにあれば即返す(アプリシェル・CDNのSheetJS含む)。
      const cached = await caches.match(e.request);
      if (cached) return cached;

      const res = await fetch(e.request);
      // 初回アクセスでキャッシュに無かったもの(例: install時に失敗したCDN資産)を
      // 取得できた時点でキャッシュに積んでおく。opaque応答(type==='opaque')は
      // 内容を検証できないため保存しない。
      if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
        const cache = await caches.open(CACHE);
        cache.put(e.request, res.clone());
      }
      return res;
    })()
  );
});
