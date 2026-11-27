// 앱 화면 파일만 캐시 (시트 API 요청은 건드리지 않음). 파일 수정 후엔 버전을 올리세요.
const CACHE = 'gagyebu-v113';
const FILES = ['./', 'index.html', 'friend-house.webp', 'tmdb-logo.svg', 'notices.js', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'PretendardVariable.woff2'];
// 설치: 화면 파일을 브라우저 HTTP 캐시를 건너뛰고 새로 받아 저장
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// 화면 파일: 저장해 둔 걸로 바로 보여 주고(인터넷을 기다리지 않음) 뒤에서 새로 받아 저장 = 앱이 즉시 열림
// 새 버전 확인(sw.js, cache:no-store 요청)은 늘 인터넷으로 → 바뀌었으면 앱이 새 서비스 워커로 새로고침
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (e.request.cache === 'no-store' || url.pathname.endsWith('/sw.js')) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request.url, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }); // 오류 화면은 저장 안 함
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net.catch(() => Response.error());
  }));
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
