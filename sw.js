// FaceTalk PWA service worker —— 仅缓存静态壳，/api/* 永远走网络(D1)
const CACHE = 'facetalk-shell-v4';
const SHELL = [
  '/',
  '/index.html',
  '/assets/style.css',
  '/assets/app.js',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;        // 跨域不处理
  if (u.pathname.startsWith('/api/')) return;           // API 永远走网络
  if (e.request.method !== 'GET') return;

  if (e.request.mode === 'navigate') {                  // 页面：网络优先，离线回壳
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    return;
  }
  // 静态资源：缓存优先 + 后台更新
  e.respondWith(
    caches.match(e.request).then((r) =>
      r || fetch(e.request).then((resp) => {
        const cp = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, cp));
        return resp;
      }).catch(() => r)
    )
  );
});
