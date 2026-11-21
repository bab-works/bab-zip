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
  const navY = () => p.$eval('nav', e => e.getBoundingClientRect().bottom);
  assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY), 'none', 'no native page bounce (it dragged the tab bar)');
  const y0 = await navY();
  await drag(220); await p.waitForTimeout(600); assert.ok(gets.length > n, 'big pull reloads');
  assert.equal(await navY(), y0, 'tab bar stays put while refreshing');
  await p.evaluate(() => toast('이건 두 줄 정도면 충분히 보여야 하는 꽤 긴 안내 문장이에요 · 예전엔 네 줄로 꺾였어요'));
  const h = await p.evaluate(() => { const t = $('#toast'); return t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight); });
  assert.ok(h < 3.6, 'toast fits in ~2 lines, got ' + h);
  // 영화 탭 ＋ → 영화 검색 → 위시리스트에 바로 담기
  await p.unroute('https://script.google.com/**'); const posts = [];
  await p.route('https://script.google.com/**', rt => { const q = rt.request(); if (q.method() === 'POST') posts.push(JSON.parse(q.postData()));
    rt.fulfill({ contentType: 'application/json', body: JSON.stringify(/what=movie/.test(q.url()) ? { ok: true, movies: [{ title: '위키드', type: '영화', year: '2024', image: '' }] } : { ok: true, wrote: true, lists: {} }) }); });
  await p.evaluate(() => setSection('movie')); await p.waitForTimeout(300);
  assert.ok(await p.locator('#lNotice').isHidden(), 'movie has search now');
  await p.click('#fab'); await p.click('[data-add=find]'); await p.fill('#findQ', '위키드'); await p.waitForSelector('#findList [data-to=movieWant]');
  assert.match(await p.textContent('#findList'), /2024 · 영화/);
  await p.click('#findList [data-to=movieWant]'); await p.waitForTimeout(500);
  assert.ok(posts.some(o => o.action === 'listSave' && o.list === 'movieWant' && o.item.title === '위키드' && o.item.memo === '2024년'), JSON.stringify(posts));
  console.log('PTR OK'); await b.close(); process.exit(0); });
