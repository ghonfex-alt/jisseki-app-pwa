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
const CACHE = 'jisseki-pwa-v4';

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
  '../local/license.js',
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

  e.respondWith(
    (async () => {
      // cache-first: キャッシュにあれば即返す(アプリシェル・CDNのSheetJS含む)。
      const cached = await caches.match(e.request);
      if (cached) return cached;

      try {
        const res = await fetch(e.request);
        // 初回アクセスでキャッシュに無かったもの(例: install時に失敗したCDN資産)を
        // 取得できた時点でキャッシュに積んでおく。opaque応答(type==='opaque')は
        // 内容を検証できないため保存しない。
        if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
          const cache = await caches.open(CACHE);
          cache.put(e.request, res.clone());
        }
        return res;
      } catch (err) {
        // オフラインでキャッシュにも無い場合: 画面遷移(ナビゲーション)だけは
        // SPAシェル(index.html)にフォールバックする。
        if (e.request.mode === 'navigate') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }
        throw err;
      }
    })()
  );
});
