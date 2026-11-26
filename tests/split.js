// N빵: 내역·달력에서 고르기(누르기/옆으로 쓸기) → 사람 수 → 1인당 10원 올림 → 항목·계좌·보낼 금액 복사 / 계좌는 기기에만
const { chromium, devices } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
http.createServer((q, r) => { const f = path.join(__dirname, '..', q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(b); }); }).listen(8799, async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ ...devices['iPhone 13'] }), p = await ctx.newPage();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  p.on('pageerror', e => { console.error('ERR', e.message); process.exit(1); });
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10), m = today.slice(0, 7);
  const tx = (id, content, amount, type = '지출', time = '12:00') => ({ id, date: today, time, type, major: '식비', minor: '', content, pay: '카드', amount, memo: '' });
  const items = [tx('t1', '삼겹살', 52000, '지출', '19:00'), tx('t2', '2차 맥주', 31000, '지출', '21:00'), tx('t3', '택시', 12000, '지출', '23:00'), tx('t4', '월급', 3000000, '수입', '09:00')];
  await ctx.addInitScript(() => { if (!localStorage.getItem('cfg')) { localStorage.setItem('startSec', '"money"'); localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 'pw1' })); } });
  await p.route('https://script.google.com/**', rt => rt.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, items, meta: { cats: [['식비', '']], budgets: {}, payments: [['카드', '신용']], rules: [], recurring: [] } }) }));
  await p.goto('http://localhost:8799/'); await p.waitForTimeout(1200);
  // 1) 내역: N빵 → 누르면 선택(편집 창 안 열림)
  await p.evaluate(() => show('list')); await p.waitForTimeout(300);
  await p.click('[data-split="#list"]'); assert.equal(await p.isVisible('#splitBar'), true);
  assert.equal(await p.isDisabled('#splitGo'), true);
  await p.click('#list li[data-id=t1]'); await p.waitForTimeout(200);
  assert.equal(await p.locator('#entry[open]').count(), 0, 'tap selects instead of opening editor');
  // 2) 옆으로 쓸어 여러 개: t2에서 시작해 t3까지 (터치처럼 포인터 이벤트)
  const box = async id => p.locator(`#list li[data-id=${id}]`).boundingBox();
  const b2 = await box('t2'), b3 = await box('t3');
  await p.mouse.move(b2.x + 60, b2.y + b2.height / 2); await p.mouse.down();
  await p.mouse.move(b2.x + 120, b2.y + b2.height / 2, { steps: 4 }); await p.mouse.move(b3.x + 140, b3.y + b3.height / 2, { steps: 6 }); await p.mouse.up();
  await p.waitForTimeout(200);
  assert.deepEqual(await p.$$eval('#list li.sel', l => l.map(x => x.dataset.id).sort()), ['t1', 't2', 't3']);
  assert.match(await p.textContent('#splitCount'), /3개 · 95,000원/);
  // 3) 3명 → 31,666.7 → 10원 올림 31,670원
  await p.click('#splitBar [data-n="1"]'); assert.equal(await p.textContent('#splitN'), '3명');
  assert.match(await p.textContent('#splitGo'), /1인당 31,670원/);
  // 4) 처음엔 계좌를 물어보고(기기에만 저장), 결과를 복사
  await p.evaluate(() => { window.__askAuto = (msg, isInput) => isInput ? '테스트은행 000-111 홍길동' : true; });
  await p.click('#splitGo'); await p.waitForSelector('#splitSheet[open]'); await p.waitForTimeout(300);
  const text = await p.inputValue('#splitText');
  assert.match(text, /^\[N빵 정산\] 3명\n· \d+\/\d+ 삼겹살 52,000원\n· \d+\/\d+ 2차 맥주 31,000원\n· \d+\/\d+ 택시 12,000원\n합계 95,000원 ÷ 3명\n1인당 31,670원\n\n테스트은행 000-111 홍길동\n31,670원 보내주세요$/);
  assert.equal(await p.evaluate(() => navigator.clipboard.readText()), text, 'copied to clipboard');
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('splitAcct'))), '테스트은행 000-111 홍길동');
  await p.screenshot({ path: require('os').tmpdir() + '/split.png' });
  await p.click('#splitCopy'); await p.waitForTimeout(300); assert.equal(await p.locator('#splitSheet[open]').count(), 0);
  assert.equal(await p.isVisible('#splitBar'), false, 'done → leaves split mode');
  // 5) 달력에서도: 이날 목록에서 N빵, 수입만 고르면 계산 안 됨
  await p.evaluate(() => show('cal')); await p.waitForTimeout(300);
  await p.click('[data-split="#dayList"]'); await p.click('#dayList li[data-id=t4]');
  assert.equal(await p.isDisabled('#splitGo'), true, 'income only → nothing to split');
  await p.click('#dayList li[data-id=t3]'); assert.match(await p.textContent('#splitCount'), /2개 · 12,000원/);
  await p.click('#splitCancel'); assert.equal(await p.locator('#dayList li.sel').count(), 0);
  // 고르는 중이 아니면 누르면 편집 창
  await p.click('#dayList li[data-id=t3]'); await p.waitForTimeout(300); assert.equal(await p.locator('#entry[open]').count(), 1);
  console.log('SPLIT OK'); await b.close(); process.exit(0); });
