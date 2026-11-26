// 습관이 많을 때: 달력 칸 안은 점 대신 막대(칸 밖으로 안 넘침) + 습관마다 따로 보는 작은 달력
const { chromium, devices } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
http.createServer((q, r) => { const f = path.join(__dirname, '..', q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : 'text/html' }); r.end(b); }); }).listen(8800, async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' }), p = await ctx.newPage();
  p.on('pageerror', e => { console.error('ERR', e.message); process.exit(1); });
  const t = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4), st = k => +new Date(t - k * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
  const COLORS = ['#ff9bac', '#9be7e7', '#8edb84', '#f18bec', '#7bc4fa', '#bf8af5'];
  const habits = Array.from({ length: 10 }, (_, k) => ({ id: 'h' + String(k).padStart(8, '0'), name: ['나이아신아마이드', '유산균 + 비타민C', '마그네슘 + 비타민D', '오메가3', '비타민c 세럼', '아젤리아 크림', '레티놀 크림', '절주', '독서', '운동'][k], icon: '💊', color: COLORS[k % 6],
    rule: k === 6 ? 'RRULE:FREQ=WEEKLY;BYDAY=MO' : 'RRULE:FREQ=DAILY', enc: '', done: k % 2 ? [st(0), st(1)] : [st(1)], total: 2, local: true }));
  await ctx.addInitScript(() => { if (!localStorage.getItem('cfg')) { localStorage.setItem('startSec', '"habit"'); localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 'f0123456789a' })); } });
  await p.route('https://script.google.com/**', rt => { const u = rt.request().url();
    rt.fulfill({ contentType: 'application/json', body: JSON.stringify(/what=habits/.test(u) ? { ok: true, habits } : /what=me/.test(u) ? { ok: true, role: 'friend', name: '민지', people: [] } : { ok: true, lists: {} }) }); });
  await p.goto('http://localhost:8800/'); await p.waitForSelector('#hList .hcheck'); await p.waitForTimeout(400);
  // 달력 펼치기 → 오늘 칸: 습관 10개라 점 대신 막대, 칸 밖으로 안 나감
  await p.click('#hGrab'); await p.waitForTimeout(500);
  const fit = await p.$$eval('#hGrid button', bs => bs.every(b => [...b.querySelectorAll('.hdots, .hbar')].every(x => { const r = x.getBoundingClientRect(), o = b.getBoundingClientRect(); return r.left >= o.left - 1 && r.right <= o.right + 1; })));
  assert.ok(fit, 'nothing spills out of a calendar cell');
  assert.equal(await p.locator('#hGrid .hdots').count(), 0); assert.ok(await p.locator('#hGrid .hbar').count() > 0);
  // 습관별 달력: 10개, 이번 달 칸 수 = 그 달 날수 (+ 앞 빈칸), 한 날은 그 습관 색, 쉬는 날은 빗금
  assert.equal(await p.locator('#hEach .h1').count(), 10);
  const days = new Date(t.getUTCFullYear(), t.getUTCMonth() + 1, 0).getDate();
  assert.equal(await p.locator('#hEach .h1 >> nth=0').locator('.h1-grid i:not(.pad)').count(), days);
  assert.equal(await p.$eval('#hEach .h1:nth-child(2) .h1-grid i.on', i => getComputedStyle(i).backgroundColor), 'rgb(155, 231, 231)');
  assert.ok(await p.locator('#hEach .h1:nth-child(7) .h1-grid i.rest').count() > 0, 'weekly habit shows rest days hatched');
  assert.ok(await p.$eval('#hEach', e => e.scrollWidth <= e.clientWidth + 1), 'habit cards fit the screen width');
  await p.screenshot({ path: require('os').tmpdir() + '/habit-each.png', fullPage: true });
  // 피크엔드: 그날 할 습관을 마지막 하나까지 체크하면 축하
  const first = await p.evaluate(() => { const st = stampOf(hDay); habits.forEach((h, i) => { if (i) { if (!h.done.includes(st)) h.done.push(st); } else h.done = h.done.filter(x => x !== st); }); renderHabits(); return habits[0].id; });
  await p.click(`#hList [data-h="${first}"]`); await p.waitForTimeout(300);
  assert.match(await p.textContent('#toast'), /습관을 모두 했어요/);
  // 누르면 그 습관의 1년 기록
  await p.click('#hEach .h1 >> nth=0'); await p.waitForSelector('#hDetail[open]');
  console.log('HABIT MANY OK'); await b.close(); process.exit(0); });
