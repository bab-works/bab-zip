// 즉시 열기: 한 번 열었던 앱은 저장된 화면 파일로 바로 뜸 (인터넷이 끊겨도) / 화면 보안 규칙(CSP): 허용 안 한 곳과는 통신 못 함
const { chromium, devices } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
let served = 0;
http.createServer((q, r) => { served++; const f = path.join(__dirname, '..', q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : f.endsWith('.webmanifest') ? 'application/manifest+json' : f.endsWith('.woff2') ? 'font/woff2' : 'text/html' }); r.end(b); }); }).listen(8803, async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ ...devices['iPhone 13'] }), p = await ctx.newPage();
  p.on('pageerror', e => { console.error('ERR', e.message); process.exit(1); });
  await ctx.addInitScript(() => { if (!localStorage.getItem('cfg')) { localStorage.setItem('startSec', '"home"'); localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 'pw1' })); } });
  await ctx.route('https://script.google.com/**', rt => rt.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, role: 'owner', name: '나', lists: {}, habits: [], items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } }) }));
  await p.goto('http://localhost:8803/'); await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForTimeout(800);
  assert.ok(await p.evaluate(() => !!navigator.serviceWorker.controller), 'service worker controls the page');
  // 인터넷 끊김 → 그래도 앱이 뜸
  await ctx.setOffline(true); await p.reload(); await p.waitForTimeout(800);
  assert.equal(await p.textContent('#appTitle'), '오늘', 'opens from saved files while offline'); await ctx.setOffline(false);
  // 저장된 파일로 먼저 뜸: 서버가 응답하기 전에 화면이 이미 그려짐 (서버를 3초 늦춰도 1초 안에 뜸)
  await ctx.route('http://localhost:8803/**', async rt => { await new Promise(r => setTimeout(r, 3000)); rt.continue(); });
  const t0 = Date.now(); await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('#appTitle'); const t = Date.now() - t0;
  assert.ok(t < 1500, `instant launch from cache (${t}ms)`); await ctx.unroute('http://localhost:8803/**');
  // 화면 보안 규칙: 모르는 서버로는 통신 불가, 시트는 허용
  const blocked = await p.evaluate(() => fetch('https://evil.example.com/steal').then(() => false, () => true));
  assert.ok(blocked, 'CSP blocks unknown hosts');
  assert.match(await p.$eval('meta[http-equiv="Content-Security-Policy"]', m => m.content), /connect-src 'self' https:\/\/script\.google\.com/);
  console.log('OFFLINE OK'); await b.close(); process.exit(0); });
