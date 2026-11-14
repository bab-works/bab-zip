const vm = require('vm'), fs = require('fs'), assert = require('assert'), crypto = require('crypto');
const props = { TICKTICK_USER: 'me@x.com', TICKTICK_PASS: 'pw' }, calls = [];
let tokenValid = 'tok1', loginCount = 0, batchMode = 'ok', checkins = [{ id: 'c1', habitId: 'a'.repeat(24), checkinStamp: 20261110, status: 2 }];
const resp = (code, obj) => ({ getResponseCode: () => code, getContentText: () => obj == null ? '' : JSON.stringify(obj) });
const UrlFetchApp = { fetch(url, o) {
  const path = url.replace('https://api.ticktick.com/api/v2', ''); calls.push([path, o.payload && JSON.parse(o.payload)]);
  assert(o.headers['X-Device'] && o.headers['User-Agent']);
  if (path.startsWith('/user/signon')) { loginCount++; return JSON.parse(o.payload).password === 'pw' ? resp(200, { token: tokenValid }) : resp(200, { errorCode: 'x' }); }
  if (o.headers.Cookie !== 't=' + tokenValid) return resp(401, {});
  if (path === '/habits') return resp(200, [{ id: 'a'.repeat(24), name: '책 읽기', status: 0, sortOrder: 2, totalCheckIns: 5, color: '#A0EFED', iconRes: 'habit_reading', repeatRule: 'RRULE:FREQ=DAILY' },
    { id: 'b'.repeat(24), name: '보관됨', status: 1, sortOrder: 1 }]);
  if (path === '/habitCheckins/query') { const b = JSON.parse(o.payload); const m = {}; b.habitIds.forEach(h => m[h] = checkins.filter(c => c.habitId === h && c.checkinStamp > b.afterStamp)); return resp(200, { checkins: m }); }
  if (path === '/habitCheckins/batch') { const b = JSON.parse(o.payload);
    const a = b.add[0] || b.update[0];
    if (batchMode === 'all500' || (batchMode === 'noMillis' && a && /\.000/.test(a.checkinTime))) return { getResponseCode: () => 500, getContentText: () => '{"errorCode":"unknown"}' }; checkins = checkins.filter(c => !b.delete.includes(c.id)).concat(b.add); b.update.forEach(u => { checkins = checkins.map(c => c.id === u.id ? u : c); }); return resp(200, { id2etag: {} }); }
  return resp(404, {});
} };
const ctx = { UrlFetchApp, console,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
  Utilities: { getUuid: () => crypto.randomUUID(), formatDate: (d, tz, p) => p === 'yyyyMMdd' ? d.toISOString().slice(0, 10).replace(/-/g, '') : d.toISOString().replace(/\.\d+Z$/, p.includes('.000') ? '.000+0000' : '+0000') },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSpreadsheetTimeZone: () => 'Asia/Seoul' }) },
  ContentService: { MimeType: { JSON: 1 }, createTextOutput: s => ({ setMimeType: () => s }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) } };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(require('path').join(__dirname, '../apps-script/Code.gs'), 'utf8').replace(/^const TOKEN = .*$/m, "const TOKEN = 'T';"), ctx);
const get = q => JSON.parse(ctx.doGet({ parameter: { token: 'T', ...q } }));
const post = b => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token: 'T', ...b }) } }));
let r = get({ what: 'habits' });
assert(r.ok && r.habits.length === 1 && r.habits[0].name === '책 읽기' && r.habits[0].done.join() === '20261110', JSON.stringify(r)); assert.equal(loginCount, 1);
const A = 'a'.repeat(24);
assert(post({ action: 'habitCheck', habitId: A, stamp: 20261111, done: true }).ok);
const added = checkins.find(c => c.checkinStamp === 20261111); assert(added && /^[0-9a-f]{24}$/.test(added.id) && added.status === 2 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000\+0000$/.test(added.checkinTime));
assert(post({ action: 'habitCheck', habitId: A, stamp: 20261111, done: true }).ok); assert.equal(checkins.filter(c => c.checkinStamp === 20261111).length, 1, 'no dup');
assert(post({ action: 'habitCheck', habitId: A, stamp: 20261110, done: false }).ok); assert(!checkins.some(c => c.checkinStamp === 20261110), 'uncheck deletes');
tokenValid = 'tok2'; // 세션 만료 → 재로그인
assert(get({ what: 'habits' }).ok); assert.equal(loginCount, 2); assert.equal(props.TT_TOKEN, 'tok2');
r = post({ action: 'habitCheck', habitId: 'nope', stamp: 20261111, done: true }); assert(!r.ok && !r.retry, 'bad input rejected');
props.TICKTICK_PASS = 'bad'; delete props.TT_TOKEN;
r = post({ action: 'habitCheck', habitId: A, stamp: 20261112, done: true }); assert(!r.ok && !r.retry && /로그인 실패/.test(r.error), JSON.stringify(r));
delete props.TICKTICK_USER; r = get({ what: 'habits' }); assert(!r.ok && /틱틱 계정/.test(r.error));
console.log('TICKTICK OK');
// 구글 로그인: 쿠키 토큰만
for (const k of Object.keys(props)) delete props[k];
props.TICKTICK_TOKEN = 'tok2'; loginCount = 0;
r = get({ what: 'habits' }); assert(r.ok && loginCount === 0, JSON.stringify(r));
tokenValid = 'tok3';
r = post({ action: 'habitCheck', habitId: A, stamp: 20261113, done: true }); assert(!r.ok && !r.retry && /TICKTICK_TOKEN이 만료/.test(r.error), JSON.stringify(r)); assert.equal(loginCount, 0);
// 틱틱이 시간 형식을 거부(500)하면 다른 형식으로 다시 시도하고 기억함
for (const k of Object.keys(props)) delete props[k];
props.TICKTICK_TOKEN = tokenValid; batchMode = 'noMillis';
r = post({ action: 'habitCheck', habitId: A, stamp: 20261120, done: true }); assert.ok(r.ok, JSON.stringify(r));
assert.ok(checkins.some(c => c.checkinStamp === 20261120 && /T\d\d:\d\d:\d\d\+0000$/.test(c.checkinTime)), 'saved with second format'); assert.equal(props.TT_FORM, '1');
// 계속 500이면 실패를 알리되, 앱 대기열을 막지 않게 retry:false + 틱틱이 보낸 내용 포함
batchMode = 'all500';
r = post({ action: 'habitCheck', habitId: A, stamp: 20261121, done: true }); assert.ok(!r.ok && r.retry === false && /500 \{"errorCode":"unknown"\}/.test(r.error), JSON.stringify(r));
console.log('COOKIE TOKEN OK');
