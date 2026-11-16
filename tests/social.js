// 친구 탭: 신청 → 친구네 동네 → 집에 놀러 가서 공개 작품 보기·위시리스트 담기 / 기록의 「친구 집에 공개」 / 친구 기록에 내 별점 따로 남기기
const { chromium, devices } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
http.createServer((q, r) => { const f = path.join(__dirname, '..', q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : 'text/html' }); r.end(b); }); }).listen(8796, async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ ...devices['iPhone 13'] }), p = await ctx.newPage(), posts = [];
  p.on('pageerror', e => { console.error('ERR', e.message); process.exit(1); });
  await ctx.addInitScript(() => { window.__askAuto = () => true; if (!localStorage.getItem('cfg')) void localStorage.setItem('startSec', '"friends"') || localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 'f0123456789a' })); });
  let social = { friends: [{ name: '서현', icon: 'c3', intro: '책 좋아해요' }], incoming: ['준호'], outgoing: [], house: {} };
  await p.route('https://script.google.com/**', rt => {
    const q = rt.request(), u = q.url(); let body;
    if (q.method() === 'POST') {
      const o = JSON.parse(q.postData()); posts.push(o);
      if (o.action === 'friendAccept') social = { ...social, incoming: [], friends: [...social.friends, { name: o.name, icon: '', intro: '' }] };
      if (o.action === 'friendRequest') social = { ...social, outgoing: [o.name] };
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
  // 2) 서현네 집: 문이 열리고 방마다 작품 → 눌러서 위시리스트
  await p.click('[data-house="서현"]'); await p.waitForSelector('#house.open'); await p.waitForSelector('#houseRooms .work');
  assert.equal(await p.textContent('#houseTitle'), '서현네 집'); assert.match(await p.textContent('#houseRooms'), /책장[\s\S]*페스트[\s\S]*영화관[\s\S]*파묘/);
  assert.doesNotMatch(await p.textContent('#houseRooms'), /방탈출/, 'empty rooms hidden');
  await p.click('#houseRooms .work[data-k=book]'); await p.waitForTimeout(400);
  assert.deepEqual([posts.at(-1).list, posts.at(-1).item.title, posts.at(-1).item.memo], ['buy', '페스트', '서현님 집에서']);
  await p.waitForTimeout(1300); await p.screenshot({ path: require('os').tmpdir() + '/house.png' });
  await p.click('#houseClose');
  // 3) 방탈출: 친구 평가가 내 줄에 함께 / 친구 기록 → 내 평가 남기기 → 한 줄로 합쳐짐 + 공개 켜기
  await p.evaluate(() => setSection('escape')); await p.waitForTimeout(500);
  if (await p.locator('#lViews [data-v=list]').count()) await p.click('#lViews [data-v=list]');
  assert.match(await p.textContent('#v-lists'), /👥 서현 😫/);
  await p.click('#lList li:has-text("오시리스")'); await p.waitForSelector('#lItem[open]');
  assert.equal(await p.inputValue('#lForm [name=theme]'), '오시리스'); assert.equal(await p.inputValue('#lForm [name=with]'), '서현');
  await p.click('#lForm [name=__pub]'); await p.click('#lForm button.primary'); await p.waitForTimeout(500);
  const save = posts.find(o => o.action === 'listSave' && o.list === 'escape'), pub = posts.find(o => o.action === 'setPub');
  assert.ok(save && !save.item.id.startsWith('s:') && save.item.others === undefined, 'saved as my own record');
  assert.deepEqual([pub.list, pub.id, pub.on], ['escape', save.item.id, true]);
  const rows = await p.locator('#lList li:has-text("오시리스")').count(); assert.equal(rows, 1, 'merged into one row');
  assert.match(await p.textContent('#lList li:has-text("오시리스")'), /🏡[\s\S]*👥 서현 😍/);
  console.log('SOCIAL OK'); await b.close(); process.exit(0); });
