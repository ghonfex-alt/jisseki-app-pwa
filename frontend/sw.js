const CACHE = 'jisseki-20261030';
const STATIC = [
  '/',
  '/static/app.js',
  '/static/summary.js',
  '/static/nippo-log.js',
  '/static/settings.js',
  '/static/reflections.js',
  '/static/daily.js',
  '/static/payroll.js',
  '/static/annual.js',
  '/static/shift-app.js',
  '/static/inventory.js',
  '/static/style.css',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // non-GET はスルー
  if (e.request.method !== 'GET') return;

  // 静的アセット + ルート: ネットワーク優先、失敗時キャッシュ
  const isStatic = url.pathname === '/' || url.pathname.startsWith('/static/');
  // API GET: ネットワーク優先、失敗時キャッシュ
  const isApi = ['/daily/', '/payroll/', '/shifts/', '/staff', '/store']
    .some(p => url.pathname.startsWith(p));

  if (isStatic || isApi) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }
});
