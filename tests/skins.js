// 사이드바(위 사용자명, 왼쪽 아래 설정) · 설정의 테마 5가지 · 앱 아이콘 3가지
const { chromium, devices } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert');
const S = process.argv[2] || require('os').tmpdir();
http.createServer((q, r) => { const f = path.join(__dirname, '..', q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : 'text/html' }); r.end(b); }); }).listen(8789, async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' }), p = await ctx.newPage();
  p.on('pageerror', e => { console.error('ERR', e.message); process.exit(1); });
  await ctx.addInitScript(() => localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 'owner-pw' })));
  await p.route('https://script.google.com/**', rt => rt.fulfill({ contentType: 'application/json', body: JSON.stringify(/what=me/.test(rt.request().url())
    ? { ok: true, role: 'owner', name: '서현', people: ['서현'], friends: [] } : { ok: true, items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } }) }));
  await p.goto('http://localhost:8789/'); await p.waitForTimeout(1000);
  // 사이드바: 위에 사용자명, 아래 설정
  await p.click('#menuBtn'); await p.waitForTimeout(500);
  assert.equal(await p.textContent('#menuName'), '서현'); assert.equal(await p.textContent('#menuAvatar'), '서');
  const [top, foot] = await p.$$eval('#menuUser, #menuSettings', els => els.map(e => e.getBoundingClientRect().top));
  assert.ok(foot > 500 && top < 120, `name at top, settings at bottom (${top}, ${foot})`);
  await p.click('#menuSettings'); await p.waitForSelector('#prefs[open]');
  assert.equal(await p.textContent('#prefName'), '서현'); assert.equal(await p.isVisible('#prefPw'), true); assert.equal(await p.locator('#prefs .switch:has(#lockOn)').count(), 1, 'Face ID toggle in settings');
  // 테마 5가지: 설정 → 「테마 · 앱 아이콘 변경」에 들어가서
  await p.click('#prefTheme'); await p.waitForSelector('#themeSheet[open]');
  assert.deepEqual(await p.$$eval('#skinList [data-skin]', bs => bs.map(x => x.textContent.trim())), ['1. 메인 테마', '2. 클레이모피즘', '3. iOS 27', '4. 쿠베르토', '5. 리니어']);
  const bg = () => p.evaluate(() => getComputedStyle(document.body).backgroundColor + '|' + getComputedStyle(document.querySelector('.card')).borderRadius);
  const seen = new Set();
  for (const k of ['main', 'clay', 'ios', 'cuberto', 'linear']) {
    await p.click(`#skinList [data-skin=${k}]`); await p.waitForTimeout(150);
    assert.equal(await p.evaluate(() => document.documentElement.dataset.skin), k);
    assert.equal(await p.getAttribute(`#skinList [data-skin=${k}]`, 'aria-checked'), 'true');
    seen.add(await bg());
  }
  assert.equal(seen.size, 5, 'every theme looks different: ' + [...seen].join(', '));
  await p.reload(); await p.waitForTimeout(600);
  assert.equal(await p.evaluate(() => document.documentElement.dataset.skin), 'linear', 'theme kept after reload');
  // 앱 아이콘
  await p.click('#openSettings'); await p.waitForSelector('#prefs[open]'); await p.click('#prefTheme'); await p.waitForSelector('#themeSheet[open]');
  assert.deepEqual(await p.$$eval('#iconList [data-icon]', bs => bs.map(x => x.dataset.icon)), ['main', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']);
  await p.click('#iconList [data-icon=c5]'); assert.equal(await p.getAttribute('link[rel=manifest]', 'href'), 'manifest-c5.webmanifest');
  await p.click('#iconList [data-icon=c1]');
  assert.equal(await p.getAttribute('link[rel=apple-touch-icon]', 'href'), 'icon-c1-180.png');
  assert.equal(await p.getAttribute('link[rel=manifest]', 'href'), 'manifest-c1.webmanifest');
  assert.ok(await p.evaluate(() => [...document.querySelectorAll('#iconList img')].every(i => i.naturalWidth > 0)), 'icon images load');
  await p.reload(); await p.waitForTimeout(500); assert.equal(await p.getAttribute('link[rel=apple-touch-icon]', 'href'), 'icon-c1-180.png');
  console.log('SKINS OK'); await b.close(); process.exit(0); });
