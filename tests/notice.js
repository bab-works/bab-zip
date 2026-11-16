// 공지사항 탭: 공지 · 홈 화면 추가 그림 · Q&A · 개선 중 / 제보하기 → 시트 / 새 버전이면 「업데이트됐어요」 창 + 메뉴 빨간 점
const { chromium, devices } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
http.createServer((q, r) => { const f = path.join(__dirname, '..', q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.jpg') ? 'image/jpeg' : f.endsWith('.png') ? 'image/png' : 'text/html' }); r.end(b); }); }).listen(8798, async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ ...devices['iPhone 13'] }), p = await ctx.newPage(), posts = [];
  p.on('pageerror', e => { console.error('ERR', e.message); process.exit(1); });
  // 예전 버전(v86)을 쓰던 사람이 새 버전을 처음 연 상황
  await ctx.addInitScript(() => { if (!localStorage.getItem('cfg')) { localStorage.setItem('testUpd', 'true'); localStorage.setItem('seenVer', '"gagyebu-v86"'); localStorage.setItem('startSec', '"home"'); localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 'f0123456789a' })); } });
  await p.route('https://script.google.com/**', rt => { const q = rt.request(); if (q.method() === 'POST') posts.push(JSON.parse(q.postData()));
    rt.fulfill({ contentType: 'application/json', body: JSON.stringify(q.method() === 'POST' ? { ok: true, wrote: true } : /what=me/.test(q.url()) ? { ok: true, role: 'friend', name: '민지', people: [] } : { ok: true, lists: {}, habits: [] }) }); });
  await p.goto('http://localhost:8798/'); await p.waitForSelector('#updSheet[open]', { timeout: 5000 });
  assert.match(await p.textContent('#updVer'), /v86 → v\d+/); assert.match(await p.textContent('#updList'), /공지사항 · Q&A · 제보하기[\s\S]*여러 개를 한 번에/);
  assert.doesNotMatch(await p.textContent('#updList'), /영화도 검색/, 'only notices newer than what I saw');
  await p.click('#updMore'); await p.waitForTimeout(500);
  assert.equal(await p.textContent('#appTitle'), '공지사항'); assert.match(await p.textContent('#nBody'), /열심히 업데이트 중[\s\S]*공지사항 · Q&A/, 'pinned request first');
  // 한 번 본 뒤엔 다시 안 뜸
  await p.reload(); await p.waitForTimeout(1500); assert.equal(await p.locator('#updSheet[open]').count(), 0);
  // 메뉴 빨간 점: 본 뒤엔 없음
  await p.click('#menuBtn'); await p.waitForTimeout(400); assert.equal(await p.locator('#menuList [data-sec=notice].dot').count(), 0);
  await p.click('#menuList [data-sec=notice]'); await p.waitForTimeout(500);
  // 홈 화면 추가: 아이폰이면 아이폰 그림 먼저, 그림이 실제로 불러와짐
  await p.click('[data-nt=guide]'); await p.waitForTimeout(800);
  assert.match(await p.textContent('#nBody'), /^아이폰/); assert.equal(await p.locator('#nBody img').count(), 6);
  assert.ok(await p.$eval('#nBody img', i => i.complete && i.naturalWidth > 300), 'guide image loads');
  await p.screenshot({ path: require('os').tmpdir() + '/guide.png' });
  await p.click('[data-nt=faq]'); await p.click('details.faq summary >> nth=1'); assert.match(await p.textContent('details.faq[open]'), /1234/);
  await p.click('[data-nt=road]'); assert.match(await p.textContent('#nBody'), /지금 고치고 있어요[\s\S]*연극·뮤지컬/);
  await p.fill('#reportText', '방탈출 검색이 느려요'); await p.click('#reportForm button'); await p.waitForTimeout(500);
  assert.deepEqual([posts.at(-1).action, posts.at(-1).text], ['report', '방탈출 검색이 느려요']); assert.equal(await p.inputValue('#reportText'), '');
  console.log('NOTICE OK'); await b.close(); process.exit(0); });
