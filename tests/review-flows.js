// 모달 전환, 공개 기본값, 계정 교체와 오프라인 재전송을 가짜 시트로 확인.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

async function run() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      const file = path.join(__dirname, '..', url.pathname === '/' ? 'index.html' : url.pathname);
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const posts = [];
    await page.route('https://script.google.com/**', route => {
      if (route.request().method() === 'POST') posts.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, wrote: true, role: 'friend', name: '테스트', people: [], lists: {}, habits: [] } });
    });
    const base = 'http://127.0.0.1:' + server.address().port;
    await page.goto(base + '/#token=f00000000001');
    await page.waitForFunction(() => me.role === 'friend');
    await page.evaluate(() => { window.answers = Promise.all([ask('하나'), ask('둘')]); });
    for (const theme of ['main', 'clay', 'ios', 'cuberto', 'linear']) {
      await page.evaluate(k => setSkin(k), theme);
      assert.equal(await page.locator('#ask').evaluate(d => getComputedStyle(d).borderBottomLeftRadius), '24px');
    }
    await page.click('#askOk');
    await page.waitForFunction(() => document.querySelector('#askMsg').textContent === '둘');
    await page.click('#askNo');
    assert.deepEqual(await page.evaluate(() => window.answers), [true, false]);
    await page.evaluate(() => { setSection('book'); openItem(); toast('저장 안내'); });
    assert.equal(await page.locator('#lItem #toast').isVisible(), true);
    assert.equal(await page.isChecked('[name=__pub]'), false);
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      for (const skin of ['main', 'clay', 'ios', 'cuberto', 'linear']) {
        await page.evaluate(k => setSkin(k), skin);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
    }
    await page.click('#lCancel');
    await page.waitForSelector('#lItem', {state:'hidden'});
    await page.evaluate(() => {
      pending.push({ action:'listSave', list:'book', item:{ id:'demo', title:'테스트 기록' } });
      persist();
      store.set('splitAcct', '이전 기기 설정');
    });
    await page.goto(base + '/?switch=1#token=f00000000002');
    assert.equal(await page.isVisible('#connectionWarning'), true);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => !pending.length);
    assert.ok(posts.some(o => o.item?.id === 'demo' && o.token === 'f00000000001'));
    await page.goto(base + '/?switch=2#token=f00000000002');
    assert.equal(await page.evaluate(() => cfg.token), 'f00000000002');
    assert.equal(await page.evaluate(() => store.get('splitAcct', '')), '');
    await page.evaluate(() => {
      Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
      store.set('pending', []);
    });
    assert.equal(await page.isVisible('#storageError'), true);
    console.log('REVIEW FLOWS OK');
  } finally { await browser.close(); server.close(); }
}
run().catch(err => { console.error(err); process.exitCode = 1; });
