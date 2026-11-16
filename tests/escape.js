// 방탈출 테마 검색: 전국방탈출 공개 테마 페이지 → 「방탈출 테마 목록」 탭 → 이름으로 검색
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const page = (id, theme, shop, genre) => `<meta property="og:title" content="${theme} - ${shop} 방탈출 테마 후기 - 전국방탈출">
<meta property="og:description" content="${shop} 방탈출 테마 · ${genre} · 60분 · 평점 3.5 · 리뷰 10개.">
<meta property="og:image" content="https://image.roomsescape.org/theme/${id}.jpg">`;
const PAGES = { 82: page(82, '젠틀맨 뱅크', '시그널헌터 가로수길점', '범죄'), 83: page(83, '오시리스', '서울이스케이프룸 홍대점', '공포'),
  84: page(84, 'Tom &amp; Jerry', '키이스케이프 강남점', '코믹'), 85: '<html>없는 테마</html>' };
const url = id => `https://www.roomescape.co.kr/theme/detail?themeId=${id}`;
// 시트 흉내
const rows = []; let sheet = null;
const mkSheet = () => ({ getLastRow: () => rows.length, getRange: (r, c, nr = 1, nc = 1) => ({
  setValues: v => v.forEach((row, i) => { rows[r - 1 + i] = row; }),
  getValues: () => rows.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)) }) });
const triggers = [], fetched = [];
const trig = () => { const t = { fn: 'escapeIndex' }; const b = { timeBased: () => b, after: ms => { t.after = ms; return b; }, everyWeeks: () => b, onWeekDay: () => b, atHour: () => { t.weekly = true; return b; }, create: () => triggers.push(t) }; return b; };
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => n === '방탈출 테마 목록' ? sheet : null, insertSheet: () => (sheet = mkSheet()) }) },
  UrlFetchApp: {
    fetch: u => ({ getContentText: () => /sitemap\.xml$/.test(u) ? '<sitemapindex><sitemap><loc>https://www.roomescape.co.kr/sitemap-cafe-1.xml</loc></sitemap><sitemap><loc>https://www.roomescape.co.kr/sitemap-theme-1.xml</loc></sitemap></sitemapindex>'
      : /sitemap-theme/.test(u) ? Object.keys(PAGES).map(id => `<url><loc>${url(id)}</loc></url>`).join('') : '' }),
    fetchAll: reqs => reqs.map(q => { fetched.push(q.url); return { getContentText: () => PAGES[q.url.match(/\d+$/)[0]] }; }) },
  ScriptApp: { getProjectTriggers: () => triggers.map(t => ({ getHandlerFunction: () => t.fn, t })), deleteTrigger: x => triggers.splice(triggers.indexOf(x.t), 1), newTrigger: trig, WeekDay: { MONDAY: 1 } },
  Utilities: { sleep: () => {} }, Logger: { log: () => {} },
};
vm.createContext(ctx); vm.runInContext(fs.readFileSync(__dirname + '/../apps-script/Code.gs', 'utf8'), ctx);
const run = c => vm.runInContext(c, ctx);
assert.throws(() => run('escapeSearch_("오시")'), /escapeIndex/, 'asks to build the list first');
run('escapeIndex()');
assert.deepEqual(rows[0], ['themeId', '테마', '매장', '장르', '포스터', '주소']);
assert.deepEqual(rows[1], ['82', '젠틀맨 뱅크', '시그널헌터 가로수길점', '범죄', 'https://image.roomsescape.org/theme/82.jpg', url(82)]);
assert.equal(rows[3][1], 'Tom & Jerry'); assert.equal(rows[4][1], '', 'unreadable page kept as blank so it is not refetched');
assert.equal(triggers.length, 1); assert.equal(triggers[0].weekly, true, 'all read → weekly refresh');
// 다시 돌리면 새 테마만 읽음
const n = fetched.length; PAGES[86] = page(86, '고백', '비트포비아 강남점', '감성'); run('escapeIndex()');
assert.deepEqual(fetched.slice(n), [url(86)]); assert.equal(triggers.length, 1, 'old trigger replaced');
// 검색: 공백·대소문자 무시, 테마 이름 앞부분이 먼저, 매장으로도
const s = q => JSON.parse(JSON.stringify(run(`escapeSearch_(${JSON.stringify(q)})`)));
assert.deepEqual(s('오시 리스'), [{ theme: '오시리스', shop: '서울이스케이프룸 홍대점', genre: '공포', image: 'https://image.roomsescape.org/theme/83.jpg', url: url(83) }]);
assert.deepEqual(s('강남').map(x => x.theme), ['Tom & Jerry', '고백']);
assert.deepEqual(s('tom').map(x => x.theme), ['Tom & Jerry']);
assert.deepEqual(s('없는말'), []);
console.log('ESCAPE OK');
