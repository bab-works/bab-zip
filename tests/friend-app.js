// 친구 접속코드 화면: 가계부 숨김 → 독서로, 남이 태그한 기록은 읽기 전용 배지, 습관은 ＋로 직접 / 주인 설정의 친구 초대
const { chromium, devices } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
http.createServer((q, r) => { const f = path.join(__dirname, '..', q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(b); }); }).listen(8788, async () => {
  const b = await chromium.launch();
  const page = async (token, role) => {
    const ctx = await b.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' }), p = await ctx.newPage(), posts = [], gets = [];
    p.on('pageerror', e => { console.error('ERR', e.message); process.exit(1); });
    await ctx.addInitScript(t => void localStorage.setItem('startSec', '"money"') || localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: t })), token);
    let friends = [{ name: '민지', code: 'f0123456789a', invite: 'i0123456789' }];
    await p.route('https://script.google.com/**', rt => {
      const q = rt.request(), u = q.url();
      if (q.method() === 'POST') {
        const o = JSON.parse(q.postData()); (x => x.action !== 'session' && posts.push(x))(o);
        if (o.action === 'invite') { friends.push({ name: o.name, code: 'fbbbbbbbbbbb', invite: 'iabcdef0123' }); return rt.fulfill({ contentType: 'application/json', body: '{"ok":true,"wrote":true,"code":"fbbbbbbbbbbb","invite":"iabcdef0123"}' }); }
        return rt.fulfill({ contentType: 'application/json', body: '{"ok":true,"wrote":true}' });
      }
      gets.push(u);
      const body = /what=me/.test(u) ? { ok: true, role, name: role === 'owner' ? '나리' : '민지', people: ['나리', '민지', '준호'], friends: role === 'owner' ? friends : undefined }
        : /what=lists/.test(u) ? { ok: true, people: ['나리', '민지', '준호'], lists: { book: [], buy: [], wish: [], escape: [{ id: 's:owner:e9', theme: '오시리스', shop: '서울이스케이프룸', with: '민지', shared: '나리' }] } }
        : /what=habits/.test(u) ? { ok: true, habits: [] }
        : /what=book/.test(u) ? {ok:true,books:[]} : role === 'friend' ? { ok: false, error: '친구 코드로는 가계부를 볼 수 없어요' } : { ok: true, items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } };
      rt.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await p.goto('http://localhost:8788/'); await p.waitForTimeout(1200);
    return { p, posts, gets };
  };

  // 친구
  const { p, posts, gets } = await page('f0123456789a', 'friend');
  assert.equal(await p.textContent('#appTitle'), '오늘', 'friend lands on the 오늘 dashboard, not 가계부');
  assert.match(await p.textContent('#dashHi'), /민지님/); assert.match(await p.textContent('#v-dash'), /위시리스트/);
  assert.ok(!gets.some(u => !/what=/.test(u) || /what=summary/.test(u)), 'never asks for money data');
  await p.click('#menuBtn'); await p.waitForTimeout(500);
  assert.equal(await p.locator('#menuList [data-sec=money]').count(), 0, 'no MONEY in menu');
  // 태그된 기록: 배지 + 읽기 전용
  await p.click('#menuList [data-sec=escape]'); await p.waitForTimeout(800); await p.click('#lViews [data-v=list]');
  assert.match(await p.textContent('#lList'), /오시리스.*나리 기록/);
  assert.equal(await p.locator('#lNav [data-list=escapeWant]').count(), 1, '방탈출 위시리스트 탭');
  await p.click('#lList li[data-id]'); await p.waitForTimeout(300);
  await p.waitForSelector('#ask[open]'); assert.match(await p.textContent('#askMsg'), /나리님이 남긴 기록[\s\S]*내 별점/, 'shared record → offer my own rating');
  await p.click('#askNo'); await p.waitForTimeout(300); assert.equal(await p.locator('#lItem[open]').count(), 0);
  // 직접 입력 → 「함께한 사람」 아래 앱 친구 칩 (나는 빼고)
  await p.click('#fab'); await p.click('#addMenu [data-add=manual]'); await p.waitForSelector('#lItem[open]');
  assert.deepEqual(await p.$$eval('.tag-chips [data-tag]', b => b.map(x => x.dataset.tag)), ['나리', '준호']);
  await p.fill('#lForm [name=with]', '엄마'); await p.click('.tag-chips [data-tag="준호"]');
  assert.equal(await p.inputValue('#lForm [name=with]'), '엄마, 준호');
  assert.equal(await p.getAttribute('.tag-chips [data-tag="준호"]', 'aria-pressed'), 'true');
  await p.click('#lCancel'); await p.waitForTimeout(300);
  // 습관: 틱틱 안내 대신 ＋로 만들기
  await p.click('#menuBtn'); await p.waitForTimeout(500); await p.click('#menuList [data-sec=habit]'); await p.waitForTimeout(600);
  assert.match(await p.textContent('#hList'), /나만의 습관/); assert.doesNotMatch(await p.textContent('#hList'), /틱틱/);
  await p.click('#fab'); await p.waitForSelector('#habitAdd[open]');
  await p.fill('#haName', '물 마시기'); await p.click('#haIcons [data-e="💧"]'); await p.click('#haForm button.primary'); await p.waitForTimeout(600);
  const add = posts.find(o => o.action === 'habitAdd'); assert.deepEqual([add.name, add.icon, add.color], ['물 마시기', '💧', '#3182f6']); assert.match(add.habitId, /^h[0-9a-f]{16}$/);
  assert.match(await p.textContent('#hList'), /물 마시기/);
  await p.click('#hList .hcheck'); await p.waitForTimeout(400);
  assert.equal(posts.at(-1).action, 'habitCheck'); assert.equal(posts.at(-1).habitId, add.habitId);
  await p.evaluate(() => { window.__askAuto = () => true; }); await p.click('#hList li div'); await p.waitForSelector('#hDetail[open]'); await p.click('#hdDelete'); await p.waitForTimeout(400);
  assert.equal(posts.at(-1).action, 'habitDelete');
  // 설정: 친구 코드로 연결됨, 초대 칸 없음
  await p.click('#openSettings'); await p.waitForTimeout(400);
  assert.equal(await p.isVisible('#friendBox'), false); assert.match(await p.textContent('#friendMe'), /친구로 로그인했어요/);

  // 주인: 설정에서 친구 초대 → 접속 링크 복사
  const o = await page('owner-pw', 'owner');
  assert.equal(await o.p.textContent('#appTitle'), '가계부');
  await o.p.click('#openSettings'); await o.p.waitForTimeout(600);
  assert.match(await o.p.textContent('#friendList'), /민지/); assert.equal(await o.p.inputValue('#myName'), '나리');
  await o.p.evaluate(() => { navigator.share = undefined; }); // 공유 시트가 없는 경우 → 링크 + 복사하기/취소 창
  await o.p.fill('#inviteName', '준호'); await o.p.click('#inviteBtn');
  await o.p.waitForSelector('#shareSheet[open]');
  assert.deepEqual(o.posts.find(x => x.action === 'invite').name, '준호');
  const link = await o.p.inputValue('#shareUrl'); assert.match(link, /#i=iabcdef0123(&s=|$)/); assert.doesNotMatch(link, /token|fbbbb/, 'no password/code in the link');
  await o.p.click('#shareCancel'); await o.p.waitForTimeout(300);
  assert.match(await o.p.textContent('#friendList'), /준호/);
  // Existing session, direct guest traffic. 책 검색은 친구 서버(카카오) 먼저, 안 되면 시트(알라딘)로.
  const worker='https://bab-zip-friends.test.workers.dev', direct=[];
  await p.route(worker+'/**', rt=>{
    const payload=rt.request().postDataJSON(); direct.push(payload);
    rt.fulfill({contentType:'application/json',body:JSON.stringify(payload.what==='book'?{ok:false,retry:true,error:'책 검색 연결 설정이 필요해요'}:{ok:true,wrote:true,role:'friend'})});
  });
  await p.evaluate(async url=>{
    cfg.url=SHEET_URL; me={role:'friend',token:cfg.token,workerUrl:url};
    await api(null,'&what=lists');
    await api({action:'habitCheck',habitId:'htest',stamp:'20260101',done:true});
    await api(null,'&what=book&q=test');
    if(directFriendUrl(null,'&what=summary')) throw Error('ledger routing');
  },worker);
  assert.deepEqual(direct.map(r=>r.what||r.action),['lists','habitCheck','book']);
  assert.ok(gets.some(url=>url.includes('what=book')), 'worker book search failed → falls back to the Sheet');
  console.log('FRIEND APP OK'); await b.close(); process.exit(0); });
