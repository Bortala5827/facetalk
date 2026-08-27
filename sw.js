// FaceTalk PWA service worker
// 缓存策略（2026-08-14 护栏）：只缓存静态资产（图标/图片/字体），
// HTML/JS/CSS/JSON 一律网络优先、绝不写入缓存，避免「改了用户看到旧版」。
// /api/* 永远走网络（D1 数据）。
const CACHE_VERSION = 'v20260814';
const CACHE = 'facetalk-static-' + CACHE_VERSION;
// 仅预缓存图标等纯静态资产；另加 /index.html 壳（离线导航兜底用，见下方 fetch navigate 分支）
const SHELL = [
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/manifest.webmanifest',
  '/index.html',
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

  // 纯静态资产（图片/字体）：缓存优先 + 后台更新，安全可缓存
  if (/\.(png|jpe?g|webp|gif|svg|ico|woff2?|ttf|eot)$/.test(u.pathname)) {
    e.respondWith(
      caches.match(e.request).then((r) =>
        r || fetch(e.request).then((resp) => {
          const cp = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, cp));
          return resp;
        }).catch(() => r)
      )
    );
    return;
  }

  // 其余（HTML/JS/CSS/JSON）：网络优先，不写入缓存
  // 离线时页面导航回退到已缓存的 index.html 壳，其余请求失败即失败（不返回旧版）
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    return;
  }
  e.respondWith(fetch(e.request));
});
