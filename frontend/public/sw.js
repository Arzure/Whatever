// Service Worker：静态资源离线缓存
// 策略：网络优先 + 失败回退缓存——在线时始终拿最新资源，离线时用缓存打开页面
const CACHE = 'wanxiang-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

// 安装：预缓存应用外壳（页面本身 + 清单 + 图标）
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

// 激活：清理旧版本缓存
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// 请求拦截：
// - API 请求（/api/）不缓存——游戏数据必须实时；
// - 静态资源网络优先，失败回退缓存（离线可用）；
// - 页面导航离线时回退缓存的首页
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/')))
  );
});
