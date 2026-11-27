// 2단계 시트 쪽: 주인이 가계부를 처음 열면 시트 → 서버(D1)로 한 번 옮김(건수·합계가 맞을 때만 켬) → 그다음부터 읽기·쓰기는 서버로,
// 친구는 여전히 못 봄, 문자·반복은 서버가, 시트는 한 시간마다 백업(수식 열은 안 건드림). 값은 전부 가짜
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
class Sheet {
  constructor(name, rows) { this.name = name; this.d = rows.map(r => [...r]); }
  cell(r, c) { const v = (this.d[r - 1] || [])[c - 1]; return v == null ? '' : v; }
  set(r, c, v) { if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1); while (this.d.length < r) this.d.push([]); this.d[r - 1][c - 1] = v; }
  getRange(r, c, nr = 1, nc = 1) {
    const s = this;
    if (typeof r === 'string') return { setNumberFormat() {} };
    return { getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => s.cell(r + i, c + j))),
      setValues: v => { if (v.length !== nr || v.some(x => x.length !== nc)) throw new Error('크기 다름'); v.forEach((row, i) => row.forEach((x, j) => s.set(r + i, c + j, x))); },
      clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.set(r + i, c + j, ''); },
      getValue: () => s.cell(r, c), setValue: x => s.set(r, c, x), getSheet: () => s };
  }
  getName() { return this.name; }
  copyTo() { const c = new Sheet(this.name + ' 사본', this.d); return { setName: n => { c.name = n; tabs[n] = c; return c; } }; }
  getMaxRows() { return 1000 } getMaxColumns() { return 16 } insertRowsAfter() {} insertColumnsAfter() {} setFrozenRows() {}
  getLastColumn() { return Math.max(1, ...this.d.map(r => (r || []).length)); }
  getLastRow() { let l = 0; this.d.forEach((r, i) => { if (r && r.some(x => x !== '' && x != null)) l = i + 1; }); return l; }
  appendRow(v) { const r = this.getLastRow() + 1; v.forEach((x, j) => this.set(r, j + 1, x)); }
}
const HEAD = ['날짜', '시간', '구분', '대분류', '소분류', '내용', '=결제유형', '결제수단', '금액', '메모', '원본분류', '할부(개월)', '=할부', '=남은', '=총액', 'id'];
const tx = new Sheet('거래', [HEAD,
  ['2026-09-05', '', '지출', '식비', '외식', '가짜식당', '=f', '샘플카드', 12000, '', '원본', 3, '=f', '=f', '=f', 'a1'],
  ['2026-10-01', '09:00', '수입', '수입', '급여', '가짜급여', '=f', '가짜통장', '1,000,000', '', '', '', '=f', '=f', '=f', 'a1'], // id 겹침 → 새 id
  ['2026-10-02', '', '지출', '식비', '', '빈 id 줄', '=f', '', 500, '', '', '', '=f', '=f', '=f', '']]);
const tabs = {
  거래: tx,
  카테고리: new Sheet('카테고리', [['대분류', '소분류', '', '대분류', '월 예산', '메모', '', '결제수단', '결제유형'], ['식비', '외식', '', '식비', 300000, '', '', '샘플카드', '카드'], ['수입', '급여', '', '기타', '', '', '', '가짜통장', '현금·계좌']]),
  분류규칙: new Sheet('분류규칙', [['키워드', '적용구분', '대분류', '소분류'], ['가나다', '지출', '식비', '외식']]),
  반복: new Sheet('반복', [['id', '내용', '구분', '대분류', '소분류', '결제수단', '금액', '매월(일)', '시작월', '종료월(선택)', '마지막 생성월'], ['r1', '가짜 구독', '지출', '기타', '', '가짜통장', 9900, 1, '2026-01', '', '2026-11']]),
};
const props = { FRIEND_MODE: 'worker', OWNER_NAME: '나', APP_TOKEN: 'owner-pw' }, cache = {}, triggers = [];
// 가짜 친구 서버: 받은 요청을 기록하고, 가계부 줄을 메모리에 들고 있음
const calls = [], server = { rows: [], meta: {}, active: false, ver: 1, fail: false };
const reply = b => {
  if (server.fail) return { ok: false, retry: true, error: '친구 서버에 연결하지 못했어요' };
  if (b.action === 'ledgerImport') { if (b.reset) server.rows = []; server.rows.push(...b.rows); if (b.meta) server.meta = b.meta; return { ok: true }; }
  if (b.action === 'ledgerVerify') { const ids = new Set(server.rows.map(r => r.id)); return { ok: true, count: ids.size, sum: server.rows.reduce((s, r) => s + r.amount, 0) }; }
  if (b.action === 'ledgerActivate') { server.active = true; return { ok: true }; }
  if (b.action === 'ledgerDeactivate') { server.active = false; return { ok: true }; }
  if (b.what === 'ledgerExport') return b.ver && +b.ver === server.ver ? { ok: true, same: true } : { ok: true, ver: server.ver, active: server.active, rows: server.rows, meta: { budgets: { 식비: 250000 }, recurring: [{ id: 'r1', content: '가짜 구독', type: '지출', major: '기타', minor: '', pay: '가짜통장', amount: 9900, day: 1, start: '2026-01', end: '', done: '2026-12' }], cards: [{ name: '현대카드', match: '현대', goal: 1 }] } };
  if (b.what === 'me') return { ok: true, role: 'owner', name: '나' };
  return { ok: true, items: [{ id: 'from-d1' }], wrote: true, today: 1 };
};
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => tabs[n] || null, insertSheet: n => (tabs[n] = new Sheet(n, [])), getSpreadsheetTimeZone: () => 'Asia/Seoul' }), flush() {} },
  ContentService: { MimeType: { JSON: 1 }, createTextOutput: s => ({ setMimeType: () => s }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
  ScriptApp: { getProjectTriggers: () => triggers, newTrigger: h => ({ timeBased: () => ({ everyHours: () => ({ create: () => triggers.push({ getHandlerFunction: () => h }) }), everyMinutes: () => ({ create: () => triggers.push({ getHandlerFunction: () => h }) }) }) }) },
  Utilities: { getUuid: () => 'uuid-' + Math.random().toString(16).slice(2), formatDate: (d, tz, p) => p === 'HH:mm' ? '00:00' : p === 'yyyy-MM' ? d.toISOString().slice(0, 7) : d.toISOString().slice(0, 10),
    DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' }, computeDigest: (a, t) => [...require('crypto').createHash(a).update(t).digest()], base64Encode: b => Buffer.from(b).toString('base64') },
  UrlFetchApp: { fetch: (_, o) => { const b = JSON.parse(o.payload); calls.push({ b, bridge: !!o.headers.Authorization }); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(reply(b)) }; } },
  Logger: { log() {} },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8')
  .replace("const FRIEND_WORKER_ = '';", "const FRIEND_WORKER_ = 'https://bab-zip-friends.test.workers.dev';").replace("const FRIEND_BRIDGE_ = '';", "const FRIEND_BRIDGE_ = 'bridge';"), ctx);
const get = (token, extra = {}) => JSON.parse(ctx.doGet({ parameter: { token, ...extra } }));
const post = (token, o) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, ...o }) } }));
const T = post(undefined, { action: 'login', name: '나', password: 'owner-pw' }).token;
assert.match(T, /^so\./);

// 1) 서버가 안 되면 옮기지 않고 시트에서 그대로 (오류를 남기고 10분 뒤 다시)
server.fail = true;
let r = get(T, { what: 'ledger' });
assert.equal(r.ok, true); assert.equal(r.items.length, 3, 'still served from the Sheet'); assert.equal(props.LEDGER_MODE, undefined); assert.ok(props.LEDGER_ERR);
server.fail = false; delete cache.LEDGER_TRY; calls.length = 0;
// 2) 옮기기: 겹친 id는 새 id로 고치고, 건수·합계 확인 뒤 켬 → 이번 응답부터 서버에서
r = get(T, { what: 'ledger', since: '2026-10-01' });
assert.equal(props.LEDGER_MODE, 'd1'); assert.equal(server.active, true); assert.deepEqual(r.items, [{ id: 'from-d1' }]);
assert.equal(server.rows.length, 3); assert.equal(new Set(server.rows.map(x => x.id)).size, 3, 'duplicate ids fixed before moving');
assert.notEqual(tx.cell(3, 16), 'a1'); assert.ok(tx.cell(4, 16), 'blank id filled');
assert.deepEqual(server.rows.map(x => [x.amount, x.orig, x.inst, x.seq]), [[12000, '원본', 3, 1], [1000000, '', 0, 2], [500, '', 0, 3]]);
assert.deepEqual(server.meta.budgetMajors, ['식비', '기타']); assert.equal(server.meta.recurring[0].done, '2026-11');
assert.ok(calls.every(c => c.bridge), 'all ledger calls use the Sheet secret, never a token'); assert.ok(calls.every(c => c.b.token === undefined));
assert.ok(triggers.some(t => t.getHandlerFunction() === 'ledgerTick'), 'hourly backup scheduled');
assert.equal(tabs['거래 (옮기기 전)'].cell(2, 6), '가짜식당', 'a copy of the tab is kept before backups start rewriting it');
assert.equal(calls.filter(c => c.b.action === 'ledgerImport').length, 1);
// 3) 그다음: 읽기·쓰기·요약은 서버로, 다시 옮기지 않음. 친구는 여전히 못 봄
calls.length = 0;
assert.deepEqual(get(T, { what: 'ledger', since: '2026-10-01', full: '1' }).items, [{ id: 'from-d1' }]);
assert.deepEqual(calls[0].b, { what: 'ledger', since: '2026-10-01', full: '1' });
assert.equal(post(T, { action: 'save', item: { id: 'n1', date: '2026-11-27', type: '지출', major: '식비', amount: 1 } }).wrote, true);
assert.equal(calls.at(-1).b.action, 'save'); assert.equal(tx.getLastRow(), 4, 'the Sheet is not written directly');
assert.equal(get(T, { what: 'summary' }).today, 1);
assert.equal(calls.filter(c => c.b.action === 'ledgerImport').length, 0);
assert.equal(get(T, { what: 'me' }).ledger, 'd1', 'app learns it can read the ledger from the server');
assert.equal(get('sf.friend', { what: 'ledger' }).ok, false, 'friends still cannot see it');
assert.equal(post('sf.friend', { action: 'save', item: {} }).ok, false);
// 4) 한 시간마다 백업: 거래 탭은 값 열만(수식 열 G·M~O는 그대로), 줄이 줄면 남은 줄 비움. 바뀐 게 없으면 다시 안 씀
server.rows = [{ id: 'k1', date: '2026-11-01', time: '', type: '지출', major: '=위험', minor: '', content: '새 줄', pay: '샘플카드', amount: 7000, memo: '', orig: '', inst: 0 },
  { id: 'k2', date: '2026-11-02', time: '10:00', type: '수입', major: '수입', minor: '', content: '둘째', pay: '', amount: 9, memo: 'm', orig: 'o', inst: 2 },
  { id: 'k3', date: '2026-11-03', time: '', type: '지출', major: '식비', minor: '', content: '셋째', pay: '', amount: 1, memo: '', orig: '', inst: 0 }];
ctx.ledgerTick();
assert.deepEqual(tx.d[1].slice(0, 6), ['2026-11-01', '', '지출', '=위험', '', '새 줄']); assert.equal(tx.cell(2, 7), '=f', 'formula column untouched');
assert.deepEqual([tx.cell(3, 8), tx.cell(3, 9), tx.cell(3, 10), tx.cell(3, 11), tx.cell(3, 12), tx.cell(3, 16)], ['', 9, 'm', 'o', 2, 'k2']);
assert.equal(tabs.카테고리.cell(2, 5), 250000); assert.equal(tabs.반복.cell(2, 11), '2026-12'); assert.match(props.CARD_GOALS, /현대카드/);
assert.ok(calls.some(c => c.b.action === 'ledgerMeta'), 'categories pushed to the server');
const writes = () => tx.d.map(x => x.join()).join('|'), before = writes(); server.rows = [];
ctx.ledgerTick(); assert.equal(writes(), before, 'same version → not rewritten');
// 서버 거래가 갑자기 많이 줄면 시트를 덮지 않음
server.ver = 2; tabs.거래.d.push(...Array.from({ length: 60 }, (_, i) => ['2026-11-04', '', '지출', '식비', '', 'x' + i, '=f', '', 1, '', '', '', '=f', '=f', '=f', 'z' + i]));
assert.throws(() => ctx.ledgerTick(), /백업 멈춤/);
// 5) 시트를 고치면 카테고리가 서버로
calls.length = 0; ctx.editedFriendProjection_({ range: tabs.카테고리.getRange(2, 5) });
assert.equal(calls[0].b.action, 'ledgerMeta'); assert.deepEqual(calls[0].b.budgets, { 식비: 250000 }, 'budgets edited in 카테고리 go to the server');
// 6) 문자: 서버가 켜져 있으면 시트는 문자를 쓰지 않음(서버가 빈 목록) / 매일 반복은 서버가
props.REC_RUN = ''; ctx.daily(); assert.equal(tabs.반복.cell(2, 11), '2026-12', 'Sheet recurring skipped');
console.log('LEDGER SHEET OK');
