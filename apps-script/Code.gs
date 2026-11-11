// 나의 가계부 API — 「나의 가계부」 시트의 [확장 프로그램 > Apps Script]에 붙여넣고 웹 앱으로 배포하세요.
const TOKEN = '여기에-나만-아는-비밀번호를-적으세요'; // 앱 ⚙ 설정의 "비밀번호"와 같아야 합니다
const TYPES = ['지출', '수입', '환불', '이체'];
const ID_COL = 15; // 거래 탭 O열. F열과 L~N열은 시트 수식(ARRAYFORMULA)이 채우므로 절대 쓰지 않음
const REC_HEAD = ['id', '내용', '구분', '대분류', '소분류', '결제수단', '금액', '매월(일)', '시작월', '종료월(선택)', '마지막 생성월'];

const ss_ = () => SpreadsheetApp.getActiveSpreadsheet();
const out_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
// 시간대 조회와 날짜 변환은 같은 날짜마다 한 번만 (거래 수천 건을 매번 변환하면 수 초~20초 걸림)
let tz_;
const fmtMemo_ = {};
function fmt_(v, p) {
  if (!(v instanceof Date)) return String(v == null ? '' : v).trim();
  const k = p + v.getTime();
  return fmtMemo_[k] || (fmtMemo_[k] = Utilities.formatDate(v, tz_ || (tz_ = ss_().getSpreadsheetTimeZone()), p));
}
const num_ = v => Number(String(v).replace(/,/g, '')) || 0;
// 앞에 ' 를 붙여 글자로 고정 (=로 시작하는 메모가 수식으로 실행되거나 날짜로 바뀌는 것 방지). 셀 값에는 ' 가 남지 않음
const txt_ = v => { const s = String(v == null ? '' : v).trim().slice(0, 200); return s ? "'" + s : ''; };

function tx_() {
  const sh = ss_().getSheetByName('거래');
  if (sh.getMaxColumns() < ID_COL) sh.insertColumnsAfter(sh.getMaxColumns(), ID_COL - sh.getMaxColumns());
  if (sh.getRange(1, ID_COL).getValue() !== 'id') sh.getRange(1, ID_COL).setValue('id');
  return sh;
}
// F열 수식이 아래까지 빈칸을 채우므로 getLastRow 대신 A열(날짜) 기준으로 마지막 행을 찾음
function last_(sh) {
  const a = sh.getRange(1, 1, sh.getMaxRows(), 1).getValues();
  for (let i = a.length - 1; i > 0; i--) if (a[i][0] !== '') return i + 1;
  return 1;
}
// id가 없는 기존 행에 id를 한 번 채워 넣음 (수정·삭제할 때 행을 찾는 용도)
function ids_(sh, last) {
  if (last < 2) return [];
  const r = sh.getRange(2, ID_COL, last - 1, 1), v = r.getValues();
  let changed = false;
  v.forEach(x => { if (!x[0]) { x[0] = Utilities.getUuid(); changed = true; } });
  if (changed) r.setValues(v);
  return v.map(x => String(x[0]));
}
function room_(sh, row) { if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200); }

function check_(i) {
  if (!i || !i.id || !/^\d{4}-\d{2}-\d{2}$/.test(i.date) || !TYPES.includes(i.type) || !(num_(i.amount) > 0) || !String(i.major || '').trim()) {
    throw new Error('입력값 오류');
  }
}
function write_(sh, row, i) {
  sh.getRange(row, 1, 1, 5).setValues([[i.date, i.type, txt_(i.major), txt_(i.minor), txt_(i.content)]]);
  sh.getRange(row, 7, 1, 3).setValues([[txt_(i.pay), Math.round(num_(i.amount)), txt_(i.memo)]]);
  sh.getRange(row, 11).setValue(num_(i.inst) >= 2 ? Math.round(num_(i.inst)) : '');
  sh.getRange(row, ID_COL).setValue(String(i.id));
}

function saveTx_(i) {
  check_(i);
  const sh = tx_(), last = last_(sh), idx = ids_(sh, last).indexOf(String(i.id));
  const row = idx >= 0 ? idx + 2 : last + 1;
  room_(sh, row);
  write_(sh, row, i);
}
function deleteTx_(id) {
  const sh = tx_(), idx = ids_(sh, last_(sh)).indexOf(String(id));
  if (idx >= 0) sh.deleteRow(idx + 2);
}

function rows_(name, cols) {
  const sh = ss_().getSheetByName(name);
  return !sh || sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, cols).getValues();
}
function meta_() {
  const c = rows_('카테고리', 9);
  const budgets = {};
  c.forEach(r => { if (r[3] && r[4] !== '') budgets[String(r[3])] = num_(r[4]); });
  return {
    cats: c.filter(r => r[0]).map(r => [String(r[0]), String(r[1])]),
    budgets,
    payments: c.filter(r => r[7]).map(r => [String(r[7]), String(r[8])]),
    rules: rows_('분류규칙', 4).filter(r => r[0]).map(r => r.map(String)),
    recurring: rows_('반복', 11).filter(r => r[0]).map(r => ({
      id: String(r[0]), content: String(r[1]), type: String(r[2]), major: String(r[3]), minor: String(r[4]), pay: String(r[5]),
      amount: num_(r[6]), day: num_(r[7]), start: fmt_(r[8], 'yyyy-MM'), end: fmt_(r[9], 'yyyy-MM'), done: fmt_(r[10], 'yyyy-MM'),
    })),
  };
}
function budget_(major, amount) {
  const sh = ss_().getSheetByName('카테고리'), d = sh.getRange(2, 4, Math.max(1, sh.getLastRow() - 1), 1).getValues();
  const idx = d.findIndex(r => String(r[0]) === String(major));
  if (idx < 0) throw new Error('카테고리 탭에 없는 대분류');
  sh.getRange(idx + 2, 5).setValue(Math.max(0, Math.round(num_(amount))));
}

// ── 반복 거래 ──
function rec_() {
  let sh = ss_().getSheetByName('반복');
  if (!sh) {
    sh = ss_().insertSheet('반복');
    sh.appendRow(REC_HEAD);
    sh.setFrozenRows(1);
    sh.getRange('I:K').setNumberFormat('@'); // 2026-11 이 날짜로 바뀌지 않게 글자 서식
  }
  return sh;
}
const next_ = m => { const [y, mo] = m.split('-').map(Number), d = new Date(y, mo, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const dim_ = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };

// 지정일이 지난 달마다 거래를 한 번씩 생성 (id = rec-규칙id-월 이라 여러 번 실행돼도 중복 없음)
function runRecurring_() {
  const rs = rec_();
  if (rs.getLastRow() < 2) return;
  const range = rs.getRange(2, 1, rs.getLastRow() - 1, REC_HEAD.length), v = range.getValues();
  const today = fmt_(new Date(), 'yyyy-MM-dd'), cur = today.slice(0, 7);
  const sh = tx_();
  let last = last_(sh);
  const ids = ids_(sh, last);
  let changed = false;
  v.forEach(r => {
    const [id, content, type, major, minor, pay, amount, day] = r;
    if (!id || !(num_(amount) > 0) || !TYPES.includes(String(type))) return;
    const done = fmt_(r[10], 'yyyy-MM'), end = fmt_(r[9], 'yyyy-MM');
    let m = done ? next_(done) : (fmt_(r[8], 'yyyy-MM') || cur);
    while (m <= cur && (!end || m <= end)) {
      const date = m + '-' + String(Math.min(Math.max(1, num_(day)), dim_(m))).padStart(2, '0');
      if (date > today) break;
      const tid = 'rec-' + id + '-' + m;
      if (!ids.includes(tid)) {
        room_(sh, ++last);
        write_(sh, last, { id: tid, date, type: String(type), major, minor, content, pay, amount, memo: '반복' });
        ids.push(tid);
      }
      r[10] = m; changed = true; m = next_(m);
    }
  });
  if (changed) range.setValues(v);
}
function saveRec_(r) {
  if (!r || !r.id || !String(r.content || '').trim() || !TYPES.includes(r.type) || !(num_(r.amount) > 0) ||
      !(num_(r.day) >= 1 && num_(r.day) <= 31) || !/^\d{4}-\d{2}$/.test(r.start) || (r.end && !/^\d{4}-\d{2}$/.test(r.end))) {
    throw new Error('입력값 오류');
  }
  const sh = rec_(), ids = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(x => String(x[0]));
  const idx = ids.indexOf(String(r.id)), row = idx >= 0 ? idx + 2 : sh.getLastRow() + 1;
  const done = idx >= 0 ? sh.getRange(row, 11).getValue() : '';
  sh.getRange(row, 1, 1, REC_HEAD.length).setValues([[String(r.id), txt_(r.content), r.type, txt_(r.major), txt_(r.minor), txt_(r.pay),
    Math.round(num_(r.amount)), Math.round(num_(r.day)), r.start, r.end || '', done]]);
  runRecurring_();
}
function deleteRec_(id) {
  const sh = rec_();
  if (sh.getLastRow() < 2) return;
  const idx = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().findIndex(x => String(x[0]) === String(id));
  if (idx >= 0) sh.deleteRow(idx + 2);
}
// 앱을 안 열어도 반복 거래가 기록되게 하려면, 편집기에서 이 함수를 한 번 실행하세요 (매일 오전 6시 실행)
function setupDaily() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'daily').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('daily').timeBased().everyDays(1).atHour(6).create();
}
function daily() { withLock_(runRecurring_); }

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function doGet(e) {
  if (e.parameter.token !== TOKEN) return out_({ ok: false, error: '비밀번호가 맞지 않습니다' });
  try {
    return out_(withLock_(() => {
      runRecurring_();
      const sh = tx_(), last = last_(sh);
      ids_(sh, last);
      const v = last < 2 ? [] : sh.getRange(2, 1, last - 1, ID_COL).getValues();
      const items = v.filter(r => r[0] !== '').map(r => ({
        id: String(r[14]), date: fmt_(r[0], 'yyyy-MM-dd'), type: String(r[1]), major: String(r[2]), minor: String(r[3]),
        content: String(r[4]), payType: String(r[5]), pay: String(r[6]), amount: num_(r[7]), memo: String(r[8]),
        inst: num_(r[10]) || '', instState: String(r[11]),
      }));
      return { ok: true, items, meta: meta_() };
    }));
  } catch (err) {
    return out_({ ok: false, error: err.message, retry: true });
  }
}

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: '잘못된 요청' }); }
  if (b.token !== TOKEN) return out_({ ok: false, error: '비밀번호가 맞지 않습니다' });
  try {
    withLock_(() => {
      if (b.action === 'save') saveTx_(b.item);
      else if (b.action === 'delete') deleteTx_(b.id);
      else if (b.action === 'recSave') saveRec_(b.rule);
      else if (b.action === 'recDelete') deleteRec_(b.id);
      else if (b.action === 'budget') budget_(b.major, b.amount);
      else throw new Error('알 수 없는 동작');
    });
    return out_({ ok: true });
  } catch (err) {
    // 잠금 대기 초과 같은 일시적 오류는 앱이 다시 보내도록 retry 표시
    return out_({ ok: false, error: err.message, retry: !/입력값|알 수 없는|없는 대분류/.test(err.message) });
  }
}
