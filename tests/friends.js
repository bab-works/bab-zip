// 친구 접속코드: 초대 → 친구는 가계부 못 봄, 취미 기록·습관은 친구마다 따로, 「함께한 사람」 태그는 서로의 앱에 같이 보임
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
class Sheet {
  constructor(rows) { this.d = rows.map(r => [...r]); }
  cell(r, c) { const v = (this.d[r - 1] || [])[c - 1]; return v == null ? '' : v; }
  set(r, c, v) { if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1); while (this.d.length < r) this.d.push([]); this.d[r - 1][c - 1] = v; }
  getRange(r, c, nr = 1, nc = 1) {
    const s = this;
    return { getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => s.cell(r + i, c + j))),
      setValues: v => v.forEach((row, i) => row.forEach((x, j) => s.set(r + i, c + j, x))),
      getFormulas: () => Array.from({ length: nr }, () => Array(nc).fill('')), getValue: () => s.cell(r, c), setValue: x => s.set(r, c, x) };
  }
  getMaxRows() { return 1000 } getMaxColumns() { return 40 } insertRowsAfter() {} insertColumnsAfter() {}
  getLastColumn() { return Math.max(1, ...this.d.map(r => (r || []).length)); }
  getLastRow() { let l = 0; this.d.forEach((r, i) => { if (r && r.some(x => x !== '' && x != null)) l = i + 1; }); return l; }
  deleteRow(r) { this.d.splice(r - 1, 1); }
  appendRow(v) { const r = this.getLastRow() + 1; v.forEach((x, j) => this.set(r, j + 1, x)); }
}
const tabs = {}, props = {}; let uid = 0;
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => tabs[n] || null, insertSheet: n => (tabs[n] = new Sheet([])), getSpreadsheetTimeZone: () => 'Asia/Seoul' }), flush() {} },
  ContentService: { MimeType: { JSON: 1 }, createTextOutput: s => ({ setMimeType: () => s }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
  Utilities: { getUuid: () => String(++uid).padStart(8, '0') + '-cccc-dddd-eeee-ffffffffffff', formatDate: d => d.toISOString().slice(0, 10),
    DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (a, t) => [...require('crypto').createHash('sha256').update(t).digest()], base64Encode: b => Buffer.from(b).toString('base64') },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8').replace(/^const TOKEN = .*$/m, "const TOKEN = 'owner-pw';"), ctx);
// 주인 시트의 취미 탭들 (setupSheet가 만드는 제목 줄 그대로)
const TABS = vm.runInContext('TABS_', ctx), LISTS = vm.runInContext('LISTS', ctx);
Object.values(LISTS).filter(c => !c.create).forEach(c => { tabs[c.tab] = new Sheet(TABS[c.tab]); });
const get = (token, what, extra = {}) => JSON.parse(ctx.doGet({ parameter: { token, what, ...extra } }));
const post = (token, o) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, ...o }) } }));
const OWNER = 'owner-pw';

// 주인: 이름 정하고 친구 초대 → 접속코드
assert.equal(post(OWNER, { action: 'setName', name: '나리' }).ok, true);
const inv = post(OWNER, { action: 'invite', name: '민지' }); assert.equal(inv.ok, true); assert.match(inv.code, /^f[0-9a-f]{11}$/);
const MJ = inv.code, JH = post(OWNER, { action: 'invite', name: '준호' }).code;
assert.equal(post(OWNER, { action: 'invite', name: '민지' }).ok, false, 'duplicate name');
assert.equal(post(OWNER, { action: 'invite', name: '김 민지' }).ok, false, 'no spaces (tags split on spaces)');
assert.deepEqual(get(OWNER, 'me').people, ['나리', '민지', '준호']);
assert.deepEqual([get(MJ, 'me').role, get(MJ, 'me').name], ['friend', '민지']);
assert.equal(get(MJ, 'me').friends, undefined, 'friends cannot see others’ codes');
assert.equal(get('nope-code-1', 'me').ok, false);

// 친구는 가계부 금지 (읽기·쓰기·초대)
assert.match(get(MJ, undefined).error, /가계부/); assert.match(get(MJ, 'summary').error, /가계부/);
assert.equal(post(MJ, { action: 'save', item: { id: 'x', date: '2026-11-16', type: '지출', major: '식비', amount: 1 } }).ok, false);
assert.equal(post(MJ, { action: 'invite', name: '해커' }).ok, false);

// 친구 기록은 친구 것만 + 일부만 바꿔도 나머지 유지
assert.equal(post(MJ, { action: 'listSave', list: 'escape', item: { id: 'e1', theme: '오시리스', shop: '서울이스케이프룸', with: '나리, 준호', date: '2026-11-15' } }).ok, true);
assert.equal(post(MJ, { action: 'listSave', list: 'escape', item: { id: 'e1', theme: '오시리스', rating: '😍' } }).ok, true);
assert.equal(post(MJ, { action: 'listSave', list: 'book', item: { id: 'b1', title: '페스트', author: '카뮈' } }).ok, true);
const mj = get(MJ, 'lists').lists;
assert.deepEqual([mj.escape.length, mj.escape[0].with, mj.escape[0].rating, mj.book[0].title], [1, '나리, 준호', '😍', '페스트']);
assert.equal(get(JH, 'lists').lists.book.length, 0, 'friends do not see each other’s own lists');

// 태그: 민지가 「나리, 준호」와 간 방탈출 → 나리(주인)·준호 앱에 읽기 전용으로
const ownerEsc = get(OWNER, 'lists').lists.escape.find(i => i.shared);
assert.deepEqual([ownerEsc.theme, ownerEsc.shared, ownerEsc.id], ['오시리스', '민지', 's:' + MJ + ':e1']);
// 게스트끼리는 아직 친구가 아니라 준호 앱엔 안 보이고, 준호 태그 칩에도 민지가 없음
assert.equal(get(JH, 'lists').lists.escape.length, 0, 'not friends → tag not shown');
assert.deepEqual(get(JH, 'me').people, ['준호', '나리'], 'tag chips: me + friends only');
// 친구 신청 → 받은 쪽 수락 → 친구
assert.equal(post(MJ, { action: 'friendRequest', name: '없는사람' }).ok, false);
assert.deepEqual(post(MJ, { action: 'friendRequest', name: '준호' }).social.outgoing, ['준호']);
assert.deepEqual(get(JH, 'me').social.incoming, ['민지']);
assert.deepEqual(post(JH, { action: 'friendAccept', name: '민지' }).social.friends.map(f => f.name).sort(), ['나리', '민지']);
assert.deepEqual(get(MJ, 'me').social.incoming, []);
assert.equal(get(JH, 'lists').lists.escape[0].shared, '민지');
assert.equal(post(OWNER, { action: 'listSave', list: 'escape', item: { id: ownerEsc.id, theme: 'x' } }).ok, false, 'cannot edit someone else’s record');
assert.equal(post(JH, { action: 'listSave', list: 'escape', item: { id: ownerEsc.id, theme: 'x' } }).ok, false);
// 주인이 민지를 태그한 기록 → 민지 앱에
assert.equal(post(OWNER, { action: 'listSave', list: 'movie', item: { id: 'm1', title: '파묘', with: '민지' } }).ok, true);
const mjMovie = get(MJ, 'lists').lists.movie; assert.deepEqual(mjMovie.map(i => [i.title, i.shared]), [['파묘', '나리']]);
assert.equal(get(JH, 'lists').lists.movie.length, 0, 'not tagged → not shown');

// 친구 습관 (틱틱 없이)
assert.equal(post(MJ, { action: 'habitAdd', habitId: 'h1234abcd', name: '물 마시기', icon: '💧', color: '#3182f6' }).ok, true);
assert.equal(post(MJ, { action: 'habitCheck', habitId: 'h1234abcd', stamp: 20261116, done: true }).ok, true);
let h = get(MJ, 'habits').habits; assert.deepEqual([h.length, h[0].name, h[0].icon, h[0].done, h[0].local], [1, '물 마시기', '💧', [20261116], true]);
post(MJ, { action: 'habitCheck', habitId: 'h1234abcd', stamp: 20261116, done: false }); assert.deepEqual(get(MJ, 'habits').habits[0].done, []);
assert.equal(get(JH, 'habits').habits.length, 0, 'habits are per code');
assert.equal(post(JH, { action: 'habitCheck', habitId: 'h1234abcd', stamp: 20261116, done: true }).ok, false, 'cannot check someone else’s habit');
post(MJ, { action: 'habitDelete', habitId: 'h1234abcd' }); assert.equal(get(MJ, 'habits').habits.length, 0);

// 로그인: 주인은 이름 + 시트 비밀번호, 친구는 짧은 초대 링크(비밀번호 없음)로 들어와서 비밀번호를 정한 뒤 이름 + 비밀번호
assert.equal(post(undefined, { action: 'login', name: '나리', password: OWNER }).token, OWNER);
assert.equal(post(undefined, { action: 'login', name: '남', password: OWNER }).ok, false, 'owner name must match');
assert.match(post(undefined, { action: 'login', name: '나리', password: 'x' }).error, /맞지 않아요/);
const mjInv = get(OWNER, 'me').friends.find(f => f.name === '민지').invite; assert.match(mjInv, /^i[0-9a-f]{9}$/);
assert.notEqual(mjInv, MJ, 'invite id is not the access code');
const red = post(undefined, { action: 'redeem', invite: mjInv }); assert.deepEqual([red.token, red.name, red.hasPassword], [MJ, '민지', true]);
assert.equal(post(undefined, { action: 'redeem', invite: 'i000000000' }).ok, false);
assert.equal(post(undefined, { action: 'login', name: '민지', password: MJ }).ok, false, 'access code alone is not a password');
assert.equal(post(undefined, { action: 'login', name: '민지', password: '1234' }).token, MJ, 'first password is 1234');
assert.equal(post(MJ, { action: 'setPassword', password: 'cat1' }).ok, true);
assert.equal(post(undefined, { action: 'login', name: '민지', password: 'cat1' }).token, MJ);
assert.equal(tabs['친구'].d.some(r => r.includes('cat1')), false, 'password stored hashed');
assert.equal(post(MJ, { action: 'setPassword', password: 'ab' }).ok, false, 'too short');
// 중복 없애기: 주인이 혼자 먼저 기록해 둔 테마를 민지가 뒤늦게 태그 → 한 줄만, 민지 평가는 주인 기록에 붙음
assert.equal(post(OWNER, { action: 'listSave', list: 'escape', item: { id: 'o1', theme: '사라진 목격자', rating: '🙂', date: '2026-11-01' } }).ok, true);
assert.equal(post(MJ, { action: 'listSave', list: 'escape', item: { id: 'e2', theme: '사라진  목격자', rating: '😍', review: '최고', with: '나리' } }).ok, true);
const twice = get(OWNER, 'lists').lists.escape.filter(i => i.theme.replace(/\s/g, '') === '사라진목격자');
assert.equal(twice.length, 1, 'no duplicate'); assert.deepEqual([twice[0].rating, twice[0].others], ['🙂', [{ name: '민지', rating: '😍', review: '최고' }]]);
// 친구 집: 공개한 것만, 친구만 / 함께한 사람은 안 보임
assert.equal(post(MJ, { action: 'setPub', list: 'escape', id: 'e1', on: true }).ok, true);
assert.equal(post(MJ, { action: 'setHouse', icon: 'c3', intro: '방탈출 좋아해요' }).ok, true);
assert.equal(get(MJ, 'lists').lists.escape.find(i => i.id === 'e1').pub, true);
const hs = get(JH, 'house', { name: '민지' }).house;
assert.deepEqual([hs.name, hs.icon, hs.intro, hs.items.escape.map(i => i.theme), hs.items.escape[0].with], ['민지', 'c3', '방탈출 좋아해요', ['오시리스'], undefined]);
assert.equal(get(OWNER, 'house', { name: '민지' }).house.items.escape.length, 1, 'owner is friends with invited guests');
// 친구 끊기 → 집도 태그도 안 보임
assert.equal(post(JH, { action: 'friendRemove', name: '민지' }).ok, true);
assert.equal(get(JH, 'house', { name: '민지' }).ok, false); assert.equal(get(JH, 'lists').lists.escape.length, 0);
post(MJ, { action: 'setPub', list: 'escape', id: 'e1', on: false }); assert.equal(get(OWNER, 'house', { name: '민지' }).house.items.escape.length, 0);
// 주인 비밀번호 바꾸기 → 새 토큰으로만
const np = post(OWNER, { action: 'setPassword', password: 'newpw1' }); assert.equal(np.token, 'newpw1');
assert.equal(get(OWNER, 'me').ok, false); assert.equal(get('newpw1', 'me').role, 'owner');
assert.equal(post('newpw1', { action: 'setPassword', password: OWNER }).ok, true); // 원래대로

// 초대 취소 → 그 코드는 더 못 씀
post(OWNER, { action: 'uninvite', code: JH }); assert.equal(get(JH, 'lists').ok, false);
console.log('FRIENDS OK');
