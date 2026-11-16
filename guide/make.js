// 「홈 화면에 추가」 안내 그림 만들기: node guide/make.js  (앱 화면을 찍고, 그 위에 사파리·크롬 모양 + 빨간 표시를 그려 guide/*.jpg로 저장)
const { chromium } = require('playwright'), fs = require('fs'), http = require('http'), path = require('path');
const root = path.join(__dirname, '..');
http.createServer((q, r) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : f.endsWith('.woff2') ? 'font/woff2' : 'text/html' }); r.end(b); }); }).listen(8797, async () => {
  const b = await chromium.launch();
  // 1) 앱 화면 (가짜 데이터)
  const ctx = await b.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 }), p = await ctx.newPage();
  await ctx.addInitScript(() => { localStorage.setItem('startSec', '"home"'); localStorage.setItem('cfg', JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 'f0123456789a' })); localStorage.setItem('seenVer', '"x"'); });
  await p.route('https://script.google.com/**', rt => { const u = rt.request().url();
    rt.fulfill({ contentType: 'application/json', body: JSON.stringify(/what=me/.test(u) ? { ok: true, role: 'friend', name: '하트', people: [] }
      : /what=lists/.test(u) ? { ok: true, lists: { book: [{ id: 'b1', title: '데미안', author: '헤르만 헤세', status: '읽는중' }], escape: [{ id: 'e1', theme: '사라진 목격자', date: '2026-11-10', rating: '😍' }] } }
      : /what=habits/.test(u) ? { ok: true, habits: [{ id: 'h1234abcd', name: '물 마시기', icon: '💧', color: '#3182f6', rule: 'RRULE:FREQ=DAILY', enc: '', total: 3, done: [], local: true }] } : { ok: true }) }); });
  await p.goto('http://localhost:8797/'); await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  const app = 'data:image/png;base64,' + (await p.screenshot()).toString('base64');
  const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'icon-180.png')).toString('base64');
  const font = 'http://localhost:8797/PretendardVariable.woff2';
  // 2) 장면마다: 휴대폰 화면 + 빨간 동그라미(mark) + 번호 말풍선
  const css = `@font-face{font-family:P;src:url(${font})} *{box-sizing:border-box} body{margin:0;font-family:P,sans-serif;background:#fff}
    .ph{position:relative;width:390px;height:760px;overflow:hidden;background:#fff} .app{position:absolute;inset:0;width:390px}
    .dim{position:absolute;inset:0;background:rgba(0,0,0,.35)}
    .ios-bar{position:absolute;left:12px;right:12px;bottom:18px;height:54px;border-radius:27px;background:rgba(245,245,247,.92);box-shadow:0 4px 18px rgba(0,0,0,.18);display:flex;align-items:center;gap:8px;padding:0 10px}
    .ios-bar .addr{flex:1;height:38px;border-radius:19px;background:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;color:#333}
    .btn{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-size:22px;color:#007aff;font-weight:700}
    .sheet{position:absolute;left:0;right:0;bottom:0;background:#f2f2f7;border-radius:18px 18px 0 0;padding:14px 14px 30px}
    .row{background:#fff;border-radius:12px;padding:14px 16px;font-size:16px;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;color:#111}
    .menu{position:absolute;right:14px;bottom:84px;width:230px;background:rgba(250,250,252,.97);border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.25);overflow:hidden}
    .menu div{padding:13px 16px;font-size:15px;border-bottom:1px solid #e5e5ea;display:flex;justify-content:space-between;color:#111}
    .mark{position:absolute;border:4px solid #ff2d55;border-radius:16px;box-shadow:0 0 0 4px rgba(255,45,85,.25)}
    .tip{position:absolute;background:#ff2d55;color:#fff;font-weight:800;font-size:17px;line-height:1.35;padding:10px 14px;border-radius:14px;box-shadow:0 6px 16px rgba(255,45,85,.35);max-width:280px;word-break:keep-all}
    .tip b{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#fff;color:#ff2d55;margin-right:6px;font-size:15px}
    .and-top{position:absolute;left:0;right:0;top:0;height:56px;background:#fff;display:flex;align-items:center;gap:8px;padding:0 8px;box-shadow:0 1px 4px rgba(0,0,0,.12)}
    .and-top .addr{flex:1;height:38px;border-radius:19px;background:#f1f3f4;display:flex;align-items:center;padding:0 14px;font-size:14px;color:#333}
    .amenu{position:absolute;right:6px;top:8px;width:250px;background:#fff;border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.25)} .amenu div{padding:14px 18px;font-size:15px;color:#202124}
    .dlg{position:absolute;left:28px;right:28px;top:250px;background:#fff;border-radius:24px;padding:22px;box-shadow:0 10px 30px rgba(0,0,0,.3)}`;
  const iosBar = `<div class="ios-bar"><div class="btn">‹</div><div class="addr">bab-works.github.io</div><div class="btn">⋯</div></div>`;
  const shots = {
    'ios-1': `<img class="app" src="${app}">${iosBar}<div class="mark" style="right:14px;bottom:20px;width:50px;height:50px;border-radius:50%"></div>
      <div class="tip" style="right:14px;bottom:86px"><b>1</b>사파리 아래쪽 <u>⋯</u> 버튼을 눌러요</div>
      <div class="tip" style="left:14px;top:20px;background:#333;font-size:14px;font-weight:600">공유 버튼(□↑)이 바로 보이면<br>그걸 눌러도 돼요</div>`,
    'ios-2': `<img class="app" src="${app}"><div class="dim"></div>${iosBar}<div class="menu"><div>즐겨찾기에 추가 <span>☆</span></div><div>새로운 탭 <span>＋</span></div><div style="font-weight:700">공유 <span>⬆︎</span></div><div style="border:0">페이지에서 찾기 <span>🔍</span></div></div>
      <div class="mark" style="right:10px;bottom:138px;width:238px;height:46px"></div><div class="tip" style="left:14px;top:300px"><b>2</b>「공유」를 눌러요</div>`,
    'ios-3': `<img class="app" src="${app}"><div class="dim"></div><div class="sheet"><div class="row" style="justify-content:flex-start;gap:12px"><img src="${icon}" style="width:44px;border-radius:10px">하트 : 하비 트래커</div>
      <div class="row">링크 복사 <span>🔗</span></div><div class="row">읽기 목록에 추가 <span>👓</span></div><div class="row" style="font-weight:700">홈 화면에 추가 <span>⊞</span></div><div class="row">즐겨찾기에 추가 <span>☆</span></div></div>
      <div class="mark" style="left:10px;right:10px;bottom:84px;height:56px"></div><div class="tip" style="left:14px;top:170px"><b>3</b>아래로 내려서<br>「홈 화면에 추가」를 눌러요</div>`,
    'ios-4': `<div style="position:absolute;inset:0;background:#f2f2f7"></div><div style="position:relative">
      <div style="display:flex;justify-content:space-between;padding:18px 18px;font-size:17px;color:#007aff"><span>취소</span><b style="color:#111">홈 화면에 추가</b><b>추가</b></div>
      <div style="margin:10px 16px;background:#fff;border-radius:12px;padding:14px;display:flex;gap:14px;align-items:center"><img src="${icon}" style="width:64px;border-radius:14px"><div><div style="font-size:17px;color:#111">하트</div><div style="font-size:13px;color:#8e8e93;margin-top:4px">bab-works.github.io</div></div></div>
      <div style="margin:10px 16px;background:#fff;border-radius:12px;padding:14px 16px;display:flex;justify-content:space-between;font-size:16px;color:#111">웹 앱으로 열기<span style="width:50px;height:30px;border-radius:15px;background:#34c759;position:relative"><i style="position:absolute;right:2px;top:2px;width:26px;height:26px;border-radius:50%;background:#fff"></i></span></div></div>
      <div class="mark" style="right:8px;top:8px;width:64px;height:44px"></div><div class="tip" style="right:14px;top:250px"><b>4</b>오른쪽 위 「추가」를 누르면 끝!</div>
      <div class="tip" style="left:14px;bottom:30px;background:#333;font-size:14px;font-weight:600">홈 화면에 생긴 하트 아이콘으로 열고,<br>아이디(이름)와 비밀번호로 한 번 더 로그인해요</div>`,
    'and-1': `<img class="app" src="${app}" style="top:56px"><div class="and-top"><div class="addr">bab-works.github.io/bab-zip</div><div class="btn" style="color:#555">⋮</div></div>
      <div class="mark" style="right:4px;top:6px;width:46px;height:46px;border-radius:50%"></div><div class="tip" style="right:14px;top:70px"><b>1</b>크롬 오른쪽 위 ⋮ 를 눌러요</div>`,
    'and-2': `<img class="app" src="${app}" style="top:56px"><div class="dim"></div><div class="amenu"><div>새 탭</div><div>방문 기록</div><div>북마크</div><div style="font-weight:700">홈 화면에 추가</div><div>설정</div></div>
      <div class="mark" style="right:4px;top:142px;width:254px;height:52px"></div><div class="tip" style="left:14px;top:300px"><b>2</b>「홈 화면에 추가」 또는<br>「앱 설치」를 누르고 「설치」</div>`,
  };
  const pg = await (await b.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 1.6 })).newPage();
  for (const [n, h] of Object.entries(shots)) {
    await pg.setContent(`<style>${css}</style><div class="ph">${h}</div>`); await pg.waitForTimeout(300);
    await pg.screenshot({ path: path.join(__dirname, n + '.jpg'), type: 'jpeg', quality: 78 });
  }
  console.log('GUIDE OK'); await b.close(); process.exit(0); });
