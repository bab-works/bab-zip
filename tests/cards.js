// 가계부 대시보드 카드 실적: 결제수단 이름으로 카드별 이번 달 사용액(환불 차감·이체 제외), 모자란 금액, 눌러서 실적 금액 저장
const { chromium, devices } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
http.createServer((q, r) => { const f = path.join(__dirname, '..', q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(b); }); }).listen(8801, async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ ...devices['iPhone 13'] }), p = await ctx.newPage(), posts = [];
  p.on('pageerror', e => { console.error('ERR', e.message); process.exit(1); });
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const tx = (id, type, pay, amount) => ({ id, date: today, time: '', type, major: '식비', minor: '', content: id, pay, amount, memo: '' });
  const items = [tx('a', '지출', '롯데카드', 120000), tx('b', '지출', '현대카드(M)', 200000), tx('c', '환불', '현대카드(M)', 10000), tx('d', '이체', '롯데카드', 500000), tx('e', '지출', 'KB국민카드', 350000)];
  const cards = [{ name: '롯데카드', match: '롯데', goal: 300000 }, { name: '현대카드', match: '현대', goal: 0 }, { name: '국민카드', match: '국민|KB', goal: 300000 }];
  await ctx.addInitScript(() => { if (!localStorage.getItem('cfg')) { localStorage.setItem('startSec', '"money"'); localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 'pw1' })); } });
  await p.route('https://script.google.com/**', rt => { const q = rt.request(); if (q.method() === 'POST') posts.push(JSON.parse(q.postData()));
    rt.fulfill({ contentType: 'application/json', body: JSON.stringify(q.method() === 'POST' ? { ok: true, wrote: true } : { ok: true, full: true, items, meta: { cats: [['식비', '']], budgets: {}, cards, payments: [], rules: [], recurring: [] } }) }); });
  await p.goto('http://localhost:8801/'); await p.waitForTimeout(1200);
  const row = n => p.textContent(`#cardGoals [data-cardname="${n}"]`);
  assert.match(await row('롯데카드'), /120,000원[\s\S]*30만[\s\S]*180,000원 더 써야/, 'transfer excluded');
  assert.match(await row('현대카드'), /190,000원[\s\S]*눌러서 실적 금액을 정해/, 'refund subtracted, no goal yet');
  assert.match(await row('국민카드'), /350,000원[\s\S]*실적 달성/);
  await p.evaluate(() => { window.__askAuto = () => '400000'; });
  await p.click('#cardGoals [data-cardname="현대카드"]'); await p.waitForTimeout(400);
  assert.deepEqual(posts.at(-1), { action: 'cardGoal', name: '현대카드', goal: 400000, token: 'pw1' });
  assert.match(await row('현대카드'), /210,000원 더 써야/);
  await p.screenshot({ path: require('os').tmpdir() + '/cards.png' });
  console.log('CARDS UI OK'); await b.close(); process.exit(0); });
