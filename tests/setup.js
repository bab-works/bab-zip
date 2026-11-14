// 친구용 setupSheet: 빈 시트에 탭·제목 줄·수식·기본 카테고리를 만들고 비밀번호를 생성. 이미 있는 탭은 안 건드림
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
function run(token, existing = []) {
  const props = {}, logs = [], tabs = {}, order = [];
  const mk = name => { const cells = {}, sh = { name, cells, frozen: 0,
    getName: () => name, getLastRow: () => Object.keys(cells).length ? 1 : 0, setFrozenRows: n => { sh.frozen = n; },
    getRange: (r, c, nr = 1, nc = 1) => typeof r === 'string' ? { setNumberFormat() {} } : {
      setValue: v => { cells[r + ',' + c] = v; }, setFormula: v => { cells[r + ',' + c] = v; }, setFontWeight() {},
      setValues: v => v.forEach((row, i) => row.forEach((x, j) => { cells[(r + i) + ',' + (c + j)] = x; })) } };
    tabs[name] = sh; order.push(sh); return sh; };
  mk('시트1'); existing.forEach(n => { mk(n).cells['1,1'] = '내 데이터'; });
  const ctx = { console, Logger: { log: (...a) => logs.push(a.join(' ')) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => tabs[n] || null, insertSheet: mk, getSheets: () => order,
      deleteSheet: sh => { delete tabs[sh.name]; order.splice(order.indexOf(sh), 1); } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    Utilities: { getUuid: () => 'abcd1234-ef56-7890-abcd-ef1234567890' }, ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/NEW/exec' }) },
    ContentService: { MimeType: { JSON: 1 }, createTextOutput: s => ({ setMimeType: () => s }) } };
  vm.createContext(ctx); vm.runInContext(src.replace(/^const TOKEN = .*$/m, `const TOKEN = '${token}';`), ctx);
  return { ctx, props, logs, tabs, order };
}
// 친구: 비밀번호 칸을 안 고친 새 시트
let r = run('여기에-나만-아는-비밀번호를-적으세요');
assert.equal(JSON.parse(r.ctx.doGet({ parameter: { token: '여기에-나만-아는-비밀번호를-적으세요' } })).ok, false, 'placeholder token never works');
r.ctx.setupSheet();
assert.ok(!r.tabs['시트1'], 'empty default tab removed');
for (const t of ['거래', '카테고리', '분류규칙', '독서 기록', '구매 목록', '추천·관심 도서', '방탈출 기록', '보드게임 기록', '영화 기록', '연극·뮤지컬 기록']) assert.ok(r.tabs[t], t);
const T = r.tabs['거래'].cells;
assert.equal(T['1,1'], '날짜'); assert.equal(T['1,9'], '금액'); assert.equal(T['1,16'], 'id'); assert.match(T['1,7'], /^=\{"결제유형"/); assert.match(T['1,15'], /^=\{"할부 총액"/);
assert.equal(r.tabs['방탈출 기록'].cells['3,2'], '테마'); assert.equal(r.tabs['방탈출 기록'].cells['3,15'], 'id');
assert.equal(r.tabs['카테고리'].cells['2,1'], '식비'); assert.equal(r.tabs['카테고리'].cells['2,8'], '현금');
assert.match(r.props.APP_TOKEN, /^[0-9a-f]{12}$/);
assert.equal(JSON.parse(r.ctx.doGet({ parameter: { token: 'nope', what: 'summary' } })).ok, false);
r.ctx.appLink(); assert.ok(r.logs.some(l => l.includes('https://bab-works.github.io/bab-zip/#url=https://script.google.com/macros/s/NEW/exec&token=' + r.props.APP_TOKEN)), r.logs.join('\n'));
// 기존 사용자: 이미 있는 탭은 그대로, 비밀번호는 코드의 TOKEN 유지
r = run('my-secret', ['거래', '카테고리']);
r.ctx.setupSheet();
assert.equal(r.tabs['거래'].cells['1,1'], '내 데이터', 'existing tab untouched'); assert.equal(r.props.APP_TOKEN, undefined);
assert.ok(r.tabs['영화 기록'], 'missing tabs still created');
console.log('SETUP OK');
