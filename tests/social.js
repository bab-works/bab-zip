// 친구 탭: 신청 → 친구네 동네 → 집에 놀러 가서 공개 작품 보기·위시리스트 담기 / 기록의 「친구 집에 공개」 / 친구 기록에 내 별점 따로 남기기
const { chromium, devices } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
http.createServer((q, r) => { const f = path.join(__dirname, '..', q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : 'text/html' }); r.end(b); }); }).listen(8796, async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ ...devices['iPhone 13'] }), p = await ctx.newPage(), posts = [];
  p.on('pageerror', e => { console.error('ERR', e.message); process.exit(1); });
  await ctx.addInitScript(() => { localStorage.setItem('pubDefault','true'); window.__askAuto = () => true; if (!localStorage.getItem('cfg')) void localStorage.setItem('startSec', '"friends"') || localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 'f0123456789a' })); });
  let social = { friends: [{ name: '서현', icon: 'c3', intro: '책 좋아해요' }], incoming: ['준호'], outgoing: [], house: {}, ownerName: '서현' };
  await p.route('https://script.google.com/**', rt => {
    const q = rt.request(), u = q.url(); let body;
    if (q.method() === 'POST') {
      const o = JSON.parse(q.postData()); posts.push(o);
      if (o.action === 'friendAccept') social = { ...social, incoming: [], friends: [...social.friends, { name: o.name, icon: '', intro: '' }] };
      if (o.action === 'friendRequest') social = { ...social, outgoing: [o.name] };
      if (o.action === 'friendRemove') social = { ...social, friends: social.friends.filter(f => f.name !== o.name), outgoing: social.outgoing.filter(n => n !== o.name) };
      body = { ok: true, wrote: true, social };
    } else body = /what=me/.test(u) ? { ok: true, role: 'friend', name: '민지', people: ['민지', '서현'], social }
      : /what=house/.test(u) ? { ok: true, house: { name: '서현', icon: 'c3', intro: '책 좋아해요', items: { book: [{ id: 'b1', title: '페스트', author: '카뮈', stars: '😍', review: '명작' }], escape: [], board: [], movie: [{ id: 'm1', title: '파묘', rating: '🙂' }], play: [] } } }
      : /what=lists/.test(u) ? { ok: true, lists: { escape: [{ id: 's:owner:e9', theme: '오시리스', shop: '키이스케이프', rating: '😍', with: '민지', shared: '서현' }, { id: 'e1', theme: '사라진 목격자', rating: '🙂', others: [{ name: '서현', rating: '😫', review: '' }] }] } }
      : /what=habits/.test(u) ? { ok: true, habits: [] } : { ok: true, items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } };
    rt.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await p.goto('http://localhost:8796/'); await p.waitForTimeout(900);
  // 1) 친구 탭: 내 집, 받은 신청, 동네
  assert.equal(await p.textContent('#appTitle'), '친구');
  assert.match(await p.textContent('#myHouse'), /민지네 집/); assert.match(await p.textContent('#frIn'), /준호/);
  assert.match(await p.textContent('#town'), /서현네 집[\s\S]*책 좋아해요/);
  await p.click('#frIn [data-fr=friendAccept]'); await p.waitForTimeout(400);
  assert.deepEqual(posts.at(-1), { action: 'friendAccept', name: '준호', token: 'f0123456789a' }); assert.match(await p.textContent('#town'), /준호네 집/);
  await p.fill('#frName', '지현'); await p.click('#frAdd button'); await p.waitForTimeout(400);
  assert.equal(posts.at(-1).action, 'friendRequest'); assert.match(await p.textContent('#frOut'), /지현[\s\S]*기다리는 중/);
  await p.screenshot({ path: require('os').tmpdir() + '/town.png' });
  // 내 친구 목록: 초대해 준 친구는 못 끊고, 나머지는 친구 끊기
  assert.match(await p.textContent('#frMine'), /내 친구 2명[\s\S]*서현[\s\S]*초대해 준 친구[\s\S]*준호/);
  await p.click('#frMine [data-unfriend][data-n="준호"]'); await p.waitForTimeout(400);
  assert.deepEqual(posts.at(-1), { action: 'friendRemove', name: '준호', token: 'f0123456789a' }); assert.doesNotMatch(await p.textContent('#town'), /준호/);
  // 2) 서현네 집: 문이 열리고 방마다 작품 → 눌러서 위시리스트
  await p.click('[data-house="서현"]'); await p.waitForSelector('#house.open'); await p.waitForSelector('#houseRooms .work');
  assert.equal(await p.textContent('#houseTitle'), '서현네 집'); assert.match(await p.textContent('#houseRooms'), /책장[\s\S]*페스트[\s\S]*영화[\s\S]*파묘/);
  assert.doesNotMatch(await p.textContent('#houseRooms'), /방탈출/, 'empty rooms hidden');
  await p.click('#houseRooms .work[data-k=book]'); await p.waitForTimeout(400);
  const wl = posts.find(o => o.action === 'listSave' && o.list === 'buy'); assert.deepEqual([wl.item.title, wl.item.memo, wl.item.pub], ['페스트', '서현님 집에서', undefined]);
  assert.deepEqual(posts.at(-1), { action: 'setPub', list: 'buy', id: wl.item.id, on: true, token: 'f0123456789a' }, 'new wishlist item follows default-public');
  await p.waitForTimeout(1300); await p.screenshot({ path: require('os').tmpdir() + '/house.png' });
  for (const k of ['clay', 'ios', 'linear']) { await p.evaluate(k => document.documentElement.dataset.skin = k, k); await p.waitForTimeout(200); await p.screenshot({ path: require('os').tmpdir() + `/house-${k}.png` }); }
  await p.evaluate(() => setSkin(skin()));
  await p.click('#houseClose');
  // 3) 방탈출: 친구 평가가 내 줄에 함께 / 친구 기록 → 내 평가 남기기 → 한 줄로 합쳐짐 + 공개 켜기
  await p.evaluate(() => setSection('escape')); await p.waitForTimeout(500);
  if (await p.locator('#lViews [data-v=list]').count()) await p.click('#lViews [data-v=list]');
  assert.match(await p.textContent('#v-lists'), /서현 😫/);
  await p.click('#lList li:has-text("오시리스")'); await p.waitForSelector('#lItem[open]');
  assert.equal(await p.inputValue('#lForm [name=theme]'), '오시리스'); assert.equal(await p.inputValue('#lForm [name=with]'), '서현');
  assert.equal(await p.isChecked('#lForm [name=__pub]'), true, 'new records start public'); await p.click('#lForm button.primary'); await p.waitForTimeout(500);
  const save = posts.find(o => o.action === 'listSave' && o.list === 'escape'), pub = posts.find(o => o.action === 'setPub' && o.list === 'escape');
  assert.ok(save && !save.item.id.startsWith('s:') && save.item.others === undefined, 'saved as my own record');
  assert.deepEqual([pub.list, pub.id, pub.on], ['escape', save.item.id, true]);
  const rows = await p.locator('#lList li:has-text("오시리스")').count(); assert.equal(rows, 1, 'merged into one row');
  assert.equal(await p.locator('#lList li:has-text("오시리스") .pub-mark svg').count(), 1, 'public mark is an icon'); assert.match(await p.textContent('#lList li:has-text("오시리스")'), /서현 😍/);
  // 화면을 열 때 붙는 enter 애니메이션이 친구 집 입장 화면(고정 위치)과 섞이면 안 됨 (커졌다 줄어드는 버그)
  assert.notEqual(await p.$eval('#v-lists', e => getComputedStyle(e).position), 'fixed');
  // 4) 선택해서 한 번에: 전체 선택 → 공개 / 상태 변경 / 삭제
  await p.click('#lSelect'); assert.equal(await p.isVisible('#selBar'), true);
  await p.click('#selAll'); assert.match(await p.textContent('#selCount'), /^2개 선택/, 'shared items not selectable');
  await p.click('[data-act=unpub]'); await p.waitForTimeout(400);
  const up = posts.filter(o => o.action === 'setPub').at(-1); assert.deepEqual([up.on, up.ids.length], [false, 2]);
  assert.equal(await p.isVisible('#selBar'), false, 'leaves select mode after action');
  await p.click('#lSelect'); await p.click('#lList li:has-text("사라진 목격자")'); await p.click('[data-act=state]');
  await p.waitForSelector('#pickSheet[open]'); await p.click('#pickList button:has-text("성공")'); await p.waitForTimeout(400);
  const bk = posts.filter(o => o.action === 'bulk').at(-1); assert.deepEqual(bk.ops.map(o => [o.action, o.item.theme, o.item.result]), [['listSave', '사라진 목격자', '성공']]);
  await p.click('#lSelect'); await p.click('#lList li:has-text("사라진 목격자")'); await p.click('[data-act=del]'); await p.waitForTimeout(400);
  assert.deepEqual(posts.filter(o => o.action === 'bulk').at(-1).ops.map(o => o.action), ['listDelete']); assert.equal(await p.locator('#lList li:has-text("사라진 목격자")').count(), 0);
  // 5) 새 기록은 기본 공개 (설정에서 끌 수 있음), 공개 스위치는 입력 창 맨 위
  await p.evaluate(() => openItem()); await p.waitForSelector('#lItem[open]');
  assert.equal(await p.evaluate(() => $('#lTitle').nextElementSibling.classList.contains('pub-pill')), true); assert.equal(await p.isChecked('#lForm [name=__pub]'), true);
  await p.click('#lCancel'); await p.waitForSelector('#lItem', { state: 'hidden' }); await p.evaluate(() => store.set('pubDefault', false)); await p.evaluate(() => openItem()); await p.waitForSelector('#lItem[open]'); assert.equal(await p.isChecked('#lForm [name=__pub]'), false); await p.click('#lCancel'); await p.waitForSelector('#lItem', { state: 'hidden' });
  // 선택 막대는 화면 위에 고정
  await p.click('#lSelect'); assert.ok((await p.locator('#selBar').boundingBox()).y < 100, 'select bar pinned at top'); await p.screenshot({ path: require('os').tmpdir() + '/seltop.png' }); await p.click('#selDone');
  // 위시리스트도 친구 공개 (입력 창 맨 위 「친구 공개」 아이콘 스위치)
  await p.click('#lNav [data-list=escapeWant]'); await p.waitForTimeout(200); await p.evaluate(() => openItem()); await p.waitForSelector('#lItem[open]');
  await p.screenshot({ path: require('os').tmpdir() + '/pill.png' });  assert.match(await p.textContent('#lForm .pub-pill'), /^친구 공개/); assert.equal(await p.locator('#lForm .pub-pill svg').count(), 1);
  await p.click('#lCancel'); await p.waitForSelector('#lItem', { state: 'hidden' });
  // 6) 책: 선택해서 위시리스트로 옮기기
  await p.evaluate(() => { lists.book = [{ id: 'k1', title: '데미안', author: '헤세', status: '읽는중' }, { id: 'k2', title: '변신', status: '읽는중' }]; setSection('book'); });
  await p.waitForTimeout(400); await p.click('#lSelect'); await p.click('#selAll'); await p.click('[data-act=move]');
  await p.screenshot({ path: require('os').tmpdir() + '/sel.png' }); await p.waitForSelector('#pickSheet[open]'); await p.click('#pickList button:has-text("위시리스트")'); await p.waitForTimeout(600);
  const mv = posts.filter(o => o.action === 'bulk').slice(-2); assert.deepEqual([mv[0].ops.map(o => o.list + ':' + o.item.title), mv[1].ops.map(o => o.action + ':' + o.id)], [['buy:데미안', 'buy:변신'], ['listDelete:k1', 'listDelete:k2']]);
  console.log('SOCIAL OK'); await b.close(); process.exit(0); });
