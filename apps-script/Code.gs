// 나의 가계부 API — 「나의 가계부」 시트의 Apps Script. main에 올라오면 GitHub Actions가 자동 배포해요 (.github/workflows/deploy-gas.yml)
const TOKEN = '여기에-나만-아는-비밀번호를-적으세요'; // 앱 ⚙ 설정의 "비밀번호"와 같아야 합니다
const TYPES = ['지출', '수입', '환불', '이체'];
// 비밀번호: setupSheet()가 만든 스크립트 속성 APP_TOKEN이 있으면 그걸, 없으면 위 TOKEN. 처음 문구 그대로면 아무도 못 들어옴
const PLACEHOLDER = '여기에-나만-아는-비밀번호를-적으세요';
// 비밀번호는 스크립트 속성 APP_TOKEN에만 둠 (코드에 남기지 않음). 예전 배포가 코드에 넣어 둔 값이 있으면 처음 한 번 속성으로 옮김
const pwOk_ = t => {
  const p = PropertiesService.getScriptProperties(); let k = p.getProperty('APP_TOKEN');
  if (!k && TOKEN !== PLACEHOLDER) { p.setProperty('APP_TOKEN', TOKEN); k = TOKEN; }
  return !!t && !!k && k !== PLACEHOLDER && String(t) === k;
};
// 로그인하면 비밀번호 대신 출입증(so.…)을 줌. 시트엔 출입증의 SHA-256과 {e: 만료, c: 만든 때}만 (스크립트 속성 SESSIONS)
// 슬라이딩: 쓸 때마다 마지막 사용 + 30일(기록은 하루 한 번). 30일 넘게 안 쓰면 끝. 7일 넘은 출입증은 앱을 열 때(what=me) 새것으로 교체
// 예전 앱이 비밀번호를 그대로 들고 오는 건 LEGACY_UNTIL_까지만 받음 (그 전에 앱이 알아서 출입증으로 바꿈)
const SESSION_MS_ = 30 * 864e5, ROTATE_MS_ = 7 * 864e5, GRACE_MS_ = 120e3, LEGACY_UNTIL_ = Date.parse('2027-01-01T00:00:00+09:00');
const sha_ = s => Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s)).map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
const sessions_ = () => { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('SESSIONS') || '{}'); } catch (_) { return {}; } };
const saveSessions_ = s => PropertiesService.getScriptProperties().setProperty('SESSIONS', JSON.stringify(s));
const authOk_ = t => {
  t = String(t || '');
  if (/^so\./.test(t)) { const x = sessions_()[sha_(t)]; return !!x && x.e > Date.now(); }
  return Date.now() < LEGACY_UNTIL_ && pwOk_(t);
};
const ownerWorker_ = () => friendMode_() === 'worker' && !!FRIEND_BRIDGE_;
function newSession_() {
  const token = 'so.' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''), now = Date.now(), s = sessions_();
  Object.keys(s).forEach(k => { if (!s[k] || !(s[k].e > now)) delete s[k]; });
  const keep = Object.keys(s).sort((a, b) => s[b].e - s[a].e).slice(0, 19), next = {}; keep.forEach(k => { next[k] = s[k]; }); // 기기 20대까지
  const h = sha_(token), exp = now + SESSION_MS_; next[h] = { e: exp, c: now }; saveSessions_(next);
  if (ownerWorker_()) workerCall_({ action: 'ownerSession', hash: h, expires: Math.floor(exp / 1000) }, true); // 친구 서버에서 책·영화 검색용
  return token;
}
// 쓸 때마다 연장 (하루에 한 번만 기록). rotate면 7일 넘은 출입증을 새것으로 바꿔 돌려줌 (예전 것은 2분 뒤 끝)
function renewSession_(t, rotate) {
  if (!/^so\./.test(String(t))) return '';
  const s = sessions_(), h = sha_(t), now = Date.now(), x = s[h];
  if (!x || !(x.e > now) || x.r) return ''; // x.r: 이미 새것으로 바꾼 출입증 (2분 유예만, 연장 안 함)
  if (rotate && now - x.c > ROTATE_MS_) {
    x.e = Math.min(x.e, now + GRACE_MS_); x.r = 1; saveSessions_(s);
    if (ownerWorker_()) workerCall_({ action: 'ownerSession', hash: h, expires: Math.floor(x.e / 1000) }, true);
    return newSession_();
  }
  if (x.e - now > SESSION_MS_ - 864e5) return '';
  x.e = now + SESSION_MS_; saveSessions_(s);
  if (ownerWorker_()) workerCall_({ action: 'ownerSession', hash: h, expires: Math.floor(x.e / 1000) }, true);
  return '';
}
// 로그아웃: 이 기기 출입증만 / 모든 기기 (친구 서버에 알려 둔 것까지)
function endSessions_(t, all) {
  const s = sessions_(), h = sha_(t);
  if (all) saveSessions_({}); else { delete s[h]; saveSessions_(s); }
  if (ownerWorker_()) workerCall_(all ? { action: 'dropOwnerSessions' } : { action: 'dropOwnerSessions', hashes: [h] }, true);
  return { ok: true, wrote: true };
}
// 거래 탭 열 위치 (A 날짜 · B 시간 · C 구분 · D 대분류 · E 소분류 · F 내용 · G 결제유형(수식) · H 결제수단 · I 금액 · J 메모 · K 원본분류 · L 할부 · M~O 수식 · P id)
// G·M·N·O 열은 시트 수식이 채우므로 절대 쓰지 않음. 열 구성이 다르면 아무것도 쓰지 않고 멈춤
const ID_COL = 16;
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
const txt_ = (v, n) => { const s = String(v == null ? '' : v).trim().slice(0, n || 200); return s ? "'" + s : ''; };

function tx_() {
  const sh = ss_().getSheetByName('거래');
  if (sh.getMaxColumns() < ID_COL) sh.insertColumnsAfter(sh.getMaxColumns(), ID_COL - sh.getMaxColumns());
  const head = sh.getRange(1, 1, 1, ID_COL).getValues()[0];
  if (head[0] !== '날짜' || head[1] !== '시간' || head[2] !== '구분' || head[7] !== '결제수단' || head[8] !== '금액') {
    throw new Error('거래 탭의 열 구성이 바뀌었어요. 저장을 멈췄어요. 열 이름을 확인해 주세요');
  }
  // P열(id)이 비어 있을 때만 id 제목을 씀. 다른 제목이 있으면 덮어쓰지 않음
  if (head[ID_COL - 1] === '') sh.getRange(1, ID_COL).setValue('id');
  else if (head[ID_COL - 1] !== 'id') throw new Error('거래 탭 P열이 id 열이 아니에요. 저장을 멈췄어요');
  return sh;
}
const tm_ = v => (v instanceof Date ? fmt_(v, 'HH:mm') : String(v == null ? '' : v).trim());
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
  sh.getRange(row, 1, 1, 6).setValues([[i.date, /^\d{2}:\d{2}$/.test(i.time || '') ? i.time : '', i.type, txt_(i.major), txt_(i.minor), txt_(i.content)]]);
  sh.getRange(row, 8, 1, 3).setValues([[txt_(i.pay), Math.round(num_(i.amount)), txt_(i.memo)]]);
  sh.getRange(row, 12).setValue(num_(i.inst) >= 2 ? Math.round(num_(i.inst)) : '');
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

// ── 방탈출 테마 검색: 전국방탈출(roomescape.co.kr) 공개 테마 페이지(사이트맵·robots 허용)를 천천히 읽어 「방탈출 테마 목록」 탭에 모아 둠 ──
// 처음 한 번 함수 목록에서 escapeIndex를 실행해요. 한 번에 4분씩 읽고, 남으면 1분 뒤 저절로 이어서, 다 끝나면 매주 새 테마만 추가해요
const ESC_TAB_ = '방탈출 테마 목록';
function escParse_(url, html) {
  const id = (url.match(/themeId=(\d+)/) || [])[1] || '';
  const un = x => x.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const meta = p => { const m = html.match(new RegExp('<meta property="' + p + '" content="([^"]*)"')); return m ? un(m[1]) : ''; };
  const raw = meta('og:title'), t = raw.replace(/ 방탈출 테마 후기 - 전국방탈출$/, ''), cut = t.lastIndexOf(' - ');
  if (!id || t === raw || cut < 0) return [id, '', '', '', '', url, '-']; // 없는 번호는 사이트 기본 제목만 나옴 → 빈 줄로 남겨 다시 안 읽음
  const genre = (meta('og:description').split(' · ')[1] || '').trim();
  const addr = un((html.match(/주소:\s*([^<"]+)/) || [])[1] || '').trim(); // 「서울 강남구 강남대로…」 → 지역 「서울 강남구」
  return [id, t.slice(0, cut), t.slice(cut + 3), /분$|평점/.test(genre) ? '' : genre, meta('og:image'), url, addr.split(/\s+/).slice(0, 2).join(' ') || '-'];
}
// 상태: 다 모았는지(ESC_DONE). 앱 검색 결과가 비었을 때 「아직 모으는 중」이라고 알려 주려고
function escapeIndex() {
  const props = PropertiesService.getScriptProperties();
  const sh = ss_().getSheetByName(ESC_TAB_) || ss_().insertSheet(ESC_TAB_);
  sh.getRange(1, 1, 1, 7).setValues([['themeId', '테마', '매장', '장르', '포스터', '주소', '지역']]);
  const old = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues() : [];
  const rowOf = {}; old.forEach((r, k) => { rowOf[String(r[0])] = k + 2; });
  const locs = x => (x.match(/<loc>[^<]*<\/loc>/g) || []).map(s => s.replace(/<\/?loc>/g, '').replace(/&amp;/g, '&'));
  const maps = locs(UrlFetchApp.fetch('https://www.roomescape.co.kr/sitemap.xml').getContentText()).filter(u => /sitemap-theme/.test(u));
  const idOf = u => (u.match(/themeId=(\d+)/) || [])[1];
  // 사이트맵엔 테마 절반쯤만 있어서, 사이트맵 + 1번부터 (아는 가장 큰 번호 + 300)번까지 모든 번호의 공개 테마 페이지를 읽음
  // 할 일: 아직 없는 번호 + 예전에 지역 없이 모은 테마 (한 번만 다시 읽어 지역 채움). 사이트맵 것 먼저, 나머지는 최근 번호부터
  const sm = [].concat(...maps.map(m => locs(UrlFetchApp.fetch(m).getContentText())));
  // 빈 번호(빈 줄)는 기준에서 빼야 매주 300씩 끝없이 늘지 않음 → 진짜 테마의 가장 큰 번호 + 300
  const top = Math.max(0, ...sm.map(idOf).map(Number), ...old.filter(r => r[1]).map(r => Number(r[0]) || 0)) + 300;
  const known = new Set(sm.map(idOf)), url = n => 'https://www.roomescape.co.kr/theme/detail?themeId=' + n;
  const all = sm.concat(Array.from({ length: top }, (_, k) => top - k).filter(n => !known.has(String(n))).map(url));
  // 빈 번호도 사이트맵에 새로 올라왔거나 가장 최근 번호 뒤쪽이면 다시 확인 (그 사이 새 테마가 생겼을 수 있음)
  const maxReal = top - 300;
  const todo = all.filter(u => { const id = idOf(u), r = rowOf[id], o = r && old[r - 2]; return !r || (o[1] ? !o[6] : known.has(id) || Number(id) > maxReal); });
  if (todo.length) props.setProperty('ESC_DONE', '');
  const t0 = Date.now(); let i = 0;
  for (; i < todo.length && Date.now() - t0 < 4 * 60e3; i += 10) { // 10쪽씩, 쉬어 가며 (사이트에 부담 안 주게)
    const part = todo.slice(i, i + 10), rows = UrlFetchApp.fetchAll(part.map(u => ({ url: u, muteHttpExceptions: true }))).map((r, k) => escParse_(part[k], r.getContentText()));
    const fresh = [];
    rows.forEach((row, k) => { const at = rowOf[idOf(part[k])]; if (at) sh.getRange(at, 1, 1, 7).setValues([row]); else fresh.push(row); });
    if (fresh.length) sh.getRange(sh.getLastRow() + 1, 1, fresh.length, 7).setValues(fresh);
    Utilities.sleep(1000);
  }
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'escapeIndex').forEach(t => ScriptApp.deleteTrigger(t));
  if (i < todo.length) ScriptApp.newTrigger('escapeIndex').timeBased().after(60e3).create(); // 남은 건 1분 뒤 이어서
  else { props.setProperty('ESC_DONE', '1'); ScriptApp.newTrigger('escapeIndex').timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(4).create(); } // 다 읽었으면 매주 새 테마만
  Logger.log('방탈출 테마 ' + Math.min(i, todo.length) + '개 읽음 · 남은 ' + Math.max(0, todo.length - i) + '개' + (i < todo.length ? ' (1분 뒤 저절로 이어서 읽어요)' : ' · 다 읽었어요'));
}
function escapeSearch_(q) {
  const sh = ss_().getSheetByName(ESC_TAB_), k = String(q || '').replace(/\s+/g, '').toLowerCase();
  if (!sh || sh.getLastRow() < 2) throw new Error('먼저 Apps Script에서 escapeIndex를 실행해 테마 목록을 만들어 주세요');
  if (k.length < 1) return [];
  const flat = s => String(s).replace(/\s+/g, '').toLowerCase();
  return sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues().filter(r => r[1] && flat(r[1] + r[2]).includes(k))
    .sort((a, b) => (flat(b[1]).startsWith(k) - flat(a[1]).startsWith(k)) || (flat(b[1]).includes(k) - flat(a[1]).includes(k)))
    .slice(0, 20).map(r => ({ theme: String(r[1]), shop: String(r[2]), genre: String(r[3]), image: /^https:\/\//.test(r[4]) ? String(r[4]) : '', url: String(r[5]), area: r[6] === '-' ? '' : String(r[6] || '') }));
}
const escapeStatus_ = () => { const sh = ss_().getSheetByName(ESC_TAB_); return { count: sh ? Math.max(0, sh.getLastRow() - 1) : 0, building: PropertiesService.getScriptProperties().getProperty('ESC_DONE') !== '1' }; };

// ── 친구: 주인이 앱 설정에서 이름으로 초대 → 친구마다 접속코드. 친구는 가계부를 못 보고, 취미 기록·습관은 친구마다 따로 저장 ──
// 「친구」 탭: 이름 | 접속코드 | 만든 날 / 「친구 기록」 탭: 코드 | 목록 | id | 내용(JSON) | 수정일 / 「친구 습관」 탭: 코드 | id | 이름 | 아이콘 | 색 | 한 날(JSON) | 만든 날
const FRIEND_TAB_ = '친구', FREC_TAB_ = '친구 기록', FHAB_TAB_ = '친구 습관';
const ownerName_ = () => PropertiesService.getScriptProperties().getProperty('OWNER_NAME') || '';
const tab_ = (name, head) => { let sh = ss_().getSheetByName(name); if (!sh) { sh = ss_().insertSheet(name); sh.getRange(1, 1, 1, head.length).setValues([head]); } return sh; };
const body_ = sh => sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues() : [];
// 「친구」 탭 열: 이름 | 접속코드 | 만든 날 | 초대ID(짧은 초대 링크용) | 비밀번호(해시)
const friends_ = () => body_(ss_().getSheetByName(FRIEND_TAB_)).filter(r => r[0] && r[1]).map(r => ({ name: String(r[0]).trim(), code: String(r[1]), invite: String(r[3] || ''), pw: String(r[4] || '') }));
const pwHash_ = (salt, pw) => Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pw));
const newId_ = (p, n) => p + Utilities.getUuid().replace(/-/g, '').slice(0, n);
// 예전에 초대한 친구에게도 짧은 초대 ID를 만들어 줌 (주인이 설정을 열 때)
// 게스트 첫 비밀번호는 모두 1234 (아이폰은 홈 화면 앱과 사파리·인스타 브라우저의 저장소가 따로라, 링크로 로그인해도 홈 화면 앱에선 다시 로그인해야 함)
const FIRST_PW_ = '1234';
function ensureInvites_() {
  const sh = ss_().getSheetByName(FRIEND_TAB_); if (!sh) return;
  const rows = body_(sh), miss = rows.map((r, i) => r[0] && r[1] && (!r[3] || !r[4]) ? i : -1).filter(i => i >= 0);
  if (!miss.length) return; // 대부분은 쓸 게 없음 → 잠금·쓰기 없이 바로 (예전엔 매번 써서 느렸음)
  withLock_(() => { sh.getRange(1, 4, 1, 2).setValues([['초대ID', '비밀번호']]);
    miss.forEach(i => { const r = rows[i]; if (!r[3]) sh.getRange(i + 2, 4).setValue(newId_('i', 9)); if (!r[4]) sh.getRange(i + 2, 5).setValue(pwHash_(String(r[1]), FIRST_PW_)); }); });
}
// ── 빠르게: 목록·습관 응답을 CacheService에 잠깐 저장. 기록이 바뀌면 DATA_VER가 바뀌어 옛 캐시는 안 씀 ──
// shortcut: 시트에서 손으로 고친 건 최대 10분 늦게 보임 (앱의 새로고침 단추는 캐시를 건너뜀)
const cache_ = () => { try { return CacheService.getScriptCache(); } catch (e) { return null; } };
const dataVer_ = () => PropertiesService.getScriptProperties().getProperty('DATA_VER') || '0';
const bumpVer_ = () => PropertiesService.getScriptProperties().setProperty('DATA_VER', String(Date.now()));
function cached_(key, sec, fresh, make) {
  const c = cache_(), k = key + ':' + dataVer_();
  if (c && !fresh) { const hit = c.get(k); if (hit) { try { return JSON.parse(hit); } catch (e) {} } }
  const v = make();
  if (c) { try { c.put(k, JSON.stringify(v), sec); } catch (e) {} } // 100KB가 넘으면 그냥 안 담음
  return v;
}
// 로그인: 이름 + 비밀번호 → 접속 토큰 (주인: 시트 비밀번호, 친구: 자기가 정한 비밀번호). 같은 이름으로 10번 넘게 틀리면 10분 쉬기
function login_(b) {
  const name = String(b.name || '').trim(), pw = String(b.password || ''), cache = typeof CacheService !== 'undefined' ? CacheService.getScriptCache() : null, key = 'fail:' + name;
  if (!name || !pw) throw new Error('아이디와 비밀번호를 넣어 주세요');
  if (cache && +(cache.get(key) || 0) >= 10) throw new Error('너무 많이 틀렸어요 · 10분 뒤에 다시 해 주세요');
  const owner = ownerName_();
  if (pwOk_(pw) && (!owner || owner === name)) { if (!owner) PropertiesService.getScriptProperties().setProperty('OWNER_NAME', name); return { token: newSession_(), role: 'owner', name }; }
  const f = friends_().find(x => x.name === name && x.pw && x.pw === pwHash_(x.code, pw));
  if (f) return { token: f.code, role: 'friend', name: f.name };
  if (cache) cache.put(key, String(+(cache.get(key) || 0) + 1), 600);
  throw new Error('아이디 또는 비밀번호가 맞지 않아요');
}
// 초대 링크(#i=초대ID)로 열면 비밀번호 없이 바로 로그인
function redeem_(b) {
  const f = /^i[0-9a-f]{9}$/.test(String(b.invite || '')) && friends_().find(x => x.invite === String(b.invite));
  if (!f) throw new Error('초대 링크가 맞지 않거나 취소됐어요 · 초대한 사람에게 다시 받아 주세요');
  return { token: f.code, role: 'friend', name: f.name, hasPassword: !!f.pw };
}
// 비밀번호 바꾸기: 주인은 시트 비밀번호(APP_TOKEN) 자체가 바뀜 → 새 토큰을 돌려줌, 친구는 로그인용 비밀번호만
function setPassword_(me, b) {
  const pw = String(b.password || '');
  if (pw.length < 4 || pw.length > 40) throw new Error('입력값 오류: 비밀번호는 4~40자');
  if (me.role === 'owner') { // 비밀번호를 바꾸면 모든 기기의 출입증을 끊고 이 기기엔 새 출입증
    PropertiesService.getScriptProperties().setProperty('APP_TOKEN', pw); endSessions_('', true); return { token: newSession_() };
  }
  const sh = ss_().getSheetByName(FRIEND_TAB_), i = body_(sh).findIndex(r => String(r[1]) === me.code);
  sh.getRange(1, 5).setValue('비밀번호'); sh.getRange(i + 2, 5).setValue(pwHash_(me.code, pw));
  return { token: me.code };
}
function who_(t) {
  if (authOk_(t)) return { role: 'owner', name: ownerName_(), code: '' };
  const f = t && String(t).length >= 8 && friends_().find(x => x.code === String(t));
  return f ? { role: 'friend', name: f.name, code: f.code } : null;
}
const people_ = () => [ownerName_(), ...friends_().map(f => f.name)].filter(Boolean); // 앱을 쓰는 모든 사람 (이름 겹침 확인용)
// ── 친구 맺기: 「친구 관계」 탭 [보낸 사람, 받는 사람, 상태(요청/친구), 날짜]. 사람 열쇠는 주인 'owner', 게스트는 접속코드 ──
// 주인이 초대한 게스트는 처음부터 주인과 친구. 게스트끼리는 이름으로 신청 → 받은 사람이 수락해야 친구 (그래야 태그·집 방문이 됨)
const REL_TAB_ = '친구 관계', PUB_TAB_ = '공개', HOUSE_TAB_ = '집';
const keyOf_ = me => me.code || 'owner';
function rels_() { const sh = ss_().getSheetByName(REL_TAB_); return sh ? body_(sh).map((r, i) => ({ a: String(r[0]), b: String(r[1]), st: String(r[2]), row: i + 2 })) : []; }
// 모든 사람 열쇠 ↔ 이름
function folks_() { const o = { owner: ownerName_() }; friends_().forEach(f => { o[f.code] = f.name; }); return o; }
function friendKeys_(k, rels, folks) {
  const out = {};
  if (k === 'owner') Object.keys(folks).forEach(x => { if (x !== 'owner') out[x] = 1; }); else if (folks.owner) out.owner = 1;
  rels.filter(r => r.st === '친구' && (r.a === k || r.b === k)).forEach(r => { out[r.a === k ? r.b : r.a] = 1; });
  delete out[k]; return Object.keys(out).filter(x => folks[x]);
}
// 나 + 내 친구 이름 (태그 칩에 나오는 사람)
function myPeople_(me) { const folks = folks_(); return [me.name, ...friendKeys_(keyOf_(me), rels_(), folks).map(x => folks[x])].filter(Boolean); }
function social_(me) {
  const folks = folks_(), rels = rels_(), k = keyOf_(me), hs = houses_();
  return { friends: friendKeys_(k, rels, folks).map(x => ({ name: folks[x], icon: (hs[x] || {}).icon || '', intro: (hs[x] || {}).intro || '' })),
    incoming: rels.filter(r => r.st === '요청' && r.b === k && folks[r.a]).map(r => folks[r.a]), outgoing: rels.filter(r => r.st === '요청' && r.a === k && folks[r.b]).map(r => folks[r.b]),
    house: hs[k] || {}, ownerName: folks.owner || '' };
}
// friendRequest(이름): 상대가 이미 나에게 신청했으면 바로 친구 / friendAccept / friendRemove(거절·취소·끊기 모두)
function friendOp_(me, b) {
  const folks = folks_(), k = keyOf_(me), n = String(b.name || '').trim(), t = Object.keys(folks).find(x => folks[x] === n);
  if (!t || t === k) throw new Error('입력값 오류: 그런 이름의 친구가 없어요 · 앱에 쓰는 이름(아이디)을 정확히 넣어 주세요');
  const sh = tab_(REL_TAB_, ['보낸 사람', '받는 사람', '상태', '날짜']), rels = rels_(), pair = rels.filter(r => (r.a === k && r.b === t) || (r.a === t && r.b === k));
  if (b.action === 'friendRemove') { pair.sort((x, y) => y.row - x.row).forEach(r => sh.deleteRow(r.row)); return social_(me); }
  if (friendKeys_(k, rels, folks).includes(t)) return social_(me);
  const theirs = pair.find(r => r.a === t && r.st === '요청');
  if (theirs) sh.getRange(theirs.row, 3, 1, 2).setValues([['친구', new Date()]]);
  else if (b.action === 'friendAccept') throw new Error('입력값 오류: 받은 친구 신청이 없어요');
  else if (!pair.length) sh.appendRow([k, t, '요청', new Date()]);
  return social_(me);
}
// 제보하기: 「제보」 탭 [날짜, 이름, 내용, 앱 버전, 기기] (주인이 시트에서 확인)
function report_(me, b) {
  const t = String(b.text || '').trim().slice(0, 1000);
  if (!t) throw new Error('입력값 오류: 내용을 적어 주세요');
  tab_('제보', ['날짜', '이름', '내용', '앱 버전', '기기']).appendRow([new Date(), "'" + (me.name || ''), "'" + t, String(b.ver || '').slice(0, 20), String(b.ua || '').slice(0, 120)]);
}
// 내 집: 아이콘·한 줄 소개 [사람 열쇠, 아이콘, 소개]
function houses_() { const sh = ss_().getSheetByName(HOUSE_TAB_), o = {}; if (sh) body_(sh).forEach(r => { o[String(r[0])] = { icon: String(r[1] || ''), intro: String(r[2] || '') }; }); return o; }
function setHouse_(me, b) {
  const sh = tab_(HOUSE_TAB_, ['사람', '아이콘', '소개']), k = keyOf_(me), i = body_(sh).findIndex(r => String(r[0]) === k);
  const row = [k, String(b.icon || '').replace(/[^a-z0-9]/g, '').slice(0, 8), "'" + String(b.intro || '').slice(0, 60)];
  if (i >= 0) sh.getRange(i + 2, 1, 1, 3).setValues([row]); else sh.appendRow(row);
}
// 공개한 작품: 「공개」 탭 [사람 열쇠, 목록, id]. 시트 원래 목록 탭은 건드리지 않음
function pubs_() { const sh = ss_().getSheetByName(PUB_TAB_); return sh ? body_(sh).map((r, i) => ({ k: String(r[0]), list: String(r[1]), id: String(r[2]), row: i + 2 })) : []; }
// 하나(id) 또는 여러 개(ids)를 한 번에: 읽기 한 번, 추가는 한 번에 쓰고, 지우기는 아래 줄부터
function setPub_(me, b) {
  const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(String).slice(0, 2000);
  if (!LISTS[b.list] || !ids.length || ids.some(id => !id || id.startsWith('s:'))) throw new Error('입력값 오류');
  const sh = tab_(PUB_TAB_, ['사람', '목록', 'id']), k = keyOf_(me), mine = {};
  pubs_().filter(r => r.k === k && r.list === b.list).forEach(r => { mine[r.id] = r.row; });
  if (b.on) { const add = ids.filter((id, i) => !mine[id] && ids.indexOf(id) === i).map(id => [k, b.list, id]); if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 3).setValues(add); }
  else ids.map(id => mine[id]).filter(Boolean).sort((x, y) => y - x).forEach(r => sh.deleteRow(r));
}
// 여러 기록을 한 번에 저장·삭제 (선택해서 상태 바꾸기·삭제·옮기기)
function listOp_(me, o) {
  if (!/^list(Save|Delete)$/.test(o.action) || String((o.item || {}).id || o.id).startsWith('s:')) throw new Error('입력값 오류');
  if (me.role === 'friend') return o.action === 'listSave' ? fListSave_(me, o.list, o.item) : fListDelete_(me, o.list, o.id);
  return o.action === 'listSave' ? listSave_(o.list, o.item) : listDelete_(o.list, o.id);
}
// 친구 집 구경: 친구가 공개한 기록만 (함께한 사람·비용은 빼고)
const HOUSE_LISTS_ = ['book', 'escape', 'board', 'movie', 'play', 'buy', 'escapeWant', 'boardWant', 'movieWant', 'playWant'];
function house_(me, name) {
  const folks = folks_(), t = Object.keys(folks).find(x => folks[x] === String(name || ''));
  if (!t || !friendKeys_(keyOf_(me), rels_(), folks).includes(t)) throw new Error('입력값 오류: 친구가 된 사람의 집만 놀러 갈 수 있어요');
  const pub = {}, recs = t === 'owner' ? null : fRecs_();
  pubs_().filter(r => r.k === t).forEach(r => { pub[r.list + ':' + r.id] = 1; });
  const items = {};
  HOUSE_LISTS_.forEach(k => {
    const all = t === 'owner' ? listRead_(k) : recs.filter(r => r.code === t && r.list === k).map(r => r.item);
    items[k] = all.filter(it => pub[k + ':' + it.id]).map(it => { const o = Object.assign({}, it); delete o.with; delete o.cost; delete o.quotes; return o; });
  });
  return { name: folks[t], ...(houses_()[t] || {}), items };
}
// 「함께한 사람」 칸에 이름이 있으면 태그된 것 (쉼표·가운뎃점·띄어쓰기로 나눔)
// 같은 작품인지: 제목(띄어쓰기·대소문자 무시). 보드게임은 여러 번 하니 날짜도 같아야 (한쪽에 날짜가 없으면 같은 걸로)
const sameWork_ = (k, a, b) => { const key = (LISTS[k] || {}).key, f = v => String(v || '').replace(/\s+/g, '').toLowerCase();
  return !!key && !!f(a[key]) && f(a[key]) === f(b[key]) && (k !== 'board' || !a.date || !b.date || String(a.date) === String(b.date)); };
const tagged_ = (item, name) => !!name && String(item.with || '').split(/[,·、/&+\s]+/).map(x => x.trim()).includes(name);
function fRecs_() { return body_(ss_().getSheetByName(FREC_TAB_)).map(r => { let o = {}; try { o = JSON.parse(r[3]); } catch (e) {} return { code: String(r[0]), list: String(r[1]), id: String(r[2]), item: o }; }); }
function fListSave_(me, k, item) {
  if (!LISTS[k] || !item || !item.id || String(item.id).startsWith('s:')) throw new Error('입력값 오류');
  const sh = tab_(FREC_TAB_, ['코드', '목록', 'id', '내용', '수정일']), rows = body_(sh);
  const i = rows.findIndex(r => String(r[0]) === me.code && String(r[1]) === k && String(r[2]) === String(item.id));
  const old = i >= 0 ? (() => { try { return JSON.parse(rows[i][3]); } catch (e) { return {}; } })() : {};
  const merged = JSON.stringify(Object.assign(old, item)); // 평가만 바꿀 때처럼 일부만 와도 나머지는 그대로
  if (merged.length > 45000) throw new Error('입력값 오류: 너무 길어요');
  const row = [me.code, k, String(item.id), merged, new Date()];
  if (i >= 0) sh.getRange(i + 2, 1, 1, 5).setValues([row]); else sh.appendRow(row);
}
function fListDelete_(me, k, id) {
  const sh = ss_().getSheetByName(FREC_TAB_), rows = body_(sh);
  const i = rows.findIndex(r => String(r[0]) === me.code && String(r[1]) === k && String(r[2]) === String(id));
  if (i >= 0) sh.deleteRow(i + 2);
}
// 목록 읽기: 내 기록 + 남이 나를 태그한 기록(읽기 전용, shared = 기록한 사람 이름)
function listsFor_(me) {
  const lists = {}, fr = friends_(), nameOf = c => (fr.find(f => f.code === c) || {}).name || '친구', recs = fRecs_();
  Object.keys(LISTS).forEach(k => { lists[k] = me.role === 'owner' ? listRead_(k) : recs.filter(r => r.code === me.code && r.list === k).map(r => r.item); });
  // 친구가 나를 태그한 기록: 내가 이미 같은 작품을 기록했으면 따로 안 띄우고 내 기록에 그 친구 평가만 붙임 (others)
  const share = (k, it, by, from) => {
    const mine = lists[k] = lists[k] || [], hit = mine.find(x => sameWork_(k, x, it));
    if (hit) return (hit.others = hit.others || []).push({ name: by, rating: it.rating || it.stars || '', review: it.review || '' });
    mine.push(Object.assign({}, it, { id: 's:' + from + ':' + it.id, shared: by }));
  };
  if (me.name) {
    const folks = folks_(), fk = friendKeys_(keyOf_(me), rels_(), folks); // 친구가 된 사람의 태그만
    if (me.role === 'friend' && ownerName_() && fk.includes('owner')) Object.keys(LISTS).forEach(k => listRead_(k).filter(it => tagged_(it, me.name)).forEach(it => share(k, it, ownerName_(), 'owner')));
    recs.filter(r => r.code !== me.code && fk.includes(r.code) && tagged_(r.item, me.name)).forEach(r => share(r.list, r.item, nameOf(r.code), r.code));
  }
  const pub = {}; pubs_().filter(r => r.k === keyOf_(me)).forEach(r => { pub[r.list + ':' + r.id] = 1; });
  Object.keys(lists).forEach(k => lists[k].forEach(it => { if (pub[k + ':' + it.id]) it.pub = true; }));
  return lists;
}
// 친구 습관 (틱틱 없이): 앱이 틱틱 습관과 같은 모양으로 받음
function fHabits_(me) {
  return body_(ss_().getSheetByName(FHAB_TAB_)).filter(r => String(r[0]) === me.code).map(r => {
    let done = []; try { done = JSON.parse(r[5] || '[]'); } catch (e) {}
    return { id: String(r[1]), name: String(r[2]), icon: String(r[3]), color: String(r[4]) || '#3182f6', rule: 'RRULE:FREQ=DAILY', enc: '', total: done.length, done, local: true };
  });
}
function fHabit_(me, b) {
  const sh = tab_(FHAB_TAB_, ['코드', 'id', '이름', '아이콘', '색', '한 날', '만든 날']), rows = body_(sh);
  const i = rows.findIndex(r => String(r[0]) === me.code && String(r[1]) === String(b.habitId));
  if (b.action === 'habitAdd') {
    const name = String(b.name || '').trim().slice(0, 40);
    if (!name || !/^h[0-9a-f-]{8,40}$/.test(String(b.habitId))) throw new Error('입력값 오류');
    if (i < 0) sh.appendRow([me.code, String(b.habitId), "'" + name, String(b.icon || '⭐').slice(0, 4), /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#3182f6', '[]', new Date()]);
    return;
  }
  if (i < 0) throw new Error('입력값 오류: 없는 습관');
  if (b.action === 'habitDelete') return sh.deleteRow(i + 2);
  if (!/^\d{8}$/.test(String(b.stamp))) throw new Error('입력값 오류');
  let done = []; try { done = JSON.parse(rows[i][5] || '[]'); } catch (e) {}
  done = done.filter(x => x !== Number(b.stamp)); if (b.done) done.push(Number(b.stamp));
  sh.getRange(i + 2, 6).setValue(JSON.stringify(done));
}
// 주인만: 내 이름 정하기, 친구 초대(접속코드 발급), 초대 취소
// 이름(아이디) 바꾸기: 주인·게스트 모두. 띄어쓰기 없이, 다른 사람과 겹치지 않게
function setName_(me, b) {
  const n = String(b.name || '').trim().slice(0, 20);
  if (!n || /[,·、/&+\s]/.test(n)) throw new Error('입력값 오류: 이름은 띄어쓰기 없이');
  if (n !== me.name && people_().includes(n)) throw new Error('입력값 오류: 이미 있는 이름이에요');
  if (me.role === 'owner') { PropertiesService.getScriptProperties().setProperty('OWNER_NAME', n); return { name: n }; }
  const sh = ss_().getSheetByName(FRIEND_TAB_), i = body_(sh).findIndex(r => String(r[1]) === me.code);
  sh.getRange(i + 2, 1).setValue("'" + n); return { name: n };
}
function invite_(b) {
  const sh = tab_(FRIEND_TAB_, ['이름', '접속코드', '만든 날']);
  if (b.action === 'uninvite') { const i = body_(sh).findIndex(r => String(r[1]) === String(b.code)); if (i >= 0) sh.deleteRow(i + 2); return {}; }
  const name = String(b.name || '').trim().slice(0, 20);
  if (!name || /[,·、/&+\s]/.test(name)) throw new Error('입력값 오류: 이름은 띄어쓰기 없이');
  if (people_().includes(name)) throw new Error('입력값 오류: 이미 있는 이름');
  const code = newId_('f', 11), invite = newId_('i', 9);
  sh.getRange(1, 1, 1, 5).setValues([['이름', '접속코드', '만든 날', '초대ID', '비밀번호']]);
  sh.appendRow(["'" + name, code, new Date(), invite, pwHash_(code, FIRST_PW_)]);
  return { code, invite };
}
const OWNER_ONLY_ = ['save', 'delete', 'recSave', 'recDelete', 'budget', 'cardGoal', 'invite', 'uninvite'];

// 보드게임 이름으로 코리아보드게임즈 검색 → 앞의 6개 [이름, 이미지, 가격]. 검색 화면 안의 상품 목록(searchPrdList)을 읽음
// shortcut: 사이트 화면 구조가 바뀌면 빈 목록이 됨
function boardSearch_(q) {
  q = String(q || '').trim().slice(0, 40);
  if (q.length < 1) return [];
  const html = UrlFetchApp.fetch('https://www.koreaboardgames.com/main/mainSearch?keyword=' + encodeURIComponent(q), { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } }).getContentText();
  const at = html.indexOf('var searchPrdList = ');
  if (at < 0) return [];
  // 대괄호 짝을 세어 배열 끝을 찾음 (문자열 안의 괄호는 건너뜀)
  let i = html.indexOf('[', at), depth = 0, inStr = false, end = -1;
  for (let k = i; k < html.length; k++) {
    const ch = html[k];
    if (inStr) { if (ch === '\\') k++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '[') depth++; else if (ch === ']' && --depth === 0) { end = k; break; }
  }
  let arr = []; try { arr = JSON.parse(html.slice(i, end + 1)); } catch (e) { return []; }
  const flat = t => String(t).replace(/\s+/g, '').toLowerCase(), k = flat(q);
  return arr.filter(p => p.prdNm && !/슬리브|굿즈|부품|카드\s*케이스/.test(p.prdNm)).map(p => ({
    name: String(p.prdNm).replace(/^\[[^\]]*\]\s*/, ''), image: p.prdMainImg ? 'https://cdnfile.koreaboardgames.com/' + encodeURI(String(p.prdMainImg).replace(/^\//, '')) : '', price: Number(p.unitPrice) || 0 }))
    .sort((a, b) => (flat(b.name) === k) - (flat(a.name) === k) || flat(b.name).startsWith(k) - flat(a.name).startsWith(k)).slice(0, 20); // 이름이 딱 맞는 것 먼저
}

// 영화: 키노라이츠 공개 검색 화면(robots 허용)에 함께 실려 오는 결과 → [제목, 종류, 개봉 연도, 포스터]. 영화 먼저
// shortcut: 키노라이츠 화면 구조가 바뀌면 빈 목록이 됨, 그때는 정규식만 고치기
function movieSearch_(q) {
  q = String(q || '').trim().slice(0, 40);
  if (q.length < 1) return [];
  const html = UrlFetchApp.fetch('https://kinolights.com/search?keyword=' + encodeURIComponent(q), { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } }).getContentText().replace(/\\"/g, '"');
  const re = /\{"content":\{"id":"(\d+)","titleKr":"([^"]*)","contentTypes":\[([^\]]*)\],"posterImage":(?:null|\{"id":"\d+","pathUrl":"([^"]*)")[\s\S]*?"openYear":(?:"(\d+)"|null)/g, out = [], seen = {};
  let m; while ((m = re.exec(html)) && out.length < 20) if (!seen[m[1]]) { seen[m[1]] = 1; out.push({ title: m[2], type: m[3].replace(/"/g, '').replace(/,/g, '·'), year: m[5] || '', image: m[4] || '' }); }
  return out.sort((a, b) => (b.type === '영화') - (a.type === '영화')).slice(0, 20);
}

// 책 제목으로 알라딘 검색 → 앞의 3권 [제목, 저자, 표지]. 알라딘 API 키 없이 검색 결과 화면에서 읽음
// shortcut: 알라딘 화면 구조가 바뀌면 빈 목록이 됨, 그때는 TTB API 키(무료)로 바꾸기
function bookSearch_(q) {
  q = String(q || '').trim().slice(0, 60);
  if (q.length < 2) return [];
  const html = UrlFetchApp.fetch('https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=Book&SearchWord=' + encodeURIComponent(q),
    { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } }).getContentText();
  const un = t => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
  const al = html.split('class="ss_book_box"').slice(1).map(b => {
    const t = b.match(/class="bo3"[^>]*>(?:<b>)?([^<]+)/), a = b.match(/AuthorSearch=[^>]*>([^<]+)<\/a>/), c = b.match(/<img src="(https:\/\/image\.aladin\.co\.kr\/product\/[^"]+)"/);
    return t ? { title: un(t[1]), author: a ? un(a[1]) : '', image: c ? c[1].replace(/\/cover\d*\//, '/cover500/') : '' } : null;
  }).filter(Boolean).slice(0, 20);
  if (al.length) return al;
  // 알라딘이 구글 서버 요청을 막거나 화면이 바뀌었으면 구글 도서 검색으로 (키 필요 없음)
  const g = JSON.parse(UrlFetchApp.fetch('https://www.googleapis.com/books/v1/volumes?maxResults=10&q=' + encodeURIComponent(q), { muteHttpExceptions: true }).getContentText() || '{}');
  return (g.items || []).map(v => v.volumeInfo || {}).map(v => ({ title: v.title || '', author: (v.authors || []).join(', '),
    image: ((v.imageLinks || {}).thumbnail || '').replace(/^http:/, 'https:') })).filter(b => b.title);
}

// ── 카드 결제 문자 → 거래 탭: 단축어 → 친구 서버 보관함(sms_inbox) → 여기서 가져와 기록 (5분마다 + 가계부를 열 때) ──
function smsIngest_() {
  if (friendMode_() !== 'worker' || !FRIEND_BRIDGE_) return 0;
  const r = workerCall_({ action: 'smsPull' }, true);
  if (!r.ok || !(r.items || []).length) return 0;
  const meta = meta_(), done = [], failed = [];
  r.items.forEach(x => { try { saveTx_(smsTx_(x.id, x.parsed, meta)); done.push(x.id); } catch (err) { failed.push({ id: x.id, error: String(err.message) }); } });
  if (done.length) { SpreadsheetApp.flush(); bumpVer_(); }
  workerCall_({ action: 'smsAck', done, failed }, true);
  return done.length;
}
// 해석된 문자 → 거래 한 줄. 결제수단은 카테고리 탭의 결제수단 이름에서 카드사로 찾고, 대분류는 「분류규칙」(가맹점 글자)으로
function smsTx_(id, p, meta) {
  const kw = { 롯데: /롯데/, 현대: /현대/, 국민: /국민|KB/i }[p.card];
  const pay = (meta.payments.find(x => kw && kw.test(x[0])) || [])[0] || p.card + '카드';
  const m = String(p.merchant || ''), majors = [...new Set(meta.cats.map(c => c[0]))];
  const rule = meta.rules.find(r => r[0] && m.toLowerCase().includes(String(r[0]).toLowerCase()) && (!r[1] || r[1] === p.type) && majors.includes(r[2]));
  const major = rule ? rule[2] : (majors.find(x => /미분류|기타/.test(x)) || majors[0] || '기타');
  return { id, date: p.date, time: p.time, type: p.type, major, minor: rule ? rule[3] || '' : '', content: p.type === '환불' ? m + ' 취소' : m, pay, amount: p.amount, inst: p.inst || '',
    memo: ['문자 자동', p.currency ? p.currency + ' ' + p.foreign + (p.rate ? ' · 환율 ' + p.rate : '') : ''].filter(Boolean).join(' · ') };
}
function smsTick() { if (friendMode_() === 'worker') withLock_(() => smsIngest_()); } // 5분마다 (시간 트리거)
function ensureSmsTrigger_() {
  const props = PropertiesService.getScriptProperties(); if (props.getProperty('SMS_TRIGGER')) return;
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'smsTick')) ScriptApp.newTrigger('smsTick').timeBased().everyMinutes(5).create();
  props.setProperty('SMS_TRIGGER', '1');
}

function rows_(name, cols) {
  const sh = ss_().getSheetByName(name);
  return !sh || sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, cols).getValues();
}
// 카드 실적: 결제수단 이름에 match(정규식 글자)가 들어 있으면 그 카드. goal = 이번 달 채워야 할 실적(원), 0이면 미설정
// 스크립트 속성 CARD_GOALS에 [{name, match, goal}]로 저장 (시트 탭은 건드리지 않음)
const CARDS_DEFAULT_ = [{ name: '롯데카드', match: '롯데', goal: 0 }, { name: '현대카드', match: '현대', goal: 0 }, { name: '국민카드', match: '국민|KB', goal: 0 }];
function cards_() {
  try { const v = JSON.parse(PropertiesService.getScriptProperties().getProperty('CARD_GOALS') || 'null'); if (Array.isArray(v) && v.length) return v; } catch (e) {}
  return CARDS_DEFAULT_.map(c => Object.assign({}, c));
}
const cardOf_ = (cards, pay) => cards.find(c => new RegExp(c.match, 'i').test(String(pay || '')));
function cardGoal_(b) {
  const cs = cards_(), c = cs.find(x => x.name === String(b.name || ''));
  if (!c) throw new Error('입력값 오류: 없는 카드');
  c.goal = Math.max(0, Math.round(num_(b.goal)));
  PropertiesService.getScriptProperties().setProperty('CARD_GOALS', JSON.stringify(cs));
}
function meta_() {
  const c = rows_('카테고리', 9);
  const budgets = {};
  c.forEach(r => { if (r[3] && r[4] !== '') budgets[String(r[3])] = num_(r[4]); });
  return {
    cats: c.filter(r => r[0]).map(r => [String(r[0]), String(r[1])]),
    budgets,
    cards: cards_(),
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
function daily() { if (!ledgerOn_()) withLock_(runRecurring_); } // 가계부가 서버에 있으면 반복은 서버가

// ── 취미 목록 (독서·방탈출·보드게임·영화·연극): 이 가계부 파일 안의 탭 ──
// 열은 "제목 줄의 글자"로 찾아요. 시트에 열을 끼워 넣어도 자동으로 맞춰져요.
// f: 필드 → [열 제목, 종류, 제목이 없을 때 쓸 열 번호]. 열이 없으면 그 필드는 건너뜀
// image: 표지·포스터 열 (=IMAGE("주소") 수식이나 http 주소를 읽어서 앱에 보여 줌)
const LISTS = {
  book: { tab: '독서 기록', head: 1, key: 'title', idHead: 'id', no: '번호', f: {
    year: ['기록 시기'], month: ['', '', 3], seq: ['순번', 'num'], title: ['책 제목'], author: ['저자'], status: ['독서 상태'],
    stars: ['별점'], review: ['한 줄 리뷰'], memo: ['메모'], image: ['표지'], quotes: ['밑줄 문장'] }, auto: ['quotes'] },
  buy: { tab: '구매 목록', head: 1, key: 'title', idHead: 'id', no: '번호', f: {
    title: ['책 제목'], author: ['저자'], done: ['구매 완료', 'bool'], memo: ['메모'], image: ['표지'] } },
  wish: { tab: '추천·관심 도서', head: 1, key: 'title', idHead: 'id', no: '번호', f: {
    title: ['책 제목'], author: ['저자'], kind: ['구분'], memo: ['메모'], image: ['표지'] } },
  escape: { tab: '방탈출 기록', head: 3, key: 'theme', idHead: 'id', f: {
    date: ['방문일', 'date'], theme: ['테마'], image: ['포스터'], shop: ['매장'], area: ['지역'], result: ['결과'], people: ['인원', 'num'],
    hints: ['힌트 수', 'num'], left: ['남은 시간(분)', 'num'], cost: ['비용(원)', 'num'], rating: ['평점(1~5)'], with: ['함께한 사람'], review: ['후기'] } },
  board: { tab: '보드게임 기록', head: 1, key: 'name', idHead: '기록 ID', f: {
    date: ['날짜', 'date'], kind: ['종류'], name: ['테마·보드게임'], place: ['장소'], with: ['함께한 사람'], review: ['후기'], rating: ['평점'], image: ['이미지'] } },
  movie: { tab: '영화 기록', head: 1, key: 'title', idHead: 'id', no: '번호', f: {
    title: ['영화 제목'], director: ['감독'], date: ['관람일', 'date'], place: ['극장'], rating: ['평점'], with: ['함께한 사람'], review: ['후기'], image: ['포스터'] } },
  play: { tab: '연극·뮤지컬 기록', head: 1, key: 'title', idHead: 'id', no: '번호', f: {
    title: ['작품명'], kind: ['종류'], date: ['관람일', 'date'], place: ['극장'], cast: ['출연'], rating: ['평점'], with: ['함께한 사람'], review: ['후기'], image: ['포스터'] } },
  // 보고 싶어요: 탭이 없으면 처음 저장할 때 만듦
  escapeWant: { tab: '가고 싶은 방탈출', head: 1, key: 'theme', idHead: 'id', create: ['테마', '매장', '지역', '메모', '포스터', 'id'], f: { theme: ['테마'], shop: ['매장'], area: ['지역'], memo: ['메모'], image: ['포스터'] } },
  boardWant: { tab: '해 보고 싶은 보드게임', head: 1, key: 'name', idHead: 'id', create: ['보드게임', '메모', '이미지', 'id'], f: { name: ['보드게임'], memo: ['메모'], image: ['이미지'] } },
  movieWant: { tab: '보고 싶은 영화', head: 1, key: 'title', idHead: 'id', create: ['제목', '메모', '포스터', 'id'], f: { title: ['제목'], memo: ['메모'], image: ['포스터'] } },
  playWant: { tab: '보고 싶은 공연', head: 1, key: 'title', idHead: 'id', create: ['제목', '종류', '메모', '포스터', 'id'], f: { title: ['제목'], kind: ['종류'], memo: ['메모'], image: ['포스터'] } },
};
// 제목 줄에서 각 필드의 열 번호를 찾음 (없으면 0)
function listMap_(sh, c) {
  const head = sh.getRange(c.head, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(v => String(v).trim());
  const col = name => { const i = head.indexOf(name); return i < 0 ? 0 : i + 1; };
  const m = {};
  for (const k in c.f) {
    const [name, type, fixed] = c.f[k];
    m[k] = { col: name ? col(name) : (fixed || 0), type: type || '' };
  }
  m.__id = col(c.idHead);
  m.__no = c.no ? col(c.no) : 0;
  if (!m.__id) throw new Error('목록 탭 "' + c.tab + '"에 "' + c.idHead + '" 열이 없어요');
  if (!m[c.key].col) throw new Error('목록 탭 "' + c.tab + '"의 열 이름을 확인해 주세요');
  return m;
}
function listSheet_(k, read) {
  const c = LISTS[k];
  if (!c) throw new Error('알 수 없는 목록');
  let sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(c.tab);
  if (!sh && c.create && read) return null; // 아직 안 만든 「보고 싶어요」 탭은 읽을 땐 빈 목록
  if (!sh && c.create) { sh = SpreadsheetApp.getActiveSpreadsheet().insertSheet(c.tab); sh.getRange(1, 1, 1, c.create.length).setValues([c.create]); }
  if (!sh) throw new Error('탭 없음: ' + c.tab);
  return { sh, c, m: listMap_(sh, c) };
}
function listLast_(sh, c, m) {
  const a = sh.getRange(1, m[c.key].col, sh.getMaxRows(), 1).getValues();
  for (let i = a.length - 1; i >= c.head; i--) if (a[i][0] !== '') return i + 1;
  return c.head;
}
function listIds_(sh, c, m, last) {
  if (last <= c.head) return [];
  const r = sh.getRange(c.head + 1, m.__id, last - c.head, 1), v = r.getValues();
  let changed = false;
  v.forEach(x => { if (!x[0]) { x[0] = Utilities.getUuid(); changed = true; } });
  if (changed) r.setValues(v);
  return v.map(x => String(x[0]));
}
// 독서 별점 칸은 시트 규칙상 ★~★★★★★만 받으므로, 앱의 이모지 5단계와 ★ 개수를 서로 바꿔 씀
const STARS_ = ['😫', '😕', '😐', '🙂', '😍'];
const toStars_ = v => { const k = STARS_.indexOf(String(v)); return k < 0 ? v : '★'.repeat(k + 1); };
const fromStars_ = v => /^★{1,5}$/.test(String(v)) ? STARS_[String(v).length - 1] : v;
// =IMAGE("주소") 수식에서 주소 꺼내기
const imgOf_ = f => { const m = String(f || '').match(/IMAGE\(\s*"([^"]+)"/i); return m ? m[1] : ''; };
function listRead_(k) {
  const ls = listSheet_(k, true);
  if (!ls) return [];
  const { sh, c, m } = ls, last = listLast_(sh, c, m), ids = listIds_(sh, c, m, last);
  if (!ids.length) return [];
  const n = last - c.head, vals = sh.getRange(c.head + 1, 1, n, sh.getLastColumn()).getValues();
  const imgCol = m.image ? m.image.col : 0;
  const forms = imgCol ? sh.getRange(c.head + 1, imgCol, n, 1).getFormulas() : [];
  return vals.map((r, i) => {
    const o = { id: String(r[m.__id - 1]) };
    for (const f in c.f) {
      if (f === 'image' || !m[f].col) continue;
      const x = r[m[f].col - 1], t = m[f].type;
      o[f] = t === 'bool' ? x === true : t === 'num' ? (x === '' ? '' : num_(x)) : t === 'date' ? fmt_(x, 'yyyy-MM-dd') : String(x == null ? '' : x);
      if (f === 'stars') o[f] = fromStars_(o[f]);
    }
    const raw = imgCol ? String(r[imgCol - 1]) : '';
    o.image = imgOf_(forms[i] && forms[i][0]) || (/^https?:\/\//.test(raw) ? raw : '');
    return o;
  }).filter(o => o[c.key] !== '');
}
function listSave_(k, item) {
  const { sh, c, m } = listSheet_(k);
  if (!item || !item.id || !String(item[c.key] || '').trim()) throw new Error('입력값 오류');
  const last = listLast_(sh, c, m), idx = listIds_(sh, c, m, last).indexOf(String(item.id));
  const row = idx >= 0 ? c.head + 1 + idx : last + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
  (c.auto || []).forEach(f => { // 새로 생긴 칸(밑줄 문장 등)은 제목 줄 맨 끝에 열을 만들어 씀
    if (!(f in item) || m[f].col) return;
    const col = sh.getLastColumn() + 1;
    if (col > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
    sh.getRange(c.head, col).setValue(c.f[f][0]); m[f].col = col;
  });
  for (const f in c.f) {
    if (!(f in item) || !m[f].col) continue;
    if (f === 'image') { if (/^https:\/\//.test(String(item.image))) sh.getRange(row, m.image.col).setValue(String(item.image).slice(0, 500)); continue; } // 앱은 바꾼 https 주소만 보냄
    const t = m[f].type, x = f === 'stars' ? toStars_(item[f]) : item[f];
    sh.getRange(row, m[f].col).setValue(t === 'bool' ? x === true : t === 'num' ? (x === '' || x == null ? '' : num_(x))
      : t === 'date' ? (/^\d{4}-\d{2}-\d{2}$/.test(x) ? x : '') : txt_(x, f === 'quotes' ? 20000 : 1000));
  }
  if (idx < 0 && m.__no) sh.getRange(row, m.__no).setValue((row > c.head + 1 ? num_(sh.getRange(row - 1, m.__no).getValue()) : 0) + 1);
  sh.getRange(row, m.__id).setValue(String(item.id));
}
function listDelete_(k, id) {
  const { sh, c, m } = listSheet_(k), idx = listIds_(sh, c, m, listLast_(sh, c, m)).indexOf(String(id));
  if (idx < 0) return;
  const row = c.head + 1 + idx;
  const cols = Object.keys(c.f).map(f => m[f].col).filter(Boolean).concat(m.__no ? [m.__no] : []);
  const lastC = Math.max(...cols);
  // 목록 칸만 위로 당김 (같은 열 바깥의 요약 표는 건드리지 않음)
  sh.getRange(row, 1, 1, lastC).deleteCells(SpreadsheetApp.Dimension.ROWS);
  if (m.__id > lastC) sh.getRange(row, m.__id).deleteCells(SpreadsheetApp.Dimension.ROWS);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ── 틱틱 습관 (공식 API엔 습관이 없어 틱틱 웹이 쓰는 내부 API를 사용) ──
// 편집기 왼쪽 ⚙ 프로젝트 설정 → 스크립트 속성에 TICKTICK_USER(이메일)·TICKTICK_PASS(비밀번호)를 넣으세요. 코드·깃허브엔 남지 않아요
// shortcut: 내부 API라 틱틱이 바꾸면 끊길 수 있음, 공식 API에 습관이 생기면 그걸로 교체
const TT = 'https://api.ticktick.com/api/v2';
const props_ = () => PropertiesService.getScriptProperties();
const oid_ = () => (Math.floor(Date.now() / 1000).toString(16) + Utilities.getUuid().replace(/-/g, '')).slice(0, 24);
const stamp_ = d => Number(fmt_(d, 'yyyyMMdd'));
function ttHead_() {
  const p = props_();
  let dev = p.getProperty('TT_DEVICE');
  if (!dev) { dev = oid_(); p.setProperty('TT_DEVICE', dev); }
  return { 'User-Agent': 'Mozilla/5.0 (rv:145.0) Firefox/145.0', 'X-Device': JSON.stringify({ platform: 'web', version: 6430, id: dev }) };
}
function ttLogin_() {
  const p = props_(), u = p.getProperty('TICKTICK_USER'), pw = p.getProperty('TICKTICK_PASS');
  if (!u || !pw) throw new Error('틱틱 계정이 없어요 · 스크립트 속성에 TICKTICK_TOKEN 또는 TICKTICK_USER·TICKTICK_PASS를 넣으세요');
  const r = UrlFetchApp.fetch(TT + '/user/signon?wc=true&remember=true', {
    method: 'post', contentType: 'application/json', headers: ttHead_(), payload: JSON.stringify({ username: u, password: pw }), muteHttpExceptions: true });
  let d = {}; try { d = JSON.parse(r.getContentText()); } catch (e) {}
  if (!d.token) throw new Error(d.authId ? '틱틱 2단계 인증이 켜져 있어 로그인할 수 없어요' : '틱틱 로그인 실패 · 이메일·비밀번호를 확인하세요');
  p.setProperty('TT_TOKEN', d.token);
  return d.token;
}
// 구글 로그인 계정은 비밀번호가 없어서, 브라우저 쿠키 t 값을 스크립트 속성 TICKTICK_TOKEN에 넣어도 됨
function tt_(path, body) {
  const p = props_(), own = p.getProperty('TICKTICK_TOKEN');
  for (let i = 0; i < 2; i++) {
    const t = p.getProperty('TT_TOKEN') || own || ttLogin_();
    const o = { method: body ? 'post' : 'get', headers: Object.assign(ttHead_(), { Cookie: 't=' + t }), muteHttpExceptions: true };
    if (body) { o.contentType = 'application/json'; o.payload = JSON.stringify(body); }
    const r = UrlFetchApp.fetch(TT + path, o), c = r.getResponseCode();
    if (c === 401 || c === 403) { // 세션 만료 → 다시 로그인
      if (t === own && !p.getProperty('TICKTICK_PASS')) throw new Error('틱틱 로그인 실패 · TICKTICK_TOKEN이 만료됐어요, 쿠키 t를 다시 복사해 넣으세요');
      p.deleteProperty('TT_TOKEN'); if (t === own) p.deleteProperty('TICKTICK_TOKEN'); continue;
    }
    if (c >= 300) throw new Error('틱틱 응답 오류 ' + c + ' ' + r.getContentText().replace(/\s+/g, ' ').slice(0, 120));
    const s = r.getContentText();
    return s ? JSON.parse(s) : {};
  }
  throw new Error('틱틱 로그인 실패 · 이메일·비밀번호를 확인하세요');
}
// 편집기에서 이 함수를 한 번 실행: 외부 접속 권한 승인 + 틱틱 로그인 확인 (실행 로그에 습관 이름이 나오면 성공)
function testTickTick() { const h = habits_(); Logger.log('틱틱 습관 %s개: %s', h.length, h.map(x => x.name).join(', ')); }
const ckStamp_ = c => Number(c.checkinStamp || c.stamp);
function habits_() {
  const hs = tt_('/habits').filter(h => h.status === 0).sort((a, b) => a.sortOrder - b.sortOrder); // status 0 = 보관 안 한 습관
  const q = hs.length ? tt_('/habitCheckins/query', { habitIds: hs.map(h => h.id), afterStamp: stamp_(new Date(Date.now() - 371 * 864e5)) }).checkins || {} : {};
  return hs.map(h => ({
    id: h.id, name: h.name, color: h.color || '#4772fa', icon: h.iconRes || '', rule: h.repeatRule || '', enc: h.encouragement || '',
    total: h.totalCheckIns || 0, done: (q[h.id] || []).filter(c => c.status === 2).map(ckStamp_),
  }));
}
function habitCheck_(habitId, stamp, done) {
  if (!/^[0-9a-f]{24}$/.test(String(habitId)) || !/^\d{8}$/.test(String(stamp))) throw new Error('입력값 오류');
  stamp = Number(stamp);
  const list = (tt_('/habitCheckins/query', { habitIds: [habitId], afterStamp: stamp - 1 }).checkins || {})[habitId] || [];
  const cur = list.find(c => ckStamp_(c) === stamp);
  if (!done) { if (cur) tt_('/habitCheckins/batch', { add: [], update: [], delete: [cur.id] }); return; }
  if (cur && cur.status === 2) return;
  // 틱틱 내부 API가 받는 시간 형식이 바뀌어 500이 나는 경우가 있어, 형식을 바꿔 가며 한 번씩 시도 (성공한 형식은 기억)
  const d = new Date(), id = cur ? cur.id : oid_();
  const forms = [
    () => { const t = Utilities.formatDate(d, 'UTC', "yyyy-MM-dd'T'HH:mm:ss.000+0000"); return { checkinTime: t, opTime: t }; },
    () => { const t = Utilities.formatDate(d, 'UTC', "yyyy-MM-dd'T'HH:mm:ss+0000"); return { checkinTime: t, opTime: t }; },
    () => ({}),
  ];
  const p = props_(), first = Number(p.getProperty('TT_FORM') || 0);
  let err;
  for (const k of [first, 0, 1, 2].filter((x, i, a) => a.indexOf(x) === i)) {
    const c = Object.assign({ id, habitId, checkinStamp: stamp, value: 1, goal: 1, status: 2 }, forms[k]());
    try {
      tt_('/habitCheckins/batch', cur ? { add: [], update: [c], delete: [] } : { add: [c], update: [], delete: [] });
      if (k !== first) p.setProperty('TT_FORM', String(k));
      return;
    } catch (e) { err = e; if (!/응답 오류 5/.test(e.message)) throw e; }
  }
  throw err;
}

// 잠금화면 위젯용 요약 (전체 거래를 보내지 않아 빠름): 오늘·이번 달 지출(환불 차감, 이체 제외)과 남은 예산
function summary_() {
  const sh = tx_(), last = last_(sh), today = fmt_(new Date(), 'yyyy-MM-dd'), m = today.slice(0, 7);
  const v = last < 2 ? [] : sh.getRange(2, 1, last - 1, 9).getValues();
  let day = 0, month = 0;
  const cards = cards_().map(c => Object.assign({ spent: 0 }, c));
  v.forEach(r => {
    const d = fmt_(r[0], 'yyyy-MM-dd');
    if (!d.startsWith(m)) return;
    const n = r[2] === '지출' ? num_(r[8]) : r[2] === '환불' ? -num_(r[8]) : 0;
    month += n; if (d === today) day += n;
    const c = n && cardOf_(cards, r[7]); if (c) c.spent += n; // H열 결제수단
  });
  const budget = rows_('카테고리', 5).reduce((s, r) => s + (r[3] ? num_(r[4]) : 0), 0);
  const [y, mo, dd] = today.split('-').map(Number), daysLeft = new Date(y, mo, 0).getDate() - dd + 1;
  // 오늘 써도 되는 돈 = (예산 - 어제까지 쓴 돈) ÷ 오늘 포함 남은 날
  const daily = budget ? Math.max(0, Math.round((budget - (month - day)) / daysLeft)) : 0;
  return { ok: true, date: today, today: day, month, budget, left: budget - month, daily, cards: cards.map(c => ({ name: c.name, goal: c.goal, spent: c.spent })) };
}

// ── 2단계: 가계부 원본을 친구 서버(D1)로. 시트는 한 시간마다 채우는 백업·보기용 ──
// LEDGER_TARGET_ = 'd1': 주인이 가계부를 처음 열 때 한 번 옮기고(건수·합계가 맞을 때만) 켬
// 되돌리기: 'sheet'로 바꿔 배포 → 다음에 열 때 D1 → 시트로 마지막 백업 후 시트가 다시 원본
const LEDGER_TARGET_ = 'd1';
const LEDGER_ACTS_ = ['save', 'delete', 'recSave', 'recDelete', 'budget', 'cardGoal'];
const ledgerMode_ = () => props_().getProperty('LEDGER_MODE') || 'sheet';
const ledgerOn_ = () => ledgerMode_() === 'd1' && LEDGER_TARGET_ === 'd1';
function ledgerSwitch_() {
  const p = props_(), mode = ledgerMode_();
  if (LEDGER_TARGET_ === 'd1' && mode !== 'd1' && ownerWorker_()) {
    const c = cache_(); if (c && c.get('LEDGER_TRY')) return; // 실패하면 10분 뒤에 다시
    if (c) c.put('LEDGER_TRY', '1', 600);
    ledgerMigrate_();
  } else if (LEDGER_TARGET_ !== 'd1' && mode === 'd1') {
    ledgerBackup_(); workerRequired_({ action: 'ledgerDeactivate' }); p.setProperty('LEDGER_MODE', 'sheet');
  }
}
function ledgerMigrate_() {
  const p = props_(), sh = tx_(), last = last_(sh); ids_(sh, last);
  const v = last < 2 ? [] : sh.getRange(2, 1, last - 1, ID_COL).getValues();
  // 복사한 줄 등으로 id가 겹치면 새 id를 줌 (겹치면 서버에서 한 줄로 합쳐져 건수가 안 맞음)
  const seen = {}, idCol = v.map(r => [r[ID_COL - 1]]); let fixed = false;
  idCol.forEach(x => { if (x[0] !== '' && seen[x[0]]) { x[0] = Utilities.getUuid(); fixed = true; } seen[x[0]] = 1; });
  if (fixed) sh.getRange(2, ID_COL, idCol.length, 1).setValues(idCol);
  const rows = []; let sum = 0;
  v.forEach((r, i) => {
    if (r[0] === '') return;
    const x = { id: String(idCol[i][0]), date: fmt_(r[0], 'yyyy-MM-dd'), time: tm_(r[1]), type: String(r[2]), major: String(r[3]), minor: String(r[4]), content: String(r[5]),
      pay: String(r[7]), amount: Math.round(num_(r[8])), memo: String(r[9]), orig: String(r[10]), inst: num_(r[11]) >= 2 ? Math.round(num_(r[11])) : 0, seq: i + 1 };
    rows.push(x); sum += x.amount;
  });
  const m = meta_(), meta = { cats: m.cats, payments: m.payments, rules: m.rules, budgets: m.budgets, budgetMajors: budgetMajors_(), recurring: m.recurring, cards: m.cards };
  for (let i = 0; i === 0 || i < rows.length; i += 500)
    workerRequired_(Object.assign({ action: 'ledgerImport', reset: i === 0, rows: rows.slice(i, i + 500) }, i === 0 ? { meta, recRun: p.getProperty('REC_RUN') || '' } : {}));
  const got = workerRequired_({ action: 'ledgerVerify' });
  if (got.count !== rows.length || got.sum !== sum) throw new Error('가계부 옮기기 확인 실패 · 시트 ' + rows.length + '건 ' + sum + '원 / 서버 ' + got.count + '건 ' + got.sum + '원');
  if (!ss_().getSheetByName('거래 (옮기기 전)')) sh.copyTo(ss_()).setName('거래 (옮기기 전)'); // 옮기기 직전 그대로 한 장 남겨 둠 (백업이 거래 탭을 다시 쓰기 전)
  workerRequired_({ action: 'ledgerActivate' });
  p.setProperty('LEDGER_MODE', 'd1'); p.deleteProperty('LEDGER_BACKUP_VER'); p.deleteProperty('LEDGER_ERR');
  ensureLedgerTrigger_();
}
const budgetMajors_ = () => rows_('카테고리', 5).filter(r => r[3]).map(r => String(r[3]));
// 시트에서 고친 카테고리·결제수단·분류규칙(+카테고리 탭을 고쳤으면 예산)을 서버에 알림
function pushLedgerMeta_(withBudgets) {
  const m = meta_();
  workerRequired_(Object.assign({ action: 'ledgerMeta', cats: m.cats, payments: m.payments, rules: m.rules, budgetMajors: budgetMajors_() }, withBudgets ? { budgets: m.budgets } : {}));
}
// 서버 → 시트 백업: 거래 탭(A~F, H~L, P열만. 수식 열 G·M~O는 그대로), 카테고리 예산(E열), 반복 탭, 카드 실적
function ledgerBackup_() {
  const p = props_(), r = workerRequired_({ what: 'ledgerExport', ver: p.getProperty('LEDGER_BACKUP_VER') || '' });
  if (r.same || !r.active) return 0;
  const sh = tx_(), last = last_(sh), n = r.rows.length;
  if (last - 1 > 50 && n < (last - 1) * 0.9) throw new Error('백업 멈춤: 서버 거래(' + n + '건)가 시트(' + (last - 1) + '건)보다 너무 적어요'); // 이상하면 시트를 덮지 않음
  if (n + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), n + 1 - sh.getMaxRows());
  if (n) {
    sh.getRange(2, 1, n, 6).setValues(r.rows.map(x => [x.date, x.time, x.type, txt_(x.major), txt_(x.minor), txt_(x.content)]));
    sh.getRange(2, 8, n, 5).setValues(r.rows.map(x => [txt_(x.pay), x.amount, txt_(x.memo, 500), txt_(x.orig), x.inst >= 2 ? x.inst : '']));
    sh.getRange(2, ID_COL, n, 1).setValues(r.rows.map(x => [String(x.id)]));
  }
  if (last > n + 1) [[1, 6], [8, 5], [ID_COL, 1]].forEach(([c, w]) => sh.getRange(n + 2, c, last - n - 1, w).clearContent());
  const cat = ss_().getSheetByName('카테고리');
  if (cat && cat.getLastRow() > 1) {
    const d = cat.getRange(2, 4, cat.getLastRow() - 1, 2).getValues();
    d.forEach(x => { if (x[0] && r.meta.budgets[String(x[0])] !== undefined) x[1] = r.meta.budgets[String(x[0])]; });
    cat.getRange(2, 4, d.length, 2).setValues(d);
  }
  const rs = rec_(), rec = r.meta.recurring.map(x => [x.id, txt_(x.content), x.type, txt_(x.major), txt_(x.minor), txt_(x.pay), x.amount, x.day, x.start, x.end || '', x.done || '']);
  if (rs.getLastRow() > 1) rs.getRange(2, 1, rs.getLastRow() - 1, REC_HEAD.length).clearContent();
  if (rec.length) rs.getRange(2, 1, rec.length, REC_HEAD.length).setValues(rec);
  if (r.meta.cards.length) p.setProperty('CARD_GOALS', JSON.stringify(r.meta.cards));
  p.setProperty('LEDGER_BACKUP_VER', String(r.ver));
  return n;
}
function ledgerTick() { // 한 시간마다 (시간 트리거)
  if (!ledgerOn_()) return;
  withLock_(() => { pushLedgerMeta_(false); ledgerBackup_(); });
}
function ensureLedgerTrigger_() {
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'ledgerTick')) ScriptApp.newTrigger('ledgerTick').timeBased().everyHours(1).create();
}
// 편집기에서 바로 백업하고 싶을 때 실행
function ledgerBackupNow() { props_().deleteProperty('LEDGER_BACKUP_VER'); withLock_(() => Logger.log('시트에 쓴 거래: %s건', ledgerBackup_())); }

// Deployment injects the bridge credentials. Copies of this script default to Sheets.
const FRIEND_WORKER_ = '';
const FRIEND_BRIDGE_ = '';
const friendMode_ = () => PropertiesService.getScriptProperties().getProperty('FRIEND_MODE');
const waitFriends_ = () => ({ok:false,retry:true,error:'친구 서버를 전환하고 있어요. 잠시 후 다시 시도해 주세요.'});
function workerCall_(request, owner) {
  const body = Object.assign({}, request);
  if (owner) delete body.token;
  try {
    const r = UrlFetchApp.fetch(FRIEND_WORKER_, {method:'post',contentType:'application/json',payload:JSON.stringify(body),
      headers:owner ? {Authorization:'Bearer '+FRIEND_BRIDGE_} : {},muteHttpExceptions:true,followRedirects:false});
    if (r.getResponseCode() === 200) return JSON.parse(r.getContentText());
  } catch (_) {}
  return {ok:false,retry:true,error:'친구 서버에 연결하지 못했어요'};
}
function workerRequired_(b) {
  const r = workerCall_(b,true);
  if (!r.ok) throw new Error(r.retry ? '친구 서버 연결을 다시 시도해 주세요' : '입력값 오류: '+r.error);
  return r;
}
function friendControl_(b) {
  if (!FRIEND_BRIDGE_ || b.proof !== FRIEND_BRIDGE_ || !(authOk_(b.token) || pwOk_(b.token))) return {ok:false};
  if(b.command==='baseline' && !['freeze','worker'].includes(friendMode_())) {
    const sample=friends_()[0];
    if(!sample) return {ok:true,sample:false};
    if(!['me','lists','habits'].includes(b.what)) return {ok:false};
    const data=JSON.parse(doGet({parameter:{token:sample.code,what:b.what}}).getContent());
    return {ok:data.ok,sample:true};
  }
  return withLock_(()=>{
    const props=PropertiesService.getScriptProperties(), mode=friendMode_() || 'sheets';
    if (b.command==='status') return {ok:true,mode};
    if (b.command==='freeze' && mode==='sheets') {
      installProjectionTriggers_();
      props.setProperty('FRIEND_MODE','freeze');
    } else if (b.command==='resumeSheets' && mode==='freeze') props.setProperty('FRIEND_MODE','sheets');
    else if (b.command==='activate' && mode==='freeze') {
      const state=workerRequired_({action:'cutoverStatus'});
      if (!state.active) return {ok:false};
      props.setProperty('FRIEND_MODE','worker');
    } else return {ok:false};
    return {ok:true,mode:friendMode_()};
  });
}
function ownerListsWithTags_() {
  const extra=workerRequired_({what:'ownerOverlay'}), lists={};
  for(const k of Object.keys(LISTS)) {
    lists[k]=listRead_(k);
    const published=new Set(extra.publications.filter(p=>p.list===k).map(p=>p.id));
    for(const item of lists[k]) if(published.has(item.id)) item.pub=true;
    for(const {item,from,name} of extra.tags.filter(t=>t.list===k)) {
      const hit=lists[k].find(x=>sameWork_(k,x,item));
      if(hit) (hit.others || (hit.others=[])).push({name,rating:item.rating||item.stars||'',review:item.review||''});
      else lists[k].push({...item,id:'s:'+from+':'+item.id,shared:name});
    }
  }
  return {ok:true,lists,people:extra.people};
}
function refreshOwnerProjection_() {
  const ctx=workerRequired_({what:'projectionContext'});
  const published=new Set(ctx.publications.map(p=>JSON.stringify([p.list,p.id]))), records=[];
  for(const k of Object.keys(LISTS)) {
    for(const item of listRead_(k)) {
      const tag=ctx.people.some(name=>tagged_(item,name));
      if (!tag && !published.has(JSON.stringify([k,item.id]))) continue;
      if (!tag) {delete item.with; delete item.quotes; delete item.cost;}
      records.push({list:k,item});
    }
  }
  workerRequired_({action:'replaceProjection',records});
}
function repairFriendProjection_() {
  if (friendMode_()==='worker') withLock_(()=>refreshOwnerProjection_());
}
function editedFriendProjection_(e) {
  if(e && e.range && ['카테고리','분류규칙'].includes(e.range.getSheet().getName()) && ledgerOn_()) { try { withLock_(()=>pushLedgerMeta_(e.range.getSheet().getName()==='카테고리')); } catch (_) {} }
  if(friendMode_()!=='worker' || !e || !e.range || !Object.values(LISTS).some(c=>c.tab===e.range.getSheet().getName())) return;
  withLock_(()=>{workerRequired_({action:'replaceProjection',records:[]});refreshOwnerProjection_();});
}
function installProjectionTriggers_() {
  const names=ScriptApp.getProjectTriggers().map(t=>t.getHandlerFunction());
  if(!names.includes('editedFriendProjection_')) ScriptApp.newTrigger('editedFriendProjection_').forSpreadsheet(ss_()).onEdit().create();
  if(!names.includes('repairFriendProjection_')) ScriptApp.newTrigger('repairFriendProjection_').timeBased().everyHours(1).create();
}
const friendActions_=['invite','uninvite','setName','setPassword','setHouse','setPub','report','friendRequest','friendAccept','friendRemove','listSave','listDelete','bulk','habitAdd','habitCheck','habitDelete'];
function bridgeWrite_(b, owner) {
  if(b.what || !friendActions_.includes(b.action)) return {ok:false,error:'입력값 오류: 허용되지 않은 동작'};
  if(!owner) return workerCall_(b,false);
  if(['listSave','listDelete','bulk','setPub'].includes(b.action)) {
    // Hide the old projection before changing originals. A failed rebuild remains private and can be retried.
    workerRequired_({action:'replaceProjection',records:[]});
    if(b.action==='setPub') workerRequired_(b);
    else for(const op of (b.action==='bulk'?b.ops:[b])) listOp_({role:'owner'},op);
    SpreadsheetApp.flush();
    refreshOwnerProjection_();
    return {ok:true,wrote:true};
  }
  if(b.action==='setPassword') return {ok:true,wrote:true,...setPassword_({role:'owner'},b)};
  const r=workerCall_(b,true);
  if(r.ok && b.action==='setName') PropertiesService.getScriptProperties().setProperty('OWNER_NAME',r.name);
  return r;
}

function doGet(e) {
  if (e.parameter.op) { // 저장 작업을 GET으로 받은 경우
    let b;
    try { b = JSON.parse(e.parameter.op); } catch (err) { return out_({ ok: false, error: '잘못된 요청' }); }
    b.token = e.parameter.token;
    return writeOp_(b);
  }
  const mode=friendMode_(), owner=authOk_(e.parameter.token), what=e.parameter.what;
  const rotated=owner ? renewSession_(e.parameter.token, what==='me') : '';
  if(mode==='freeze' && (!owner || ['me','lists','house'].includes(what))) return out_(waitFriends_());
  let me;
  if(mode==='worker') {
    if(what==='movie') return out_(workerCall_({what,q:e.parameter.q,token:e.parameter.token},owner));
    if(what==='book') { const r=workerCall_({what,q:e.parameter.q,token:e.parameter.token},owner); if(r.ok && r.books) return out_(r); } // 카카오 도서, 안 되면 아래 알라딘
    if(!owner && ['book','board','escape'].includes(what)) {
      const identity=workerCall_({what:'me',token:e.parameter.token},false);
      if(!identity.ok) return out_(identity);
      me={role:'friend',name:identity.name};
    } else if(!owner || ['me','house'].includes(what)) {
      if(!['me','house','lists','habits'].includes(what)) return out_({ok:false,error:'친구 코드로는 볼 수 없어요'});
      const r=workerCall_({what,token:e.parameter.token,name:e.parameter.name},owner);
      if(r.ok && what==='me') r.workerUrl=FRIEND_WORKER_; // 주인도 책·영화 검색은 친구 서버로 바로
      if(r.ok && rotated) r.token=rotated;
      if(r.ok && owner && what==='me') r.ledger=ledgerMode_();
      return out_(r);
    } else if(what==='lists') {
      try{return out_(withLock_(()=>ownerListsWithTags_()));}catch(_){return out_(waitFriends_());}
    } else me={role:'owner',name:ownerName_(),code:''};
  } else me=who_(e.parameter.token);
  if (!me) return out_({ ok: false, error: '비밀번호가 맞지 않습니다' });
  try {
    if (e.parameter.what === 'me') {
      if (me.role === 'owner') ensureInvites_();
      return out_({ ok: true, ...(rotated && { token: rotated }), role: me.role, name: me.name, people: myPeople_(me), social: social_(me), friends: me.role === 'owner' ? friends_().map(f => ({ name: f.name, code: f.code, invite: f.invite })) : undefined });
    }
    if (me.role === 'friend' && !['escape', 'book', 'board', 'movie', 'habits', 'lists', 'house'].includes(e.parameter.what)) return out_({ ok: false, error: '친구 코드로는 가계부를 볼 수 없어요' });
    if (e.parameter.what === 'summary') return out_(ledgerOn_() ? workerCall_({ what: 'summary' }, true) : summary_()); // 읽기만 해서 잠금 불필요
    if (e.parameter.what === 'escape') return out_({ ok: true, themes: escapeSearch_(e.parameter.q), ...escapeStatus_() }); // 방탈출 테마 검색 (목록 탭에서)
    if (e.parameter.what === 'board') return out_({ ok: true, games: cached_('QG2:' + String(e.parameter.q || '').trim().slice(0, 80), 21600, false, () => boardSearch_(e.parameter.q)) }); // 코리아보드게임즈 검색
    if (e.parameter.what === 'house') return out_({ ok: true, house: cached_('HS:' + keyOf_(me) + ':' + String(e.parameter.name || '').slice(0, 20), 300, e.parameter.fresh === '1', () => house_(me, e.parameter.name)) }); // 친구 집 놀러 가기
    if (e.parameter.what === 'movie') return out_({ ok: true, movies: cached_('QM2:' + String(e.parameter.q || '').trim().slice(0, 80), 21600, false, () => movieSearch_(e.parameter.q)) }); // 키노라이츠 검색
    if (e.parameter.what === 'book') return out_({ ok: true, books: cached_('QB2:' + String(e.parameter.q || '').trim().slice(0, 80), 21600, false, () => bookSearch_(e.parameter.q)) }); // 알라딘 검색 (시트 안 건드림)
    const fresh = e.parameter.fresh === '1';
    if (e.parameter.what === 'habits') return out_({ ok: true, habits: cached_('H:' + (me.code || 'owner'), 300, fresh, () => me.role === 'owner' ? habits_() : fHabits_(me)) }); // 주인은 틱틱, 친구는 시트
    if (e.parameter.what === 'lists') {
      return out_({ ok: true, ...cached_('L:' + (me.code || 'owner'), 600, fresh, () => withLock_(() => ({ lists: listsFor_(me), people: myPeople_(me) }))) });
    }
    // since=날짜: 그날 이후 거래만 보내고, 그 이전 줄은 지문(old.h)만 보냄 → 앱은 지문이 같으면 가진 것을 그대로 씀
    // full=1이면 전부 보냄. 할부 진행 같은 수식 값도 지문에 들어가서, 바뀌면 앱이 전체를 다시 받음
    const since = /^\d{4}-\d{2}-\d{2}$/.test(e.parameter.since || '') ? e.parameter.since : '';
    const fromD1 = () => workerCall_({ what: 'ledger', since, full: e.parameter.full || '' }, true);
    if (me.role === 'owner' && ledgerOn_()) return out_(fromD1());
    return out_(withLock_(() => {
      if (me.role === 'owner') {
        try { ledgerSwitch_(); } catch (err) { props_().setProperty('LEDGER_ERR', String(err.message).slice(0, 300)); }
        if (ledgerOn_()) return fromD1();
      }
      try { smsIngest_(); ensureSmsTrigger_(); } catch (err) {} // 카드 문자 보관함에 새 결제가 있으면 먼저 거래 탭에 (실패해도 보관함에 남아 다음에 다시)
      // 반복 거래 채우기는 하루 한 번이면 충분 (매번 돌려서 느렸음). 반복 규칙을 바꾸면 다시 돎
      const props = PropertiesService.getScriptProperties(), day = fmt_(new Date(), 'yyyy-MM-dd');
      if (props.getProperty('REC_RUN') !== day) { runRecurring_(); props.setProperty('REC_RUN', day); }
      const sh = tx_(), last = last_(sh);
      ids_(sh, last);
      const v = (last < 2 ? [] : sh.getRange(2, 1, last - 1, ID_COL).getValues()).filter(r => r[0] !== '');
      const recent = r => fmt_(r[0], 'yyyy-MM-dd') >= since;
      const full = !since || e.parameter.full === '1';
      const old = since ? { since, h: Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(v.filter(r => !recent(r))))) } : null;
      const items = (full ? v : v.filter(recent)).map(r => ({
        id: String(r[15]), date: fmt_(r[0], 'yyyy-MM-dd'), time: tm_(r[1]), type: String(r[2]), major: String(r[3]), minor: String(r[4]),
        content: String(r[5]), payType: String(r[6]), pay: String(r[7]), amount: num_(r[8]), memo: String(r[9]),
        inst: num_(r[11]) || '', instState: String(r[12]),
      }));
      return { ok: true, items, full, old, meta: meta_() };
    }));
  } catch (err) {
    return out_({ ok: false, error: err.message, retry: true });
  }
}

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: '잘못된 요청' }); }
  if(b.action==='friendCutover') {
    try{return out_(friendControl_(b));}catch(_){return out_({ok:false,error:'전환 설정을 확인해 주세요'});}
  }
  // 예전 앱(비밀번호·접속코드를 들고 있음) → 출입증으로 바꾸기. 주인 비밀번호는 로그인과 같은 횟수 제한
  if(b.action==='session') {
    const t=String(b.token||'');
    if(/^s[of]\./.test(t)) return out_({ok:false,error:'입력값 오류: 이미 출입증이에요'});
    if(Date.now()<LEGACY_UNTIL_ && pwOk_(t)) return out_({ok:true,role:'owner',name:ownerName_(),token:newSession_()});
    if(friendMode_()==='worker') return out_(workerCall_(b,false));
    return out_({ok:false,error:'다시 로그인해 주세요'});
  }
  if(b.action==='logout' || b.action==='logoutAll') {
    if(authOk_(b.token)) return out_(/^so\./.test(String(b.token)) || b.action==='logoutAll' ? endSessions_(String(b.token),b.action==='logoutAll') : {ok:true,wrote:true});
    if(friendMode_()==='worker') return out_(workerCall_(b,false));
    return out_({ok:true,wrote:true});
  }
  if(['login','redeem'].includes(b.action) && friendMode_()==='worker') {
    const name=String(b.name||'').trim(), ownerName=ownerName_();
    if(b.action==='login' && name && (ownerName===name || (!ownerName && pwOk_(b.password)))) {
      const cache=cache_(), key='fail:'+name, failures=Number(cache && cache.get(key) || 0);
      if(failures>=10) return out_({ok:false,error:'너무 많이 틀렸어요 · 10분 뒤에 다시 해 주세요'});
      if(!pwOk_(b.password)) {
        if(cache) cache.put(key,String(failures+1),600);
        return out_({ok:false,error:'아이디 또는 비밀번호가 맞지 않아요'});
      }
      if(!ownerName){
        const r=workerCall_({action:'setName',name},true);
        if(!r.ok) return out_(r);
        PropertiesService.getScriptProperties().setProperty('OWNER_NAME',name);
      }
      if(cache) cache.remove(key);
      return out_({ok:true,role:'owner',token:newSession_(),name});
    }
    const r=workerCall_(b,false);
    if(r.ok) r.workerUrl=FRIEND_WORKER_;
    return out_(r);
  }
  if(['login','redeem'].includes(b.action) && friendMode_()==='freeze') return out_(waitFriends_());
  if (b.action === 'login' || b.action === 'redeem') { // 로그인은 토큰 없이
    try { return out_({ ok: true, ...withLock_(() => b.action === 'login' ? login_(b) : redeem_(b)) }); } catch (err) { return out_({ ok: false, error: err.message }); }
  }
  if (b.action === 'ocr') return out_({ ok: false, error: '사진은 이제 기기에서 읽어요. 앱을 새로고침해 주세요.' });
  return writeOp_(b);
}
// 저장 작업 (POST 본문, 또는 아이폰에서 POST가 끊길 때 GET ?op=로도 받음). wrote:true = 실제로 처리했다는 표시
function writeOp_(b) {
  const owner=authOk_(b.token);
  if(owner && LEDGER_ACTS_.includes(b.action) && ledgerOn_()) { // 가계부가 서버에 있으면 서버에 바로 씀
    const r=workerCall_(Object.assign({},b),true);
    return out_(r.ok ? Object.assign(r,{wrote:true}) : r);
  }
  const sheetOwner=owner && ['save','delete','recSave','recDelete','budget','cardGoal','habitCheck'].includes(b.action);
  if(!sheetOwner && ['freeze','worker'].includes(friendMode_())) {
    try{return out_(withLock_(()=>friendMode_()==='worker'?bridgeWrite_(b,owner):waitFriends_()));}
    catch(err){return out_({ok:false,retry:!String(err.message).startsWith('입력값 오류'),error:String(err.message)});}
  }
  const me = who_(b.token);
  if (!me) return out_({ ok: false, error: '비밀번호가 맞지 않습니다' });
  if (me.role === 'friend' && OWNER_ONLY_.includes(b.action)) return out_({ ok: false, error: '입력값 오류: 친구 코드로는 할 수 없어요' });
  let res = {};
  try {
    withLock_(() => {
      if(!sheetOwner && ['freeze','worker'].includes(friendMode_())) throw new Error('친구 서버 전환 중 · 다시 시도해 주세요');
      if(LEDGER_ACTS_.includes(b.action) && ledgerOn_()) throw new Error('가계부를 서버로 옮겼어요 · 다시 보내 주세요'); // 기다리는 동안 옮겨졌으면 시트에 쓰지 않음
      if (b.action === 'setName') res = setName_(me, b);
      else if (/^friend(Request|Accept|Remove)$/.test(b.action)) res = { social: friendOp_(me, b) };
      else if (b.action === 'setHouse') setHouse_(me, b);
      else if (b.action === 'report') report_(me, b);
      else if (b.action === 'setPub') setPub_(me, b);
      else if (b.action === 'bulk') (Array.isArray(b.ops) ? b.ops : []).slice(0, 300).forEach(o => listOp_(me, o));
      else if (/^(invite|uninvite)$/.test(b.action)) res = invite_(b);
      else if (b.action === 'setPassword') res = setPassword_(me, b);
      else if (me.role === 'friend' && b.action === 'listSave') fListSave_(me, b.list, b.item);
      else if (me.role === 'friend' && b.action === 'listDelete') fListDelete_(me, b.list, b.id);
      else if (me.role === 'friend' && /^habit(Check|Add|Delete)$/.test(b.action)) fHabit_(me, b);
      else if (b.action === 'save') saveTx_(b.item);
      else if (b.action === 'delete') deleteTx_(b.id);
      else if (b.action === 'recSave') saveRec_(b.rule);
      else if (b.action === 'recDelete') deleteRec_(b.id);
      else if (b.action === 'budget') budget_(b.major, b.amount);
      else if (b.action === 'cardGoal') cardGoal_(b);
      else if (/^list(Save|Delete)$/.test(b.action) && String((b.item || {}).id || b.id).startsWith('s:')) throw new Error('입력값 오류: 친구가 남긴 기록은 바꿀 수 없어요');
      else if (b.action === 'listSave') listSave_(b.list, b.item);
      else if (b.action === 'listDelete') listDelete_(b.list, b.id);
      else if (b.action === 'habitCheck') habitCheck_(b.habitId, b.stamp, b.done);
      else throw new Error('알 수 없는 동작');
      SpreadsheetApp.flush(); // 시트 규칙 위반 같은 오류를 여기서 잡아 글로 돌려줌 (안 그러면 오류 페이지가 가서 앱엔 Load failed로 보임)
    });
    if (!/^(save|delete|recSave|recDelete|budget)$/.test(b.action)) bumpVer_(); // 목록·습관·친구가 바뀌면 캐시 새로
    if (/^rec(Save|Delete)$/.test(b.action)) PropertiesService.getScriptProperties().setProperty('REC_RUN', ''); // 새 반복 규칙은 다음 불러오기 때 바로 채움
    return out_({ ok: true, wrote: true, ...res });
  } catch (err) {
    // 잠금 대기 초과 같은 일시적 오류는 앱이 다시 보내도록 retry 표시
    return out_({ ok: false, error: err.message, retry: !/입력값|알 수 없는|없는 대분류|탭 없음|틱틱|규칙/.test(err.message) });
  }
}

// ── 새로 쓰는 사람(친구)용 ──
// 1) 빈 구글 시트의 Apps Script에 이 파일을 붙여넣고 setupSheet 실행 → 필요한 탭과 비밀번호를 만들어 줌 (이미 있는 탭은 건드리지 않음)
// 2) 웹 앱으로 배포한 뒤 appLink 실행 → 실행 로그에 나온 링크를 아이폰 사파리로 열면 연결 끝
const PAY_F = `={"결제유형";ARRAYFORMULA(IF(H2:H="","",IFERROR(VLOOKUP(H2:H,'카테고리'!$H$2:$I,2,0),"미지정")))}`;
const INST_R = `LET(r,(YEAR(TODAY())*12+MONTH(TODAY()))-(YEAR(A2:A)*12+MONTH(A2:A))+1,`;
const TABS_ = {
  '거래': [['날짜', '시간', '구분', '대분류', '소분류', '내용', PAY_F, '결제수단', '금액', '메모', '원본분류', '할부(개월)',
    `={"할부 진행";ARRAYFORMULA(IF(IFERROR(L2:L*1,0)<2,"",${INST_R}IF(r>L2:L,"완료",r&"/"&L2:L&"회차"))))}`,
    `={"남은 개월";ARRAYFORMULA(IF(IFERROR(L2:L*1,0)<2,"",${INST_R}IF(r>L2:L,0,L2:L-r))))}`,
    `={"할부 총액";ARRAYFORMULA(IF(IFERROR(L2:L*1,0)<2,"",I2:I*L2:L))}`, 'id']],
  '카테고리': [['대분류', '소분류', '', '대분류', '월 예산', '메모', '', '결제수단', '결제유형']],
  '분류규칙': [['키워드', '적용구분', '대분류', '소분류'], ['쿠팡이츠', '지출', '식비', '배달'], ['배달의민족', '지출', '식비', '배달'],
    ['스타벅스', '지출', '카페·간식', '카페'], ['택시', '지출', '교통', '택시'], ['GS25', '지출', '생활', '편의점'], ['CU', '지출', '생활', '편의점']],
  '독서 기록': [['번호', '기록 시기', '', '순번', '표지', '책 제목', '저자', '독서 상태', '별점', '메모', '한 줄 리뷰', 'id']],
  '구매 목록': [['번호', '책 제목', '저자', '구매 완료', '메모', '표지', 'id']],
  '추천·관심 도서': [['번호', '책 제목', '저자', '구분', '메모', '표지', 'id']],
  '방탈출 기록': [[''], ['총 진행 테마 수', '=COUNTA(B4:B)&" 개"'],
    ['방문일', '테마', '포스터', '매장', '지역', '결과', '인원', '힌트 수', '남은 시간(분)', '비용(원)', '평점(1~5)', '함께한 사람', '후기', '', 'id']],
  '보드게임 기록': [['기록 ID', '날짜', '종류', '테마·보드게임', '장소', '함께한 사람', '후기', '평점', '이미지']],
  '영화 기록': [['번호', '영화 제목', '감독', '관람일', '극장', '평점', '함께한 사람', '후기', 'id', '포스터']],
  '연극·뮤지컬 기록': [['번호', '작품명', '종류', '관람일', '극장', '출연', '평점', '함께한 사람', '후기', 'id', '포스터']],
};
const CATS_ = { 식비: ['외식', '배달', '장보기'], '카페·간식': ['카페', '베이커리·디저트'], '술·유흥': ['술집'], 생활: ['편의점', '생활용품', '온라인쇼핑'],
  교통: ['대중교통', '택시'], 자동차: ['주유', '주차·통행료'], '주거·통신': ['주거비', '공과금', '통신비'], '의료·건강': ['병원', '약국'],
  '의복·미용': ['의류·잡화', '미용'], '문화·여가': ['취미·놀이', '공연·전시', '여행·숙박'], 구독: ['앱·멤버십'], '선물·경조사': ['선물', '경조사비'],
  교육: ['교육'], 기타: ['미분류'], 수입: ['급여', '부수입', '기타수입'], 이체: ['내 계좌 이동', '송금'] };
const PAYS_ = [['현금', '현금·계좌'], ['계좌이체', '현금·계좌'], ['체크카드', '카드'], ['신용카드', '카드'], ['간편결제', '간편결제']];
function setupSheet() {
  const ss = ss_(), made = [];
  Object.keys(TABS_).forEach(name => {
    if (ss.getSheetByName(name)) return;
    const sh = ss.insertSheet(name), rows = TABS_[name], w = Math.max(...rows.map(r => r.length));
    rows.forEach((r, i) => r.forEach((v, j) => { if (v === '') return; const c = sh.getRange(i + 1, j + 1); String(v).startsWith('=') ? c.setFormula(v) : c.setValue(v); }));
    sh.setFrozenRows(rows.length); sh.getRange(rows.length, 1, 1, w).setFontWeight('bold');
    if (name === '카테고리') {
      const cats = []; Object.keys(CATS_).forEach(k => CATS_[k].forEach(m => cats.push([k, m])));
      sh.getRange(2, 1, cats.length, 2).setValues(cats);
      const majors = Object.keys(CATS_); sh.getRange(2, 4, majors.length, 1).setValues(majors.map(k => [k]));
      sh.getRange(2, 8, PAYS_.length, 2).setValues(PAYS_);
    }
    if (name === '거래') sh.getRange('A:A').setNumberFormat('yyyy-mm-dd');
    made.push(name);
  });
  const p = props_();
  if (!p.getProperty('APP_TOKEN') && TOKEN === PLACEHOLDER) p.setProperty('APP_TOKEN', Utilities.getUuid().replace(/-/g, '').slice(0, 12));
  const first = ss.getSheets()[0]; if (first.getName() !== '거래' && first.getLastRow() === 0 && ss.getSheets().length > 1 && /^(시트|Sheet)\d+$/.test(first.getName())) ss.deleteSheet(first);
  Logger.log('만든 탭: %s', made.join(', ') || '없음 (이미 다 있음)');
  Logger.log('이제 배포 → 새 배포 → 웹 앱(실행: 나, 액세스: 모든 사용자)으로 배포한 뒤 appLink를 실행하세요.');
}
// 시트를 넘겨받은 사람(예: 대신 세팅해 준 친구에게서)이 실행: 비밀번호를 새로 만들어 이전 사람이 알던 비밀번호를 무효로 하고, 연결 링크를 보여 줌
// 먼저 「배포 → 새 배포 → 웹 앱(실행: 나, 액세스: 모든 사용자)」을 한 뒤 실행하세요
function resetPassword() {
  props_().setProperty('APP_TOKEN', Utilities.getUuid().replace(/-/g, '').slice(0, 12));
  Logger.log('새 비밀번호를 만들었어요. 예전 비밀번호와 링크는 이제 쓸 수 없어요.');
  appLink();
}
// 배포한 뒤 실행: 아이폰에서 열 연결 링크를 실행 로그에 보여 줌 (이 링크 = 내 가계부 열쇠이니 남에게 보내지 마세요)
function appLink() {
  const url = ScriptApp.getService().getUrl(), token = props_().getProperty('APP_TOKEN') || TOKEN;
  if (!url) return Logger.log('아직 웹 앱으로 배포하지 않았어요. 배포 → 새 배포 → 웹 앱으로 먼저 배포하세요.');
  Logger.log('아이폰 사파리에서 이 링크를 열고 공유 → 홈 화면에 추가:\n%s', 'https://bab-works.github.io/bab-zip/#url=' + url + '&token=' + encodeURIComponent(token));
}
