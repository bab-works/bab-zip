// Face ID 잠금: 크로미움 가상 인증기(패스키)로 켜기 → 다시 열면 잠김 → 풀기 / 비밀번호로도 풀림
const { chromium } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
http.createServer((q, r) => { const f = path.join(__dirname, '..', q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(b); }); }).listen(8784, async () => {
  const b = await chromium.launch(), ctx = await b.newContext(), p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('cfg')) localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 'pw1' })); });
  await p.route('https://script.google.com/**', rt => rt.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } }) }));
  await p.goto('http://localhost:8784/'); await p.waitForTimeout(500);
  assert.equal(await p.locator('#lock[open]').count(), 0, 'no lock until enabled');
  await p.click('#openSettings'); await p.click('#settings .switch:has(#lockOn)'); await p.waitForTimeout(800);
  assert.ok(await p.evaluate(() => JSON.parse(localStorage.getItem('lockId') || '""')), 'credential saved');
  await p.reload(); await p.waitForTimeout(500);
  await p.waitForTimeout(1000); assert.equal(await p.locator('#lock[open]').count(), 0, 'Face ID asked right away on launch');
  await p.evaluate(() => { navigator.credentials.get = () => Promise.reject(new Error('NotAllowed')); }); // 자동 시도가 막히는 아이폰 흉내
  await p.evaluate(() => { localStorage.setItem('x', 1); lockNow(); }); await p.waitForTimeout(500);
  assert.equal(await p.locator('#lock[open]').count(), 1, 'stays locked if auto prompt blocked');
  await p.fill('#lockPw [name=pw]', 'nope'); await p.click('#lockPw button'); assert.equal(await p.locator('#lock[open]').count(), 1);
  await p.fill('#lockPw [name=pw]', 'pw1'); await p.click('#lockPw button'); await p.waitForTimeout(600); assert.equal(await p.locator('#lock[open]').count(), 0, 'password fallback');
  console.log('LOCK OK'); await b.close(); process.exit(0); });
