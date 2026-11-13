const { chromium, devices } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
const ROOT = require('path').join(__dirname, '..'), S = process.argv[2] || require('os').tmpdir(), body = JSON.stringify({ ok: true, items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } }); // 시트 응답은 빈 가짜 데이터, S = 스크린샷 폴더
http.createServer((q, r) => { const f = path.join(ROOT, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.woff2') ? 'font/woff2' : f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(b); }); }).listen(8783, async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ ...devices['iPhone 15 Pro'], reducedMotion: 'reduce' });
  await ctx.addInitScript(() => localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 't' })));
  const p = await ctx.newPage(); p.on('pageerror', e => console.error('ERR', e.message));
  const t = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4), st = k => +new Date(t - k * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
  const H = (id, name, icon, color, rule, done, total, enc = '') => ({ id: id.repeat(24), name, icon, color, rule, done, total, enc });
  const habits = [H('a', '유산균 + 비타민C', 'habit_take_medicine', '#A0EFED', 'RRULE:FREQ=DAILY', [st(1), st(2), st(3)], 167, '피부 건강을 위한 모닝 루틴'),
    H('b', '책 읽기', 'habit_reading', '#7BC4FA', 'RRULE:FREQ=DAILY', [st(0), st(1)], 193, '하루 한 장'),
    H('c', '운동', 'habit_exercising', '#BF8AF5', 'RRULE:FREQ=DAILY', [], 7), H('d', '레티놀 크림', 'habit_skincare', '#FF9BAC', 'RRULE:FREQ=WEEKLY;BYDAY=XX', [], 7)];
  const posts = [];
  await p.route('https://script.google.com/**', rt => {
    const q = rt.request();
    if (q.method() === 'POST') { posts.push(JSON.parse(q.postData())); return rt.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
    rt.fulfill({ contentType: 'application/json', body: /what=habits/.test(q.url()) ? JSON.stringify({ ok: true, habits }) : body });
  });
  await p.goto('http://localhost:8783/'); await p.waitForTimeout(800);
  await p.click('#menuBtn'); await p.click('#menuList [data-sec=habit]'); await p.waitForSelector('#hList .hcheck');
  assert.equal(await p.locator('#hList li').count(), 3); assert.equal(await p.textContent('#hRest'), '이날 쉬는 습관 1개');
  assert.equal(await p.textContent('#hInfo'), '오늘 1/3 완료');
  assert(/🔥 3일 연속/.test(await p.textContent('#hList li:nth-child(1)')), 'streak counts back over today');
  assert(/🔥 2일 연속/.test(await p.textContent('#hList li:nth-child(2)')));
  await p.screenshot({ path: S + '/habit.png' });
  await p.click('#hList li:nth-child(1) .hcheck'); await p.waitForTimeout(300);
  assert.deepEqual(posts.at(-1), { action: 'habitCheck', habitId: 'a'.repeat(24), stamp: st(0), done: true, token: 't' });
  assert.equal(await p.textContent('#hInfo'), '오늘 2/3 완료'); assert(/4일 연속 · 총 168일/.test(await p.textContent('#hList li:nth-child(1)')));
  const yd = new Date(t - 864e5).toISOString().slice(0, 10);
  const h0 = await p.evaluate(() => document.querySelector('#hClip').offsetHeight);
  assert(h0 < 80, 'folded to one week: ' + h0);
  assert.equal(await p.getAttribute('#hGrid button.today i', 'style'), '--p:67%');
  await p.click('#hGrab'); await p.waitForTimeout(400);
  const h1 = await p.evaluate(() => document.querySelector('#hClip').offsetHeight); assert(h1 > 200, 'expanded month: ' + h1);
  await p.screenshot({ path: S + '/habit-month.png' });
  await p.click('#hPrev'); assert(/년/.test(await p.textContent('#hMonth'))); await p.click('#hNext');
  assert.equal(await p.isDisabled('#hNext'), true);
  await p.click(`#hGrid [data-d="${yd}"]`); // 어제
  assert(/1\/3|2\/3/.test(await p.textContent('#hInfo')));
  await p.click('#hList li:nth-child(2) .hcheck'); await p.waitForTimeout(300);
  assert.deepEqual(posts.at(-1).done, false); assert.equal(posts.at(-1).stamp, st(1));
  await p.click('#reload'); await p.waitForTimeout(500);
  assert.equal(await p.locator('#fab').isHidden(), true); assert.equal(await p.locator('nav').isHidden(), true);
  await p.click('#menuBtn'); await p.click('#menuList [data-sec=money]'); await p.waitForTimeout(300);
  assert.equal(await p.locator('#v-habit').isHidden(), true); assert.equal(await p.locator('#v-home').isVisible(), true);
  await p.click('#menuBtn'); await p.click('#menuList [data-sec=book]'); await p.waitForTimeout(300);
  assert.equal(await p.locator('#v-habit').isHidden(), true); assert.equal(await p.locator('#v-lists').isVisible(), true);
  console.log('HABIT APP OK'); await b.close(); process.exit(0); });
