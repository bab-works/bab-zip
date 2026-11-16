// 사진으로 입력: 글자 → 거래 후보 (은행 앱 목록·영수증), 이미 있는 거래는 체크 해제, 고른 것만 저장
const { chromium } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
http.createServer((q, r) => { const f = path.join(__dirname, '..', q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(b); }); }).listen(8786, async () => {
  const b = await chromium.launch(), ctx = await b.newContext(), p = await ctx.newPage(); p.on('pageerror', e => { console.error('ERR', e.message); process.exit(1); });
  await ctx.addInitScript(() => localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 't' })));
  const today = await p.evaluate(() => 0) || new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);
  const meta = { cats: [['식비', '배달'], ['카페·간식', '카페'], ['기타', ''], ['수입', '급여']], budgets: {}, payments: [], rules: [['스타벅스', '지출', '카페·간식', '카페'], ['쿠팡이츠', '지출', '식비', '배달']], recurring: [] };
  const items = [{ id: 'old', date: today, time: '', type: '지출', major: '식비', minor: '배달', content: '쿠팡이츠', pay: '', amount: 18900, memo: '' }];
  const ocrText = `${today.replace(/-/g, '.')} (오늘)\n스타벅스 강남점\n-4,500원\n쿠팡이츠\n-18,900원\n스타벅스 강남점\n-4,500원\n급여 입금\n+2,500,000원\n잔액 1,234,567원`;
  const posts = [];
  await p.route('https://script.google.com/**', rt => { const q = rt.request();
    if (q.method() === 'POST') { const o = JSON.parse(q.postData()); posts.push(o); return rt.fulfill({ contentType: 'application/json', body: JSON.stringify(o.action === 'ocr' ? { ok: true, text: ocrText } : { ok: true, wrote: true }) }); }
    rt.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, items, full: true, meta }) }); });
  await p.goto('http://localhost:8786/'); await p.waitForTimeout(800);
  // 파서: 은행 앱 목록 / 영수증 / 카드 문자
  const parse = (t, d) => p.evaluate(([t, d]) => parseOcr(t, d), [t, d]);
  const bank = await parse('11.14 (금)\n스타벅스 강남점\n-4,500원\nGS25 역삼점\n-3,200원\n11.15 (토)\n쿠팡이츠\n-18,900원\n급여 입금\n+2,500,000원\n잔액 1,234,567원', '2026-11-16');
  assert.deepEqual(bank.map(r => [r.date, r.content, r.amount, r.type]), [['2026-11-14', '스타벅스 강남점', 4500, '지출'], ['2026-11-14', 'GS25 역삼점', 3200, '지출'], ['2026-11-15', '쿠팡이츠', 18900, '지출'], ['2026-11-15', '급여 입금', 2500000, '수입']]);
  const rcpt = await parse('스타벅스 강남점\n2026-11-15 12:01\n아메리카노 4,500\n라떼 5,000\n합계 9,500', '2026-11-16');
  assert.deepEqual(rcpt.map(r => [r.date, r.time, r.content, r.amount]), [['2026-11-15', '12:01', '스타벅스 강남점', 9500]]);
  assert.equal((await parse('12/30 마트 30,000원', '2026-01-03'))[0].date, '2025-12-30', 'future date → last year');
  const sms = await parse('[Web발신]\n현대카드 승인\n홍*동\n12,300원 일시불\n11/15 13:20\n스타벅스 강남', '2026-11-16');
  assert.deepEqual(sms.map(r => [r.date, r.time, r.content, r.amount]), [['2026-11-15', '13:20', '스타벅스 강남', 12300]]);
  const sms1 = await parse('신한카드(1234)승인 홍*동 8,000원(일시불)11/14 09:05 파리바게뜨', '2026-11-16');
  assert.deepEqual(sms1.map(r => [r.date, r.time, r.content, r.amount]), [['2026-11-14', '09:05', '파리바게뜨', 8000]]);
  // 화면: 📷 → 후보 4건, 시트에 있는 쿠팡이츠·사진 안 두 번째 스타벅스는 체크 해제
  await p.setInputFiles('#photoIn', { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
  await p.waitForSelector('#photoSheet[open]');
  assert.equal(await p.locator('#phList li').count(), 4);
  assert.deepEqual(await p.$$eval('#phList li', ls => ls.map(l => l.querySelector('[type=checkbox]').checked)), [true, false, false, true]);
  assert.equal(posts[0].action, 'ocr'); assert.ok(posts[0].image.length > 10);
  await p.click('#phSave'); await p.waitForTimeout(800);
  const saved = posts.filter(o => o.action === 'save').map(o => o.item);
  assert.deepEqual(saved.map(i => [i.content, i.amount, i.type, i.major, i.minor, i.date]), [['스타벅스 강남점', 4500, '지출', '카페·간식', '카페', today], ['급여 입금', 2500000, '수입', '수입', '', today]]);
  assert.match(await p.textContent('#homeQuickSum'), /오늘/);
  console.log('PHOTO OK'); await b.close(); process.exit(0); });
