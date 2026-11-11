// 가계부 API — 스프레드시트의 [확장 프로그램 > Apps Script]에 붙여넣고 웹 앱으로 배포하세요.
const TOKEN = '여기에-나만-아는-비밀번호를-적으세요'; // 앱 설정의 "비밀번호"와 같아야 합니다
const SHEET = '가계부';
const HEAD = ['id', '날짜', '구분', '카테고리', '금액', '메모', '등록시각'];

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET); sh.appendRow(HEAD); sh.setFrozenRows(1); }
  return sh;
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function day_(v) { return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v); }
// 메모가 =, +, -, @ 로 시작하면 시트가 수식으로 실행하므로 글자로 고정
function text_(v) { const s = String(v || '').slice(0, 200); return /^[=+\-@]/.test(s) ? "'" + s : s; }

function doGet(e) {
  if (e.parameter.token !== TOKEN) return out_({ ok: false, error: '비밀번호가 맞지 않습니다' });
  const rows = sheet_().getDataRange().getValues().slice(1).filter(r => r[0]);
  return out_({ ok: true, items: rows.map(r => ({
    id: String(r[0]), date: day_(r[1]), type: String(r[2]), category: String(r[3]), amount: Number(r[4]), memo: String(r[5]),
  })) });
}

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: '잘못된 요청' }); }
  if (b.token !== TOKEN) return out_({ ok: false, error: '비밀번호가 맞지 않습니다' });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_();
    const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => String(r[0]));
    if (b.action === 'add') {
      const i = b.item || {};
      if (!i.id || !/^\d{4}-\d{2}-\d{2}$/.test(i.date) || !['수입', '지출'].includes(i.type) || !(Number(i.amount) > 0)) {
        return out_({ ok: false, error: '입력값 오류' });
      }
      // 같은 id는 한 번만 저장 (재전송돼도 중복 안 됨)
      if (!ids.includes(String(i.id))) {
        sh.appendRow([String(i.id), i.date, i.type, text_(i.category || '기타'), Number(i.amount), text_(i.memo), new Date()]);
      }
      return out_({ ok: true });
    }
    if (b.action === 'delete') {
      const idx = ids.indexOf(String(b.id));
      if (idx > 0) sh.deleteRow(idx + 1);
      return out_({ ok: true });
    }
    return out_({ ok: false, error: '알 수 없는 동작' });
  } finally {
    lock.releaseLock();
  }
}
