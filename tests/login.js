// 로그인 화면: 틀리면 안 넘어감 → 맞으면 「○○님 반가워요」 → 앱 / 초대 링크(#i=)는 바로 로그인 / 로그아웃하면 다시 로그인 화면
const { chromium, devices } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
http.createServer((q, r) => { const f = path.join(__dirname, '..', q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : 'text/html' }); r.end(b); }); }).listen(8790, async () => {
  const b = await chromium.launch();
  const page = async (hash = '') => {
    const ctx = await b.newContext({ ...devices['iPhone 13'] }), p = await ctx.newPage(), posts = [];
    p.on('pageerror', e => { console.error('ERR', e.message); process.exit(1); });
    await p.route('https://script.google.com/**', rt => {
      const q = rt.request(), u = q.url(); let body;
      if (q.method() === 'POST') {
        const o = JSON.parse(q.postData()); posts.push(o);
        body = o.action === 'login' ? (o.name === '서현' && o.password === 'pw1' ? { ok: true, token: 'pw1', role: 'owner', name: '서현' } : { ok: false, error: '아이디 또는 비밀번호가 맞지 않아요' })
          : o.action === 'redeem' ? (o.invite === 'i0123456789' ? { ok: true, token: 'f0123456789a', role: 'friend', name: '민지', hasPassword: false } : { ok: false, error: '초대 링크가 맞지 않거나 취소됐어요' })
          : { ok: true, wrote: true };
      } else body = /what=me/.test(u) ? { ok: true, role: /f0123/.test(u) ? 'friend' : 'owner', name: /f0123/.test(u) ? '민지' : '서현', people: ['서현', '민지'] }
        : /what=lists/.test(u) ? { ok: true, lists: { book: [{ id: 'b1', title: '페스트', author: '카뮈', status: '읽는중' }], escape: [{ id: 'e1', theme: '오시리스', date: '2026-11-10', rating: '😍' }] } }
        : /what=habits/.test(u) ? { ok: true, habits: [{ id: 'h1234abcd', name: '물 마시기', icon: '💧', color: '#3182f6', rule: 'RRULE:FREQ=DAILY', enc: '', total: 0, done: [], local: true }] }
        : { ok: true, items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } };
      rt.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await p.goto('http://localhost:8790/' + hash); await p.waitForTimeout(600);
    return { p, posts };
  };
  // 1) 처음: 로그인 화면, Esc로도 안 닫힘, 틀리면 그대로
  const { p, posts } = await page();
  assert.equal(await p.locator('#login[open]').count(), 1);
  await p.keyboard.press('Escape'); assert.equal(await p.locator('#login[open]').count(), 1, 'cannot dismiss login');
  await p.fill('#loginForm [name=name]', '서현'); await p.fill('#loginForm [name=password]', 'nope'); await p.click('#loginBtn'); await p.waitForTimeout(400);
  assert.equal(await p.locator('#login[open]').count(), 1, 'wrong password stays'); assert.match(await p.textContent('#loginErr'), /맞지 않아요/);
  // 2) 맞으면 「서현님 반가워요」 펜 글씨 → 종이 넘김 → 가계부
  await p.fill('#loginForm [name=password]', 'pw1'); await p.click('#loginBtn');
  await p.waitForSelector('#hello:not([hidden])'); assert.equal(await p.textContent('#helloText'), '서현님 반가워요');
  assert.equal(await p.locator('#helloSvg text.write').count(), 1);
  await p.waitForSelector('#hello.turn'); await p.waitForSelector('#hello', { state: 'hidden', timeout: 5000 });
  assert.equal(await p.locator('#login[open]').count(), 0); assert.equal(await p.textContent('#appTitle'), '가계부');
  assert.deepEqual(JSON.parse(await p.evaluate(() => localStorage.getItem('cfg'))).token, 'pw1');
  assert.deepEqual(posts[0], { action: 'login', name: '서현', password: 'nope' }, 'login sends no token');
  // 3) 로그아웃 (사이드바 위) → 로그인 화면, 저장된 사본 지움
  await p.evaluate(() => { window.__askAuto = () => true; }); await p.click('#menuBtn'); await p.waitForTimeout(500); await p.click('#menuLogout');
  await p.waitForTimeout(800); assert.equal(await p.locator('#login[open]').count(), 1, 'back to login');
  assert.equal(JSON.parse(await p.evaluate(() => localStorage.getItem('cfg'))).token, '');

  // 4) 초대 링크: 비밀번호 없이 바로 로그인 → 반가워요 → 친구는 「오늘」 대시보드, 주소창의 초대ID는 지움
  const f = await page('#i=i0123456789');
  await f.p.waitForSelector('#hello:not([hidden])'); assert.equal(await f.p.textContent('#helloText'), '민지님 반가워요');
  await f.p.waitForSelector('#hello', { state: 'hidden', timeout: 5000 }); await f.p.waitForTimeout(800);
  // 브라우저(홈 화면 앱 아님)로 열면: 홈 화면에 추가 + 아이디/비밀번호 1234 안내
  await f.p.waitForSelector('#ask[open]'); assert.match(await f.p.textContent('#askMsg'), /아이디: 민지[\s\S]*1234/); await f.p.click('#askOk'); await f.p.waitForTimeout(300);
  assert.equal(await f.p.textContent('#appTitle'), '오늘'); assert.equal(await f.p.evaluate(() => location.hash), '', 'invite id removed from address bar');
  assert.match(await f.p.textContent('#dashHi'), /민지님/); assert.match(await f.p.textContent('#dashBook'), /페스트/);
  assert.match(await f.p.textContent('#dashRecent'), /오시리스/); assert.match(await f.p.textContent('#dashHabit'), /물 마시기/);
  await f.p.click('#dashHabit [data-hab]'); await f.p.waitForTimeout(400);
  assert.equal(f.posts.at(-1).action, 'habitCheck', 'check habit right from the dashboard');
  // 5) 비밀번호 바꾸기: 가벼운 비밀번호 안내, 두 번 같아야
  await f.p.click('#openSettings'); await f.p.click('#prefPw'); await f.p.waitForSelector('#pwSheet[open]');
  assert.match(await f.p.textContent('.pw-warn'), /가벼운 비밀번호/);
  await f.p.fill('[name=pw1]', 'cat1'); await f.p.fill('[name=pw2]', 'cat2'); await f.p.click('#pwForm button.primary');
  assert.match(await f.p.textContent('#pwErr'), /달라요/);
  await f.p.fill('[name=pw2]', 'cat1'); await f.p.click('#pwForm button.primary'); await f.p.waitForTimeout(500);
  assert.deepEqual(f.posts.at(-1), { action: 'setPassword', password: 'cat1', token: 'f0123456789a' });
  // 6) 잘못된 초대 링크 → 로그인 화면에 이유
  const bad = await page('#i=i9999999999'); await bad.p.waitForTimeout(600);
  assert.equal(await bad.p.locator('#login[open]').count(), 1); assert.match(await bad.p.textContent('#loginErr'), /초대 링크가 맞지 않거나/);
  console.log('LOGIN OK'); await b.close(); process.exit(0); });
