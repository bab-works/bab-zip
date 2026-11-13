const { chromium, devices } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = require('path').join(__dirname, '..'), S = process.argv[2] || require('os').tmpdir(), body = JSON.stringify({ ok: true, items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } }); // 시트 응답은 빈 가짜 데이터, S = 스크린샷 폴더
http.createServer((q, r) => { const f = path.join(ROOT, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]);
  fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.woff2') ? 'font/woff2' : f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(b); }); }).listen(8781, async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 15 Pro'] });
  await ctx.addInitScript(() => localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/x', token: 't' })));
  const p = await ctx.newPage(); p.on('pageerror', e => console.error('ERR', e.message));
  await p.route('https://script.google.com/**', rt => rt.fulfill({ contentType: 'application/json', body }));
  await p.goto('http://localhost:8781/'); await p.waitForFunction(() => /동기화됨/.test(document.querySelector('#syncPop').textContent + document.querySelector('#status').textContent));
  const swipe = (sel, x0, dx, steps = 10, gap = 25) => p.evaluate(async ([sel, x0, dx, steps, gap]) => {
    const r = document.querySelector(sel), y = r.getBoundingClientRect().top + 10;
    const t = xx => new Touch({ identifier: 1, target: r, clientX: xx, clientY: y });
    r.dispatchEvent(new TouchEvent('touchstart', { touches: [t(x0)], bubbles: true, cancelable: true }));
    let mid = null;
    for (let i = 1; i <= steps; i++) { r.dispatchEvent(new TouchEvent('touchmove', { touches: [t(x0 + dx * i / steps)], bubbles: true, cancelable: true }));
      if (i === steps / 2) { const m = document.querySelector('#menu'); mid = [m.style.transform, m.style.boxShadow]; } await new Promise(z => setTimeout(z, gap)); }
    r.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(x0 + dx)], bubbles: true, cancelable: true }));
    await new Promise(z => setTimeout(z, 450));
    return { open: document.querySelector('#menu').open, mid };
  }, [sel, x0, dx, steps, gap]);
  const assert = require('assert');
  let r = await swipe('#budgets', 60, 240); console.log('home drag right', r); assert(r.open && /translateX\(-/.test(r.mid[0]) && /0\.\d+\)/.test(r.mid[1]));
  await p.screenshot({ path: S + '/menu-open.png' });
  r = await swipe('#menu', 250, -200); console.log('drag left on menu', r); assert(!r.open);
  r = await swipe('#budgets', 60, 60, 10, 80); console.log('short slow drag', r); assert(!r.open);
  r = await swipe('#budgets', 60, 80, 4, 10); console.log('short fast flick', r); assert(r.open);
  await p.evaluate(() => document.querySelector('#menu').close()); await p.waitForTimeout(300);
  await p.click('nav button[data-view=cal]'); await p.waitForTimeout(300);
  const m0 = await p.textContent('#monthLabel');
  r = await swipe('#calGrid', 60, 240); const m1 = await p.textContent('#monthLabel'); console.log('calendar drag', r.open, m0, '->', m1); assert(!r.open && m0 !== m1);
  // 중간 프레임 캡처
  await p.click('nav button[data-view=home]'); await p.waitForTimeout(300);
  await p.evaluate(() => { const r = document.querySelector('#budgets'), t = x => new Touch({ identifier: 1, target: r, clientX: x, clientY: 300 });
    r.dispatchEvent(new TouchEvent('touchstart', { touches: [t(20)], bubbles: true })); r.dispatchEvent(new TouchEvent('touchmove', { touches: [t(40)], bubbles: true, cancelable: true }));
    r.dispatchEvent(new TouchEvent('touchmove', { touches: [t(170)], bubbles: true, cancelable: true })); });
  await p.screenshot({ path: S + '/menu-mid.png' });
  console.log('MENU OK'); await b.close(); process.exit(0); });
