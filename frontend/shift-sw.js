const CACHE = 'shift-v4';
const ASSETS = ['/shift', '/shift-manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // 2026-10-30バグハントで指摘(Important): url.includes('/shift')は部分一致のため
  // /shifts/2026/10や/shifts/gaps?ym=...等のAPI GETパスにも誤マッチしていた。
  // マッチすればcache-first扱いになり、Excel再取込や手動編集後もシフト予定・
  // 不足情報が古いまま返り続ける恐れがあった(register-sw.jsと同じendsWithに統一)。
  if (!ASSETS.some(a => url.endsWith(a))) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return resp;
      });
    })
  );
});
