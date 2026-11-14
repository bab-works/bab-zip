// 독서 보기 3가지: 커버플로우(기본) · 카드 3열 · 목록, 가운데 책 평가 저장
const { chromium, devices } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..'), S = process.argv[2] || require('os').tmpdir(), COVERS = process.env.COVERS === '1'; // COVERS=1 이면 실제 표지 주소로 스크린샷
const IMG = ['https://image.aladin.co.kr/product/26249/89/cover500/k862738481_1.jpg', 'https://image.aladin.co.kr/product/36943/15/cover500/k382030510_1.jpg',
  'https://image.aladin.co.kr/product/36489/68/cover500/k852039119_1.jpg', 'https://image.aladin.co.kr/product/39802/11/cover500/s832131283_1.jpg',
  'https://image.aladin.co.kr/product/10222/18/cover500/k202536889_1.jpg', 'https://image.aladin.co.kr/product/37895/44/cover500/k532033629_1.jpg',
  'https://image.aladin.co.kr/product/34283/72/cover500/k752932072_1.jpg', 'https://image.aladin.co.kr/product/7492/9/cover500/8956609950_2.jpg'];
const books = ['종의 기원', '추리소설가의 살인사건', '더럽혀진 성지순례에 대하여', '새는 날아가면서 뒤돌아보지 않는다', '투명한 나선', '살인편지', '다정한 사람이 이긴다', '페스트']
  .map((title, k) => ({ id: 'b' + k, title, author: '저자' + k, year: '2026년', month: '11월', status: k === 7 ? '읽는중' : '완독', stars: k === 6 ? '🙂' : '', image: COVERS ? IMG[7 - k] : (k === 3 ? 'http://localhost:1/broken.jpg' : '') }));
const empty = JSON.stringify({ ok: true, items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } });
http.createServer((q, r) => { const f = path.join(ROOT, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.woff2') ? 'font/woff2' : f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(b); }); }).listen(8791, async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ ...devices['iPhone 15 Pro'] });
  await ctx.addInitScript(() => { localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 't' })); localStorage.setItem('sec', '"book"'); });
  const p = await ctx.newPage(); p.on('pageerror', e => { console.error('ERR', e.message); process.exit(1); });
  const posts = [];
  await p.route('https://script.google.com/**', rt => {
    const q = rt.request();
    if (q.method() === 'POST') { posts.push(JSON.parse(q.postData())); return rt.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
    rt.fulfill({ contentType: 'application/json', body: /what=lists/.test(q.url()) ? JSON.stringify({ ok: true, lists: { book: books, buy: [], wish: [] } }) : empty });
  });
  await p.goto('http://localhost:8791/'); await p.waitForSelector('#lFlow .fc'); await p.waitForTimeout(COVERS ? 2500 : 600);
  // 기본은 커버플로우, 가장 최근(시트 맨 아래) 책이 가운데
  assert.equal(await p.getAttribute('#lViews [data-v=flow]', 'aria-pressed'), 'true');
  assert.equal(await p.isVisible('#lListCard'), false);
  assert.equal(await p.textContent('#fTitle'), '페스트');
  assert.equal(await p.isVisible('#fab'), false, 'floating + hidden so it does not cover the rating');
  await p.click('#fAdd'); await p.waitForSelector('#lItem[open]'); assert.equal(await p.inputValue('#lForm [name=title]'), ''); await p.click('#lCancel'); await p.waitForTimeout(300);
  await p.screenshot({ path: S + '/flow.png' });
  // 옆 책을 누르면 가운데로 넘어오고 정보가 바뀜
  await p.click('#lFlow .fc:nth-child(2)', { force: true }); await p.waitForTimeout(700);
  assert.equal(await p.textContent('#fTitle'), '다정한 사람이 이긴다');
  assert.equal(await p.getAttribute('#fRate [data-r="🙂"]', 'aria-pressed'), 'true');
  // 손가락으로 밀기 (스크롤) → 두 칸 넘어감
  await p.evaluate(() => { document.querySelector('#lFlow').scrollLeft += 160; }); await p.waitForTimeout(300);
  assert.equal(await p.textContent('#fTitle'), '투명한 나선');
  await p.screenshot({ path: S + '/flow-mid.png' });
  // 이모지로 평가 → 그 책만 시트에 저장, 보던 책 그대로
  await p.click('#fRate [data-r="😍"]'); await p.waitForTimeout(400);
  assert.deepEqual(posts.at(-1), { action: 'listSave', list: 'book', item: { id: 'b4', title: '투명한 나선', stars: '😍' }, token: 't' });
  assert.equal(await p.textContent('#fTitle'), '투명한 나선');
  assert.equal(await p.getAttribute('#fRate [data-r="😍"]', 'aria-pressed'), 'true');
  await p.click('#fRate [data-r="😍"]'); await p.waitForTimeout(300); assert.equal(posts.at(-1).item.stars, '', 'tap again clears');
  // 가운데 책을 누르면 편집 창
  await p.click('#lFlow .fc:nth-child(4)', { force: true }); await p.waitForSelector('#lItem[open]');
  assert.equal(await p.inputValue('#lForm [name=title]'), '투명한 나선'); await p.click('#lCancel'); await p.waitForTimeout(300);
  // 카드 3열
  await p.click('#lViews [data-v=grid]');
  assert.equal(await p.isVisible('#lFlowCard'), false); assert.equal(await p.isVisible('#fab'), true);
  const xs = await p.$$eval('#lList.grid li', ls => ls.slice(0, 4).map(l => Math.round(l.getBoundingClientRect().top)));
  assert.ok(xs[0] === xs[1] && xs[1] === xs[2] && xs[3] > xs[0], '3 per row ' + xs);
  if (!COVERS) assert.ok(await p.locator('#lList .cover.ph').count() >= 1, 'missing/broken cover shows title card');
  await p.waitForTimeout(COVERS ? 1500 : 200); await p.screenshot({ path: S + '/grid.png' });
  // 목록
  await p.click('#lViews [data-v=list]');
  assert.equal(await p.locator('#lList.grid').count(), 0); assert.equal(await p.locator('#lList li[data-id]').count(), 8);
  // 고른 보기는 기억, 다른 취미 목록은 늘 목록 보기
  await p.reload(); await p.waitForSelector('#lList li[data-id]'); assert.equal(await p.getAttribute('#lViews [data-v=list]', 'aria-pressed'), 'true');
  await p.click('#lViews [data-v=flow]');
  await p.click('#menuBtn'); await p.click('#menuList [data-sec=escape]'); await p.waitForTimeout(300);
  assert.equal(await p.isVisible('#lViews'), true, 'escape also has 3 views');
  await p.click('#menuBtn'); await p.click('#menuList [data-sec=movie]'); await p.waitForTimeout(300);
  assert.equal(await p.isVisible('#lViews'), false); assert.equal(await p.isVisible('#lHead'), false, 'no empty top box'); assert.equal(await p.isVisible('#lListCard'), true);
  console.log('BOOK VIEWS OK'); await b.close(); process.exit(0); });
