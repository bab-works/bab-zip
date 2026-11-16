// 당겨서 새로고침 + 넓어진 토스트
const { chromium, devices } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
http.createServer((q, r) => { const f = path.join(__dirname, '..', q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(b); }); }).listen(8795, async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ ...devices['iPhone 13'] }), p = await ctx.newPage(), gets = [];
  p.on('pageerror', e => { console.error('ERR', e.message); process.exit(1); });
  await ctx.addInitScript(() => { if (!localStorage.getItem('cfg')) void localStorage.setItem('startSec', '"money"') || localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 'pw1' })); });
  await p.route('https://script.google.com/**', rt => { gets.push(rt.request().url()); rt.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } }) }); });
  await p.goto('http://localhost:8795/'); await p.waitForTimeout(800);
  const n = gets.length, drag = async dy => p.evaluate(dy => {
    const t = (type, y) => document.querySelector('main').dispatchEvent(new TouchEvent(type, { bubbles: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: document.body, clientY: y })] }));
    t('touchstart', 100); t('touchmove', 100 + dy); t('touchend', 0);
  }, dy);
  await drag(60); await p.waitForTimeout(400); assert.equal(gets.length, n, 'small pull does nothing');
  await drag(220); await p.waitForTimeout(600); assert.ok(gets.length > n, 'big pull reloads');
  await p.evaluate(() => toast('이건 두 줄 정도면 충분히 보여야 하는 꽤 긴 안내 문장이에요 · 예전엔 네 줄로 꺾였어요'));
  const h = await p.evaluate(() => { const t = $('#toast'); return t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight); });
  assert.ok(h < 3.6, 'toast fits in ~2 lines, got ' + h);
  console.log('PTR OK'); await b.close(); process.exit(0); });
