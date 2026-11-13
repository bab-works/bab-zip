const { chromium, devices } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = require('path').join(__dirname, '..'), S = process.argv[2] || require('os').tmpdir(), body = JSON.stringify({ ok: true, items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } }); // 시트 응답은 빈 가짜 데이터, S = 스크린샷 폴더
http.createServer((q, r) => { const f = path.join(ROOT, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]);
  fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.woff2') ? 'font/woff2' : f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(b); }); }).listen(8784, async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 15 Pro'] });
  await ctx.addInitScript(() => localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/x', token: 't' })));
  const p = await ctx.newPage(); p.on('pageerror', e => console.error('ERR', e.message));
  await p.route('https://script.google.com/**', rt => rt.fulfill({ contentType: 'application/json', body }));
  await p.goto('http://localhost:8784/'); await p.waitForFunction(() => /동기화됨/.test(document.querySelector('#syncPop').textContent + document.querySelector('#status').textContent));
  const assert = require('assert');
  const order = () => p.$$eval('#menuList [data-sec]', bs => bs.map(b => b.dataset.sec).join());
  await p.click('#menuBtn'); await p.waitForTimeout(400);
  const o0 = await order(); assert.equal(o0, 'money,book,escape,board,movie,play,habit');
  const box = async k => (await p.locator(`#menuList [data-sec=${k}]`).boundingBox());
  // 짧게 누르면 이동 (편집 아님)는 마지막에 확인. 꾹 누르기 → 편집
  let bx = await box('habit'); await p.mouse.move(bx.x + 40, bx.y + bx.height / 2); await p.mouse.down(); await p.waitForTimeout(600); await p.mouse.up();
  assert.equal(await p.locator('#menuList.editing').count(), 1); assert.equal(await p.isVisible('#menuDone'), true);
  assert.equal(await p.locator('#menu[open]').count(), 1, 'long press does not navigate');
  // 습관을 맨 위로 끌기
  bx = await box('habit'); const top = await box('money');
  await p.mouse.move(bx.x + 40, bx.y + bx.height / 2); await p.mouse.down();
  for (let i = 1; i <= 20; i++) { await p.mouse.move(bx.x + 40, bx.y + bx.height / 2 - (bx.y - top.y) * i / 20); await p.waitForTimeout(16); }
  await p.screenshot({ path: S + '/menu-edit.png' });
  await p.mouse.up(); await p.waitForTimeout(100);
  assert.equal(await order(), 'habit,money,book,escape,board,movie,play');
  await p.click('#menuList [data-sec=book]', { force: true }); assert.equal(await p.locator('#menu[open]').count(), 1, 'tap in edit mode does not navigate');
  await p.click('#menuDone'); assert.equal(await p.locator('#menuList.editing').count(), 0);
  await p.evaluate(() => document.querySelector('#menu').close()); await p.waitForTimeout(400);
  await p.reload(); await p.waitForTimeout(800); await p.click('#menuBtn'); await p.waitForTimeout(400);
  assert.equal(await order(), 'habit,money,book,escape,board,movie,play', 'order persisted');
  await p.click('#menuList [data-sec=book]'); await p.waitForTimeout(300); assert.equal(await p.textContent('#appTitle'), '독서', 'short tap navigates');
  console.log('MENU EDIT OK'); await b.close(); process.exit(0); });
