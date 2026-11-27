// Face ID 잠금: 크로미움 가상 인증기(패스키)로 켜기 → 다시 열면 잠김 → 풀기 / 비밀번호로도 풀림
const { chromium } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
http.createServer((q, r) => { const f = path.join(__dirname, '..', q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(b); }); }).listen(8784, async () => {
  const b = await chromium.launch(), ctx = await b.newContext(), p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('cfg')) void localStorage.setItem('startSec', '"money"') || localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 'pw1' })); });
  const posts = [];
  await p.route('https://script.google.com/**', rt => { // 비밀번호로 풀 때는 서버에 확인(기기엔 비밀번호가 없음)
    const o = rt.request().method() === 'POST' ? JSON.parse(rt.request().postData()) : {}; posts.push(o);
    rt.fulfill({ contentType: 'application/json', body: JSON.stringify(o.action === 'login' ? (o.password === 'pw1' ? { ok: true, token: 'so.new', role: 'owner', name: '서현' } : { ok: false, error: '아이디 또는 비밀번호가 맞지 않아요' })
      : /what=me/.test(rt.request().url()) ? { ok: true, role: 'owner', name: '서현' } : { ok: true, items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } }) });
  });
  await p.goto('http://localhost:8784/'); await p.waitForTimeout(500);
  assert.equal(await p.locator('#lock[open]').count(), 0, 'no lock until enabled');
  await p.click('#openSettings'); await p.click('#prefs .switch:has(#lockOn)'); await p.waitForTimeout(800);
  assert.ok(await p.evaluate(() => JSON.parse(localStorage.getItem('lockId') || '""')), 'credential saved');
  await p.reload(); await p.waitForTimeout(500);
  await p.waitForTimeout(1000); assert.equal(await p.locator('#lock[open]').count(), 0, 'Face ID asked right away on launch');
  // 두 번 뜨던 문제: 방금 풀었으면 새 버전으로 새로고침돼도 다시 묻지 않음
  await p.evaluate(() => { window.__gets = 0; const g = navigator.credentials.get.bind(navigator.credentials); navigator.credentials.get = o => { window.__gets++; return g(o); }; });
  await p.evaluate(() => { lockNow(); lockNow(); }); await p.waitForTimeout(500);
  assert.equal(await p.evaluate(() => window.__gets), 0, 'no second Face ID right after unlocking'); assert.equal(await p.locator('#lock[open]').count(), 0);
  await p.reload(); await p.waitForTimeout(800); assert.equal(await p.locator('#lock[open]').count(), 0, 'reload (new version) within 2 min keeps it unlocked');
  await p.evaluate(() => { navigator.credentials.get = () => Promise.reject(new Error('NotAllowed')); }); // 자동 시도가 막히는 아이폰 흉내
  await p.evaluate(() => { sessionStorage.removeItem('unlockedAt'); lockNow(); }); await p.waitForTimeout(500);
  assert.equal(await p.locator('#lock[open]').count(), 1, 'stays locked if auto prompt blocked');
  await p.fill('#lockPw [name=pw]', 'nope'); await p.click('#lockPw button'); assert.equal(await p.locator('#lock[open]').count(), 1);
  await p.fill('#lockPw [name=pw]', 'pw1'); await p.click('#lockPw button'); await p.waitForTimeout(600); assert.equal(await p.locator('#lock[open]').count(), 0, 'password fallback');
  assert.equal(JSON.parse(await p.evaluate(() => localStorage.getItem('cfg'))).token, 'so.new', 'unlocking by password swaps in a fresh session');
  assert.ok(posts.some(o => o.action === 'logout'), 'and ends the old one');
  console.log('LOCK OK'); await b.close(); process.exit(0); });
