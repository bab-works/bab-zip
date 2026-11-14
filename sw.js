// 앱 화면 파일만 캐시 (시트 API 요청은 건드리지 않음). 파일 수정 후엔 버전을 올리세요.
const CACHE = 'gagyebu-v51';
const FILES = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'PretendardVariable.woff2'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // 온라인이면 서버에 최신인지 꼭 확인(브라우저 HTTP 캐시 무시), 오프라인이면 저장해 둔 파일
  e.respondWith(fetch(e.request.url, { cache: 'no-cache' })
    .then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; }) // 오류 화면은 저장 안 함
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
// 알림 서버(push/worker.js)가 보낸 아침·퇴근 전 알림
self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(d.title || 'BAB:ZIP', { body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => {
    const c = cs[0];
    return c ? c.navigate(url).then(w => (w || c).focus()) : self.clients.openWindow(url);
  }));
});
