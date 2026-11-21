// 검색: 결과는 5개씩, 「더 보기」로 5개씩 더 / 연관검색어(자주 나온 저자·제목 단어) 칩을 누르면 그걸로 다시 검색
const { chromium, devices } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
http.createServer((q, r) => { const f = path.join(__dirname, '..', q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(b); }); }).listen(8802, async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ ...devices['iPhone 13'] }), p = await ctx.newPage(), qs = [];
  p.on('pageerror', e => { console.error('ERR', e.message); process.exit(1); });
  const books = Array.from({ length: 12 }, (_, k) => ({ title: k < 4 ? `만조를 기다리며 ${k + 1}` : `위픽 단편 ${k}`, author: k % 2 ? '조예은 (지은이)' : '천선란 (지은이)', image: '' }));
  await ctx.addInitScript(() => { if (!localStorage.getItem('cfg')) { localStorage.setItem('startSec', '"book"'); localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 'pw1' })); } });
  await p.route('https://script.google.com/**', rt => { const u = new URL(rt.request().url()); if (u.searchParams.get('what') === 'book') qs.push(u.searchParams.get('q'));
    rt.fulfill({ contentType: 'application/json', body: JSON.stringify(u.searchParams.get('what') === 'book' ? { ok: true, books } : { ok: true, lists: {}, habits: [], items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } }) }); });
  await p.goto('http://localhost:8802/'); await p.waitForTimeout(800);
  await p.evaluate(() => openFind()); await p.fill('#findQ', '위픽'); await p.waitForSelector('#findList [data-more]');
  const shown = () => p.locator('#findList li:not(.find-more)').count();
  assert.equal(await shown(), 5); assert.match(await p.textContent('[data-more]'), /5개 더 보기/);
  await p.click('[data-more]'); assert.equal(await shown(), 10); assert.match(await p.textContent('[data-more]'), /2개 더 보기/);
  await p.click('[data-more]'); assert.equal(await shown(), 12); assert.equal(await p.locator('[data-more]').count(), 0);
  // 연관검색어: 저자 이름·자주 나온 제목 단어, 지금 검색어(위픽)는 빼고
  const rel = await p.$$eval('#findRel [data-rel]', l => l.map(x => x.dataset.rel));
  assert.ok(rel.includes('조예은') && rel.includes('천선란') && rel.includes('만조를'), JSON.stringify(rel)); assert.ok(!rel.includes('위픽'));
  await p.click('#findRel [data-rel="조예은"]'); await p.waitForTimeout(500);
  assert.equal(await p.inputValue('#findQ'), '조예은'); assert.equal(qs.at(-1), '조예은'); assert.equal(await shown(), 5, 'new search starts at 5 again');
  await p.fill('#findQ', 'a'); await p.waitForTimeout(100); assert.equal(await p.isVisible('#findRel'), false);
  console.log('FIND OK'); await b.close(); process.exit(0); });
