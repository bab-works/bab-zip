const { chromium } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path');
http.createServer((q, r) => { const f = path.join(require('path').join(__dirname, '..'), q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(b); }); }).listen(8782, async () => {
  const b = await chromium.launch(), p = await b.newPage(); let hit = '';
  await p.route('https://script.google.com/**', rt => { hit = rt.request().url(); rt.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } }) }); });
  await p.goto('http://localhost:8782/#token=abc'); await p.waitForTimeout(1500);
  const cfg = await p.evaluate(() => JSON.parse(localStorage.getItem('cfg')));
  console.log(cfg.token === 'abc' && /AKfycbzZWDg.*exec\?token=abc/.test(hit) && !(await p.locator('#settings[open]').count()) ? 'SHORT LINK OK' : 'FAIL ' + hit);
  await b.close(); process.exit(0); });
