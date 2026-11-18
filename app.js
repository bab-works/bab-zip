const $ = s => document.querySelector(s);
const APP_VERSION = 'gagyebu-v92'; // sw.js의 CACHE와 같아야 함 (tests/version.js가 확인)
const TYPES = ['지출', '수입', '환불', '이체'];
const SHOW_MAX = 300; // 내역은 최대 300건만 그림 (검색·필터로 좁히면 됨)
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
// 내 시트 웹 앱 주소 (주소만으로는 읽고 쓸 수 없고 비밀번호가 함께 있어야 함) → 링크엔 비밀번호만: …/#token=비밀번호
const SHEET_URL = 'https://script.google.com/macros/s/AKfycbzZWDgLW1AFlZbCGTgzWH0uZAs660hNJOh4YHzyqXFu4kZtyzUP_VWOBzj0T5PDBtxM/exec';
let cfg = store.get('cfg', { url: '', token: '' });
if (!cfg.url) cfg.url = SHEET_URL;
// 설정 링크(…/#url=웹앱URL&token=비밀번호)로 열면 연결 정보를 저장. 폰이 저장소를 지워도 이 링크로 열면 다시 연결됨
// (홈 화면 앱은 사파리와 저장소가 따로라서, 앱 안에서도 ⚙에 링크를 붙여넣을 수 있게 함)
function cfgFrom(hash) {
  const h = new URLSearchParams(hash), url = h.get('url') || SHEET_URL, token = h.get('token');
  return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url) && token ? { url, token } : null;
}
const fromLink = cfgFrom(location.hash.slice(1));
if (fromLink) { cfg = fromLink; store.set('cfg', cfg); }
navigator.storage?.persist?.(); // 브라우저가 저장 데이터를 임의로 지우지 않게 요청
// 누구로 연결했나: 주인(가계부까지) / 친구(접속코드, 취미 기록·습관만). 시트에 물어보기 전엔 코드 모양(f + 11자리)으로 짐작
let me = store.get('me', {});
const isFriend = () => me.token === cfg.token ? me.role === 'friend' : /^f[0-9a-f]{11}$/.test(cfg.token || '');
const people = () => (me.token === cfg.token && me.people) || [];
// 시트(원본)의 화면용 사본. meta = 카테고리·예산·결제수단·분류규칙·반복
let data = store.get('data2', { items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } });
let pending = store.get('pending', []); // 아직 시트에 못 보낸 작업 (오프라인 대비, 순서대로 전송)

// 자랑하기 모드: 금액은 전부 ••로 가리고, 거래 내용·결제수단은 흐리게 (화면 캡처해서 자랑해도 안전)
let brag = store.get('brag', false);
const won = n => brag ? '••,•••원' : Math.round(n).toLocaleString('ko-KR') + '원';
const pad2 = n => String(n).padStart(2, '0');
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const ymAdd = (ym, n) => { const [y, m] = ym.split('-').map(Number), d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
// 달력 한 달: 요일 시작 위치·날 수와, 앞뒤 달의 흐린 날짜 칸
function monthGrid(ym) {
  const [y, mo] = ym.split('-').map(Number), first = new Date(y, mo - 1, 1).getDay(), days = new Date(y, mo, 0).getDate(), pd = new Date(y, mo - 1, 0).getDate();
  const other = d => `<span class="other" aria-hidden="true">${d}</span>`;
  return { y, mo, first, days, lead: range(pd - first + 1, pd).map(other).join(''), tail: range(1, (7 - (first + days) % 7) % 7).map(other).join('') };
}
// ── 움직임 도우미 ──
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// 같은 애니메이션을 다시 재생 (클래스를 뗐다 붙임)
function replay(el, cls, dx) {
  if (!el || calm()) return;
  if (dx) el.style.setProperty('--dx', dx);
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}
// 숫자를 이전 값에서 새 값까지 굴리기
function countTo(el, to) {
  const from = +(el.dataset.n || 0); el.dataset.n = to;
  if (calm() || from === to) { el.textContent = won(to); return; }
  const t0 = performance.now(), dur = 520;
  const step = t => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = won(from + (to - from) * e); if (p < 1 && el.dataset.n == to) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
// 창 닫기: 내려가는(사라지는) 애니메이션이 끝난 뒤 실제로 닫음
const realClose = HTMLDialogElement.prototype.close;
const closeNow = d => realClose.call(d);
HTMLDialogElement.prototype.close = function (rv) {
  if (this.open && !this.classList.contains('closing')) this.dispatchEvent(new Event('closing')); // 닫히기 시작 (메뉴는 이때 본문을 제자리로)
  if (!this.open || this.classList.contains('closing') || calm()) return realClose.call(this, rv);
  this.classList.add('closing');
  setTimeout(() => { this.classList.remove('closing'); realClose.call(this, rv); }, +this.dataset.closeMs || 220);
};
// ESC·뒤로가기로 닫을 때도 같은 애니메이션
// 로그인·잠금 화면은 ESC로도 안 닫힘
document.addEventListener('cancel', e => { if (e.target instanceof HTMLDialogElement) { e.preventDefault(); if (!['login', 'lock'].includes(e.target.id)) e.target.close(); } }, true);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
// 앱 안 확인·입력 창 (아이폰 기본 알림창 대신, 앱 디자인 그대로). 확인 → true / 입력값, 취소 → false / null
// window.__askAuto는 자동 테스트가 대답할 때만 씀
function ask(msg, { ok = '확인', danger = false, input = null, type = 'text' } = {}) {
  if (window.__askAuto) return Promise.resolve(window.__askAuto(msg, input != null)).then(v => input != null ? (v === true ? input : v) : !!v);
  return new Promise(done => {
    const d = document.querySelector('#ask'), f = d.querySelector('form'), i = f.querySelector('input');
    d.querySelector('#askMsg').textContent = msg; i.hidden = input == null; i.type = type; i.value = input ?? '';
    const yes = f.querySelector('#askOk'); yes.textContent = ok; yes.classList.toggle('danger-fill', danger);
    let answered = false; const finish = v => { if (answered) return; answered = true; d.close(); done(v); };
    f.onsubmit = e => { e.preventDefault(); finish(input != null ? i.value : true); };
    d.querySelector('#askNo').onclick = () => finish(input != null ? null : false);
    d.onclose = () => finish(input != null ? null : false);
    d.showModal(); if (input != null) setTimeout(() => { i.focus(); i.select(); }, 50);
  });
}
const localISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString(); };
const persist = () => { store.set('data2', data); store.set('pending', pending); };
// 동기화·저장·삭제 완료는 잠깐 뜨는 팝업으로만, 연결 문제 같은 건 상단에 남김
let syncTimer;
const setStatus = t => {
  statusAct = ''; $('#status').classList.remove('err');
  if (/동기화됨|저장됨|삭제됨|반영됨/.test(t)) {
    $('#syncPop').textContent = t; // 화면 읽기 프로그램용 (눈에는 안 보임)
    const u = $('#reload use'); u.setAttribute('href', '#i-check'); $('#reload').classList.add('ok');
    clearTimeout(syncTimer); syncTimer = setTimeout(() => { u.setAttribute('href', '#i-sync'); $('#reload').classList.remove('ok'); }, 1400);
    $('#status').textContent = '';
    return;
  }
  $('#status').textContent = t;
};
// 오류를 쉬운 말로 바꾸고, 상태 줄을 누르면 고칠 수 있는 곳(설정·해결 방법·다시 시도)으로 연결
let statusAct = '';
function explain(e) {
  const m = String(e?.message || e || '');
  if (!navigator.onLine) return ['인터넷이 끊겼어요 · 입력은 폰에 저장되고 연결되면 보내져요', pending.length ? 'pending' : 'retry'];
  if (/닿지 못했어요|45초|알 수 없는 응답/.test(m)) return [m + ' · 눌러서 자세히', pending.length ? 'pending' : 'retry'];
  if (/비밀번호/.test(m)) return ['비밀번호가 맞지 않아요 · 눌러서 다시 입력', 'settings'];
  if (/연결하지 않았어요/.test(m)) return ['아직 내 시트에 연결하지 않았어요 · 눌러서 연결하기', 'welcome'];
  if (/틱틱/.test(m)) return [m + ' · 눌러서 해결 방법 보기', 'help-ticktick'];
  if (/배포|Code\.gs/.test(m)) return ['시트 쪽 코드가 예전 버전이에요 · 눌러서 해결 방법 보기', 'help-deploy'];
  if (/열 구성|P열|열 이름|열이 없어요|탭 없음|목록 탭/.test(m)) return ['시트 모양이 달라요: ' + m + ' · 눌러서 해결 방법 보기', 'help-sheet'];
  return [m + ' · 눌러서 자세히', pending.length ? 'pending' : 'retry'];
}
let lastErr = '';
function showError(e, where) {
  lastErr = String(e?.message || e || '');
  const [text, act] = explain(e);
  // 시트가 느리거나 잠깐 안 닿는 건 일시적: 저장 대기가 없으면 상단에 계속 띄우지 않고 한 번만 알림
  if (/45초|닿지 못했어요|Load failed|Failed to fetch/.test(lastErr) && !pending.length) {
    $('#status').textContent = ''; $('#status').classList.remove('err');
    return toast('시트가 느려서 지금은 저장된 내용을 보여 줘요 · 잠시 뒤 새로고침해 주세요');
  }
  $('#status').textContent = (where ? where + ' · ' : '') + text;
  $('#status').classList.add('err'); statusAct = act;
}
const HELP = {
  'help-ticktick': ['틱틱 연결 고치기', ['컴퓨터에서 가계부 구글 시트 → 확장 프로그램 → Apps Script를 열어요.',
    '왼쪽 ⚙ 프로젝트 설정 → 스크립트 속성에서 TICKTICK_TOKEN(구글 로그인) 또는 TICKTICK_USER·TICKTICK_PASS를 확인해요.',
    '구글 로그인이면 크롬에서 ticktick.com에 로그인 → F12 → Application → Cookies → t 값을 다시 복사해 TICKTICK_TOKEN에 넣어요.',
    '함수 목록에서 testTickTick을 골라 ▶ 실행해서 습관 이름이 나오면 성공이에요.']],
  'help-deploy': ['시트 코드를 새 버전으로', ['컴퓨터에서 가계부 구글 시트 → 확장 프로그램 → Apps Script를 열어요.',
    '최신 Code.gs 내용을 통째로 붙여넣고 저장해요.', '배포 → 배포 관리 → 연필 → 버전: 새 버전 → 배포를 눌러요. 주소는 그대로예요.']],
  'help-sheet': ['시트 제목 줄 확인', ['구글 시트에서 문제가 난 탭의 첫 줄(제목 줄)을 봐요.',
    '거래 탭은 날짜·시간·구분·대분류·소분류·내용·결제유형·결제수단·금액 … 순서이고 P열은 id예요.', '열을 옮기거나 이름을 바꿨다면 원래대로 되돌린 뒤 다시 시도해요.']],
};
function openHelp(k) {
  const [title, steps] = HELP[k];
  $('#helpTitle').textContent = title;
  $('#helpMsg').textContent = $('#status').textContent.replace(/ · 눌러서.*$/, '');
  $('#helpSteps').innerHTML = steps.map(t => `<li>${esc(t)}</li>`).join('');
  $('#help').showModal();
}
const retry = () => (sec === 'money' ? refresh() : sec === 'habit' ? refreshHabits() : refreshLists());
// 저장 대기 목록: 무엇이 막혔는지 보고, 다시 보내거나 하나씩 버림
const LIST_NAME = { book: '독서', buy: '위시리스트', wish: '추천 목록', escape: '방탈출', board: '보드게임', movie: '영화', play: '연극·뮤지컬', movieWant: '보고 싶은 영화', playWant: '보고 싶은 공연', escapeWant: '가고 싶은 방탈출', boardWant: '해 보고 싶은 보드게임' };
function opText(o) {
  const i = o.item || {};
  if (o.action === 'save') return `거래 저장 · ${i.date || ''} ${i.content || i.minor || i.major || ''} ${won(i.amount || 0)}`;
  if (o.action === 'delete') return '거래 삭제';
  if (o.action === 'recSave') return `반복 등록 · ${o.rule?.content || ''}`;
  if (o.action === 'recDelete') return '반복 삭제';
  if (o.action === 'budget') return `${o.major} 예산 ${won(o.amount)}`;
  if (o.action === 'listSave') return `${LIST_NAME[o.list] || o.list} 저장 · ${i.title || i.theme || i.name || ''}`;
  if (o.action === 'listDelete') return `${LIST_NAME[o.list] || o.list} 삭제`;
  if (o.action === 'habitCheck') return `습관 ${o.done ? '체크' : '해제'} · ${(habits.find(h => h.id === o.habitId) || {}).name || ''} ${String(o.stamp).slice(4, 6)}/${String(o.stamp).slice(6)}`;
  return o.action;
}
function renderPending() {
  $('#pendVer').textContent = '앱 버전 ' + APP_VERSION.replace('gagyebu-', '');
  $('#pendErr').textContent = pending.length ? `맨 위 항목에서 멈췄어요 · 오류: ${lastErr || '없음'}` : '보낼 것이 없어요 · 모두 시트에 저장됐어요';
  $('#pendList').innerHTML = pending.map((o, k) => `<li><span>${esc(opText(o))}</span><button type="button" class="small danger" data-k="${k}">버리기</button></li>`).join('');
  $('#pendRetry').disabled = !pending.length;
}
$('#pendList').addEventListener('click', async e => {
  const k = e.target.closest('[data-k]')?.dataset.k;
  if (k == null || !(await ask('이 항목을 시트에 보내지 않고 버릴까요?', { ok: '버리기', danger: true }))) return;
  pending.splice(+k, 1); persist(); renderPending();
  if (!pending.length) setStatus('');
});
$('#pendRetry').addEventListener('click', async () => {
  $('#pendErr').textContent = '보내는 중…';
  const ok = await sync();
  if (ok) { setStatus('시트에 저장됨'); retry(); }
  renderPending();
});
$('#pendClose').addEventListener('click', () => $('#pend').close());
$('#status').addEventListener('click', () => {
  if (statusAct === 'pending') { renderPending(); $('#pend').showModal(); return; }
  if (statusAct === 'retry') retry();
  else if (statusAct === 'settings') openConn();
  else if (statusAct === 'welcome') showLogin();
  else if (HELP[statusAct]) openHelp(statusAct);
});
$('#helpRetry').addEventListener('click', () => { $('#help').close(); retry(); });
$('#helpClose').addEventListener('click', () => $('#help').close());
let toastTimer;
// undo: 누르면 되돌리는 함수 → 토스트에 「되돌리기」 단추
function toast(t, ms = 3500, undo) {
  const el = $('#toast');
  el.textContent = t; el.classList.add('show'); el.classList.toggle('act', !!undo);
  if (undo) { const b = document.createElement('button'); b.type = 'button'; b.textContent = '되돌리기'; b.onclick = () => { el.classList.remove('show'); undo(); }; el.append(b); ms = Math.max(ms, 6000); }
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ── 시트 통신 ──
// 저장(POST)이 아이폰에서 「Load failed」로 끊기는 경우가 있어, 그러면 같은 작업을 GET(?op=)으로 다시 보냄
// 저장 작업은 모두 id로 덮어쓰는 방식이라 두 번 들어가도 중복이 생기지 않음. 한 번 GET이 통하면 다음부터 GET 먼저
async function api(body, qs = '') {
  if (!body) return call('', qs);
  const viaGet = () => call('', '&op=' + encodeURIComponent(JSON.stringify(body))).then(r => {
    if (!r.wrote) throw new Error('시트 쪽 코드가 예전 버전이에요 · Code.gs를 새 버전으로 배포해 주세요');
    return r;
  });
  if (store.get('writeViaGet')) return viaGet();
  try { return await call(body); }
  catch (e) {
    if (!e.unreached) throw e;
    try { const r = await viaGet(); store.set('writeViaGet', true); return r; }
    catch (e2) { throw Object.assign(new Error(`${e.message} · GET으로도 실패: ${e2.message}`), { unreached: e2.unreached, rejected: e2.rejected }); }
  }
}
async function call(body, qs = '') {
  if (!cfg.url || !cfg.token) throw new Error('아직 내 시트에 연결하지 않았어요');
  // 45초 넘게 답이 없으면 끊고 알려 줌 (안 그러면 아이폰이 「Load failed」만 남김)
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 45000);
  let res, text;
  try {
    res = body
      // text/plain 이어야 Apps Script가 CORS 사전요청 없이 받음
      ? await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, token: cfg.token }), signal: ctl.signal })
      : await fetch(cfg.url + '?token=' + encodeURIComponent(cfg.token) + qs, { signal: ctl.signal });
    text = await res.text();
  } catch (e) {
    throw Object.assign(new Error(e.name === 'AbortError' ? '시트가 45초 넘게 답이 없어요' : `시트에 닿지 못했어요 (${e.message})`), { unreached: e.name !== 'AbortError' });
  } finally { clearTimeout(timer); }
  let r;
  try { r = JSON.parse(text); } catch { throw new Error(`시트가 알 수 없는 응답을 보냈어요 (HTTP ${res.status}) ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}`); }
  if (!r.ok) throw Object.assign(new Error(r.error || '서버 오류'), { rejected: !r.retry && !/비밀번호/.test(r.error) });
  return r;
}
// 보내기는 한 번에 하나만: 동시에 두 번 돌면 아직 안 보낸 작업이 목록에서 지워질 수 있음
let syncing = null;
const sync = () => syncing || (syncing = sendPending().finally(() => { syncing = null; }));
async function sendPending() {
  while (pending.length) {
    try { await api(pending[0]); }
    catch (e) {
      // 시트가 내용 자체를 거부한 작업은 버림 (계속 막히지 않게). 네트워크·비밀번호 문제는 대기
      if (!e.rejected) { showError(e, `저장 대기 ${pending.length}건`); return false; }
      if (pending[0].action === 'habitCheck') { toast('틱틱에 반영하지 못했어요: ' + e.message, 6000); setTimeout(refreshHabits, 0); } // 화면을 틱틱의 실제 상태로 되돌림
      else toast('시트가 거부해서 취소됨: ' + e.message);
    }
    pending.shift();
    persist();
  }
  return true;
}
async function refresh() {
  if (isFriend()) return; // 친구 코드는 가계부 없음
  if (!cfg.token) return sec === 'money' ? render() : sec === 'habit' ? renderHabits() : renderLists(); // 연결 전엔 시트에 묻지 않음 (오류 대신 시작 화면)
  try {
    busy(true);
    document.body.classList.toggle('loading', !data.items.length);
    if (await sync()) {
      try {
        // 지난달 1일부터만 받고, 그 이전은 지문이 같으면 폰에 있는 것을 그대로 씀 (예전 줄이 바뀌었으면 전체를 다시 받음)
        const since = ymAdd(localISO().slice(0, 7), -1) + '-01';
        let r = await api(null, `&since=${since}${data.old?.since === since ? '' : '&full=1'}`);
        if (r.old && !r.full && r.old.h !== data.old.h) r = await api(null, `&since=${since}&full=1`);
        const items = r.old && !r.full ? [...data.items.filter(i => i.date < since), ...r.items] : r.items;
        data = { items, meta: r.meta, old: r.old };
        persist();
        setStatus(`시트와 동기화됨 · ${data.items.length.toLocaleString()}건`);
      } catch (e) { showError(e); }
    }
    render();
  } finally { busy(false); document.body.classList.remove('loading'); }
}
// 불러오는 동안은 문구 대신 새로고침 버튼이 회전
const setFab = hide => { $('#fab').hidden = hide; document.body.classList.toggle('nofab', hide); };
const busy = on => $('#reload').classList.toggle('spin', on);
function queue(op) {
  pending.push(op);
  persist();
  render();
  return sync().then(ok => { if (ok) setStatus('시트에 저장됨'); return ok; });
}

// ── 계산 ──
const net = i => i.type === '지출' ? i.amount : i.type === '환불' ? -i.amount : 0; // 지출은 환불 차감, 이체는 제외
const inMonth = m => data.items.filter(i => i.date.startsWith(m));
const spent = (m, major) => inMonth(m).filter(i => i.major === major).reduce((s, i) => s + net(i), 0);
const majorsAll = () => [...new Set(data.meta.cats.map(c => c[0]))];
function majorsFor(type) {
  const all = majorsAll();
  if (type === '수입' || type === '이체') return [type];
  const list = all.filter(m => m !== '수입' && m !== '이체');
  return list.length ? list : ['기타'];
}
const minorsFor = major => data.meta.cats.filter(c => c[0] === major && c[1]).map(c => c[1]);
const payments = () => data.meta.payments.map(p => p[0]);
const EMOJI = { 식비: '🍚', '카페·간식': '☕', '술·유흥': '🍺', 생활: '🧺', 교통: '🚌', 자동차: '🚗', '주거·통신': '🏠', '의료·건강': '💊',
  '의복·미용': '👕', '문화·여가': '🎬', 구독: '📺', '선물·경조사': '🎁', 교육: '📚', 기타: '📦', 수입: '💰', 이체: '🔁' };
const em = major => EMOJI[major] || '•';

function fillSelect(sel, opts, blank) {
  const v = sel.value;
  sel.innerHTML = (blank != null ? `<option value="">${esc(blank)}</option>` : '') + opts.map(o => `<option>${esc(o)}</option>`).join('');
  if ([...sel.options].some(o => o.value === v)) sel.value = v;
}
function setSel(sel, v) {
  if (!v) return;
  if (![...sel.options].some(o => o.value === v)) sel.add(new Option(v, v));
  sel.value = v;
}

// ── 예산 알림 ──
function level(used, budget) { return !budget ? 0 : used >= budget ? 2 : used >= budget * 0.8 ? 1 : 0; }
function checkBudget(m, major, before) {
  const budget = data.meta.budgets[major], after = spent(m, major), lv = level(after, budget);
  if (!budget || lv <= level(before, budget)) return;
  const msg = lv === 2
    ? `🚨 ${major} 예산 초과! ${won(after)} / ${won(budget)} (${won(after - budget)} 넘음)`
    : `⚠️ ${major} 예산 ${Math.round(after / budget * 100)}% 사용 · 남은 ${won(budget - after)}`;
  toast(msg);
  if ('Notification' in window && Notification.permission === 'granted') {
    navigator.serviceWorker?.ready.then(r => r.showNotification('가계부 예산 알림', { body: msg, icon: 'icon-192.png', tag: 'budget-' + major }));
  }
}

// ── 화면 ──
function renderHome() {
  const m = $('#month').value, list = inMonth(m);
  const inc = list.filter(i => i.type === '수입').reduce((s, i) => s + i.amount, 0);
  const exp = list.reduce((s, i) => s + net(i), 0);
  countTo($('#inc'), inc); countTo($('#exp'), exp); countTo($('#bal'), inc - exp); $('#bal').classList.toggle('out', inc - exp < 0);

  const byMajor = {};
  list.forEach(i => { if (net(i)) byMajor[i.major] = (byMajor[i.major] || 0) + net(i); });
  const b = data.meta.budgets;
  const rows = [...new Set([...Object.keys(b).filter(k => b[k] > 0), ...Object.keys(byMajor)])]
    .map(k => ({ k, used: byMajor[k] || 0, budget: b[k] || 0 }))
    .sort((x, y) => (y.budget ? y.used / y.budget : -1) - (x.budget ? x.used / x.budget : -1) || y.used - x.used);
  const total = Object.values(b).reduce((s, v) => s + (v || 0), 0);
  const cls = lv => ['', 'warn', 'over'][lv];
  const pct = (u, t) => t ? Math.min(100, u / t * 100).toFixed(1) : 0;
  const lvTxt = lv => ['', ' · ⚠️ 80% 넘음', ' · 🚨 초과'][lv];
  $('#budgets').innerHTML = rows.map(r => `<li>
      <button type="button" class="cat-open" data-cat="${esc(r.k)}" aria-label="${esc(r.k)} 내역 보기"><span class="em" aria-hidden="true">${em(r.k)}</span>
      <span>${esc(r.k)}<small class="hint">${lvTxt(level(r.used, r.budget))}</small></span></button>
      <button class="budget-btn" data-major="${esc(r.k)}" aria-label="${esc(r.k)} 예산 수정">${won(r.used)} <small>/ ${r.budget ? compact(r.budget) : '예산 없음'}</small></button>
      <span class="bar ${cls(level(r.used, r.budget))}"><i style="--w:${pct(r.used, r.budget)}%"></i></span>
    </li>`).join('') + (total ? `<li class="total"><span class="em" aria-hidden="true">Σ</span><span>전체</span>
      <span style="text-align:right">${won(exp)} <small class="hint">/ ${compact(total)}</small></span>
      <span class="bar ${cls(level(exp, total))}"><i style="--w:${pct(exp, total)}%"></i></span></li>` : '')
    || '<li class="empty">이번 달 지출 없음</li>';

  // 경고는 단계별로 한 줄씩 묶어서 (여러 개가 화면을 밀어내지 않게)
  const names = lv => rows.filter(r => level(r.used, r.budget) === lv).map(r => `${esc(r.k)} ${Math.round(r.used / r.budget * 100)}%`);
  const over = names(2), warn = names(1);
  // 예산 경고는 홈에 붙여 두지 않고 토스트로 한 번만 (같은 내용은 하루 한 번, 이번 달을 볼 때만)
  const warnTxt = [over.length && `🚨 예산 초과 ${over.length}개 · ${over.join(', ')}`, warn.length && `⚠️ 80% 넘음 ${warn.length}개 · ${warn.join(', ')}`].filter(Boolean).join('\n');
  const warnKey = localISO().slice(0, 10) + warnTxt;
  if (warnTxt && m === localISO().slice(0, 7) && store.get('warnShown') !== warnKey && !brag) { store.set('warnShown', warnKey); setTimeout(() => toast(warnTxt, 5000), 600); }
  $('#notifyBtn').hidden = !('Notification' in window) || Notification.permission !== 'default';

  // 지난달 같은 기간(이번 달이면 오늘 날짜까지)과 비교
  const [y, mo] = m.split('-').map(Number), today = localISO().slice(0, 10);
  const cut = today.startsWith(m) ? +today.slice(8) : 31, pm = ymAdd(m, -1);
  const prev = inMonth(pm).filter(i => +i.date.slice(8) <= cut).reduce((s, i) => s + net(i), 0);
  $('#cmp').textContent = prev > 0 ? `지난달 ${cut < 31 ? cut + '일까지' : '전체'} ${won(prev)} 대비 ${exp >= prev ? '▲' : '▼'} ${Math.abs(Math.round((exp - prev) / prev * 100))}%` : '';

  // 일별 지출 막대 (한 가지 색, 높이 = 그날 지출)
  const days = new Date(y, mo, 0).getDate(), per = Array(days).fill(0);
  list.forEach(i => { per[+i.date.slice(8) - 1] += net(i); });
  const max = Math.max(1, ...per);
  $('#daily').innerHTML = per.map((v, d) => `<button type="button" data-d="${d + 1}" class="${v > 0 ? '' : 'zero'}" aria-pressed="${d + 1 === dailySel}"
    aria-label="${mo}월 ${d + 1}일 지출 ${won(v)}"><i style="--h:${v > 0 ? (v / max * 100).toFixed(1) : 0}%"></i></button>`).join('');
  $('#dailyX').innerHTML = [1, 8, 15, 22, days].map(d => `<span>${d}일</span>`).join('');
  const top = per.indexOf(Math.max(...per));
  $('#dailyInfo').innerHTML = dailySel
    ? `<b>${mo}월 ${dailySel}일</b> ${won(per[dailySel - 1])} · <a href="#" id="dailyGo">그날 내역 보기</a>`
    : per[top] > 0 ? `가장 많이 쓴 날 <b>${mo}월 ${top + 1}일</b> ${won(per[top])} · 막대를 눌러 보세요` : '이번 달 지출이 없어요';

  renderToday(m, exp, total, today, list); renderReport(today); renderUpcoming(today);
  $('#recent').innerHTML = [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || '')).slice(0, 5).map(txRow).join('') || '<li class="empty">이번 달 거래가 없어요</li>';
}
let dailySel = 0;
// 오늘 쓸 수 있는 돈 = (월 예산 − 어제까지 지출) ÷ 오늘 포함 남은 일수 − 오늘 쓴 돈. 이번 달을 볼 때만, 예산이 있을 때만
function renderToday(m, exp, total, today, list) {
  const el = $('#todayCan');
  el.hidden = !total || !today.startsWith(m);
  if (el.hidden) return;
  const [y, mo] = m.split('-').map(Number), left = new Date(y, mo, 0).getDate() - +today.slice(8) + 1;
  const spentToday = list.filter(i => i.date === today).reduce((t, i) => t + net(i), 0);
  const can = Math.floor((total - (exp - spentToday)) / left) - spentToday;
  el.innerHTML = `<small>오늘 쓸 수 있는 돈 · 남은 ${left}일</small><b class="${can < 0 ? 'out' : ''}">${can < 0 ? '−' + won(-can) + ' 넘었어요' : won(can)}</b>`;
}
// 매월 첫 접속 때 지난달 결산 (✕로 닫으면 그달엔 다시 안 뜸)
function renderReport(today) {
  const cur = today.slice(0, 7), pm = ymAdd(cur, -1), el = $('#report'), list = inMonth(pm);
  const exp = list.reduce((t, i) => t + net(i), 0);
  el.hidden = store.get('reportSeen') === cur || exp <= 0;
  if (el.hidden) return;
  const byMajor = {}, byDay = {};
  list.forEach(i => { if (net(i)) { byMajor[i.major] = (byMajor[i.major] || 0) + net(i); byDay[i.date] = (byDay[i.date] || 0) + net(i); } });
  const top = Object.entries(byMajor).sort((a, b) => b[1] - a[1]).slice(0, 3), [bd, bv] = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
  const prev = inMonth(ymAdd(pm, -1)).reduce((t, i) => t + net(i), 0), mo = +pm.slice(5);
  el.innerHTML = `<button type="button" class="x" id="reportX" aria-label="결산 닫기">✕</button><h2>${mo}월 결산</h2>
    <div class="big" style="font-size:1.412rem;font-weight:800">${won(exp)}</div>
    ${prev > 0 ? `<p>그 전달보다 ${exp >= prev ? '▲' : '▼'} ${Math.abs(Math.round((exp - prev) / prev * 100))}% (${won(Math.abs(exp - prev))} ${exp >= prev ? '더' : '덜'} 썼어요)</p>` : ''}
    <ol>${top.map(([k, v]) => `<li>${em(k)} ${esc(k)} <b>${won(v)}</b> · ${Math.round(v / exp * 100)}%</li>`).join('')}</ol>
    <p>가장 많이 쓴 날 <b>${+bd.slice(5, 7)}월 ${+bd.slice(8)}일</b> ${won(bv)}</p>`;
}
$('#report').addEventListener('click', e => { if (e.target.id === 'reportX') { store.set('reportSeen', localISO().slice(0, 7)); $('#report').hidden = true; } });
// 이번 달 남은 결제 예정: 아직 날짜가 안 된 반복 지출 + 진행 중인 할부
function renderUpcoming(today) {
  const cur = today.slice(0, 7), d = +today.slice(8), days = monthGrid(cur).days;
  const rec = data.meta.recurring.filter(r => r.type === '지출' && r.start <= cur && (!r.end || r.end >= cur) && Math.min(+r.day, days) > d)
    .sort((a, b) => a.day - b.day);
  const inst = data.items.filter(i => /회차/.test(i.instState || ''));
  const sum = rec.reduce((t, r) => t + +r.amount, 0);
  $('#upcoming').innerHTML = rec.map(r => `<li><span>${Math.min(+r.day, days)}일 · ${esc(r.content)}</span><b>${won(r.amount)}</b></li>`).join('')
    + (inst.length ? `<li><span>할부 진행 중 ${inst.length}건 (${esc(inst.map(i => i.content || i.major).slice(0, 2).join(', '))}${inst.length > 2 ? ' 외' : ''})</span><b>월 ${won(inst.reduce((t, i) => t + i.amount, 0))}</b></li>` : '')
    + (rec.length ? `<li style="font-weight:700"><span>반복 결제 합계</span><b>${won(sum)}</b></li>` : '')
    || '<li class="empty">이번 달 남은 반복 결제가 없어요</li>';
}

function txRow(i, timeOnly) {
  const [cls, sign] = { 수입: ['in', '+'], 지출: ['out', '-'], 환불: ['refund', '+'], 이체: ['move', ''] }[i.type] || ['move', ''];
  const inst = i.instState ? `<span class="badge">${esc(i.instState)}</span>` : i.inst ? `<span class="badge">${esc(i.inst)}개월</span>` : '';
  return `<li data-id="${esc(i.id)}"><span class="em" aria-hidden="true">${em(i.major)}</span>
    <div><small>${timeOnly ? (i.time ? esc(i.time) + ' · ' : '') : esc(i.date.slice(2).replace(/-/g, '.')) + (i.time ? ' ' + esc(i.time) : '') + ' · '}${esc(i.major)}${i.minor ? '·' + esc(i.minor) : ''}${i.pay ? ' · ' + esc(i.pay) : ''}</small>
    <span>${esc(i.content || i.minor || i.major)}${inst}</span></div>
    <b class="${cls}">${sign}${won(i.amount)}</b></li>`;
}
// 검색·필터 (달력과 내역이 같이 씀)
function filtered() {
  const q = $('#q').value.trim().toLowerCase(), t = $('#fType').value, mj = $('#fMajor').value, p = $('#fPay').value;
  return data.items.filter(i => (!t || i.type === t) && (!mj || i.major === mj) && (!p || i.pay === p) &&
    (!q || [i.content, i.memo, i.major, i.minor, i.pay].join(' ').toLowerCase().includes(q)));
}
function renderFilters() {
  fillSelect($('#fType'), TYPES, '구분 전체');
  fillSelect($('#fMajor'), majorsAll(), '대분류 전체');
  fillSelect($('#fPay'), payments(), '결제수단 전체');
  const on = ['#q', '#fType', '#fMajor', '#fPay'].map(s => $(s).value.trim()).filter(Boolean);
  $('#fActive').textContent = on.length ? `필터 적용 중: ${on.join(' · ')}` : '';
  const [y, mo] = $('#month').value.split('-').map(Number);
  $('#monthLabel').textContent = `${y}년 ${mo}월`;
}
function renderList() {
  const m = $('#month').value, all = $('#fAll').checked, [key, dir] = $('#fSort').value.split('-');
  const list = filtered().filter(i => all || i.date.startsWith(m))
    .sort((a, b) => (key === 'amt' ? a.amount - b.amount || a.date.localeCompare(b.date) : a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || a.amount - b.amount) * (dir === 'asc' ? 1 : -1));
  const exp = list.reduce((s, i) => s + net(i), 0), inc = list.filter(i => i.type === '수입').reduce((s, i) => s + i.amount, 0);
  $('#listInfo').textContent = `${list.length.toLocaleString()}건 · 지출 ${won(exp)} · 수입 ${won(inc)}` +
    (list.length > SHOW_MAX ? ` · 앞의 ${SHOW_MAX}건만 표시 (검색·필터로 좁혀 보세요)` : '');
  let last = '';
  const byDate = {};
  list.forEach(i => (byDate[i.date] = byDate[i.date] || []).push(i));
  $('#list').innerHTML = list.slice(0, SHOW_MAX).map(i => {
    if (key !== 'date') return txRow(i);
    if (i.date === last) return txRow(i, true);
    last = i.date;
    const ds = daySums(byDate[i.date]), [yy, mm, dd] = i.date.split('-').map(Number);
    return `<li class="day-h"><span>${mm}월 ${dd}일 ${WEEK[new Date(yy, mm - 1, dd).getDay()]}요일</span>
      <span>${ds.inc ? `<span class="in" style="display:inline">+${won(ds.inc)}</span> ` : ''}${ds.exp ? `-${won(ds.exp)}` : ''}</span></li>` + txRow(i, true);
  }).join('') || '<li class="empty">조건에 맞는 내역이 없어요</li>';
  paintSplit();
}

function renderRec() {
  $('#recList').innerHTML = data.meta.recurring.map(r => `<li>
      <div><small>매월 ${esc(r.day)}일 · ${esc(r.major)}${r.minor ? '·' + esc(r.minor) : ''}${r.pay ? ' · ' + esc(r.pay) : ''} · ${esc(r.start)}부터${r.end ? ' ' + esc(r.end) + '까지' : ''}</small>
      <span>${esc(r.content)} <b class="${r.type === '수입' ? 'in' : r.type === '지출' ? 'out' : 'move'}">${won(r.amount)}</b></span></div>
      <button class="small danger" data-rid="${esc(r.id)}" aria-label="${esc(r.content)} 반복 삭제">삭제</button></li>`).join('')
    || '<li class="empty">등록된 반복 거래가 없어요</li>';
}

// ── 달력 ──
const cf1 = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 });
const cf0 = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 0 });
const compact = n => brag ? '••만' : (Math.abs(n) >= 1e6 ? cf0 : cf1).format(Math.abs(n)); // 칸이 좁아 100만 이상은 소수점 없이
const WEEK = '일월화수목금토';
let selDay = localISO().slice(0, 10);
function daySums(list) {
  return { inc: list.filter(i => i.type === '수입').reduce((s, i) => s + i.amount, 0), exp: list.reduce((s, i) => s + net(i), 0) };
}
let calPay = ''; // 달력 결제유형 탭 ('' = 전체)
// 달력 손잡이: 펼침(한 달) ↔ 접힘(선택한 주 한 줄). 끌면 그 사이 높이로 움직임 (가계부 달력·습관 달력 공용)
function foldCal(clip, grid, grab, open = true, hook = {}) {
  const f = { open, week: 0 };
  const row = () => (grid.querySelector('button, .other')?.offsetHeight || 60) + 2, full = () => grid.scrollHeight;
  const place = (h, animate) => {
    const rh = row(), fh = full(), t = fh > rh ? Math.min(1, Math.max(0, (h - rh) / (fh - rh))) : 1;
    clip.classList.toggle('anim', animate); grid.classList.toggle('anim', animate);
    clip.style.height = h + 'px';
    grid.style.transform = `translateY(${-(1 - t) * f.week * rh}px)`;
  };
  f.fit = () => { if (clip.offsetParent) place(f.open ? full() : row(), false); }; // 숨긴 상태에선 높이를 못 재므로 보일 때 다시 맞춤
  // hook.opening: 펼치기 직전(내용을 달력으로 바꿀 때), hook.closed: 다 접힌 뒤
  const settle = () => { place(f.open ? full() : row(), true); if (!f.open && hook.closed) setTimeout(hook.closed, 260); };
  const toggle = () => { if (!f.open && hook.opening) hook.opening(); f.open = !f.open; settle(); };
  let drag = null;
  grab.addEventListener('pointerdown', e => { if (!f.open && hook.opening) hook.opening(); drag = { y: e.clientY, h: clip.offsetHeight, moved: false }; grab.setPointerCapture(e.pointerId); });
  grab.addEventListener('pointermove', e => {
    if (!drag) return;
    const dy = e.clientY - drag.y; if (Math.abs(dy) > 4) drag.moved = true;
    place(Math.min(full(), Math.max(row(), drag.h + dy)), false);
  });
  const end = () => {
    if (!drag) return;
    const moved = drag.moved; drag = null;
    if (!moved) { if (!f.open && hook.closed) hook.closed(); return toggle(); } // 눌렀으면 토글, 끌었으면 가까운 쪽으로
    f.open = clip.offsetHeight > (row() + full()) / 2;
    settle();
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
  grab.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  return f;
}
const calGrid = $('#calGrid'), calF = foldCal($('#calClip'), calGrid, $('#calGrab'));
function renderCal() {
  const m = $('#month').value;
  if (!m) return;
  const { y, mo, first, days, lead, tail } = monthGrid(m);
  if (!selDay.startsWith(m)) selDay = m + '-01';
  const types = [...new Set(data.meta.payments.map(p => p[1]).filter(Boolean))];
  $('#calTabs').innerHTML = ['', ...types].map(t => `<button type="button" data-pt="${esc(t)}" aria-pressed="${t === calPay}">${t ? esc(t) : '전체'}</button>`).join('');
  // 결제유형은 「카테고리」 탭의 결제수단→유형 표로 판단 (방금 입력해 시트 수식이 아직 안 돈 거래도 포함되게)
  const ptOf = Object.fromEntries(data.meta.payments);
  const src = filtered().filter(i => !calPay || (ptOf[i.pay] || i.payType) === calPay);
  $('#calMonthTitle').textContent = `${mo}월 지출 ${won(src.filter(i => i.date.startsWith(m)).reduce((t, i) => t + net(i), 0))}`;
  const byDay = {};
  src.filter(i => i.date.startsWith(m)).forEach(i => (byDay[i.date] = byDay[i.date] || []).push(i));
  const sums = {};
  Object.keys(byDay).forEach(d => { sums[d] = daySums(byDay[d]); });
  // 평소보다 크게 쓴 날(지출일 중앙값의 3배 이상, 100만원 이상)은 빨간색
  const exps = Object.values(sums).map(s => s.exp).filter(v => v > 0).sort((a, b) => a - b);
  const bigCut = Math.max(1e6, 3 * (exps[Math.floor(exps.length / 2)] || 0));
  const today = localISO().slice(0, 10);
  // 칸엔 지출만 만 단위로 (15.6만), 수입은 파란 점. 정확한 금액은 날짜를 누르면 아래 목록에
  const man = n => { n = Math.abs(n); if (brag) return '••'; return n >= 1e4 ? `${+(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)}만` : n.toLocaleString('ko-KR'); };
  let html = lead;
  for (let d = 1; d <= days; d++) {
    const ds = `${m}-${pad2(d)}`, s = sums[ds], wd = (first + d - 1) % 7;
    const cls = [ds === today && 'today', ds > today && 'future', wd === 0 && 'sun', wd === 6 && 'sat'].filter(Boolean).join(' ');
    html += `<button type="button" data-day="${ds}" class="${cls}" aria-pressed="${ds === selDay}" aria-label="${mo}월 ${d}일${s ? ` 수입 ${won(s.inc)} 지출 ${won(s.exp)}` : ''}">
      <span class="d">${d}</span>${s && s.inc ? '<i class="inc-dot" aria-hidden="true"></i>' : ''}${s && s.exp ? (s.exp > 0
        ? `<small class="man ${s.exp >= bigCut ? 'big' : 'spend'}">${man(s.exp)}</small>` : `<small class="man refund">+${man(s.exp)}</small>`) : ''}</button>`;
  }
  calGrid.innerHTML = html + tail;
  calF.week = Math.floor((first + +selDay.slice(8) - 1) / 7);
  calF.fit();
  renderTrend(src, m, y, mo, days, today);

  const list = (byDay[selDay] || []).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || b.amount - a.amount);
  const [, sm, sd] = selDay.split('-').map(Number), ds = daySums(list);
  $('#dayTitle').textContent = `${sm}월 ${sd}일 ${WEEK[new Date(y, sm - 1, sd).getDay()]}요일`;
  $('#daySum').innerHTML = list.length ? `${list.length}건 · 수입 <b class="in">${won(ds.inc)}</b> · 지출 <b class="out">${won(ds.exp)}</b>` : '';
  $('#dayList').innerHTML = list.map(i => txRow(i, true)).join('') || '<li class="empty">이날 기록이 없어요</li>';
  paintSplit(); // N빵 고르는 중이면 다른 날로 가도 고른 건 그대로 (여러 날 합쳐 나누기)
}
// 이번 달 누적 지출(선) vs 지난달 누적(회색 면): 같은 날짜 기준으로 비교
function renderTrend(src, m, y, mo, days, today) {
  const pm = ymAdd(m, -1);
  const cum = (mm, n) => { const a = Array(n).fill(0); src.filter(i => i.date.startsWith(mm)).forEach(i => { a[+i.date.slice(8) - 1] += net(i); });
    for (let k = 1; k < n; k++) a[k] += a[k - 1]; return a; };
  const pdays = new Date(y, mo - 1, 0).getDate(), cur = cum(m, days), prev = cum(pm, pdays);
  const upto = today.startsWith(m) ? +today.slice(8) : today > m ? days : 0;
  if (!upto) { $('#calTrend').innerHTML = '<div><small>아직 시작하지 않은 달이에요</small></div>'; return; }
  const diff = cur[upto - 1] - prev[Math.min(upto, pdays) - 1];
  const W = 104, H = 52, max = Math.max(1, cur[days - 1], prev[pdays - 1]);
  const pts = (a, n) => a.slice(0, n).map((v, k) => `${(k / (Math.max(days, pdays) - 1) * W).toFixed(1)},${(H - v / max * H).toFixed(1)}`).join(' ');
  const lx = ((upto - 1) / (Math.max(days, pdays) - 1) * W).toFixed(1), ly = (H - cur[upto - 1] / max * H).toFixed(1);
  $('#calTrend').innerHTML = `<div><b>지난달보다 <span class="${diff > 0 ? 'out' : 'refund'}">${compact(diff)}원</span> ${diff > 0 ? '더' : '덜'} 쓰는 중</b>
      <small>${upto}일까지 ${won(cur[upto - 1])} · 지난달 ${won(prev[Math.min(upto, pdays) - 1])}</small></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="누적 지출 비교: 빨간 선 이번 달, 회색 면 지난달">
      <polygon points="0,${H} ${pts(prev, pdays)} ${(((pdays - 1) / (Math.max(days, pdays) - 1)) * W).toFixed(1)},${H}" fill="currentColor" opacity=".12"/>
      <polyline points="${pts(prev, pdays)}" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="2"/>
      <polyline points="${pts(cur, upto)}" fill="none" stroke="var(--out)" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${lx}" cy="${ly}" r="8" fill="var(--out)" opacity=".18"/><circle cx="${lx}" cy="${ly}" r="3.5" fill="var(--out)"/>
      <text x="${W}" y="${H + 11}" text-anchor="end" font-size="9" fill="currentColor" opacity=".6">— 이번 달 ▒ 지난달</text>
    </svg>`;
}
function moveMonth(k) {
  $('#month').value = ymAdd($('#month').value, k);
  dailySel = 0;
  render();
  if (k) replay(document.querySelector('main'), 'slide', k > 0 ? '24px' : '-24px');
}

// ── 카테고리 내역 시트 (홈 「어디에 썼나」에서 열림) ──
let catOpen = '';
function renderCatSheet() {
  if (!catOpen) return;
  const m = $('#month').value, [, mo] = m.split('-').map(Number);
  const list = inMonth(m).filter(i => i.major === catOpen && net(i)).sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || '') || b.amount - a.amount);
  const used = list.reduce((s, i) => s + net(i), 0), budget = data.meta.budgets[catOpen];
  $('#catTitle').textContent = `${em(catOpen)} ${catOpen} · ${mo}월`;
  $('#catSum').textContent = `${list.length}건 · ${won(used)}${budget ? ` / 예산 ${won(budget)} (${Math.round(used / budget * 100)}%)` : ''} · 항목을 누르면 수정`;
  $('#catList').innerHTML = list.map(txRow).join('') || '<li class="empty">이번 달 내역이 없어요</li>';
}
$('#catClose').addEventListener('click', () => $('#catSheet').close());
$('#catSheet').addEventListener('close', () => { catOpen = ''; });

function render() { renderFilters(); renderHome(); renderCal(); renderList(); renderRec(); renderCatSheet(); renderLists(); }

// ── 거래 입력·수정 ──
const F = $('#entryForm').elements;
function entryCats(major, minor) {
  fillSelect(F.major, majorsFor(F.type.value)); setSel(F.major, major);
  fillSelect(F.minor, minorsFor(F.major.value), '소분류 없음'); setSel(F.minor, minor);
  renderChips();
}
// 숨긴 select 두 개를 칩 버튼으로 보여줌
function renderChips() {
  const chip = (sel, cls) => [...sel.options].filter(o => o.value).map(o => `<button type="button" data-v="${esc(o.value)}" aria-pressed="${o.value === sel.value}">${
    cls === 'major' ? `<span class="em" aria-hidden="true">${em(o.value)}</span>` : ''}${esc(o.value)}</button>`).join('');
  $('#majorChips').innerHTML = chip(F.major, 'major');
  $('#minorChips').innerHTML = chip(F.minor);
}
$('#majorChips').addEventListener('click', e => {
  const v = e.target.closest('[data-v]')?.dataset.v;
  if (v) entryCats(v);
});
$('#minorChips').addEventListener('click', e => {
  const v = e.target.closest('[data-v]')?.dataset.v;
  if (v) { F.minor.value = F.minor.value === v ? '' : v; renderChips(); }
});
$('#quick').addEventListener('click', e => {
  const a = e.target.dataset.add;
  if (a != null) F.amount.value = +a ? (+F.amount.value || 0) + +a : '';
});
function openEntry(it, date) {
  $('#entryForm').reset();
  F.tid.value = it?.id || '';
  F.type.value = it?.type || '지출';
  F.date.value = it?.date || date || localISO().slice(0, 10);
  // 새 거래는 지금 시각을 기본으로 (다른 날짜를 골랐으면 비움)
  F.time.value = it ? (it.time || '') : (F.date.value === localISO().slice(0, 10) ? localISO().slice(11, 16) : '');
  entryCats(it?.major, it?.minor);
  fillSelect(F.pay, payments(), '결제수단 선택 안 함'); F.pay.value = ''; setSel(F.pay, it ? it.pay : payments().includes(store.get('lastPay')) ? store.get('lastPay') : ''); // 새 거래는 지난번 결제수단으로
  renderPayChips();
  F.amount.value = it?.amount || '';
  F.content.value = it?.content || '';
  F.memo.value = it?.memo || '';
  F.inst.value = it?.inst || '';
  $('#recRow').hidden = !!it; // 반복은 새 거래에서만 켬
  recHint();
  $('#entryDelete').hidden = !it;
  $('#entryTitle').textContent = it ? '거래 수정' : '거래 추가';
  $('#entry').showModal();
  if (!it) F.amount.focus(); // 새 거래는 바로 숫자 키패드
}
// 결제수단: 최근 쓴 3개 칩 + 더보기(전체 목록 시트). 값은 숨은 select에 넣음
const payRecent = () => [...new Set([...store.get('payRecent', []), ...payments()])].filter(p => payments().includes(p)).slice(0, 3);
function renderPayChips() {
  const cur = F.pay.value, top = payRecent(), chips = cur && !top.includes(cur) ? [cur, ...top.slice(0, 2)] : top;
  $('#payChips').innerHTML = chips.map(p => `<button type="button" data-pay="${esc(p)}" aria-pressed="${p === cur}">${esc(p)}</button>`).join('')
    + `<button type="button" data-pay="" aria-pressed="${!cur}">없음</button>` + (payments().length > 3 ? '<button type="button" data-paymore>더보기</button>' : '');
}
$('#payChips').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.hasAttribute('data-paymore')) {
    $('#payList').innerHTML = payments().map(p => `<button type="button" data-pay="${esc(p)}" aria-pressed="${p === F.pay.value}">${esc(p)}</button>`).join('');
    return $('#paySheet').showModal();
  }
  F.pay.value = b.dataset.pay; renderPayChips();
});
$('#payList').addEventListener('click', e => { const b = e.target.closest('[data-pay]'); if (b) { setSel(F.pay, b.dataset.pay); renderPayChips(); $('#paySheet').close(); } });
const recHint = () => { $('#recHint').textContent = F.rec.checked && F.date.value ? `매월 ${+F.date.value.slice(8)}일` : ''; };
$('#entryForm').addEventListener('change', e => {
  if (e.target.name === 'type') entryCats();
  if (e.target.name === 'rec' || e.target.name === 'date') recHint();
});
$('#recManage').addEventListener('click', () => { $('#entry').close(); show('rec'); });
// 내용을 치면 「분류규칙」 탭의 키워드로 구분·대분류·소분류 자동 선택 (새 거래만)
F.content.addEventListener('input', () => {
  if (F.tid.value) return;
  const r = ruleFor(F.content.value);
  if (!r) return;
  if (TYPES.includes(r[1])) F.type.value = r[1];
  entryCats(r[2], r[3]);
});
$('#entryForm').addEventListener('submit', e => {
  e.preventDefault();
  const it = {
    id: F.tid.value || crypto.randomUUID(), date: F.date.value, time: F.time.value || '', type: F.type.value, major: F.major.value, minor: F.minor.value,
    content: F.content.value.trim(), pay: F.pay.value, amount: Math.round(+F.amount.value), memo: F.memo.value.trim(),
    inst: +F.inst.value >= 2 ? Math.round(+F.inst.value) : '',
  };
  if (!(it.amount > 0) || !it.date || !it.major) return;
  if (F.rec.checked && !F.tid.value) {
    // 반복 규칙만 저장 → 서버가 이 날짜부터 매월 거래를 만들어 줌 (이번 달 분 포함)
    const rule = { id: crypto.randomUUID(), content: it.content || it.minor || it.major, type: it.type, major: it.major, minor: it.minor,
      pay: it.pay, amount: it.amount, day: +it.date.slice(8), start: it.date.slice(0, 7), end: '' };
    data.meta.recurring.push(rule);
    $('#entry').close();
    toast(`🔁 매월 ${rule.day}일 반복으로 등록했어요`);
    return queue({ action: 'recSave', rule }).then(ok => ok && refresh());
  }
  const m = it.date.slice(0, 7), before = spent(m, it.major);
  const idx = data.items.findIndex(x => x.id === it.id);
  if (idx >= 0) data.items[idx] = { ...data.items[idx], ...it, instState: '' }; else data.items.push(it);
  $('#entry').close();
  if (it.pay) { store.set('lastPay', it.pay); store.set('payRecent', [it.pay, ...store.get('payRecent', []).filter(p => p !== it.pay)].slice(0, 5)); }
  queue({ action: 'save', item: it });
  checkBudget(m, it.major, before);
});
$('#entryDelete').addEventListener('click', async () => {
  if (!(await ask('이 거래를 시트에서 삭제할까요?', { ok: '삭제', danger: true }))) return;
  const id = F.tid.value;
  data.items = data.items.filter(i => i.id !== id);
  $('#entry').close();
  queue({ action: 'delete', id }).then(ok => ok && setStatus('삭제됨'));
});
$('#entryCancel').addEventListener('click', () => $('#entry').close());
// 가계부 ＋: 「직접 입력」 「사진으로 입력」 두 가지가 위로 펼쳐짐 (바깥을 누르면 닫힘)
const addMenu = open => {
  const m = $('#addMenu');
  document.body.classList.toggle('adding', open); $('#fab').setAttribute('aria-expanded', open);
  if (open) { // 가계부: 사진·직접 / 독서: 책 검색·직접
    const opt = (k, icon, t) => `<button type="button" data-add="${k}"><svg class="i" aria-hidden="true"><use href="#${icon}"/></svg>${t}</button>`;
    m.innerHTML = (sec === 'book' ? opt('find', 'i-search', '책 검색해서 추가') : sec === 'escape' ? opt('find', 'i-search', '테마 검색해서 추가') : sec === 'board' ? opt('find', 'i-search', '보드게임 검색해서 추가') : sec === 'movie' ? opt('find', 'i-search', '영화 검색해서 추가') : opt('photo', 'i-photo', '사진으로 입력')) + opt('manual', 'i-pen', '직접 입력');
    m.classList.remove('out'); m.hidden = false; return;
  }
  if (m.hidden) return;
  m.classList.add('out'); setTimeout(() => { m.hidden = true; m.classList.remove('out'); }, calm() ? 0 : 200);
};
$('#fab').addEventListener('click', () => sec === 'friends' ? $('#frName').focus() : sec === 'home' ? (setSection('book'), openFind()) : sec === 'habit' ? openHabitAdd() : ['money', 'book', 'escape', 'board', 'movie'].includes(sec) ? addMenu($('#addMenu').hidden) : openItem());
$('#addMenu').addEventListener('click', e => {
  const k = e.target.closest('[data-add]')?.dataset.add;
  if (!k) return;
  addMenu(false);
  if (k === 'photo') $('#photoIn').click();
  else if (k === 'find') openFind();
  else if (sec !== 'money') openItem();
  else openEntry(null, $('#v-cal').hidden ? '' : selDay);
});
document.addEventListener('pointerdown', e => { if (document.body.classList.contains('adding') && !e.target.closest('#addMenu, #fab')) addMenu(false); });
// 리퀴드 글래스 알약: 선택된 탭 뒤로 스프링처럼 미끄러지며 살짝 늘어났다 돌아옴
// 탭 바를 다시 그려도(목록 탭) 알약은 nav에 기억해 둔 지난 위치에서 출발 → 누른 탭으로 미끄러짐 (왼쪽 끝에서 튀어나오지 않게)
function movePill(nav) {
  if (!nav || !nav.offsetWidth) return; // 숨은 탭 바는 위치를 잴 수 없음
  const b = nav.querySelector('[aria-current="page"]');
  let pill = nav.querySelector('.tab-pill');
  if (!pill) {
    pill = document.createElement('span'); pill.className = 'tab-pill'; pill.setAttribute('aria-hidden', 'true'); nav.prepend(pill);
    const from = nav._pill || (b && [b.offsetLeft, b.offsetWidth]); // 처음이면 제자리에서 시작
    if (from) { pill.style.transition = 'none'; pill.style.setProperty('--px', from[0] + 'px'); pill.style.setProperty('--pw', from[1] + 'px'); void pill.offsetWidth; pill.style.transition = ''; }
  }
  pill.hidden = !b;
  if (!b) return;
  const to = [b.offsetLeft, b.offsetWidth], moved = nav._pill && nav._pill[0] !== to[0];
  nav._pill = to;
  pill.style.setProperty('--px', to[0] + 'px'); pill.style.setProperty('--pw', to[1] + 'px');
  if (moved && !calm()) replay(pill, 'moving');
}
addEventListener('resize', () => document.querySelectorAll('nav').forEach(movePill));
['#list', '#dayList', '#recent', '#catList'].forEach(s => $(s).addEventListener('click', e => {
  if (splitUl && e.currentTarget === splitUl) return; // N빵 고르는 중엔 편집 창 대신 선택 (아래 N빵 코드)
  const id = e.target.closest('li[data-id]')?.dataset.id;
  const it = id && data.items.find(i => i.id === id);
  if (it) openEntry(it);
}));
$('#calGrid').addEventListener('click', e => {
  const d = e.target.closest('[data-day]')?.dataset.day;
  if (d) {
    selDay = d; renderCal();
    // 화면을 다시 그린 직후 스크롤하면 iOS가 무시하는 경우가 있어 한 프레임 뒤에 실행
    requestAnimationFrame(() => window.scrollTo({ top: $('#dayTitle').getBoundingClientRect().top + scrollY - 96, behavior: 'smooth' })); // 내역 제목이 상단 바 아래에 오도록
  }
});
$('#dayAdd').addEventListener('click', () => openEntry(null, selDay));
$('#calTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-pt]');
  if (b) { calPay = b.dataset.pt; renderCal(); }
});
$('#calToday').addEventListener('click', () => {
  selDay = localISO().slice(0, 10);
  $('#month').value = selDay.slice(0, 7);
  dailySel = 0;
  render();
});
// 달력을 좌우로 밀어서 달 이동
let touchX = null;
$('#calGrid').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
$('#calGrid').addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - (touchX ?? e.changedTouches[0].clientX);
  touchX = null;
  if (Math.abs(dx) > 60) moveMonth(dx < 0 ? 1 : -1);
});

// ── 예산 ──
$('#budgets').addEventListener('click', async e => {
  const cat = e.target.closest('[data-cat]')?.dataset.cat;
  if (cat) { catOpen = cat; renderCatSheet(); return $('#catSheet').showModal(); }
  const mj = e.target.closest('[data-major]')?.dataset.major;
  if (!mj) return;
  if (!majorsAll().includes(mj)) return toast('「카테고리」 탭에 없는 대분류예요');
  const v = await ask(`${mj} 월 예산 (원)`, { input: String(data.meta.budgets[mj] || ''), type: 'number', ok: '저장' });
  if (v === null) return;
  const n = Math.round(+String(v).replace(/[^\d]/g, ''));
  if (!(n >= 0)) return;
  data.meta.budgets[mj] = n;
  queue({ action: 'budget', major: mj, amount: n });
});
$('#notifyBtn').addEventListener('click', async () => {
  const p = await Notification.requestPermission();
  toast(p !== 'granted' ? '알림이 허용되지 않았어요' : PUSH_URL ? '알림을 켰어요 · 아침 9시·10시 반, 평일 6시 50분' : '예산 알림을 켰어요');
  if (p === 'granted') pushSubscribe();
  renderHome();
});
// 아침·퇴근 전 알림: 이 기기를 알림 서버(push/worker.js)에 등록. 바뀐 경우에만 다시 보냄
const PUSH_URL = '', PUSH_KEY = 'BCc58JIGOOvCKS3pAfrDBnACqjJw778mxlpUUqc2Dv9QL_7jwrRigs5tSaGNGqMmKl-A54TekHTMn57_u4eLnak';
async function pushSubscribe() {
  if (!PUSH_URL || !cfg.token || !('PushManager' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(PUSH_KEY.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    if (store.get('pushSent') === sub.endpoint + cfg.token) return;
    const r = await fetch(PUSH_URL + '/subscribe', { method: 'POST', body: JSON.stringify({ token: cfg.token, sub }) });
    if (r.ok) store.set('pushSent', sub.endpoint + cfg.token);
  } catch (err) { console.warn('알림 등록 실패', err); }
}

// ── 반복 ──
$('#recList').addEventListener('click', async e => {
  const id = e.target.dataset.rid;
  if (!id || !(await ask('반복을 삭제할까요? (이미 기록된 거래는 남아요)', { ok: '삭제', danger: true }))) return;
  data.meta.recurring = data.meta.recurring.filter(r => r.id !== id);
  queue({ action: 'recDelete', id });
});

// ── 공통 ──
let curView = 'home';
function show(v) {
  if (splitUl && !(v === 'cal' && splitUl.id === 'dayList') && !(v === 'list' && splitUl.id === 'list')) endSplit();
  curView = v;
  document.querySelectorAll('nav button').forEach(b => b.dataset.view === v ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  ['home', 'cal', 'list', 'rec'].forEach(x => { $('#v-' + x).hidden = x !== v; });
  $('#filters').hidden = v !== 'list' && v !== 'cal';
  document.querySelectorAll('.list-only').forEach(el => { el.hidden = v !== 'list'; });
  setFab(false); addMenu(false);
  movePill(document.querySelector('nav'));
  if (v === 'cal') calF.fit();
  replay($('#v-' + v), 'enter');
  window.scrollTo(0, 0);
}
document.querySelector('nav').addEventListener('click', e => { const v = e.target.closest('[data-view]')?.dataset.view; if (v) show(v); });
$('#toList').addEventListener('click', () => show('list'));
$('#mPrev').addEventListener('click', () => moveMonth(-1));
$('#mNext').addEventListener('click', () => moveMonth(1));
$('#monthLabel').addEventListener('click', () => openWheel($('#month'), 'month', '조회 월'));
$('#fToggle').addEventListener('click', () => {
  const open = $('#fPanel').hidden;
  $('#fPanel').hidden = !open;
  $('#fToggle').setAttribute('aria-expanded', open);
});
$('#daily').addEventListener('click', e => {
  const d = +e.target.closest('[data-d]')?.dataset.d;
  if (d) { dailySel = dailySel === d ? 0 : d; renderHome(); }
});
$('#dailyInfo').addEventListener('click', e => {
  if (e.target.id !== 'dailyGo') return;
  e.preventDefault();
  selDay = `${$('#month').value}-${pad2(dailySel)}`;
  show('cal'); renderCal();
});
['#month', '#fType', '#fMajor', '#fPay', '#fSort', '#fAll'].forEach(s => $(s).addEventListener('change', render));
$('#q').addEventListener('input', () => { renderFilters(); renderCal(); renderList(); });
// 하단 검색: 동그란 단추를 누르면 탭 바 자리가 검색창이 됨 (홈에서 누르면 내역으로). ✕는 검색어를 지우고 탭 바로
document.addEventListener('click', e => { if (e.target.closest('nav [data-search]')) $('#searchBtn').click(); });
$('#searchBtn').addEventListener('click', () => {
  document.body.classList.add('searching');
  if (sec !== 'money') return $('#lq').focus();
  if (curView === 'home') show('list');
  $('#q').focus();
});
$('#lClose').addEventListener('click', () => { document.body.classList.remove('searching'); $('#lq').value = ''; renderLists(); });
const endSearch = () => { document.body.classList.remove('searching'); if ($('#q').value) { $('#q').value = ''; $('#q').dispatchEvent(new Event('input')); } };
$('#sClose').addEventListener('click', endSearch);
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('#lq').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
// 아이폰 키보드가 올라오면 아래 고정 바도 키보드 위로
if (window.visualViewport) {
  const kb = () => document.documentElement.style.setProperty('--kb', Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop) + 'px');
  visualViewport.addEventListener('resize', kb); visualViewport.addEventListener('scroll', kb);
}
$('#fReset').addEventListener('click', () => {
  ['#q', '#fType', '#fMajor', '#fPay'].forEach(s => { $(s).value = ''; });
  $('#fSort').value = 'date-desc'; $('#fAll').checked = false;
  render();
});
// Face ID 잠금 (패스키): 이 기기에서만, 화면을 가리는 잠금이에요 (데이터 암호화는 아님)
// shortcut: 서명을 서버에서 확인하지 않음, 진짜 보안이 필요하면 Code.gs에서 검증
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))), unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const rand = n => crypto.getRandomValues(new Uint8Array(n));
// Face ID가 두 번 뜨던 문제: ① 이미 묻는 중이면 또 묻지 않음 ② 방금(2분 안) 풀었으면, 새 버전으로 새로고침돼도 다시 잠그지 않음
// ③ Face ID 창이 떠 있는 동안 앱이 잠깐 「숨김」이 되는 것은 나갔다 온 걸로 치지 않음
let unlocking = false;
const ss = { get: k => { try { return +sessionStorage.getItem(k) || 0; } catch (e) { return 0; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} } };
const unlocked = () => { ss.set('unlockedAt', Date.now()); $('#lock').close(); };
async function unlock(auto) {
  if (unlocking) return;
  unlocking = true;
  try {
    await navigator.credentials.get({ publicKey: { challenge: rand(32), allowCredentials: [{ type: 'public-key', id: unb64(store.get('lockId')) }], userVerification: 'required', timeout: 60000 } });
    unlocked();
  } catch (e) { if (auto !== true) toast('Face ID를 확인하지 못했어요 · 다시 누르거나 비밀번호로 열어요'); } // 자동 시도가 막히면(손가락 터치 필요) 조용히 단추로
  finally { unlocking = false; hiddenAt = 0; }
}
// 잠기면 바로 Face ID 창을 띄움 (아이폰이 터치 없이는 막는 경우엔 「Face ID로 열기」 단추)
const lockNow = () => { if (store.get('lockId') && cfg.token && !$('#lock').open && !unlocking && Date.now() - ss.get('unlockedAt') > 120e3) { $('#lock').showModal(); $('#lockPw').pw.value = ''; setTimeout(() => unlock(true), 150); } };
$('#lock').addEventListener('cancel', e => e.preventDefault()); // Esc로 못 닫게
$('#unlock').addEventListener('click', () => unlock());
$('#lockPw').addEventListener('submit', e => { e.preventDefault(); if (e.target.pw.value === cfg.token) unlocked(); else toast('비밀번호가 맞지 않아요'); });
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (!unlocking) hiddenAt = Date.now(); } else if (hiddenAt && Date.now() - hiddenAt > 60e3) lockNow(); }); // 1분 넘게 나갔다 오면 다시 잠금
$('#lockOn').addEventListener('change', async e => {
  if (!e.target.checked) { store.set('lockId', ''); return toast('Face ID 잠금을 껐어요'); }
  try {
    if (!window.PublicKeyCredential) throw new Error('지원 안 함');
    const c = await navigator.credentials.create({ publicKey: { challenge: rand(32), rp: { name: '하트' }, user: { id: rand(16), name: '하트', displayName: '하트' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], timeout: 60000,
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' } } });
    store.set('lockId', b64(c.rawId)); toast('다음부터 앱을 열 때 Face ID로 잠금을 풀어요');
  } catch (err) { e.target.checked = false; toast('이 기기에서는 Face ID 잠금을 켤 수 없어요'); }
});
// ── 로그인 (흔한 앱처럼 아이디·비밀번호). 맞게 로그인하기 전엔 창이 안 닫힘 ──
// 로그인·초대 확인은 토큰 없이 시트에 보냄
async function pub(body) {
  const res = await fetch(cfg.url || SHEET_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  let r; try { r = JSON.parse(await res.text()); } catch (e) { throw new Error('시트가 알 수 없는 응답을 보냈어요 · Code.gs를 새 버전으로 배포했는지 확인해 주세요'); }
  if (!r.ok) throw new Error(r.error || '로그인하지 못했어요');
  return r;
}
function showLogin(msg) {
  const f = $('#loginForm'); f.reset(); $('#loginErr').textContent = msg || '';
  if (!$('#login').open) $('#login').showModal();
  setTimeout(() => f.name.focus(), 50);
}
$('#login').addEventListener('cancel', e => e.preventDefault()); // Esc로도 못 닫음
async function loggedIn(r) {
  cfg = { url: cfg.url || SHEET_URL, token: r.token }; store.set('cfg', cfg);
  me = { token: r.token, role: r.role, name: r.name, people: [], friends: [] }; store.set('me', me);
  ss.set('unlockedAt', Date.now()); // 방금 로그인했으면 Face ID 다시 안 물음
  $('#login').close();
  // 웰컴 스크린이 시트 불러오기를 가려 줌: 다 불러올 때까지(최대 15초) 기다렸다가 넘김
  const ready = Promise.all([loadMe(), isFriend() ? Promise.all([refreshLists(), refreshHabits()]) : refresh()]).catch(() => {});
  await hello(r.name, ready);
  applyRole();
  setSection('home'); render(); // 처음 로그인하면 「오늘」부터
}
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = $('#loginBtn');
  if (!f.name.value.trim() || !f.password.value) { $('#loginErr').textContent = '아이디와 비밀번호를 넣어 주세요'; return; }
  btn.disabled = true; btn.textContent = '확인하는 중…'; $('#loginErr').textContent = '';
  try { await loggedIn(await pub({ action: 'login', name: f.name.value.trim(), password: f.password.value })); }
  catch (err) { $('#loginErr').textContent = err.message; replay($('#login'), 'shake'); f.password.select(); }
  finally { btn.disabled = false; btn.textContent = '로그인'; }
});
$('#loginAdv').addEventListener('click', () => { openConn(); }); // 다른 사람 시트 주소·예전 방식 링크
// 「○○님 반가워요」를 펜으로 쓰듯 그린 뒤, 종이 한 장이 넘어가며 앱이 보임
function hello(name, ready = Promise.resolve()) {
  const wait = Promise.race([ready, new Promise(r => setTimeout(r, 15000))]);
  return new Promise(done => {
    const t = `${name || ''}님 반가워요`, el = $('#hello'), svg = $('#helloSvg'), d = Math.min(3, .5 + t.length * .12);
    $('#helloText').textContent = t;
    if (calm()) { el.hidden = false; Promise.all([wait, new Promise(r => setTimeout(r, 700))]).then(() => { el.hidden = true; done(); }); return; }
    svg.innerHTML = `<text x="50%" y="62" text-anchor="middle" class="write" style="--d:${d}s">${esc(t)}</text><circle class="nib" r="5" cx="0" cy="66"/>`;
    const w = svg.querySelector('text').getComputedTextLength?.() || 300;
    svg.querySelector('.nib').style.cssText = `--d:${d}s;--x0:${180 - w / 2}px;--x1:${180 + w / 2}px`;
    el.classList.remove('turn', 'waiting'); el.hidden = false;
    let wrote = false; setTimeout(() => { wrote = true; el.classList.add('waiting'); }, d * 1000 + 350); // 다 썼는데 아직 불러오는 중이면 「불러오는 중」 점
    Promise.all([wait, new Promise(r => setTimeout(r, d * 1000 + 350))]).then(() => {
      el.classList.remove('waiting'); el.classList.add('turn');
      setTimeout(() => { el.hidden = true; el.classList.remove('turn'); done(); }, 900);
    });
  });
}
// 로그아웃: 이 기기에 저장된 연결·기록 사본을 지우고 로그인 화면으로 (시트의 기록은 그대로)
async function logout() {
  const left = pending.length ? `\n아직 시트에 못 보낸 ${pending.length}건은 사라져요.` : '';
  if (!(await ask('로그아웃할까요?' + left, { ok: '로그아웃', danger: true }))) return;
  ['me', 'lists', 'habits', 'data2', 'pending', 'lockId', 'sec'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  cfg = { url: cfg.url, token: '' }; store.set('cfg', cfg); me = {};
  document.querySelectorAll('dialog[open]').forEach(d => d.id !== 'login' && d.close());
  location.hash = ''; setTimeout(() => location.reload(), 50);
}
$('#menuLogout').addEventListener('click', logout);
$('#prefLogout').addEventListener('click', logout);
document.addEventListener('click', e => { const k = e.target.closest('[data-help]')?.dataset.help; if (k && HELP[k]) openHelp(k); });
// 당겨서 새로고침: 맨 위에서 아래로 70px 넘게 끌었다 놓으면 새로고침 단추와 똑같이
{
  let y0 = null, pull = 0;
  const el = $('#ptr'), off = t => document.querySelector('dialog[open]') || t.closest('input, textarea, select, .wcol, #lFlow, #calGrab, #hGrab, .sheet-grab') || window.scrollY > 0;
  document.addEventListener('touchstart', e => { y0 = e.touches.length === 1 && !off(e.target) ? e.touches[0].clientY : null; pull = 0; }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (y0 == null) return;
    pull = Math.max(0, Math.min(110, (e.touches[0].clientY - y0) * .5)); // 손가락의 절반만큼 (고무줄 느낌)
    if (window.scrollY > 0) { y0 = null; pull = 0; }
    el.style.setProperty('--pull', pull + 'px'); el.classList.toggle('on', pull > 8); el.classList.toggle('ready', pull > 70);
  }, { passive: true });
  document.addEventListener('touchend', async () => {
    if (y0 == null) return; y0 = null;
    const go = pull > 70; pull = 0; el.classList.remove('on', 'ready'); el.style.setProperty('--pull', '0px');
    if (!go || !cfg.token) return;
    navigator.vibrate?.(10); el.classList.add('spin');
    try { await doReload(); } finally { el.classList.remove('spin'); }
  });
}
const doReload = async () => {
  forceFresh = true;
  try { await (sec === 'money' ? refresh() : sec === 'habit' ? refreshHabits() : sec === 'home' ? Promise.all([refreshLists(), refreshHabits()]).then(renderDash) : refreshLists()); } finally { forceFresh = false; }
};
$('#reload').addEventListener('click', () => doReload());
// ── 테마 5가지: 기능은 같고 모양만 완전히 다름. html[data-skin]으로 index.html의 테마 CSS가 켜짐 (첫 화면 깜빡임 없게 head에서도 미리 적용) ──
const SKINS = [['main', '메인 테마', '#f2f4f6', '#ffffff', '#3182f6', '10px', '0 1px 2px rgba(0,0,0,.06)'],
  ['clay', '클레이모피즘', '#fbefe5', '#fff7f0', '#ff7a3d', '12px', '3px 3px 6px rgba(214,160,125,.35), inset 1px 1px 2px #fff'],
  ['ios', 'iOS 27', 'linear-gradient(160deg,#dfe9ff,#f7e8ff 55%,#e3fbf3)', 'rgba(255,255,255,.6)', '#0a84ff', '12px', 'inset 0 1px 0 #fff, 0 2px 8px rgba(31,38,135,.12)'],
  ['cuberto', '쿠베르토', '#f4f4f2', '#ffffff', '#0b0b0b', '14px', '0 8px 14px -8px rgba(20,20,40,.35)'],
  ['linear', '리니어', '#0d0e10', '#17181b', '#5e6ad2', '4px', 'inset 0 0 0 1px rgba(255,255,255,.08)']];
const skin = () => store.get('skin', 'main');
function setSkin(k) {
  store.set('skin', k); document.documentElement.dataset.skin = k;
  const tc = { clay: '#fbefe5', linear: '#0d0e10', cuberto: '#f4f4f2', ios: '#eef1f7' }[k];
  document.querySelectorAll('meta[name=theme-color]').forEach(m => tc ? m.setAttribute('content', tc) : m.setAttribute('content', m.media.includes('dark') ? '#101013' : '#f2f4f6'));
  requestAnimationFrame(() => document.querySelectorAll('nav').forEach(movePill)); renderSkins();
  if ($('#prefThemeVal')) $('#prefThemeVal').textContent = (SKINS.find(x => x[0] === k) || SKINS[0])[1];
}
function renderSkins() {
  $('#skinList').innerHTML = SKINS.map(([k, n, bg, card, acc, r, sh], i) => `<button type="button" role="radio" data-skin="${k}" aria-checked="${skin() === k}">
    <span class="skin-prev" style="--pb:${bg};--pc:${card};--pa:${acc};--pr:${r};--ps:${sh}" aria-hidden="true"><i></i><i></i><i></i><b></b></span>${i + 1}. ${n}</button>`).join('');
}
$('#skinList').addEventListener('click', e => { const k = e.target.closest('[data-skin]')?.dataset.skin; if (k) { setSkin(k); toast(`「${SKINS.find(x => x[0] === k)[1]}」로 바꿨어요`); } });
// 앱 아이콘 3가지: 사파리 「홈 화면에 추가」가 읽는 아이콘 주소를 바꿈 (이미 추가한 아이콘은 지우고 다시 추가해야 바뀜)
const ICONS = [['main', '우사기', 'icon-180.png', 'icon-192.png'],
  ...['썬구리 우사기', '짭몽가', '쿠리', '하치와레', '소시지쿠리', '랏코', '랏코 귀여워 ㅠ'].map((n, i) => [`c${i + 1}`, n, `icon-c${i + 1}-180.png`, `icon-c${i + 1}-192.png`])];
function setIcon(k) {
  const c = ICONS.find(x => x[0] === k) || ICONS[0]; store.set('appIcon', c[0]);
  $('link[rel=apple-touch-icon]').href = c[2]; $('link[rel=icon]').href = c[3];
  $('link[rel=manifest]').href = c[0] === 'main' ? 'manifest.webmanifest' : `manifest-${c[0]}.webmanifest`;
  renderIcons();
}
// 이름 앞 동그라미에 고른 앱 아이콘 그림
const paintAvatar = el => { const c = ICONS.find(x => x[0] === store.get('appIcon', 'main')) || ICONS[0]; el.textContent = ''; el.classList.add('icon'); el.style.backgroundImage = `url("${c[2]}")`; };
$('#pubDefault').addEventListener('change', e => { store.set('pubDefault', e.target.checked); toast(e.target.checked ? '새 기록은 친구 집에 공개로 시작해요' : '새 기록은 비공개로 시작해요'); });
$('#startSec').addEventListener('change', e => { store.set('startSec', e.target.value); toast('다음에 앱을 켤 때부터 적용돼요'); });
function renderIcons() {
  const cur = store.get('appIcon', 'main');
  $('#iconList').innerHTML = ICONS.map(([k, n, src]) => `<button type="button" role="radio" data-icon="${k}" aria-checked="${cur === k}"><img src="${src}" alt="">${n}</button>`).join('');
}
$('#iconList').addEventListener('click', e => { const k = e.target.closest('[data-icon]')?.dataset.icon; if (k) { setIcon(k); saveHouse(); toast('아이콘을 바꿨어요 · 홈 화면에 다시 추가하면 적용돼요'); } });
setSkin(skin()); if (store.get('appIcon', 'main') !== 'main') setIcon(store.get('appIcon'));
// 설정: 목록 시트(prefs) — 사용자명·비밀번호 변경·Face ID·테마·앱 아이콘·친구 초대 / 비밀번호(접속코드) 변경은 따로 창
function openConn() {
  const f = $('#settingsForm');
  f.url.value = cfg.url; f.token.value = cfg.token;
  $('#settings').showModal();
}
function openPrefs() {
  $('#lockOn').checked = !!store.get('lockId');
  const nm = me.token === cfg.token && me.name ? me.name : '';
  $('#prefName').textContent = nm || (isFriend() ? '친구' : '이름(아이디)을 정해 주세요');
  $('#prefRole').textContent = isFriend() ? '친구 계정' : '내 시트 주인 · 가계부까지';
  paintAvatar($('#prefAvatar'));
  $('#pubDefault').checked = store.get('pubDefault', true);
  $('#startSec').value = store.get('startSec', 'home'); $('#startSec').querySelector('.owner-opt').hidden = isFriend();
  $('#prefThemeVal').textContent = SKINS.find(x => x[0] === skin())[1];
  if (document.activeElement !== $('#myName')) $('#myName').value = nm;
  document.querySelectorAll('#prefs .owner-only').forEach(el => { el.hidden = isFriend() || !cfg.token; });
  $('#prefs .name-edit').hidden = !cfg.token; // 게스트도 이름(아이디)을 바꿀 수 있음
  renderFriends(); if (stale('me')) loadMe();
  if (!$('#prefs').open) $('#prefs').showModal();
}
$('#openSettings').addEventListener('click', openPrefs);
$('#prefAdv').addEventListener('click', () => { $('#prefs').close(); openConn(); });
// 테마·아이콘은 「테마 변경」에 들어가서
$('#prefTheme').addEventListener('click', () => { renderSkins(); renderIcons(); $('#themeSheet').showModal(); });
$('#themeClose').addEventListener('click', () => { $('#themeSheet').close(); if ($('#prefs').open) openPrefs(); });
// 비밀번호 변경: 새 비밀번호 두 번, 가벼운 비밀번호를 쓰라는 안내
$('#prefPw').addEventListener('click', () => { $('#pwForm').reset(); $('#pwErr').textContent = ''; $('#pwSheet').showModal(); });
$('#pwCancel').addEventListener('click', () => $('#pwSheet').close());
$('#pwForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, a = f.pw1.value, b = f.pw2.value;
  if (a.length < 4) return $('#pwErr').textContent = '4자 이상으로 정해 주세요';
  if (a !== b) return $('#pwErr').textContent = '두 번 적은 비밀번호가 달라요';
  try {
    const r = await api({ action: 'setPassword', password: a });
    if (r.token) { cfg.token = r.token; store.set('cfg', cfg); me.token = r.token; store.set('me', me); }
    $('#pwSheet').close(); toast('비밀번호를 바꿨어요 · 다음 로그인부터 새 비밀번호를 써요');
  } catch (err) { $('#pwErr').textContent = err.message.replace(/^입력값 오류:?\s*/, ''); }
});
$('#prefsClose').addEventListener('click', () => $('#prefs').close());
$('#menuSettings').addEventListener('click', () => { $('#menu').close(); setTimeout(openPrefs, 200); });
$('#menuUser').addEventListener('click', () => { $('#menu').close(); setTimeout(openPrefs, 200); });
$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'save') return;
  const f = $('#settingsForm'), link = f.link.value.trim();
  const c = link ? cfgFrom(link.split('#')[1] || '') : { url: f.url.value.trim() || cfg.url || SHEET_URL, token: f.token.value };
  if (!c || !c.url || !c.token) { toast(link ? '설정 링크가 올바르지 않아요' : '비밀번호를 넣어 주세요'); return $('#settings').showModal(); }
  cfg = c;
  f.link.value = '';
  store.set('cfg', cfg);
  if ($('#login').open) $('#login').close(); // 로그인 화면의 「다른 시트에 연결」로 들어온 경우
  refresh(); loadMe().then(() => { if (sec !== 'money') sec === 'habit' ? refreshHabits() : refreshLists(); });
});
window.addEventListener('online', refresh);
// 바텀시트 끌어 닫기
// 손가락: 내용이 맨 위까지 올라가 있으면 본문 어디를 잡고 내려도 시트가 따라 내려오고, 충분히 내리면 닫힘
// 마우스: 위쪽(손잡이·제목) 영역에서 끌기
document.querySelectorAll('dialog.sheet').forEach(d => {
  let y0 = null, dy = 0, dragging = false, t0 = 0;
  const reset = () => { d.style.transition = ''; d.style.transform = ''; d.style.animation = ''; };
  const begin = () => { dragging = true; d.style.animation = 'none'; d.style.transition = 'none'; };
  const move = y => { dy = Math.max(0, y - y0); d.style.transform = `translateY(${dy}px)`; };
  const finish = () => {
    if (!dragging) { y0 = null; return; }
    const fast = dy > 40 && dy / Math.max(1, Date.now() - t0) > 0.6; // 빠르게 튕기면 짧게 내려도 닫힘
    const close = dy > 110 || fast;
    y0 = null; dragging = false;
    d.style.transition = 'transform .25s ease';
    if (close) { d.style.transform = 'translateY(100%)'; setTimeout(() => { closeNow(d); reset(); }, 230); }
    else { d.style.transform = ''; setTimeout(reset, 260); }
  };
  d.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('.wcol')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0; dragging = false; t0 = Date.now();
  }, { passive: true });
  d.addEventListener('touchmove', e => {
    if (y0 === null) return;
    const now = e.touches[0].clientY;
    if (!dragging) {
      if (now - y0 > 6 && d.scrollTop <= 0) begin();            // 아래로 + 맨 위 → 시트 끌기
      else if (Math.abs(now - y0) > 6) { y0 = null; return; }    // 그 밖엔 평소처럼 스크롤
      else return;
    }
    e.preventDefault();
    move(now);
  }, { passive: false });
  d.addEventListener('touchend', finish);
  d.addEventListener('touchcancel', finish);
  d.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') return;
    if (e.clientY - d.getBoundingClientRect().top > 96 || e.target.closest('button,input,select,textarea,a,label')) return;
    y0 = e.clientY; dy = 0; t0 = Date.now(); begin();
    d.setPointerCapture(e.pointerId);
  });
  d.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && dragging) move(e.clientY); });
  d.addEventListener('pointerup', e => { if (e.pointerType === 'mouse') finish(); });
});
// 창 바깥(어두운 부분)을 누르면 닫기
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => {
  const r = d.getBoundingClientRect();
  if (e.target === d && (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right)) d.close();
}));

// ── 홈 화면 편집: 카드 순서를 ▲▼로 바꾸고 이 기기에 저장 ──
const home = $('#v-home'), cards = () => [...home.querySelectorAll(':scope > [data-card]')];
cards().forEach(c => c.insertAdjacentHTML('afterbegin',
  `<div class="mover"><span>${c.dataset.label}</span><button type="button" data-mv="-1" aria-label="${c.dataset.label} 위로">▲</button><button type="button" data-mv="1" aria-label="${c.dataset.label} 아래로">▼</button></div>`));
store.get('homeOrder', []).forEach(id => { const c = home.querySelector(`:scope > [data-card="${id}"]`); if (c) home.insertBefore(c, $('#homeEdit')); });
home.addEventListener('click', e => {
  const mv = +e.target.dataset.mv;
  if (!mv) return;
  const c = e.target.closest('[data-card]'), list = cards(), k = list.indexOf(c), to = list[k + mv];
  if (!to) return;
  mv < 0 ? home.insertBefore(c, to) : home.insertBefore(to, c);
  store.set('homeOrder', cards().map(x => x.dataset.card));
  e.target.focus();
});
$('#homeEdit').addEventListener('click', () => {
  const on = home.classList.toggle('editing');
  $('#homeEdit').textContent = on ? '✓ 편집 완료' : '✎ 홈 화면 편집';
});

// ── BAB:ZIP 섹션: MONEY · 독서 · 방탈출 · 보드게임 ──
const SECTIONS = {
  home: { title: '오늘', icon: '🏠' }, // 친구(게스트)의 첫 화면 대시보드. 주인도 메뉴에서 볼 수 있음
  money: { title: '가계부', icon: '💰' },
  book: { title: '독서', icon: '📚', tabs: [['book', '읽는 책'], ['buy', '위시리스트'], ['wish', '추천 목록']] },
  escape: { title: '방탈출', icon: '🔐', tabs: [['escape', '방탈출 기록'], ['escapeWant', '위시리스트']] },
  board: { title: '보드게임', icon: '🎲', tabs: [['board', '보드게임 기록'], ['boardWant', '위시리스트']] },
  movie: { title: '영화', icon: '🎬', tabs: [['movie', '본 영화'], ['movieWant', '위시리스트']] },
  play: { title: '연극·뮤지컬', icon: '🎭', tabs: [['play', '본 공연'], ['playWant', '위시리스트']] },
  habit: { title: '습관', icon: '🔥' },
  friends: { title: '친구', icon: '🏡' },
  notice: { title: '공지사항', icon: '📢' }, // 공지 · 홈 화면 추가 방법 · Q&A · 개선 중 · 제보 // 친구 맺기 + 친구 집 놀러 가기
};
let lists = store.get('lists', {}); // 시트 목록의 화면용 사본
let sec = 'money', curList = 'book';
const L = k => (lists[k] || []).filter(i => k !== 'board' || i.kind === '보드게임');
const yearOpts = () => [...new Set([localISO().slice(0, 4) + '년', ...L('book').map(i => i.year).filter(Boolean)])].sort().reverse();
// 취미 기록 평가: 이모지 5단계 (값 = 이모지 그대로 시트에 저장)
const RATE = [['😫', '😫 별로'], ['😕', '😕 아쉬움'], ['😐', '😐 보통'], ['🙂', '🙂 좋음'], ['😍', '😍 최고']];
const RATE_OPTS = [['', '선택 안 함'], ...RATE];
// 필드: [이름, 라벨, 종류, 선택지]
const LIST_FIELDS = {
  book: [['title', '책 제목', 'text'], ['author', '저자', 'text'], ['year', '연도', 'select', yearOpts],
    ['month', '월', 'select', ['', ...Array.from({ length: 12 }, (_, k) => pad2(k + 1) + '월')]],
    ['status', '독서 상태', 'select', ['읽는중', '완독', '보류', '중도포기']], ['stars', '평가', 'select', RATE_OPTS], ['review', '한 줄 리뷰', 'text'], ['memo', '메모', 'text'], ['image', '표지 이미지 주소', 'url']],
  buy: [['title', '책 제목', 'text'], ['author', '저자', 'text'], ['done', '구매 완료', 'bool'], ['memo', '메모', 'text'], ['image', '표지 이미지 주소', 'url']],
  wish: [['title', '책 제목', 'text'], ['author', '저자', 'text'], ['kind', '구분', 'select', ['추천받은 책', '추가 목록']], ['memo', '메모', 'text'], ['image', '표지 이미지 주소', 'url']],
  escape: [['theme', '테마', 'text'], ['date', '방문일', 'date'], ['shop', '매장', 'text'], ['area', '지역', 'text'], ['result', '결과', 'select', ['', '성공', '실패']],
    ['rating', '평점', 'select', RATE_OPTS], ['people', '인원', 'number'], ['hints', '힌트 수', 'number'], ['left', '남은 시간(분)', 'number'],
    ['cost', '비용(원)', 'number'], ['with', '함께한 사람', 'text'], ['review', '한 줄 리뷰', 'text'], ['image', '포스터 이미지 주소', 'url']],
  board: [['name', '보드게임', 'text'], ['date', '날짜', 'date'], ['place', '장소', 'text'], ['with', '함께한 사람', 'text'], ['rating', '평점', 'select', RATE_OPTS],
    ['review', '한 줄 리뷰', 'text'], ['image', '이미지 주소', 'url']],
  movie: [['title', '영화 제목', 'text'], ['director', '감독', 'text'], ['date', '관람일', 'date'], ['place', '극장', 'text'], ['rating', '평점', 'select', RATE_OPTS],
    ['with', '함께한 사람', 'text'], ['review', '한 줄 리뷰', 'text'], ['image', '포스터 이미지 주소', 'url']],
  play: [['title', '작품명', 'text'], ['kind', '종류', 'select', ['연극', '뮤지컬']], ['date', '관람일', 'date'], ['place', '극장', 'text'], ['cast', '출연', 'text'],
    ['rating', '평점', 'select', RATE_OPTS], ['with', '함께한 사람', 'text'], ['review', '한 줄 리뷰', 'text'], ['image', '포스터 이미지 주소', 'url']],
  escapeWant: [['theme', '가고 싶은 테마', 'text'], ['shop', '매장', 'text'], ['area', '지역', 'text'], ['memo', '메모', 'text'], ['image', '포스터 이미지 주소', 'url']],
  boardWant: [['name', '해 보고 싶은 보드게임', 'text'], ['memo', '메모', 'text'], ['image', '이미지 주소', 'url']],
  movieWant: [['title', '보고 싶은 영화', 'text'], ['memo', '메모 (개봉일, 추천한 사람 등)', 'text'], ['image', '포스터 이미지 주소', 'url']],
  playWant: [['title', '보고 싶은 작품', 'text'], ['kind', '종류', 'select', ['연극', '뮤지컬']], ['memo', '메모', 'text'], ['image', '포스터 이미지 주소', 'url']],
};
const joinDot = a => a.filter(Boolean).join(' · ');
const LIST_ICON = { book: '📚', buy: '🛒', wish: '⭐', escape: '🔐', board: '🎲', movie: '🎬', play: '🎭', movieWant: '🔖', playWant: '🔖', escapeWant: '🔖', boardWant: '🔖' };
// 목록 한 줄: [제목, 설명, 오른쪽 표시]
const LIST_ROW = {
  book: i => [i.title, joinDot([i.author, [i.year, i.month].filter(Boolean).join(' '), i.memo]), i.stars || i.status],
  buy: i => [i.title, joinDot([i.author, i.memo]), i.done ? '✅ 구매함' : '미구매'],
  wish: i => [i.title, joinDot([i.author, i.kind, i.memo]), ''],
  escape: i => [i.theme, joinDot([i.date, i.shop, i.area, i.with, i.review]), joinDot([i.result, i.rating])],
  board: i => [i.name, joinDot([i.date, i.place, i.with, i.review]), i.rating],
  movie: i => [i.title, joinDot([i.director, i.date, i.place, i.with, i.review]), i.rating],
  play: i => [i.title, joinDot([i.kind, i.date, i.place, i.cast, i.with, i.review]), i.rating || i.kind],
  movieWant: i => [i.title, i.memo || '', ''],
  escapeWant: i => [i.theme, joinDot([i.shop, i.area, i.memo]), ''],
  boardWant: i => [i.name, i.memo || '', ''],
  playWant: i => [i.title, joinDot([i.kind, i.memo]), ''],
};
function listSorted(k) {
  const a = [...L(k)].reverse(); // 시트 아래쪽(최근 입력)이 위로
  if (['escape', 'board', 'movie', 'play'].includes(k)) a.sort((x, y) => (y.date || '').localeCompare(x.date || ''));
  if (k === 'buy') a.sort((x, y) => x.done - y.done);
  return a;
}
function listInfo(k, a) {
  const n = a.length;
  if (k === 'book') { const y = localISO().slice(0, 4) + '년'; return `${n}권 · 완독 ${a.filter(i => i.status === '완독').length}권 · 올해 완독 ${a.filter(i => i.status === '완독' && i.year === y).length}권`; }
  if (k === 'buy') return `${n}권 · 아직 안 산 책 ${a.filter(i => !i.done).length}권`;
  if (k === 'wish') return `${n}권`;
  if (k === 'escape') return `${n}개 테마${a.some(i => i.result) ? ` · 성공 ${a.filter(i => i.result === '성공').length}` : ''}`;
  if (k === 'movie') return `${n}편 · 올해 ${a.filter(i => (i.date || '').startsWith(localISO().slice(0, 4))).length}편`;
  if (k === 'play') return `${n}편 · 뮤지컬 ${a.filter(i => i.kind === '뮤지컬').length} · 연극 ${a.filter(i => i.kind === '연극').length}`;
  return `${n}개 기록`;
}
// 목록 위 요약: 독서 연간 목표 고리, 영화·연극·보드게임 평가 분포
function renderStats(k, a) {
  const el = $('#lStats'), y = localISO().slice(0, 4);
  let h = '';
  if (k === 'book') {
    const goal = +store.get('bookGoal', {})[y] || 0, done = a.filter(i => i.status === '완독' && i.year === y + '년').length;
    const C = 2 * Math.PI * 26, pct = goal ? Math.min(1, done / goal) : 0;
    h = `<button type="button" class="goal" id="goalSet" aria-label="올해 독서 목표 ${goal ? goal + '권 중 ' + done + '권' : '정하기'}">
      <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" class="tr"/><circle cx="32" cy="32" r="26" class="pg" stroke-dasharray="${(pct * C).toFixed(1)} ${C.toFixed(1)}"/></svg>
      <b>${done}${goal ? `<small>/${goal}</small>` : ''}</b></button>
      <div><b>${y}년 독서 목표</b><small>${goal ? (done >= goal ? '목표 달성 🎉' : `${goal - done}권 남았어요 · 고리를 눌러 바꾸기`) : '고리를 눌러 올해 몇 권 읽을지 정해요'}</small></div>`;
  } else if (RATE_KEY[k] && k !== 'book' && a.some(i => i[RATE_KEY[k]])) {
    const cnt = RATE.map(([e]) => a.filter(i => i[RATE_KEY[k]] === e).length), max = Math.max(...cnt);
    h = `<div class="rdist" role="img" aria-label="내 평가 분포 ${RATE.map(([e, l], n) => l.slice(e.length + 1) + ' ' + cnt[n]).join(', ')}">${RATE.map(([e], n) =>
      `<span><i style="--h:${max ? Math.round(cnt[n] / max * 100) : 0}%"></i><b>${cnt[n]}</b>${e}</span>`).join('')}</div>`;
  }
  el.hidden = !h; el.innerHTML = h;
}
$('#lStats').addEventListener('click', async e => {
  if (!e.target.closest('#goalSet')) return;
  const y = localISO().slice(0, 4), g = store.get('bookGoal', {}), v = await ask(`${y}년에 몇 권 읽을까요?`, { input: String(g[y] || 24), type: 'number', ok: '정하기' });
  if (v == null) return;
  g[y] = Math.max(0, Math.round(+v) || 0); store.set('bookGoal', g); renderLists();
});
function renderLists() {
  if (!SECTIONS[sec].tabs) return;
  const tabs = SECTIONS[sec].tabs;
  // 독서처럼 목록이 여러 개면 가계부처럼 아래 탭 바로 (위쪽 탭 줄은 쓰지 않음)
  $('#lTabs').hidden = true;
  $('#lNav').hidden = false; // 목록이 하나여도 같은 탭 바 (검색은 탭 바 안)
  $('#lNav').innerHTML = tabs.map(([k, label]) => `<button type="button" data-list="${k}" ${k === curList ? 'aria-current="page"' : ''}><svg class="i" aria-hidden="true"><use href="#${document.getElementById('i-l-' + k) ? 'i-l-' + k : 'i-s-' + sec}"/></svg>${label}</button>`).join('')
    + '<button type="button" data-search><svg class="i" aria-hidden="true"><use href="#i-search"/></svg>검색</button>'; // 책 추가는 가계부처럼 떠 있는 ＋
  document.body.classList.add('tabbar');
  movePill($('#lNav')); requestAnimationFrame(() => movePill($('#lNav'))); // 바로 다시 붙여서 깜빡임 없이 (방금 보이게 된 경우는 다음 프레임에)
  const q = $('#lq').value.trim().toLowerCase(), all = listSorted(curList);
  const a = all.filter(i => !q || Object.values(i).join(' ').toLowerCase().includes(q));
  $('#lInfo').textContent = listInfo(curList, all) + (q ? ` · 검색 ${a.length}건` : '');
  renderStats(curList, all);
  $('#lNotice').hidden = sec !== 'play';
  $('#lNotice').textContent = '🔎 이 목록은 아직 인터넷 자동 검색이 없어요 · 제목·포스터는 직접 입력해 주세요';
  // 독서는 보기 3가지 (나머지 목록은 늘 목록 보기)
  const view = VIEWS[sec] ? lView() : 'list';
  $('#lViews').hidden = !VIEWS[sec];
  $('#lViews').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === view));
  $('#lFlowCard').hidden = view !== 'flow' || !a.length;
  $('#lListCard').hidden = !$('#lFlowCard').hidden;
  $('#lList').classList.toggle('grid', view === 'grid');
  $('#lHead').hidden = $('#lTabs').hidden && $('#lViews').hidden; // 탭도 보기 선택도 없으면 빈 상자를 숨김
  document.body.classList.toggle('white', view === 'flow' && a.length > 0);
  setFab(false); // 모든 목록에 가계부와 같은 떠 있는 ＋ (카드 안 ＋는 안 씀)
  if (view === 'flow' && a.length) return renderFlow(a);
  if (view === 'grid') {
    $('#lList').innerHTML = a.map(i => `<li data-id="${esc(i.id)}">${coverHTML(i)}<span>${esc(LIST_ROW[curList](i)[0])}</span><small>${esc(joinDot([i.author || i.shop || i.director || i.place, LIST_ROW[curList](i)[2]]))}</small></li>`).join('')
      || `<li class="empty">${q ? '검색 결과가 없어요' : '아직 기록이 없어요 · ＋ 버튼으로 추가하세요'}</li>`;
    if (selecting) paintSel();
    return;
  }
  $('#lList').innerHTML = a.map(i => { const [t, sub, right] = LIST_ROW[curList](i);
    return `<li data-id="${esc(i.id)}">${i.image ? `<img class="thumb" src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="em" aria-hidden="true">${LIST_ICON[curList]}</span>`}<div><span>${esc(t)}${i.shared ? `<span class="badge shared-badge">${esc(i.shared)} 기록</span>` : ''}${i.pub ? '<span class="pub-mark" title="친구 공개" aria-label="친구 공개"><svg class="i" aria-hidden="true"><use href="#i-s-friends"/></svg></span>' : ''}</span><small>${esc(sub)}</small>${othersLine(i)}</div>${right ? `<b class="move" style="font-size:13px">${esc(right)}</b>` : ''}</li>`; }).join('')
    || `<li class="empty">${q ? '검색 결과가 없어요' : '아직 기록이 없어요 · ＋ 버튼으로 추가하세요'}</li>`;
  if (selecting) paintSel();
}
// ── 독서 보기: flow(아이팟 커버플로우, 기본) · grid(표지 카드 3열) · list(목록) ──
// 보기 3가지는 표지·포스터가 있는 독서·방탈출. 평가 칸은 목록마다 이름이 달라요 (독서 별점 stars, 방탈출 평점 rating)
const VIEWS = { book: 'bookView', escape: 'escapeView', board: 'boardView', movie: 'movieView', play: 'playView' };
const RATE_KEY = { book: 'stars', escape: 'rating', board: 'rating', movie: 'rating', play: 'rating' };
const lView = () => store.get(VIEWS[sec], 'flow');
let flowItems = [], flowId = '', flowShown = '';
const FC = 80; // 커버플로우에서 책 사이 간격(px) = 한 칸 넘길 때 움직이는 거리
const coverHTML = i => { const t = esc(LIST_ROW[curList](i)[0]);
  return i.image ? `<img class="cover" src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-t="${t}">` : `<span class="cover ph" style="--h:${hue(t)}">${t}</span>`; };
const hue = t => [...t].reduce((h, c) => (h * 31 + c.codePointAt(0)) % 360, 7); // 같은 제목은 늘 같은 색
function renderFlow(a) {
  const el = $('#lFlow');
  flowItems = a; flowShown = '';
  el.innerHTML = a.map(i => `<button type="button" class="fc" data-id="${esc(i.id)}" role="option" aria-label="${esc(LIST_ROW[curList](i)[0])}">${coverHTML(i)}</button>`).join('');
  el.scrollLeft = Math.max(0, a.findIndex(i => i.id === flowId)) * FC; // 다시 그려도 보던 책에서 시작
  flowPaint();
}
// 가운데에서 떨어진 정도(d)만큼 비스듬히 돌리고 뒤로 보냄. 가운데 책 정보는 아래에 표시
function flowPaint() {
  const el = $('#lFlow'), c = el.scrollLeft / FC;
  [...el.children].forEach((b, k) => {
    const d = k - c, t = Math.max(-1, Math.min(1, d));
    b.style.visibility = Math.abs(d) > 7 ? 'hidden' : '';
    b.style.zIndex = 100 - Math.round(Math.abs(d) * 10);
    b.firstElementChild.style.transform = `translateX(${t * 34}px) translateZ(${-Math.abs(t) * 160}px) rotateY(${-t * 68}deg)`;
  });
  const i = flowItems[Math.min(flowItems.length - 1, Math.max(0, Math.round(c)))];
  if (!i || i.id === flowShown) return;
  flowShown = flowId = i.id;
  $('#fTitle').textContent = LIST_ROW[curList](i)[0];
  $('#fSub').textContent = { escape: () => joinDot([i.date, i.shop, i.result]), board: () => joinDot([i.date, i.place, i.with]), movie: () => joinDot([i.director, i.date, i.place]),
    play: () => joinDot([i.kind, i.date, i.place]) }[curList]?.() ?? joinDot([i.author, curList === 'book' ? i.status : i.memo]);
  if (i.shared) $('#fSub').textContent = joinDot([$('#fSub').textContent, `${i.shared}님 기록`]);
  if (i.others?.length) $('#fSub').textContent = joinDot([$('#fSub').textContent, ...i.others.map(o => `${o.name} ${o.rating || '–'}`)]);
  const rk = RATE_KEY[curList];
  $('#fRate').hidden = $('#fReview').hidden = !rk; // 평가와 한 줄 리뷰를 한 화면에 함께
  const nq = quotesOf(i).length;
  $('#fQuotes').hidden = curList !== 'book';
  $('#fQuotes').textContent = nq ? `❝ 밑줄 ${nq}` : '❝ 밑줄 문장 남기기';
  if (document.activeElement !== $('#fReviewText')) $('#fReviewText').value = i.review || '';
  $('#fRate').innerHTML = RATE.map(([e, l]) => `<button type="button" data-r="${e}" aria-pressed="${i[rk] === e}" aria-label="${l.slice(e.length + 1)}">${e}</button>`).join('');
}
let flowRaf = 0;
$('#lFlow').addEventListener('scroll', () => { if (!flowRaf) flowRaf = requestAnimationFrame(() => { flowRaf = 0; flowPaint(); }); }, { passive: true });
$('#lFlow').addEventListener('click', e => {
  const b = e.target.closest('.fc');
  if (!b) return;
  const k = [...$('#lFlow').children].indexOf(b);
  if (k === Math.round($('#lFlow').scrollLeft / FC)) openItem(flowItems[k]); // 가운데 책을 누르면 편집
  else $('#lFlow').scrollTo({ left: k * FC, behavior: calm() ? 'auto' : 'smooth' });
});
// 가운데 책 아래 이모지를 누르면 바로 평가 저장 (같은 걸 다시 누르면 지움)
$('#fRate').addEventListener('click', e => {
  const rk = RATE_KEY[curList], r = e.target.closest('[data-r]')?.dataset.r, it = r && rk && (lists[curList] || []).find(i => i.id === flowShown);
  if (!it) return;
  if (it.shared) return rateShared(it);
  it[rk] = it[rk] === r ? '' : r;
  store.set('lists', lists);
  flowShown = ''; flowPaint();
  const key = LIST_FIELDS[curList][0][0]; // 시트가 줄을 찾는 제목 칸 (독서 title, 방탈출 theme)
  queue({ action: 'listSave', list: curList, item: { id: it.id, [key]: it[key], [rk]: it[rk] } });
});
$('#fAdd').addEventListener('click', () => sec === 'book' ? openFind() : openItem());
// ── 독서: 책을 검색해서 읽는 책 · 위시리스트 · 추천 목록에 바로 추가 (알라딘) ──
const FIND_TO = [['book', '읽는 중'], ['buy', '위시리스트'], ['wish', '추천']];
let findHits = [], findT = 0;
// 방탈출은 전국방탈출(roomescape.co.kr) 공개 테마 페이지로 시트가 만든 목록에서 검색 → 고르면 테마·매장·포스터가 채워진 입력 창
const escMode = () => sec === 'escape';
function openFind() {
  const t = { escape: ['테마', '테마나 매장 이름', '테마나 매장 이름을 검색해요 · 전국방탈출 정보'], board: ['보드게임', '보드게임 이름', '보드게임 이름을 검색해요 · 코리아보드게임즈 정보'], movie: ['영화', '영화 제목', '영화 제목을 검색해요 · 키노라이츠 정보'] }[sec] || ['책', '책 제목이나 저자', '책 제목이나 저자를 검색해요'];
  $('#findTitle').textContent = `${t[0]} 검색해서 추가`;
  $('#findManual').textContent = `찾는 ${t[0]}${t[0] === '책' ? '이' : '가'} 없어요 · 직접 입력`;
  $('#findQ').placeholder = t[1];
  $('#findQ').value = ''; $('#findList').innerHTML = `<li class="empty">${t[2]}</li>`;
  $('#bookFind').showModal(); $('#findQ').focus();
}
const escRow = (b, k) => `<li><img class="thumb" src="${esc(b.image)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'"><div><span>${esc(b.theme)}</span><small>${esc(joinDot([b.shop, b.area, b.genre]))}${L('escape').some(i => i.theme === b.theme) ? ' · 이미 기록에 있어요' : ''}</small>
    <div class="find-to"><button type="button" class="small" data-k="${k}" data-to="escape">＋ 기록하기</button><button type="button" class="small" data-k="${k}" data-to="escapeWant">＋ 위시리스트</button></div></div></li>`;
const findRow = (b, k) => {
  if (escMode()) return escRow(b, k);
  if (sec === 'board') return `<li><img class="thumb" src="${esc(b.image)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'"><div><span>${esc(b.name)}</span><small>${b.price ? b.price.toLocaleString('ko-KR') + '원' : ''}${L('board').some(i => i.name === b.name) ? ' · 이미 기록에 있어요' : ''}</small>
    <div class="find-to"><button type="button" class="small" data-k="${k}" data-to="board">＋ 기록하기</button><button type="button" class="small" data-k="${k}" data-to="boardWant">＋ 위시리스트</button></div></div></li>`;
  if (sec === 'movie') return `<li><img class="thumb" src="${esc(b.image)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'"><div><span>${esc(b.title)}</span><small>${esc(joinDot([b.year, b.type]))}${L('movie').some(i => i.title === b.title) ? ' · 이미 기록에 있어요' : ''}</small>
    <div class="find-to"><button type="button" class="small" data-k="${k}" data-to="movie">＋ 기록하기</button><button type="button" class="small" data-k="${k}" data-to="movieWant">＋ 위시리스트</button></div></div></li>`;
  const has = FIND_TO.filter(([l]) => L(l).some(i => i.title === b.title)).map(([, n]) => n);
  return `<li><img class="thumb" src="${esc(b.image)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'"><div><span>${esc(b.title)}</span><small>${esc(b.author)}${has.length ? ' · ' + has.join('·') + '에 있어요' : ''}</small>
    <div class="find-to">${FIND_TO.map(([l, n]) => `<button type="button" class="small" data-k="${k}" data-to="${l}">＋ ${n}</button>`).join('')}</div></div></li>`;
};
const findMemo = new Map();
$('#findQ').addEventListener('input', () => {
  clearTimeout(findT);
  const q = $('#findQ').value.trim();
  if (q.length < 2) return;
  const what = escMode() ? 'escape' : sec === 'board' || sec === 'movie' ? sec : 'book', key = what + ':' + q;
  $('#findList').innerHTML = '<li class="empty">찾는 중…</li>';
  findT = setTimeout(async () => {
    try {
      // 같은 검색어는 이 화면이 켜져 있는 동안 다시 묻지 않음 (서버도 6시간 기억)
      const r = findMemo.get(key) || await api(null, `&what=${what}&q=` + encodeURIComponent(q));
      if (!(what === 'escape' && r.building)) findMemo.set(key, r);
      if (q !== $('#findQ').value.trim()) return;
      const hits = escMode() ? r.themes : sec === 'board' ? r.games : sec === 'movie' ? r.movies : r.books;
      if (!hits) throw new Error('시트의 Code.gs를 새 버전으로 배포해 주세요');
      findHits = hits;
      $('#findList').innerHTML = findHits.map(findRow).join('') || `<li class="empty">${escMode() && r.building ? `검색 결과가 없어요 · 시트가 아직 테마 목록을 모으는 중이에요 (지금 ${(r.count || 0).toLocaleString()}개, 다 모으면 약 2,000개) · 조금 뒤 다시 검색해 주세요` : '검색 결과가 없어요'}</li>`;
    } catch (e) { $('#findList').innerHTML = `<li class="empty">검색이 안 돼요 · ${esc(e.message)}</li>`; }
  }, findMemo.has(key) ? 0 : 250);
});
$('#findQ').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('#findList').addEventListener('click', e => {
  const btn = e.target.closest('[data-to]'), b = btn && findHits[btn.dataset.k];
  if (!b) return;
  if (btn.dataset.to === 'board') { $('#bookFind').close(); return openItem(null, { name: b.name, ...(b.image ? { image: b.image } : {}) }); } // 날짜·장소·함께한 사람은 직접
  if (btn.dataset.to === 'movie') { $('#bookFind').close(); return openItem(null, { title: b.title, ...(b.image ? { image: b.image } : {}) }); } // 관람일·극장은 직접
  if (btn.dataset.to === 'movieWant') {
    const item = { id: crypto.randomUUID(), title: b.title, memo: b.year ? b.year + '년' : '', ...(b.image ? { image: b.image } : {}) };
    (lists.movieWant = lists.movieWant || []).push(item); store.set('lists', lists);
    btn.disabled = true; btn.textContent = '✓ 담음';
    saveNew('movieWant', item).then(ok => ok && toast(`「${b.title}」 위시리스트에 담았어요`));
    return curList === 'movieWant' && renderLists();
  }
  if (btn.dataset.to === 'boardWant') {
    const item = { id: crypto.randomUUID(), name: b.name, memo: b.price ? `${b.price.toLocaleString('ko-KR')}원` : '', ...(b.image ? { image: b.image } : {}) };
    (lists.boardWant = lists.boardWant || []).push(item); store.set('lists', lists);
    btn.disabled = true; btn.textContent = '✓ 담음';
    saveNew('boardWant', item).then(ok => ok && toast(`「${b.name}」 위시리스트에 담았어요`));
    return curList === 'boardWant' && renderLists();
  }
  if (btn.dataset.to === 'escapeWant') { // 가고 싶은 방탈출은 바로 저장
    const item = { id: crypto.randomUUID(), theme: b.theme, shop: b.shop, area: b.area || '', memo: '', ...(b.image ? { image: b.image } : {}) };
    (lists.escapeWant = lists.escapeWant || []).push(item); store.set('lists', lists);
    btn.disabled = true; btn.textContent = '✓ 담음';
    saveNew('escapeWant', item).then(ok => ok && toast(`「${b.theme}」 위시리스트에 담았어요`));
    return curList === 'escapeWant' && renderLists();
  }
  if (btn.dataset.to === 'escape') { $('#bookFind').close(); return openItem(null, { theme: b.theme, shop: b.shop, area: b.area || '', ...(b.image ? { image: b.image } : {}) }); } // 날짜·결과는 직접
  const to = btn.dataset.to, t = localISO(), arr = lists[to] = lists[to] || [];
  const item = { id: crypto.randomUUID(), title: b.title, author: b.author, memo: '', ...(b.image ? { image: b.image } : {}),
    ...{ book: { year: t.slice(0, 4) + '년', month: t.slice(5, 7) + '월', status: '읽는중' }, buy: { done: false }, wish: { kind: '추천받은 책' } }[to] };
  if (to === 'book') item.seq = arr.filter(i => i.year === item.year && i.month === item.month).length + 1;
  arr.push(item); store.set('lists', lists);
  btn.disabled = true; btn.textContent = '✓ 추가됨';
  const name = FIND_TO.find(x => x[0] === to)[1];
  saveNew(to, item).then(ok => ok && toast(`「${b.title}」 ${name}에 추가했어요`));
  if (curList === to) renderLists();
});
$('#findManual').addEventListener('click', () => { $('#bookFind').close(); openItem(); });
$('#findClose').addEventListener('click', () => $('#bookFind').close());
// 밑줄 문장: 책마다 여러 개 (시트 「밑줄 문장」 칸에 빈 줄로 나눠 저장). 카드를 넘기듯 좌우로 넘겨봄
const quotesOf = i => String(i.quotes || '').split(/\n\s*\n/).map(t => t.trim()).filter(Boolean);
let qBook = null;
function renderQuotes() {
  const a = quotesOf(qBook);
  $('#qTitle').textContent = qBook.title;
  $('#qCards').innerHTML = a.map((t, k) => `<figure class="qcard"><blockquote>${esc(t)}</blockquote><figcaption>${k + 1} / ${a.length}<button type="button" class="small danger" data-qdel="${k}">지우기</button></figcaption></figure>`).join('')
    || '<figure class="qcard empty"><blockquote>마음에 남은 문장을 아래에 적어 두세요</blockquote></figure>';
}
$('#fQuotes').addEventListener('click', () => {
  qBook = (lists.book || []).find(i => i.id === flowShown); if (!qBook) return;
  renderQuotes(); $('#qText').value = ''; $('#quotes').showModal();
});
const saveQuotes = a => {
  qBook.quotes = a.join('\n\n'); store.set('lists', lists); renderQuotes(); flowShown = ''; flowPaint();
  return queue({ action: 'listSave', list: 'book', item: { id: qBook.id, title: qBook.title, quotes: qBook.quotes } });
};
$('#qForm').addEventListener('submit', e => {
  e.preventDefault();
  const t = $('#qText').value.trim(); if (!t) return;
  $('#qText').value = '';
  saveQuotes([...quotesOf(qBook), t]).then(ok => ok && toast('밑줄 문장을 저장했어요'));
  requestAnimationFrame(() => $('#qCards').scrollTo({ left: 1e6, behavior: 'smooth' }));
});
$('#qCards').addEventListener('click', async e => {
  const k = e.target.closest('[data-qdel]')?.dataset.qdel;
  if (k != null && await ask('이 문장을 지울까요?', { ok: '지우기', danger: true })) saveQuotes(quotesOf(qBook).filter((_, n) => n !== +k));
});
$('#qClose').addEventListener('click', () => $('#quotes').close());
// 한 줄 리뷰: 가운데 항목의 리뷰를 바로 쓰고 저장 (독서 「한 줄 리뷰」, 나머지는 「후기」 칸)
$('#fReview').addEventListener('submit', e => {
  e.preventDefault();
  const it = (lists[curList] || []).find(i => i.id === flowShown), v = $('#fReviewText').value.trim();
  if (!it) return;
  if (it.shared) return rateShared(it);
  it.review = v; store.set('lists', lists);
  const key = LIST_FIELDS[curList][0][0];
  $('#fReviewText').blur();
  queue({ action: 'listSave', list: curList, item: { id: it.id, [key]: it[key], review: v } }).then(ok => ok && toast('한 줄 리뷰를 저장했어요'));
});
$('#lViews').addEventListener('click', e => {
  const v = e.target.closest('[data-v]')?.dataset.v;
  if (v) { store.set(VIEWS[sec], v); renderLists(); }
});
const loadedAt = {}, FRESH_MS = 180e3;
const stale = k => Date.now() - (loadedAt[k] || 0) > FRESH_MS;
let forceFresh = false; // 새로고침 단추를 누른 뒤 한 번은 시트 캐시도 건너뜀
async function refreshLists() {
  if (!cfg.token) return sec === 'money' ? render() : sec === 'habit' ? renderHabits() : renderLists(); // 연결 전엔 시트에 묻지 않음 (오류 대신 시작 화면)
  try {
    busy(true);
    document.body.classList.toggle('loading', !(lists[curList] || []).length);
    if (await sync()) {
      try {
        const r = await api(null, '&what=lists' + (forceFresh ? '&fresh=1' : ''));
        if (!r.lists) setStatus('시트의 Code.gs를 새 버전으로 배포해야 목록을 볼 수 있어요');
        else { loadedAt.lists = Date.now(); lists = r.lists; store.set('lists', lists); if (r.people && me.token === cfg.token) { me.people = r.people; store.set('me', me); } setStatus('시트와 동기화됨'); }
      } catch (e) { showError(e); }
    }
    renderLists();
  } finally { busy(false); document.body.classList.remove('loading'); }
}
function setSection(k) {
  if (selecting) setSelecting(false);
  if (splitUl) endSplit();
  sec = k;
  document.body.classList.remove('white'); // 독서 커버플로우에서만 흰 바탕 (renderLists가 다시 켬)
  document.body.classList.remove('searching');
  document.body.classList.toggle('money', k === 'money');
  document.body.classList.toggle('tabbar', k === 'money'); // 탭 바 안에 검색 항목이 있으면 떠 있는 검색 단추는 숨김
  $('#searchBtn').hidden = k === 'habit';
  if ($('#lq').value) $('#lq').value = '';
  store.set('sec', k);
  $('#appTitle').textContent = SECTIONS[k].title;
  const money = k === 'money', habit = k === 'habit', home = k === 'home', fr = k === 'friends', nt = k === 'notice';
  $('#v-dash').hidden = !home; $('#v-friends').hidden = !fr; $('#v-notice').hidden = !nt;
  $('#monthRow').hidden = !money;
  document.querySelector('nav').hidden = !money;
  $('#lNav').hidden = true; // 목록 화면이면 renderLists가 다시 켬
  requestAnimationFrame(() => movePill(document.querySelector('nav')));
  $('#v-lists').hidden = money || habit || home || fr || nt;
  $('#v-habit').hidden = !habit;
  if (!money) replay($('#v-' + (home ? 'dash' : habit ? 'habit' : fr ? 'friends' : nt ? 'notice' : 'lists')), 'enter');
  if (money) show(curView);
  else {
    ['home', 'cal', 'list', 'rec'].forEach(x => { $('#v-' + x).hidden = true; });
    $('#filters').hidden = true;
    setFab((habit && !isFriend()) || home || fr); // 친구는 습관도 ＋로 직접 만듦
    if (nt) { setFab(true); renderNotice(); window.scrollTo(0, 0); return; }
    if (fr) { renderSocial(); if (stale('me')) loadMe().then(() => sec === 'friends' && renderSocial()); window.scrollTo(0, 0); return; }
    if (home) { renderDash(); Promise.all([stale('lists') && refreshLists(), stale('habits') && refreshHabits()]).then(() => sec === 'home' && renderDash()); window.scrollTo(0, 0); return; }
    if (habit) { renderHabits(); if (stale('habits')) refreshHabits(); window.scrollTo(0, 0); return; }
    curList = SECTIONS[k].tabs[0][0];
    $('#lq').value = '';
    renderLists();
    if (stale('lists')) refreshLists(); // 이미 불러온 목록은 그대로 (3분 지나면 다시)
    window.scrollTo(0, 0);
  }
}
// ── 습관: 틱틱과 실시간 연동 (시트의 Apps Script가 중계) ──
// 습관 화면엔 절주·운동만 (틱틱의 다른 습관은 불러와도 안 보임)
const MY_HABITS = h => /^(절주|운동)/.test(h.name);
const myHabits = a => isFriend() ? a : a.filter(MY_HABITS); // 친구는 자기가 만든 습관 전부
let habits = myHabits(store.get('habits', [])), hDay = localISO().slice(0, 10), hOff = false;
const HICON = { habit_daily_check_in: '✅', habit_reading: '📖', habit_skincare: '🧴', habit_learn_words: '🗣️', habit_take_medicine: '💊',
  habit_exercising: '🏃', habit_eat_dinner: '🍚', habit_quit_drinking: '🍺', habit_drink_water: '💧', habit_sleep: '😴', habit_meditation: '🧘' };
const stampOf = iso => +iso.replace(/-/g, '');
const isoAdd = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
// 반복 규칙: 요일 지정(BYDAY)만 따지고, 나머지(매일·주 n회 등)는 매일 보여 줌
function dueOn(h, iso) {
  const by = /BYDAY=([A-Z,]+)/.exec(h.rule);
  return !by || by[1].split(',').includes(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(iso + 'T12:00:00').getDay()]);
}
function streak(h) {
  const today = localISO().slice(0, 10);
  let n = 0;
  for (let d = today, i = 0; i < 371; i++, d = isoAdd(d, -1)) {
    if (!dueOn(h, d)) continue;
    if (h.done.includes(stampOf(d))) n++;
    else if (d !== today) break; // 오늘은 아직 안 했어도 연속은 유지
  }
  return n;
}
const hF = foldCal($('#hClip'), $('#hGrid'), $('#hGrab'), false, { opening: () => renderHabits(true), closed: () => renderHabits() }); // 접힘: 최근 7일, 펼침: 한 달
let hMon = hDay.slice(0, 7);
function renderHabits(month = hF.open) {
  const today = localISO().slice(0, 10), { y, mo, first, days, lead, tail } = monthGrid(hMon);
  $('#hMonth').textContent = month ? `${y}년 ${mo}월` : '최근 7일';
  $('#hPrev').hidden = $('#hNext').hidden = !month;
  $('#hNext').disabled = hMon >= today.slice(0, 7);
  // 접혀 있으면 오늘이 맨 오른쪽인 최근 7일, 펼치면 달력
  const cells = month ? range(1, days).map(d => `${hMon}-${pad2(d)}`) : range(0, 6).map(k => isoAdd(today, k - 6));
  // 요일 머리글도 칸 순서대로 (최근 7일은 오늘 요일이 맨 오른쪽)
  $('#hWeek').innerHTML = cells.slice(0, 7).map((ds, k) => { const w = month ? k : new Date(ds + 'T12:00:00').getDay(); return `<span class="${w === 0 ? 'sun' : w === 6 ? 'sat' : ''}">${'일월화수목금토'[w]}</span>`; }).join('');
  let html = month ? lead : '';
  for (const ds of cells) {
    const d = +ds.slice(8), wd = new Date(ds + 'T12:00:00').getDay(), due = habits.filter(h => dueOn(h, ds));
    const n = due.filter(h => h.done.includes(stampOf(ds))).length;
    const cls = [ds === today && 'today', ds > today && 'future', wd === 0 && 'sun', wd === 6 && 'sat'].filter(Boolean).join(' ');
    html += `<button type="button" data-d="${ds}" class="${cls}" aria-pressed="${ds === hDay}" ${ds > today ? 'disabled' : ''} aria-label="${mo}월 ${d}일 ${n}/${due.length} 완료">
      <span class="d">${month || d !== 1 ? d : +ds.slice(5, 7) + '/' + d}</span>${!due.length || ds > today ? '' : due.length <= 4 ? `<span class="hdots" aria-hidden="true">${due.map(h =>
        `<i class="${h.done.includes(stampOf(ds)) ? 'on' : ''}" style="--c:${esc(hColor(h))}"></i>`).join('')}</span>`
        : `<span class="hbar${n === due.length ? ' full' : ''}" aria-hidden="true"><i style="width:${Math.round(n / due.length * 100)}%"></i></span>`}</button>`; // 습관이 많으면 점 대신 막대 (칸 밖으로 안 넘침)
  }
  $('#hGrid').innerHTML = html + (month ? tail : '');
  hF.week = month && hDay.startsWith(hMon) ? Math.floor((first + +hDay.slice(8) - 1) / 7) : 0;
  hF.fit();
  const due = habits.filter(h => dueOn(h, hDay)), st = stampOf(hDay), n = due.filter(h => h.done.includes(st)).length;
  $('#hInfo').textContent = habits.length ? `${hDay === today ? '오늘' : `${+hDay.slice(5, 7)}월 ${+hDay.slice(8)}일`} ${n}/${due.length} 완료` : '';
  $('#hList').innerHTML = due.map(h => {
    const on = h.done.includes(st), s = streak(h);
    return `<li style="--c:${esc(hColor(h))}" class="${on ? 'done' : ''}" data-hd="${esc(h.id)}"><span class="hic" aria-hidden="true">${esc(hIcon(h))}</span>
      <div><span>${esc(h.name)}</span><small>${s ? `🔥 ${s}일 연속 · ` : ''}총 ${h.total}일${h.enc ? ' · ' + esc(h.enc) : ''}</small></div>
      <button type="button" class="hcheck" data-h="${esc(h.id)}" aria-pressed="${on}" aria-label="${esc(h.name)} ${on ? '체크 해제' : '체크'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button></li>`;
  }).join('') || (isFriend() ? `<li class="empty hoff"><b>${habits.length ? '이날은 할 습관이 없어요' : '나만의 습관을 만들어 보세요'}</b><span>＋를 눌러 물 마시기, 운동처럼 매일 체크할 습관을 추가해요.</span></li>`
    : hOff ? `<li class="empty hoff"><b>틱틱 습관을 여기서 체크할 수 있어요</b><span>틱틱 계정을 시트에 한 번 연결하면, 체크가 틱틱에도 바로 반영돼요.</span><button type="button" class="small" data-help="help-ticktick">연결 방법 보기</button></li>`
    : `<li class="empty">${habits.length ? '이날은 할 습관이 없어요' : '틱틱 습관을 불러오는 중이에요'}</li>`);
  const rest = habits.length - due.length;
  $('#hRest').textContent = rest ? `이날 쉬는 습관 ${rest}개` : '';
  renderHabitEach(today);
}
// 습관별 달력: 습관마다 한 달을 작은 칸으로 (한 칸 = 하루). 색 = 한 날, 회색 = 할 날인데 안 함, 빗금 = 쉬는 날
function renderHabitEach(today) {
  const { mo, first, days } = monthGrid(hMon);
  $('#hEachTitle').textContent = `${mo}월 습관별 기록`;
  $('#hEach').innerHTML = habits.map(h => {
    let done = 0, due = 0;
    const cells = Array(first).fill('<i class="pad"></i>').concat(range(1, days).map(d => {
      const ds = `${hMon}-${pad2(d)}`;
      if (ds > today) return '<i class="later"></i>';
      if (!dueOn(h, ds)) return '<i class="rest"></i>';
      due++; if (h.done.includes(stampOf(ds))) { done++; return '<i class="on"></i>'; }
      return '<i></i>';
    })).join('');
    return `<button type="button" class="h1" data-hd="${esc(h.id)}" style="--c:${esc(hColor(h))}" aria-label="${esc(h.name)} ${mo}월 ${done}일 완료">
      <span class="h1-head"><span class="hic" aria-hidden="true">${esc(hIcon(h))}</span><b>${esc(h.name)}</b><small>${done}/${due}</small></span>
      <span class="h1-grid" aria-hidden="true">${cells}</span></button>`;
  }).join('');
  $('#hEachCard').hidden = !habits.length;
}
$('#hEach').addEventListener('click', e => { const h = habits.find(x => x.id === e.target.closest('[data-hd]')?.dataset.hd); if (h) openHabit(h); });
async function refreshHabits() {
  if (!cfg.token) return sec === 'money' ? render() : sec === 'habit' ? renderHabits() : renderLists(); // 연결 전엔 시트에 묻지 않음 (오류 대신 시작 화면)
  try {
    busy(true);
    if (await sync()) {
      try {
        const r = await api(null, '&what=habits' + (forceFresh ? '&fresh=1' : ''));
        if (r.habits) loadedAt.habits = Date.now();
        if (!r.habits) setStatus('시트의 Code.gs를 새 버전으로 배포해야 습관을 볼 수 있어요');
        else { habits = myHabits(r.habits); hOff = false; store.set('habits', habits); setStatus(isFriend() ? '시트와 동기화됨' : '틱틱과 동기화됨'); }
      } catch (e) { if (!habits.length && /틱틱/.test(e.message)) hOff = true; else showError(e); } // 한 번도 연결한 적 없으면 오류 대신 안내
    }
    if (sec === 'habit') renderHabits();
  } finally { busy(false); }
}
$('#hGrid').addEventListener('click', e => {
  const d = e.target.closest('[data-d]')?.dataset.d;
  if (d) { hDay = d; renderHabits(); }
});
const hMove = n => { hMon = ymAdd(hMon, n); renderHabits(); };
$('#hPrev').addEventListener('click', () => hMove(-1));
$('#hNext').addEventListener('click', () => hMove(1));
$('#hList').addEventListener('click', e => {
  const id = e.target.closest('[data-h]')?.dataset.h, h = id && habits.find(x => x.id === id);
  if (!h) { const d = habits.find(x => x.id === e.target.closest('[data-hd]')?.dataset.hd); return d && openHabit(d); } // 줄을 누르면 1년 잔디
  const st = stampOf(hDay), done = !h.done.includes(st);
  h.done = done ? [...h.done, st] : h.done.filter(x => x !== st);
  h.total = Math.max(0, h.total + (done ? 1 : -1));
  store.set('habits', habits);
  renderHabits();
  queue({ action: 'habitCheck', habitId: h.id, stamp: st, done }).then(ok => ok && setStatus(isFriend() ? '저장됨' : '틱틱에 반영됨'));
});
// 습관 상세: 최근 1년 잔디(주마다 한 줄, 오른쪽 끝이 이번 주) + 최장 연속
function openHabit(h) {
  const today = localISO().slice(0, 10), start = isoAdd(today, -364 - new Date(today + 'T12:00:00').getDay()); // 53주 전 일요일부터
  let best = 0, run = 0, cells = '', yearN = 0;
  for (let d = start; d <= today; d = isoAdd(d, 1)) {
    const due = dueOn(h, d), on = h.done.includes(stampOf(d));
    if (due) { if (on) best = Math.max(best, ++run); else if (d !== today) run = 0; }
    if (on && d.startsWith(today.slice(0, 4))) yearN++;
    cells += `<i class="${on ? 'on' : due && d < today ? 'miss' : ''}" title="${d}${on ? ' 완료' : ''}"></i>`;
  }
  $('#hdTitle').textContent = `${hIcon(h)} ${h.name}`;
  $('#hdDelete').hidden = !h.local; $('#hdDelete').dataset.id = h.id;
  $('#hdStats').innerHTML = `<span><b>${streak(h)}일</b><small>지금 연속</small></span><span><b>${best}일</b><small>최장 연속</small></span><span><b>${yearN}일</b><small>올해 완료</small></span><span><b>${h.total}일</b><small>전체</small></span>`;
  const g = $('#hdGrid'); g.style.setProperty('--c', hColor(h) || 'var(--accent)'); g.innerHTML = cells;
  $('#hdColors').dataset.id = h.id;
  $('#hdColors').innerHTML = H_COLOR.concat(['#5ac8fa', '#ff9f0a', '#8e8e93']).filter((c, i, a) => a.indexOf(c) === i).map(c => `<button type="button" data-c="${c}" style="--c:${c}" aria-pressed="${hColor(h).toLowerCase() === c}" aria-label="이 색으로"></button>`).join('')
    + `<label class="hd-custom" aria-label="직접 고르기"><input type="color" value="${esc(hColor(h))}"><span>＋</span></label>`;
  $('#hDetail').showModal();
  g.parentElement.scrollLeft = 1e6; // 이번 주가 보이게
}
$('#hdClose').addEventListener('click', () => $('#hDetail').close());
// ── 「오늘」 대시보드 (게스트의 첫 화면): 인사 → 오늘 습관 고리 → 읽는 책 → 최근 기록 → 함께한 기록 → 위시리스트 ──
// 참고: Apple 피트니스 요약(고리), 토스 홈(카드 묶음), Daylio·Streaks(연속 기록), 인스타 친구 피드(함께한 기록), Notion 홈(최근 항목)
const RECENT_KEYS = [['escape', 'theme', '🔐'], ['board', 'name', '🎲'], ['movie', 'title', '🎬'], ['play', 'title', '🎭'], ['book', 'title', '📚']];
function renderDash() {
  const now = new Date(), h = now.getHours(), today = localISO().slice(0, 10), st = stampOf(today);
  const nm = me.token === cfg.token && me.name ? me.name : '';
  $('#dashDate').textContent = `${now.getMonth() + 1}월 ${now.getDate()}일 ${'일월화수목금토'[now.getDay()]}요일`;
  $('#dashHi').textContent = `${nm ? nm + '님, ' : ''}${h < 6 ? '늦은 밤이에요' : h < 12 ? '좋은 아침이에요' : h < 18 ? '좋은 오후예요' : '오늘도 수고했어요'}`;
  // 오늘 습관 고리
  const due = habits.filter(x => dueOn(x, today)), done = due.filter(x => x.done.includes(st)).length, pct = due.length ? done / due.length : 0, C = 2 * Math.PI * 34;
  $('#dashHabit').innerHTML = `<button type="button" class="dash-ring" data-go="habit" aria-label="오늘 습관 ${done}/${due.length}"><svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" class="tr"/><circle cx="40" cy="40" r="34" class="pg" stroke-dasharray="${(pct * C).toFixed(1)} ${C.toFixed(1)}"/></svg><b>${done}<small>/${due.length}</small></b></button>
    <div><h2>오늘 습관</h2><div class="dash-chips">${due.map(x => `<button type="button" class="small" data-hab="${esc(x.id)}" aria-pressed="${x.done.includes(st)}" style="--c:${esc(hColor(x))}">${esc(hIcon(x))} ${esc(x.name)}</button>`).join('') || '<span class="hint">＋ 습관에서 오늘 할 습관을 만들어요</span>'}</div></div>`;
  // 읽는 책 + 올해 목표
  const reading = L('book').filter(i => i.status === '읽는중' && !i.shared).slice(-1)[0], y = today.slice(0, 4), goal = +store.get('bookGoal', {})[y] || 0;
  const read = L('book').filter(i => i.status === '완독' && i.year === y + '년' && !i.shared).length;
  $('#dashBook').innerHTML = `<h2>읽는 책</h2>${reading ? `<button type="button" class="dash-book" data-go="book">${reading.image ? `<img src="${esc(reading.image)}" alt="" referrerpolicy="no-referrer" onerror="this.outerHTML='<span class=&quot;cover ph&quot;>📖</span>'">` : '<span class="cover ph">📖</span>'}<span><b>${esc(reading.title)}</b><small>${esc(reading.author || '')}</small></span></button>` : '<p class="hint">읽고 있는 책이 없어요 · 독서에서 ＋로 추가해요</p>'}
    <div class="dash-goal"><span>올해 ${read}권 읽음${goal ? ` / 목표 ${goal}권` : ''}</span><span class="bar"><i style="--w:${goal ? Math.min(100, read / goal * 100) : 0}%"></i></span></div>`;
  // 최근 기록 (모든 취미에서 날짜순 5개)
  const all = RECENT_KEYS.flatMap(([k, key, ic]) => L(k).filter(i => !i.shared).map(i => ({ k, ic, img: i.image || '', t: i[key], d: i.date || (i.year ? `${parseInt(i.year)}-${String(parseInt(i.month) || 1).padStart(2, '0')}` : ''), r: i.rating || i.stars || '' })));
  const recent = all.filter(x => x.t).sort((a, b) => (b.d || '').localeCompare(a.d || '')).slice(0, 5);
  // 표지·포스터가 있으면 작은 그림, 안 불러와지면 이모지로 (이미지가 깨진 채로 남지 않게)
  const thumb = x => x.img ? `<img class="thumb" src="${esc(x.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'em',textContent:'${x.ic}'}))">` : `<span class="em">${x.ic}</span>`;
  $('#dashRecent').innerHTML = recent.map(x => `<li data-go="${x.k}">${thumb(x)}<div><span>${esc(x.t)}</span><small>${esc(x.d)}</small></div><b>${esc(x.r)}</b></li>`).join('') || '<li class="empty">아직 기록이 없어요 · 메뉴에서 독서·방탈출을 골라 ＋로 남겨요</li>';
  // 함께한 기록 (친구가 나를 태그한 것)
  const shared = RECENT_KEYS.flatMap(([k, key, ic]) => L(k).filter(i => i.shared).map(i => ({ k, ic, t: i[key], by: i.shared, d: i.date || '' }))).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 4);
  $('#dashShared').hidden = !shared.length;
  $('#dashSharedList').innerHTML = shared.map(x => `<li data-go="${x.k}"><span class="em">${x.ic}</span><div><span>${esc(x.t)}</span><small>${esc(x.by)}님이 함께한 기록 · ${esc(x.d)}</small></div></li>`).join('');
  // 위시리스트 개수
  const W = [['buy', '책', 'book'], ['escapeWant', '방탈출', 'escape'], ['boardWant', '보드게임', 'board'], ['movieWant', '영화', 'movie'], ['playWant', '공연', 'play']];
  $('#dashWish').innerHTML = W.map(([k, n, s]) => `<button type="button" class="dash-wish" data-go="${s}" data-list="${k}"><b>${L(k).length}</b><small>${n}</small></button>`).join('');
}
$('#v-dash').addEventListener('click', e => {
  const hb = e.target.closest('[data-hab]');
  if (hb) { // 대시보드에서 바로 체크
    const x = habits.find(q => q.id === hb.dataset.hab), st = stampOf(localISO().slice(0, 10)), done = !x.done.includes(st);
    x.done = done ? [...x.done, st] : x.done.filter(q => q !== st); x.total = Math.max(0, x.total + (done ? 1 : -1)); store.set('habits', habits); renderDash();
    return queue({ action: 'habitCheck', habitId: x.id, stamp: st, done });
  }
  const g = e.target.closest('[data-go]'); if (!g) return;
  setSection(g.dataset.go); if (g.dataset.list) { curList = g.dataset.list; renderLists(); }
});
// 습관 색: 내가 고른 색(이 기기에 저장) > 운동은 기본 하늘색(절주 분홍과 헷갈리지 않게) > 틱틱·시트 색
const hColor = h => store.get('habitColors', {})[h.id] || (/^운동/.test(h.name) ? '#5ac8fa' : h.color) || '#3182f6';
function setHabitColor(id, c) {
  const m = store.get('habitColors', {}); m[id] = c; store.set('habitColors', m);
  const h = habits.find(x => x.id === id); renderHabits(); if (sec === 'home') renderDash();
  if (h) { $('#hdGrid').style.setProperty('--c', c); $('#hdColors').querySelectorAll('[data-c]').forEach(b => b.setAttribute('aria-pressed', b.dataset.c === c)); }
}
$('#hdColors').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) setHabitColor($('#hdColors').dataset.id, b.dataset.c); });
$('#hdColors').addEventListener('input', e => { if (e.target.type === 'color') setHabitColor($('#hdColors').dataset.id, e.target.value); });
// ── 친구 습관 (틱틱 없이 시트에): 만들기·지우기 ──
const hIcon = h => HICON[h.icon] || (h.local && h.icon) || '⭐';
const H_EMOJI = ['💧', '🏃', '📖', '🧘', '💊', '🥗', '😴', '✍️', '🚭', '🍺'], H_COLOR = ['#3182f6', '#20c997', '#f59f00', '#f06595', '#845ef7', '#fa5252'];
function openHabitAdd() {
  $('#haName').value = '';
  $('#haIcons').innerHTML = H_EMOJI.map((e, k) => `<button type="button" data-e="${e}" aria-pressed="${!k}">${e}</button>`).join('');
  $('#haColors').innerHTML = H_COLOR.map((c, k) => `<button type="button" data-c="${c}" style="--c:${c}" aria-pressed="${!k}" aria-label="색 ${k + 1}"></button>`).join('');
  $('#habitAdd').showModal(); $('#haName').focus();
}
['#haIcons', '#haColors'].forEach(s => $(s).addEventListener('click', e => { const b = e.target.closest('button'); if (b) $(s).querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); }));
$('#haForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#haName').value.trim(); if (!name) return;
  const h = { id: 'h' + crypto.randomUUID().replace(/-/g, '').slice(0, 16), name, icon: $('#haIcons [aria-pressed=true]').dataset.e, color: $('#haColors [aria-pressed=true]').dataset.c,
    rule: 'RRULE:FREQ=DAILY', enc: '', total: 0, done: [], local: true };
  habits.push(h); store.set('habits', habits); $('#habitAdd').close(); renderHabits();
  queue({ action: 'habitAdd', habitId: h.id, name: h.name, icon: h.icon, color: h.color }).then(ok => ok && toast(`「${h.name}」 습관을 만들었어요`));
});
$('#haCancel').addEventListener('click', () => $('#habitAdd').close());
$('#hdDelete').addEventListener('click', async () => {
  const h = habits.find(x => x.id === $('#hdDelete').dataset.id);
  if (!h || !(await ask(`「${h.name}」 습관과 체크 기록을 지울까요?`, { ok: '지우기', danger: true }))) return;
  habits = habits.filter(x => x !== h); store.set('habits', habits); $('#hDetail').close(); renderHabits();
  queue({ action: 'habitDelete', habitId: h.id });
});
// 메뉴 순서: 저장된 순서 + 새로 생긴 섹션은 뒤에
const menuOrder = () => { const o = store.get('menuOrder', []).filter(k => SECTIONS[k]); return [...o, ...Object.keys(SECTIONS).filter(k => !o.includes(k))].filter(k => !(k === 'money' && isFriend())); };
// 시트에 「나는 누구?」를 물어 역할·이름·태그할 사람 목록을 받음. 친구면 가계부를 숨기고 독서로
async function loadMe() {
  if (!cfg.token) return;
  try {
    const r = await api(null, '&what=me');
    loadedAt.me = Date.now();
    if (!r.role) return; // 예전 Code.gs
    me = { token: cfg.token, role: r.role, name: r.name || '', people: r.people || [], friends: r.friends || [], social: r.social }; store.set('me', me);
  } catch (e) { return; }
  applyRole();
}
// 설정 창: 주인은 친구 초대, 친구는 「친구로 로그인됨」
// 초대 링크는 짧은 초대ID만 담음 (비밀번호·접속코드가 안 보임). 누르면 바로 로그인
const friendLink = inv => `${location.origin}${location.pathname}#i=${inv}${cfg.url !== SHEET_URL ? '&s=' + encodeURIComponent(cfg.url) : ''}`;
function renderFriends() {
  const owner = !!cfg.token && !isFriend() && me.token === cfg.token;
  $('#friendBox').hidden = !owner; $('#friendMe').hidden = !isFriend();
  if (isFriend()) $('#friendMe').textContent = `친구로 로그인했어요 · 가계부 없이 취미 기록과 습관을 써요`;
  if (!owner) return;
  $('#friendList').innerHTML = (me.friends || []).map(f => `<li><span><b>${esc(f.name)}</b></span><button type="button" class="small plane-btn" data-share="${esc(f.invite || '')}" data-name="${esc(f.name)}"><svg class="i" aria-hidden="true"><use href="#i-plane"/></svg>공유</button><button type="button" class="small danger" data-uninvite="${esc(f.code)}">삭제</button></li>`).join('')
    || '<li class="hint">아직 초대한 친구가 없어요</li>';
}
// 종이비행기가 단추에서 위로 날아감 (지나간 자리에 점 몇 개)
function flyPlane(from) {
  if (calm()) return;
  const r = from.getBoundingClientRect(), pl = document.createElement('div');
  pl.className = 'plane-fly'; pl.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-plane"/></svg>';
  pl.style.left = r.left + r.width / 2 - 17 + 'px'; pl.style.top = r.top - 10 + 'px'; document.body.append(pl);
  for (let k = 1; k <= 5; k++) setTimeout(() => { const pr = pl.getBoundingClientRect(), d = document.createElement('i'); d.className = 'plane-trail'; d.style.left = pr.left + 4 + 'px'; d.style.top = pr.top + pr.height - 6 + 'px'; document.body.append(d); setTimeout(() => d.remove(), 800); }, k * 110);
  setTimeout(() => pl.remove(), 1200);
}
// 공유: 아이폰 공유 시트(카톡·메시지 등). 공유를 못 쓰거나 실패하면 링크 + 복사하기/취소 창
async function shareInvite(name, inv, btn) {
  if (!inv) return toast('초대 링크를 만드는 중이에요 · 잠시 뒤 다시 눌러 주세요');
  const url = friendLink(inv);
  const text = [`💌 ${name}님, 하트에 초대해요!`, '하트 : 하비 트래커 · 습관과 취미 기록을 함께 남겨요', '',
    '📲 시작하는 법', '① 아래 링크를 사파리로 열어요', '② 공유 → 「홈 화면에 추가」', '③ 홈 화면 앱에서 로그인', '',
    `🔑 아이디  ${name}`, '🔑 비밀번호  1234', '(로그인한 뒤 설정에서 꼭 바꿔 주세요)', '', `👉 ${url}`].join('\n');
  if (btn) flyPlane(btn);
  try { await navigator.clipboard.writeText(text); } catch (e) {} // 먼저 조용히 복사해 둠 (초대 글 전체)
  shareText = text;
  if (navigator.share) {
    try { await navigator.share({ title: '하트 : 하비 트래커', text }); return; } catch (e) { if (e.name === 'AbortError') return; } // 링크는 글 맨 끝에 (따로 넘기면 앱마다 위치가 달라짐)
  }
  $('#shareInfo').textContent = `${name}님에게 이 링크를 보내 주세요 · 아이디 ${name} / 비밀번호 1234`; $('#shareUrl').value = url; $('#shareSheet').showModal();
}
let shareText = '';
$('#shareCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(shareText || $('#shareUrl').value); toast('복사했어요 · 친구에게 보내 주세요'); $('#shareSheet').close(); }
  catch (e) { $('#shareUrl').select(); toast('링크를 길게 눌러 복사해 주세요'); }
});
$('#shareCancel').addEventListener('click', () => $('#shareSheet').close());
async function friendOp(body, done) {
  try { const r = await api(body); await loadMe(); done && done(r); } catch (e) { toast(e.message.replace(/^입력값 오류:?\s*/, '')); }
}
$('#myNameSave').addEventListener('click', () => { const n = $('#myName').value.trim(); if (n) friendOp({ action: 'setName', name: n }, () => { toast('이름을 바꿨어요 · 다음 로그인부터 이 이름이 아이디예요'); openPrefs(); }); });
$('#inviteBtn').addEventListener('click', () => {
  const n = $('#inviteName').value.trim(); if (!n) return $('#inviteName').focus();
  const btn = $('#inviteBtn');
  friendOp({ action: 'invite', name: n }, r => { $('#inviteName').value = ''; shareInvite(n, r.invite, btn); });
});
$('#friendList').addEventListener('click', async e => {
  const sh = e.target.closest('[data-share]'), u = e.target.closest('[data-uninvite]')?.dataset.uninvite;
  if (sh) shareInvite(sh.dataset.name, sh.dataset.share, sh);
  if (u && await ask('이 친구를 삭제할까요? 친구는 더 이상 로그인할 수 없어요 (기록은 시트에 남아요)', { ok: '삭제', danger: true })) friendOp({ action: 'uninvite', code: u });
});
function applyRole() {
  document.body.classList.toggle('friend', isFriend());
  if (isFriend() && sec === 'money') setSection('home');
  renderFriends();
}
// 사이드바 (클로드 앱 방식): 「열린 정도」 --p(0~1) 하나만 바꾸면 메뉴·본문·모서리·배경이 같은 곡선·같은 시간으로 함께 움직임
// 끄는 동안엔 transition을 끄고(html.pushing) 손가락을 그대로 따라감. 위치·투명도만 움직여서 아이폰에서도 가벼움
const root = document.documentElement, MENU_MS = 420;
function menuP(p, dragging) {
  root.classList.toggle('pushing', !!dragging);
  root.style.setProperty('--mw', ($('#menu').offsetWidth || 300) + 'px');
  root.style.setProperty('--p', Math.min(1, Math.max(0, p)).toFixed(3));
  if (p < 1) root.classList.remove('menu-rest');
}
// 다 열린 뒤에만 본문을 살짝 흐리게 (움직이는 동안 블러를 매 프레임 계산하면 아이폰에서 끊김)
$('#menu').addEventListener('transitionend', e => { if (e.target === e.currentTarget && e.propertyName === 'opacity' && root.style.getPropertyValue('--p') === '1.000') root.classList.add('menu-rest'); });
function openMenu(dragging) {
  $('#menuList').innerHTML = menuOrder().map(k => [k, SECTIONS[k]]).map(([k, v]) =>
    `<button type="button" data-sec="${k}" data-hidden="${store.get('menuHidden', []).includes(k) && k !== sec ? 1 : 0}" ${k === sec ? 'aria-current="page"' : ''}><svg class="i" aria-hidden="true"><use href="#i-s-${k}"/></svg>${v.title}${k === 'money' ? '' : '<span class="eye" data-eye role="button" aria-label="메뉴에서 숨기기·보이기">👁</span>'}</button>`).join('');
  paintNoticeDot();
  const nm = me.token === cfg.token && me.name ? me.name : '';
  $('#menuName').textContent = nm || (isFriend() ? '친구' : '이름을 정해 주세요');
  $('#menuRole').textContent = isFriend() ? '친구 접속코드' : cfg.token ? '내 시트 · 눌러서 설정' : '아직 연결 전';
  paintAvatar($('#menuAvatar'));
  menuP(0, true); root.classList.add('menu-open');
  $('#menu').showModal();
  if (dragging) return;
  $('#menu').offsetWidth; // 닫힌 위치(0)를 한 번 그린 뒤
  requestAnimationFrame(() => menuP(1)); // 열린 위치로 transition
}
$('#menu').addEventListener('closing', () => menuP(0));
$('#menu').addEventListener('close', () => root.classList.remove('menu-open'));
$('#menuBtn').addEventListener('click', () => openMenu());
// 화면 어디서든 오른쪽으로 밀면 메뉴가 손가락을 따라 나오고, 열린 메뉴는 왼쪽으로 밀면 닫힘 (TickTick 방식)
// 달력(달 넘김)·휠·가로 스크롤 줄에서 시작한 밀기는 원래 동작 그대로
{
  const menu = $('#menu');
  const hScroll = el => { for (; el && el !== document.body; el = el.parentElement) if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true; return false; };
  const paint = p => menuP(p, true);
  let sw = null;
  document.addEventListener('touchstart', e => {
    sw = null;
    if (e.touches.length !== 1) return;
    const t = e.target, open = menu.open;
    if (t.closest('.menu-list.editing')) return; // 순서 바꾸는 중엔 밀어 닫기 안 함
    if (!open && (document.querySelector('dialog[open]') || t.closest('#calGrid, .wcol, input, textarea, select') || hScroll(t))) return;
    sw = { x: e.touches[0].clientX, y: e.touches[0].clientY, open, on: false, p: open ? 1 : 0, v: 0, lx: e.touches[0].clientX, lt: Date.now() };
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!sw) return;
    const x = e.touches[0].clientX, dx = x - sw.x, dy = e.touches[0].clientY - sw.y;
    if (!sw.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; } // 세로 스크롤이면 양보
      if (sw.open ? dx > -10 : dx < 10) return;
      sw.on = true; sw.x = x;
      if (!sw.open) { openMenu(true); document.activeElement?.blur(); } // 손가락으로 연 건 포커스 테두리 없이
      sw.w = menu.getBoundingClientRect().width || 300;
    }
    e.preventDefault();
    const now = Date.now();
    sw.v = (x - sw.lx) / Math.max(1, now - sw.lt); sw.lx = x; sw.lt = now;
    sw.p = Math.min(1, Math.max(0, (sw.open ? 1 : 0) + (x - sw.x) / sw.w));
    paint(sw.p);
  }, { passive: false });
  const end = () => {
    if (!sw?.on) { sw = null; return; }
    const keep = Math.abs(sw.v) > 0.4 ? sw.v > 0 : sw.p > 0.5; // 빠르게 튕기면 방향대로
    sw = null;
    menuP(keep ? 1 : 0); // 손을 떼면 남은 거리를 같은 곡선으로
    if (!keep) setTimeout(() => { if (root.style.getPropertyValue('--p') === '0.000') closeNow(menu); }, MENU_MS);
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
}
// 메뉴 항목을 꾹 누르면 편집 모드 → 끌어서 순서 변경, 「완료」나 메뉴를 닫으면 끝
{
  const list = $('#menuList'), editing = () => list.classList.contains('editing');
  const setEdit = on => { list.classList.toggle('editing', on); $('#menuDone').hidden = $('#menuTip').hidden = !on; };
  let timer = null, start = null, drag = null;
  list.addEventListener('contextmenu', e => e.preventDefault());
  list.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-sec]');
    if (!b) return;
    if (editing() && e.target.closest('[data-eye]')) { // 눈: 이 섹션을 메뉴에서 숨기기/보이기
      b.dataset.hidden = b.dataset.hidden === '1' ? '0' : '1';
      return store.set('menuHidden', [...list.querySelectorAll('[data-hidden="1"]')].map(x => x.dataset.sec));
    }
    if (editing()) { drag = { b, y: e.clientY }; b.setPointerCapture(e.pointerId); b.classList.add('lift'); return; }
    start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => { timer = null; setEdit(true); navigator.vibrate?.(12); }, 450);
  });
  list.addEventListener('pointermove', e => {
    if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) { clearTimeout(timer); timer = null; } // 움직이면 롱프레스 취소
    if (!drag) return;
    const b = drag.b, h = b.offsetHeight + 6; // 6 = 항목 간격
    let dy = e.clientY - drag.y;
    if (dy > h / 2 && b.nextElementSibling) { list.insertBefore(b.nextElementSibling, b); drag.y += h; dy -= h; }
    else if (dy < -h / 2 && b.previousElementSibling) { list.insertBefore(b, b.previousElementSibling); drag.y -= h; dy += h; }
    b.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    clearTimeout(timer); timer = null;
    if (!drag) return;
    drag.b.style.transform = ''; drag.b.classList.remove('lift'); drag = null;
    store.set('menuOrder', [...list.querySelectorAll('[data-sec]')].map(b => b.dataset.sec));
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
  $('#menuDone').addEventListener('click', () => setEdit(false));
  $('#menu').addEventListener('close', () => setEdit(false));
}
$('#menuList').addEventListener('click', e => {
  if ($('#menuList').classList.contains('editing')) return; // 편집 중엔 이동 안 함
  const k = e.target.closest('[data-sec]')?.dataset.sec;
  if (k) { $('#menu').close(); setSection(k); }
});
$('#lNav').addEventListener('click', e => {
  if (e.target.closest('[data-find]')) return openFind();
  const k = e.target.closest('[data-list]')?.dataset.list;
  if (k) { if (selecting) setSelecting(false); curList = k; renderLists(); }
});
$('#lq').addEventListener('input', renderLists);
// 사진 서버가 막거나 주소가 틀려 못 불러오면 깨진 아이콘 대신 목록 이모지(편집 창에선 숨김)
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.matches('.thumb, .cover')) return;
  if (img.classList.contains('big')) { img.remove(); return; }
  if (img.classList.contains('cover')) { // 표지를 못 불러오면 제목 카드로
    const ph = document.createElement('span'); ph.className = 'cover ph'; ph.textContent = img.dataset.t || '';
    ph.style.transform = img.style.transform; img.replaceWith(ph); return;
  }
  const em = document.createElement('span');
  em.className = 'em'; em.setAttribute('aria-hidden', 'true'); em.textContent = LIST_ICON[curList] || '🖼️';
  img.replaceWith(em);
}, true);

// 목록 항목 추가·수정 창 (필드 표로 자동 생성)
// 목록 추가·수정 창: 제목은 크게, 몇 개 중 고르는 칸은 버튼 줄로, 평가는 이모지, 표지는 주소를 넣으면 바로 미리보기
let lEditing = null, lFromShared = null;
// 서로 느낀 게 다르니까: 친구가 태그한 기록에 내 별점·리뷰를 따로 남김 → 내 기록이 생기고 둘이 한 줄로 합쳐 보임
const othersLine = i => i.others?.length ? `<small class="others"><svg class="i" aria-hidden="true"><use href="#i-s-friends"/></svg> ${i.others.map(o => `${esc(o.name)} ${esc(o.rating || '–')}`).join(' · ')}</small>` : '';
async function rateShared(it) {
  if (!RATE_KEY[curList] && !LIST_FIELDS[curList].some(f => f[0] === 'review')) return toast(`${it.shared}님의 기록이에요`);
  if (!await ask(`${it.shared}님이 남긴 기록이에요.\n내 별점과 리뷰를 따로 남길까요?\n(둘의 평가가 한 줄에 함께 보여요)`, { ok: '내 평가 남기기' })) return;
  const pre = {}; LIST_FIELDS[curList].forEach(([n]) => { if (it[n] != null && !['rating', 'stars', 'review', 'with'].includes(n)) pre[n] = it[n]; });
  openItem(null, { ...pre, with: it.shared, __from: it });
}
function openItem(it, pre) {
  if (it?.shared) return rateShared(it);
  lFromShared = pre?.__from || null;
  const fs = LIST_FIELDS[curList], label = SECTIONS[sec].tabs.find(t => t[0] === curList)[1];
  lEditing = it || null;
  $('#lMove').hidden = !it || !BOOK_LISTS[curList];
  if (it && BOOK_LISTS[curList]) $('#lMove').innerHTML = '<span>다른 목록으로</span>' + Object.entries(BOOK_LISTS).filter(([k]) => k !== curList).map(([k, n]) => `<button type="button" class="small" data-move="${k}">→ ${n}</button>`).join('');
  const opt = (n, base) => base.map(([v, l]) => `<label><input type="radio" name="${n}" value="${esc(v)}"><span>${esc(l)}</span></label>`).join('');
  $('#lFields').innerHTML = fs.map(([n, lab, type, opts], k) => {
    if (k === 0) return `<input class="full ltitle" name="${n}" placeholder="${lab}" aria-label="${lab}" maxlength="1000" required autocomplete="off">${BOOKISH[curList] ? '<div id="bookHits" class="book-hits full" role="listbox" aria-label="알라딘 검색 결과"></div>' : ''}`;
    if (type === 'bool') return `<label class="switch full"><input type="checkbox" name="${n}"><i aria-hidden="true"></i>${lab}</label>`;
    if (type === 'select') {
      const base = (typeof opts === 'function' ? opts() : opts).map(o => Array.isArray(o) ? o : [o, o || '없음']);
      // 옛 값(예: ★★★★)이 있으면 선택지에 그대로 남겨서 안 지워지게
      if (it && it[n] && !base.some(o => o[0] === String(it[n]))) base.push([String(it[n]), String(it[n])]);
      if (opts === RATE_OPTS) return `<div class="f full">${lab}<div class="rate rate-pick" role="radiogroup" aria-label="${lab}">${opt(n, base.filter(o => o[0]).map(([v]) => [v, v]))}</div></div>`;
      if (typeof opts !== 'function' && base.length <= 5) return `<div class="f full">${lab}<div class="seg" role="radiogroup" aria-label="${lab}">${opt(n, base)}</div></div>`;
      return `<label class="f">${lab}<select name="${n}">${base.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></label>`;
    }
    const full = ['author', 'shop', 'director', 'memo', 'review', 'image', 'date'].includes(n) ? ' full' : '';
    const extra = type === 'number' ? 'inputmode="numeric" min="0"' : type === 'url' ? 'inputmode="url" placeholder="https://…"' : 'maxlength="1000"';
    if (n === 'review') return `<label class="f full">${lab}<textarea name="${n}" rows="2" maxlength="1000" placeholder="한 줄이면 충분해요"></textarea></label>`;
    return `<label class="f${full}">${lab}<input name="${n}" type="${type}" ${extra}></label>`;
  }).join('');
  const f = $('#lForm').elements, today = localISO();
  const init = it || { year: today.slice(0, 4) + '년', month: today.slice(5, 7) + '월', status: '읽는중', date: today.slice(0, 10), kind: '추천받은 책', ...pre };
  fs.forEach(([n, , type]) => { if (type === 'bool') f[n].checked = !!init[n]; else if (init[n] != null) f[n].value = init[n]; });
  $('#lFields').querySelectorAll('input[type=date]').forEach(i => dateField(i));
  // 「함께한 사람」 아래 앱 쓰는 사람 칩: 누르면 이름이 들어가고, 그 사람 앱에도 이 기록이 보임
  const tagTo = f.with, others = people().filter(n => n !== me.name);
  if (tagTo && others.length) {
    const box = document.createElement('div'); box.className = 'tag-chips full'; tagTo.closest('label').after(box);
    const names = () => tagTo.value.split(/[,·、/&+\s]+/).map(x => x.trim()).filter(Boolean);
    const paint = () => { box.innerHTML = '<small>앱 친구 태그 · 그 친구 앱에도 보여요</small>' + others.map(n => `<button type="button" class="small" data-tag="${esc(n)}" aria-pressed="${names().includes(n)}">@${esc(n)}</button>`).join(''); };
    box.addEventListener('click', e => {
      const n = e.target.closest('[data-tag]')?.dataset.tag; if (!n) return;
      const a = names(); tagTo.value = (a.includes(n) ? a.filter(x => x !== n) : [...a, n]).join(', '); paint();
    });
    tagTo.addEventListener('input', paint); paint();
  }
  if (curList === 'book') { // 연도·월은 시간처럼 휠 하나로 (값은 원래 두 select에 그대로)
    const ym = document.createElement('input'), y = f.year.value.match(/\d{4}/)?.[0], m = f.month.value.match(/\d+/)?.[0];
    f.year.closest('label').hidden = f.month.closest('label').hidden = true;
    const lab = document.createElement('label'); lab.className = 'f'; lab.textContent = '읽은 달'; lab.append(ym);
    f.month.closest('label').after(lab);
    ym.value = y && m ? `${y}-${pad2(+m)}` : '';
    pickerField(ym, 'month', '읽은 달', { blank: true });
    ym.addEventListener('change', () => { const [yy, mm] = ym.value.split('-'); setSel(f.year, yy ? yy + '년' : ''); if (!yy) f.year.value = ''; setSel(f.month, mm ? mm + '월' : ''); if (!mm) f.month.value = ''; });
  }
  $('#lForm .pub-pill')?.remove();
  if (HOUSE_LISTS.includes(curList)) { // 친구가 내 집에 놀러 오면 보이는 작품 (맨 위에서 바로 켜고 끔)
    const sw = document.createElement('label'); sw.className = 'pub-row pub-pill full'; sw.title = '친구가 내 집에 놀러 오면 보여요 · 함께한 사람은 안 보여요';
    sw.innerHTML = `<span><svg class="i" aria-hidden="true"><use href="#i-s-friends"/></svg>친구 공개</span><input type="checkbox" name="__pub" role="switch" aria-label="친구 공개">`;
    $('#lTitle').after(sw); sw.querySelector('input').checked = it ? !!it.pub : store.get('pubDefault', true);
  }
  $('#lForm').dataset.id = it?.id || '';
  $('#lDelete').hidden = !it;
  $('#lTitle').textContent = `${label} ${it ? '수정' : '추가'}`;
  lPreview((it || pre)?.image || '');
  $('#lItem').showModal();
}
// 책 제목을 치면 알라딘 검색 3권 → 고르면 제목·저자·표지 채움 (새로 추가할 때만)
const BOOKISH = { book: 1, buy: 1, wish: 1 };
let bookT = 0, bookHits = [];
$('#lFields').addEventListener('input', e => {
  if (e.target.name !== 'title' || !BOOKISH[curList] || lEditing) return;
  clearTimeout(bookT);
  const q = e.target.value.trim();
  if (q.length < 2) { $('#bookHits').innerHTML = ''; return; }
  bookT = setTimeout(async () => {
    try {
      const r = findMemo.get('book:' + q) || await api(null, '&what=book&q=' + encodeURIComponent(q)); findMemo.set('book:' + q, r);
      if (q !== $('#lForm').elements.title?.value.trim()) return; // 그새 더 쳤으면 버림
      if (!r.books) { $('#bookHits').innerHTML = '<p class="hint">책 검색은 시트의 Code.gs를 새 버전으로 배포해야 돼요</p>'; return; } // 예전 서버는 what=book을 몰라 거래를 보냄
      bookHits = r.books;
      $('#bookHits').innerHTML = (bookHits.length ? '' : '<p class="hint">검색 결과가 없어요 · 직접 입력해 주세요</p>') + bookHits.map((b, k) => `<button type="button" data-hit="${k}" role="option">${b.image ? `<img src="${esc(b.image)}" alt="" referrerpolicy="no-referrer">` : ''}<span><b>${esc(b.title)}</b><small>${esc(b.author)}</small></span></button>`).join('');
    } catch (err) { $('#bookHits').innerHTML = `<p class="hint">책 검색이 안 돼요 (${esc(err.message)}) · 직접 입력해 주세요</p>`; }
  }, 300);
});
$('#lFields').addEventListener('click', e => {
  const b = bookHits[e.target.closest('[data-hit]')?.dataset.hit];
  if (!b) return;
  const f = $('#lForm').elements;
  f.title.value = b.title; if (f.author) f.author.value = b.author;
  if (f.image && b.image) { f.image.value = b.image; lPreview(b.image); }
  $('#bookHits').innerHTML = '';
});
const lPreview = src => { $('#lPreview').innerHTML = /^https?:\/\//.test(src) ? `<img class="thumb big" src="${esc(src)}" alt="" referrerpolicy="no-referrer">` : ''; };
$('#lFields').addEventListener('input', e => { if (e.target.name === 'image') lPreview(e.target.value.trim()); });
// 이미 고른 평가를 다시 누르면 지움
$('#lFields').addEventListener('pointerdown', e => { const i = e.target.closest('.rate-pick label')?.querySelector('input'); if (i) i.dataset.was = i.checked ? '1' : ''; });
$('#lFields').addEventListener('click', e => { const i = e.target.closest('.rate-pick input'); if (i && i.dataset.was === '1') { i.checked = false; i.dataset.was = ''; } });
$('#lList').addEventListener('click', e => {
  const li = e.target.closest('li[data-id]'), id = li?.dataset.id, it = id && L(curList).find(i => i.id === id);
  if (!it) return;
  if (selecting) { if (it.shared) return toast(`${it.shared}님 기록은 선택할 수 없어요`); selected.has(id) ? selected.delete(id) : selected.add(id); return paintSel(); }
  openItem(it);
});
// ── 선택해서 한 번에: 삭제 · 공개/비공개 · 상태 바꾸기 · 다른 목록으로 ──
let selecting = false; const selected = new Set();
const pick = (title, opts) => new Promise(res => { // opts: [[값, 글]] → 고른 값 (취소면 null)
  const d = $('#pickSheet'); $('#pickTitle').textContent = title;
  $('#pickList').innerHTML = opts.map(([v, l], k) => `<button type="button" data-k="${k}">${esc(l)}</button>`).join('');
  const done = v => { d.removeEventListener('close', onClose); d.close(); res(v); }, onClose = () => res(null);
  $('#pickList').onclick = e => { const b = e.target.closest('[data-k]'); if (b) done(opts[b.dataset.k][0]); };
  $('#pickCancel').onclick = () => done(null);
  d.addEventListener('close', onClose, { once: true }); d.showModal();
});
// 상태로 바꿀 수 있는 칸: 고르는 칸(평가 빼고)과 예/아니오 칸
const stateFields = k => (LIST_FIELDS[k] || []).filter(([n, , t]) => (t === 'select' && n !== RATE_KEY[k] && !['year', 'month'].includes(n)) || t === 'bool');
function setSelecting(on) {
  selecting = on; selected.clear(); document.body.classList.toggle('selecting', on); $('#selBar').hidden = !on;
  if (on && VIEWS[sec] && lView() === 'flow') { store.set(VIEWS[sec], 'list'); renderLists(); }
  paintSel();
}
function paintSel() {
  $('#lList').querySelectorAll('li[data-id]').forEach(li => { li.classList.toggle('sel', selected.has(li.dataset.id)); li.classList.toggle('locked', selecting && String(li.dataset.id).startsWith('s:')); });
  const n = selected.size, mine = L(curList).filter(i => !i.shared);
  $('#selCount').textContent = `${n}개 선택`; $('#selAll').textContent = n && n === mine.length ? '선택 해제' : '전체 선택';
  const st = stateFields(curList), act = (k, ic, t, show = true) => show ? `<button type="button" data-act="${k}" ${n ? '' : 'disabled'}><svg class="i" aria-hidden="true"><use href="#${ic}"/></svg>${t}</button>` : '';
  $('#selActs').innerHTML = act('pub', 'i-s-friends', '친구 공개', HOUSE_LISTS.includes(curList)) + act('unpub', 'i-lock', '비공개', HOUSE_LISTS.includes(curList))
    + act('state', 'i-tag', '상태 변경', st.length > 0) + act('move', 'i-move', '옮기기', !!BOOK_LISTS[curList]) + act('del', 'i-trash', '삭제');
}
$('#lSelect').addEventListener('click', () => setSelecting(true));
$('#selDone').addEventListener('click', () => setSelecting(false));
$('#selAll').addEventListener('click', () => {
  const mine = L(curList).filter(i => !i.shared).map(i => i.id);
  if (selected.size === mine.length) selected.clear(); else mine.forEach(id => selected.add(id));
  paintSel();
});
$('#selActs').addEventListener('click', async e => {
  const k = e.target.closest('[data-act]')?.dataset.act; if (!k || !selected.size) return;
  const list = curList, items = L(list).filter(i => selected.has(i.id) && !i.shared), n = items.length, key = LIST_FIELDS[list][0][0];
  if (k === 'pub' || k === 'unpub') {
    const on = k === 'pub'; items.forEach(i => { i.pub = on; }); store.set('lists', lists);
    queue({ action: 'setPub', list, ids: items.map(i => i.id), on }).then(ok => ok && toast(`${n}개를 ${on ? '친구 공개로 바꿨어요' : '비공개로 바꿨어요'}`));
  } else if (k === 'del') {
    if (!await ask(`선택한 ${n}개 기록을 시트에서 삭제할까요?`, { ok: `${n}개 삭제`, danger: true })) return;
    lists[list] = L(list).filter(i => !selected.has(i.id) || i.shared); store.set('lists', lists);
    queue({ action: 'bulk', ops: items.map(i => ({ action: 'listDelete', list, id: i.id })) }).then(ok => ok && toast(`${n}개를 삭제했어요`));
    if (items.some(i => i.pub)) queue({ action: 'setPub', list, ids: items.filter(i => i.pub).map(i => i.id), on: false });
  } else if (k === 'state') {
    const st = stateFields(list), fk = st.length === 1 ? st[0][0] : await pick('무엇을 바꿀까요?', st.map(([n, l]) => [n, l])), f = st.find(x => x[0] === fk);
    if (!f) return;
    const [fn, fl, ft, fo] = f, v = await pick(`${fl} · ${n}개`, ft === 'bool' ? [[true, `✅ ${fl}`], [false, `${fl} 아님`]] : fo.filter(Boolean).map(o => [o, o]));
    if (v == null) return;
    items.forEach(i => { i[fn] = v; }); store.set('lists', lists);
    queue({ action: 'bulk', ops: items.map(i => ({ action: 'listSave', list, item: { id: i.id, [key]: i[key], [fn]: v } })) }).then(ok => ok && toast(`${n}개를 「${ft === 'bool' ? (v ? fl : fl + ' 아님') : v}」(으)로 바꿨어요`));
  } else if (k === 'move') {
    const to = await pick(`${n}개를 어디로 옮길까요?`, Object.entries(BOOK_LISTS).filter(([x]) => x !== list).map(([x, l]) => [x, `→ ${l}`]));
    if (!to) return;
    const t = localISO(), arr = lists[to] = lists[to] || [];
    const made = items.map(it => { const item = { id: crypto.randomUUID(), title: it.title, author: it.author || '', memo: it.memo || '', ...(/^https:/.test(it.image || '') ? { image: it.image } : {}),
      ...{ book: { year: t.slice(0, 4) + '년', month: t.slice(5, 7) + '월', status: '읽는중' }, buy: { done: false }, wish: { kind: '추천받은 책' } }[to] };
      if (to === 'book') item.seq = arr.filter(i => i.year === item.year && i.month === item.month).length + 1;
      arr.push(item); return item; });
    lists[list] = L(list).filter(i => !selected.has(i.id) || i.shared); store.set('lists', lists);
    // 새 목록에 저장이 된 뒤에만 원래 것을 지움 (책이 사라지지 않게)
    queue({ action: 'bulk', ops: made.map(item => ({ action: 'listSave', list: to, item })) })
      .then(ok => ok && queue({ action: 'bulk', ops: items.map(i => ({ action: 'listDelete', list, id: i.id })) })).then(ok => ok && toast(`${n}권을 ${BOOK_LISTS[to]}(으)로 옮겼어요`));
  }
  setSelecting(false); renderLists();
});
$('#lForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target.elements, id = e.target.dataset.id, item = { id: id || crypto.randomUUID() };
  LIST_FIELDS[curList].forEach(([n, , type]) => { item[n] = type === 'bool' ? f[n].checked : type === 'number' ? (f[n].value === '' ? '' : Math.round(+f[n].value)) : f[n].value.trim(); });
  if (!item[LIST_FIELDS[curList][0][0]]) return;
  // 표지 주소는 바꿨을 때만, https 주소만 보냄 (시트의 =IMAGE 수식을 괜히 덮지 않게)
  if ('image' in item && (item.image === (lEditing?.image || '') || !/^https:\/\//.test(item.image))) delete item.image;
  if (curList === 'board') item.kind = '보드게임';
  const arr = lists[curList] = lists[curList] || [], idx = arr.findIndex(i => i.id === item.id);
  // 독서 기록의 순번 = 같은 연·월 안에서 몇 번째 책인지 (새로 추가할 때만 매김)
  if (curList === 'book' && idx < 0) item.seq = arr.filter(i => i.year === item.year && i.month === item.month).length + 1;
  if (lFromShared && idx < 0) { // 친구 기록을 내 기록으로 → 친구 것은 내 줄에 평가로만
    const s = lFromShared, k = arr.indexOf(s);
    if (k >= 0) arr.splice(k, 1);
    item.others = [{ name: s.shared, rating: s[RATE_KEY[curList]] || '', review: s.review || '' }, ...(s.others || [])];
  }
  const pubBox = f.__pub, pubWas = !!(lEditing?.pub), pubNow = !!pubBox?.checked;
  if (pubBox) item.pub = pubNow;
  if (idx >= 0) arr[idx] = { ...arr[idx], ...item }; else arr.push(item);
  store.set('lists', lists);
  $('#lItem').close();
  const send = { ...item }; delete send.others; delete send.pub;
  queue({ action: 'listSave', list: curList, item: send });
  if (pubBox && pubNow !== pubWas) queue({ action: 'setPub', list: curList, id: item.id, on: pubNow });
});
// 읽는 책 · 위시리스트 · 추천 목록 사이 옮기기 (새 목록에 저장 → 원래 목록에서 지움), 토스트로 되돌리기
const BOOK_LISTS = { book: '읽는 책', buy: '위시리스트', wish: '추천 목록' };
function moveBook(it, from, to) {
  const t = localISO(), arr = lists[to] = lists[to] || [];
  const item = { id: crypto.randomUUID(), title: it.title, author: it.author || '', memo: it.memo || '', ...(/^https:/.test(it.image || '') ? { image: it.image } : {}),
    ...{ book: { year: t.slice(0, 4) + '년', month: t.slice(5, 7) + '월', status: '읽는중' }, buy: { done: false }, wish: { kind: '추천받은 책' } }[to] };
  if (to === 'book') item.seq = arr.filter(i => i.year === item.year && i.month === item.month).length + 1;
  arr.push(item); lists[from] = (lists[from] || []).filter(i => i.id !== it.id); store.set('lists', lists);
  queue({ action: 'listSave', list: to, item }).then(ok => ok && queue({ action: 'listDelete', list: from, id: it.id })); // 저장이 된 뒤에만 지움 (책이 사라지지 않게)
  renderLists();
  toast(`「${it.title}」을 ${BOOK_LISTS[to]}(으)로 옮겼어요`, 6000, () => {
    lists[to] = (lists[to] || []).filter(i => i.id !== item.id); (lists[from] = lists[from] || []).push(it); store.set('lists', lists);
    queue({ action: 'listSave', list: from, item: it }).then(ok => ok && queue({ action: 'listDelete', list: to, id: item.id }));
    renderLists(); toast('되돌렸어요');
  });
}
$('#lMove').addEventListener('click', e => {
  const to = e.target.closest('[data-move]')?.dataset.move;
  if (!to || !lEditing) return;
  $('#lItem').close(); moveBook(lEditing, curList, to);
});
$('#lDelete').addEventListener('click', async () => {
  if (!(await ask('이 기록을 시트에서 삭제할까요?', { ok: '삭제', danger: true }))) return;
  const id = $('#lForm').dataset.id;
  lists[curList] = (lists[curList] || []).filter(i => i.id !== id);
  store.set('lists', lists);
  $('#lItem').close();
  queue({ action: 'listDelete', list: curList, id }).then(ok => ok && setStatus('삭제됨'));
});
$('#lCancel').addEventListener('click', () => $('#lItem').close());

// ── 날짜·시간·월 입력 ──
// 숨긴 원래 input이 값의 원천이라 기존 코드(.value 읽기·쓰기, change 이벤트)는 그대로 동작
const valDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
dateField($('#entryForm [name=date]'), { short: true });
// 날짜 칸: 한 줄 버튼(예: 2026년 11월 11일 (화))을 누르면 캘린더 창
const DOW = '일월화수목금토';
const fmtDate_ = v => { const [y, m, d] = v.split('-').map(Number); return `${y}년 ${m}월 ${d}일 (${DOW[new Date(y, m - 1, d).getDay()]})`; };
// 숨긴 input 옆에 한 줄 버튼을 달고, 코드에서 .value를 바꾸면 버튼 글자도 같이 바뀌게 (input이 값의 원천)
function fieldButton(input, label, fmt, empty, open) {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'dbtn';
  btn.setAttribute('aria-label', label + ' 선택');
  const show = v => { btn.textContent = v ? fmt(v) : empty; btn.classList.toggle('empty', !v); };
  Object.defineProperty(input, 'value', { configurable: true,
    get() { return valDesc.get.call(this); }, set(v) { valDesc.set.call(this, v); show(valDesc.get.call(this)); } });
  input.classList.add('sr-only'); input.tabIndex = -1; input.setAttribute('aria-hidden', 'true');
  input.after(btn);
  btn.addEventListener('click', open);
  show(valDesc.get.call(input));
}
function dateField(input, opt = {}) {
  // short: 올해 날짜는 연도 빼고 짧게 (좌우로 좁은 칸용)
  const fmt = v => opt.short && v.slice(0, 4) === localISO().slice(0, 4) ? fmtDate_(v).replace(/^\d+년 /, '') : fmtDate_(v);
  fieldButton(input, input.getAttribute('aria-label') || '날짜', fmt, '날짜를 선택하세요', () => openCal(input));
}
let cpInput = null, cpY = 0, cpM = 0;
function cpRender() {
  $('#cpTitle').textContent = `${cpY}년 ${cpM}월`;
  const first = new Date(cpY, cpM - 1, 1).getDay(), days = new Date(cpY, cpM, 0).getDate(), sel = cpInput ? valDesc.get.call(cpInput) : '';
  const today = localISO().slice(0, 10);
  let html = '<span class="blank"></span>'.repeat(first);
  for (let d = 1; d <= days; d++) {
    const ds = `${cpY}-${pad2(cpM)}-${pad2(d)}`;
    html += `<button type="button" data-d="${ds}" class="${ds === today ? 'today' : ''}" aria-pressed="${ds === sel}"><span class="d">${d}</span></button>`;
  }
  $('#cpGrid').innerHTML = html;
}
function openCal(input) {
  cpInput = input;
  const v = valDesc.get.call(input) || localISO().slice(0, 10);
  cpY = +v.slice(0, 4); cpM = +v.slice(5, 7);
  cpRender(); $('#calPick').showModal();
}
const cpMove = k => { cpM += k; if (cpM < 1) { cpM = 12; cpY--; } if (cpM > 12) { cpM = 1; cpY++; } cpRender(); };
$('#cpPrev').addEventListener('click', () => cpMove(-1));
$('#cpNext').addEventListener('click', () => cpMove(1));
$('#cpGrid').addEventListener('click', e => {
  const d = e.target.closest('[data-d]')?.dataset.d;
  if (!d || !cpInput) return;
  cpInput.value = d; cpInput.dispatchEvent(new Event('change', { bubbles: true }));
  $('#calPick').close();
});

// 시간·월: 한 줄 버튼을 누르면 휠 시트(✕ · 제목 · ✓)가 올라옴. 가운데 띠에 온 값이 선택값
const W_ITEM = 44; // 휠 한 칸 높이(px)
const ws = { input: null, kind: '', cols: [] };
function wheelCols(kind, v, blank) {
  if (kind === 'time') {
    const [h = '', m = ''] = (v || '').split(':');
    return [{ label: '시', items: [['', '--'], ...range(0, 23).map(n => [pad2(n), pad2(n)])], val: h },
            { label: '분', items: range(0, 59).map(n => [pad2(n), pad2(n)]), val: m || '00' }];
  }
  const [y = '', m = ''] = (v || '').split('-'), now = new Date(), lead = blank ? [['', '--']] : [];
  const years = range(2015, now.getFullYear() + 1).map(n => [String(n), n + '년']);
  if (y && !years.some(i => i[0] === y)) years.push([y, y + '년']);
  return [{ label: '년', items: [...lead, ...years], val: y || (blank ? '' : String(now.getFullYear())) },
          { label: '월', items: [...lead, ...range(1, 12).map(n => [pad2(n), n + '월'])], val: m || (blank ? '' : pad2(now.getMonth() + 1)) }];
}
// 가운데에서 멀수록 흐리고 작게
function wPaint(col) {
  const c = col.scrollTop / W_ITEM;
  [...col.children].forEach((el, i) => {
    const d = Math.abs(i - c);
    el.style.opacity = Math.max(0.2, 1 - d * 0.28);
    el.style.transform = `scale(${Math.max(0.78, 1 - d * 0.08)})`;
  });
}
function openWheel(input, kind, title) {
  ws.input = input; ws.kind = kind;
  ws.cols = wheelCols(kind, valDesc.get.call(input), input.dataset.blank === '1');
  $('#wsTitle').textContent = title;
  $('#wsCols').innerHTML = ws.cols.map(c => `<div class="wcol" role="listbox" tabindex="0" aria-label="${c.label}">${
    c.items.map(([v, l]) => `<div class="witem" role="option" data-v="${v}">${l}</div>`).join('')}</div>`).join('');
  $('#wheelSheet').showModal();
  [...$('#wsCols').children].forEach((col, k) => {
    const idx = Math.max(0, ws.cols[k].items.findIndex(i => i[0] === ws.cols[k].val));
    col.scrollTop = idx * W_ITEM; wPaint(col);
    col.addEventListener('scroll', () => requestAnimationFrame(() => wPaint(col)), { passive: true });
    col.addEventListener('click', e => { const it = e.target.closest('.witem'); if (it) col.scrollTo({ top: [...col.children].indexOf(it) * W_ITEM, behavior: 'smooth' }); });
    col.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); col.scrollBy({ top: e.key === 'ArrowDown' ? W_ITEM : -W_ITEM, behavior: 'smooth' }); } });
  });
}
$('#wsCancel').addEventListener('click', () => $('#wheelSheet').close());
$('#wsOk').addEventListener('click', () => {
  const vals = [...$('#wsCols').children].map((col, k) => {
    const items = ws.cols[k].items;
    return items[Math.min(items.length - 1, Math.max(0, Math.round(col.scrollTop / W_ITEM)))][0];
  });
  const v = ws.kind === 'time' ? (vals[0] && vals[1] ? `${vals[0]}:${vals[1]}` : '') : (vals[0] && vals[1] ? `${vals[0]}-${vals[1]}` : '');
  ws.input.value = v; ws.input.dispatchEvent(new Event('change', { bubbles: true }));
  $('#wheelSheet').close();
});
function pickerField(input, kind, title, opt = {}) {
  if (opt.blank) input.dataset.blank = '1';
  const fmt = v => kind === 'time' ? v : `${+v.slice(0, 4)}년 ${+v.slice(5, 7)}월`;
  fieldButton(input, title, fmt, opt.empty || '선택 안 함', () => openWheel(input, kind, title));
}
pickerField($('#entryForm [name=time]'), 'time', '시간', { empty: '시간 없음' });

document.body.classList.add('money', 'tabbar');
requestAnimationFrame(() => movePill(document.querySelector('nav')));
if (brag) setTimeout(() => setBrag(true));
const now = localISO();
$('#month').value = now.slice(0, 7);
render();
refresh();
// 초대 링크(#i=초대ID)로 열면 비밀번호 없이 바로 로그인 → 반가워요
const invite = new URLSearchParams(location.hash.slice(1)).get('i');
if (invite) {
  const su = new URLSearchParams(location.hash.slice(1)).get('s');
  if (su && /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(su)) cfg.url = su;
  history.replaceState(null, '', location.pathname + location.search);
  showLogin('초대 링크를 확인하는 중이에요…');
  pub({ action: 'redeem', invite }).then(async r => {
    await loggedIn(r);
    const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    if (!standalone) ask(`환영해요! 공유 → 「홈 화면에 추가」로 하트를 설치하세요.\n\n홈 화면 앱에서는 처음 한 번 로그인이 필요해요.\n아이디: ${r.name}\n비밀번호: 1234 (설정에서 바꿀 수 있어요)`, { ok: '알겠어요' });
  }).catch(err => showLogin(err.message));
} else if (!cfg.token) showLogin(); // 로그인 전이면 로그인 화면
else lockNow();
// 앱을 켜면 처음엔 「오늘」 (설정 → 시작 화면에서 가계부·마지막 화면으로 바꿀 수 있음). ?sec= 바로가기는 그대로
// ── 친구 탭: 친구 신청·수락, 친구 집 놀러 가기 (친구가 공개한 작품이 방마다 선반에) ──
const HOUSE_LISTS = ['book', 'escape', 'board', 'movie', 'play', 'buy', 'escapeWant', 'boardWant', 'movieWant', 'playWant'];
// 검색 결과에서 바로 담는 것처럼 입력 창을 거치지 않는 새 기록도 「새 기록은 친구 집에 공개」 설정을 따름
const saveNew = (list, item) => {
  const pub = HOUSE_LISTS.includes(list) && store.get('pubDefault', true);
  if (pub) item.pub = true;
  const send = { ...item }; delete send.pub;
  const p = queue({ action: 'listSave', list, item: send });
  if (pub) p.then(ok => ok && queue({ action: 'setPub', list, id: item.id, on: true }));
  return p;
};
// [목록, 방 이름, 제목 칸, 담을 위시리스트, 아이콘]
const ROOMS = [['book', '책장', 'title', 'buy', 'book'], ['escape', '방탈출', 'theme', 'escapeWant', 'escape'], ['board', '보드게임', 'name', 'boardWant', 'board'], ['movie', '영화', 'title', 'movieWant', 'movie'], ['play', '공연', 'title', 'playWant', 'play'],
  ['buy', '읽고 싶은 책', 'title', 'buy', 'book'], ['escapeWant', '가고 싶은 방탈출', 'theme', 'escapeWant', 'escape'], ['boardWant', '해 보고 싶은 보드게임', 'name', 'boardWant', 'board'], ['movieWant', '보고 싶은 영화', 'title', 'movieWant', 'movie'], ['playWant', '보고 싶은 공연', 'title', 'playWant', 'play']];
const iconImg = k => (ICONS.find(x => x[0] === k) || ICONS[0])[2];
const social = () => me.social || { friends: [], incoming: [], outgoing: [], house: {} };
const roofColor = n => `hsl(${[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % 360} 62% 62%)`;
const houseSvg = (n, icon) => `<svg class="hs" viewBox="0 0 120 104" aria-hidden="true"><path d="M8 50 60 8l52 42" fill="${roofColor(n)}" stroke="${roofColor(n)}" stroke-width="10" stroke-linejoin="round"/>
  <rect x="20" y="46" width="80" height="54" rx="6" fill="var(--glass)" stroke="var(--line)" stroke-width="2"/><rect x="50" y="68" width="20" height="32" rx="3" fill="${roofColor(n)}" opacity=".85"/>
  <clipPath id="w-${esc(n)}"><circle cx="60" cy="40" r="13"/></clipPath><circle cx="60" cy="40" r="15" fill="#fff"/><image href="${iconImg(icon)}" x="47" y="27" width="26" height="26" clip-path="url(#w-${esc(n)})"/></svg>`;
function saveHouse() { if (cfg.token) queue({ action: 'setHouse', icon: store.get('appIcon', 'main'), intro: social().house?.intro || '' }); }
function renderSocial() {
  const s = social(), mine = HOUSE_LISTS.reduce((a, k) => a + L(k).filter(i => i.pub && !i.shared).length, 0);
  $('#myHouse').innerHTML = `${houseSvg(me.name || '나', store.get('appIcon', 'main'))}<div><b>${esc(me.name || '나')}네 집</b><small>공개한 작품 ${mine}개 · 기록을 고칠 때 「🏡 친구 집에 공개」를 켜면 여기 놓여요</small>
    <input id="houseIntro" maxlength="60" placeholder="문패에 쓸 한 줄 소개" value="${esc(s.house?.intro || '')}" aria-label="내 집 한 줄 소개"></div>`;
  $('#frIn').innerHTML = s.incoming.length ? '<h2>받은 친구 신청</h2>' + s.incoming.map(n => `<li><span>${esc(n)}</span><div class="row"><button type="button" class="small" data-fr="friendRemove" data-n="${esc(n)}">거절</button><button type="button" class="small primary" data-fr="friendAccept" data-n="${esc(n)}">수락</button></div></li>`).join('') : '';
  $('#frMine').innerHTML = s.friends.length ? `<h2>내 친구 ${s.friends.length}명</h2>` + s.friends.map(f => `<li><span class="fr-who"><i class="fr-av" style="background-image:url('${iconImg(f.icon)}')"></i>${esc(f.name)}</span>${f.name === s.ownerName ? '<small>초대해 준 친구</small>' : !isFriend() ? '<small>내가 초대한 친구 · 삭제는 설정에서</small>' : `<button type="button" class="small" data-fr="friendRemove" data-unfriend="1" data-n="${esc(f.name)}">친구 끊기</button>`}</li>`).join('') : '';
  $('#frOut').innerHTML = s.outgoing.map(n => `<li><span>${esc(n)} <small>수락 기다리는 중</small></span><button type="button" class="small" data-fr="friendRemove" data-n="${esc(n)}">취소</button></li>`).join('');
  $('#town').innerHTML = s.friends.length ? s.friends.map(f => `<button type="button" class="house" data-house="${esc(f.name)}">${houseSvg(f.name, f.icon)}<b>${esc(f.name)}네 집</b><small>${esc(f.intro || '놀러 가기')}</small></button>`).join('')
    : '<p class="hint" style="grid-column:1/-1;text-align:center">아직 친구가 없어요 · 위에 친구 이름(아이디)을 넣어 신청해 보세요</p>';
}
async function socialOp(action, name) {
  try {
    const r = await api({ action, name });
    if (!r.ok) throw new Error(r.error || '안 됐어요');
    me.social = r.social; store.set('me', me); renderSocial();
    if (action !== 'friendRemove') loadMe(); // 태그 칩(친구 목록)도 새로
    return r.social;
  } catch (e) { toast(String(e.message).replace(/^입력값 오류: /, '')); }
}
$('#frAdd').addEventListener('submit', async e => {
  e.preventDefault(); const n = $('#frName').value.trim(); if (!n) return;
  if (n === me.name) return toast('나 자신과는 이미 친구예요 🙂');
  const s = await socialOp('friendRequest', n);
  if (s) { $('#frName').value = ''; toast(s.friends.some(f => f.name === n) ? `${n}님과 친구가 됐어요 🎉` : `${n}님에게 친구 신청을 보냈어요 · 수락하면 서로 태그하고 집에 놀러 갈 수 있어요`); }
});
$('#v-friends').addEventListener('click', async e => {
  const b = e.target.closest('[data-fr]');
  if (b) {
    if (b.dataset.fr === 'friendRemove' && !await ask(b.dataset.unfriend ? `${b.dataset.n}님과 친구를 끊을까요?\n서로 태그한 기록과 집 방문이 더 이상 안 보여요 (기록은 그대로 남아요)` : `${b.dataset.n}님 신청을 ${b.closest('#frIn') ? '거절' : '취소'}할까요?`, { ok: b.dataset.unfriend ? '친구 끊기' : '네', danger: true })) return;
    const s = await socialOp(b.dataset.fr, b.dataset.n);
    if (s && b.dataset.unfriend) { toast(`${b.dataset.n}님과 친구를 끊었어요`); loadMe(); }
    if (s && b.dataset.fr === 'friendAccept') toast(`${b.dataset.n}님과 친구가 됐어요 🎉`);
    return;
  }
  const h = e.target.closest('[data-house]'); if (h) visitHouse(h.dataset.house);
});
$('#v-friends').addEventListener('change', e => {
  if (e.target.id !== 'houseIntro') return;
  me.social = { ...social(), house: { ...social().house, intro: e.target.value.trim() } }; store.set('me', me); saveHouse(); toast('문패를 바꿨어요');
});
// 놀러 가기: 문이 열리고 → 방마다 선반에 친구가 공개한 작품
let visiting = null;
async function visitHouse(name) {
  const d = $('#house'), f = social().friends.find(x => x.name === name) || {}; visiting = null;
  $('#houseTitle').textContent = `${name}네 집`;
  $('#houseEnter').innerHTML = houseSvg(name, f.icon);
  const hero = h => `${houseSvg(name, h.icon)}<div><b>${esc(name)}</b><p>${esc(h.intro || '문패에 아직 소개가 없어요')}</p><div class="house-stats">${h.items ? ROOMS.filter(([k]) => h.items[k]?.length).map(([k, t]) => `<span>${t} ${h.items[k].length}</span>`).join('') : ''}</div></div>`;
  $('#houseHero').innerHTML = hero(f); $('#houseRooms').innerHTML = '<p class="house-empty">문 두드리는 중…</p>';
  d.classList.remove('open'); d.showModal(); d.scrollTop = 0;
  requestAnimationFrame(() => d.classList.add('open'));
  try {
    const r = await api(null, '&what=house&name=' + encodeURIComponent(name));
    if (!r.house) throw new Error(r.error || '시트의 Code.gs를 새 버전으로 배포해 주세요');
    visiting = r.house; $('#houseHero').innerHTML = hero(visiting);
    const rooms = ROOMS.filter(([k]) => visiting.items[k]?.length);
    $('#houseRooms').innerHTML = rooms.length ? rooms.map(([k, t, key, , ic]) => `<section class="card room"><h2><svg class="i" aria-hidden="true"><use href="#i-s-${ic}"/></svg>${t} <small>${visiting.items[k].length}</small></h2><div class="shelf">${visiting.items[k].map((i, n) =>
      `<button type="button" class="work" data-k="${k}" data-n="${n}">${i.image ? `<img src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'em',textContent:'${LIST_ICON[k]}'}))">` : `<span class="em">${LIST_ICON[k]}</span>`}<b>${esc(i[key])}</b><small>${esc(i.rating || i.stars || '')}</small></button>`).join('')}</div></section>`).join('')
      : `<div class="card house-empty">아직 ${esc(name)}님이 공개한 작품이 없어요<br>조금 뒤에 다시 놀러 와요 🙂</div>`;
  } catch (e) { $('#houseRooms').innerHTML = `<div class="card house-empty">문이 안 열려요 · ${esc(String(e.message).replace(/^입력값 오류: /, ''))}</div>`; }
}
$('#houseClose').addEventListener('click', () => $('#house').close());
$('#houseRooms').addEventListener('click', async e => {
  const w = e.target.closest('.work'); if (!w || !visiting) return;
  const [k, t, key, want] = ROOMS.find(r => r[0] === w.dataset.k), i = visiting.items[k][w.dataset.n];
  const info = [i[key], joinDot([i.author, i.shop, i.director, i.kind, i.date]), [i.rating || i.stars, i.review].filter(Boolean).join(' ')].filter(Boolean).join('\n');
  if (!await ask(info, { ok: '나도 위시리스트에 담기' })) return;
  if (L(want).some(x => x[key] === i[key])) return toast('이미 위시리스트에 있어요');
  const item = { id: crypto.randomUUID(), [key]: i[key], memo: `${visiting.name}님 집에서`, ...(i.author ? { author: i.author } : {}), ...(i.shop ? { shop: i.shop } : {}), ...(i.image ? { image: i.image } : {}) };
  (lists[want] = lists[want] || []).push(item); store.set('lists', lists);
  saveNew(want, item).then(ok => ok && toast(`「${i[key]}」 위시리스트에 담았어요`));
});

// ── 공지사항 (notices.js): 공지 · 홈 화면 추가 방법 · Q&A · 개선 중 · 제보하기 ──
const verNum = v => +(String(v).match(/v(\d+)/)?.[1] || 0);
const noticeHTML = (n, isNew) => `<article class="notice${isNew ? ' new' : ''}"><div class="meta"><span class="ntag${n.pin ? ' pin' : ''}">${esc(n.tag)}</span>${esc(n.date)}</div><h3>${esc(n.title)}</h3><ul>${n.body.map(x => `<li>${esc(x)}</li>`).join('')}</ul></article>`;
let nTab = 'news';
function renderNotice() {
  const seen = store.get('noticeSeen', ''), list = [...NOTICES].sort((a, b) => (b.pin || 0) - (a.pin || 0));
  $('#v-notice').querySelectorAll('[data-nt]').forEach(b => b.setAttribute('aria-pressed', b.dataset.nt === nTab));
  const g = k => `<div class="card"><h2>${GUIDE[k].title}</h2><div class="gsteps">${GUIDE[k].steps.map(([img, t], i) => `<div class="gstep"><p><b>${i + 1}</b>${esc(t)}</p><img src="${img}" alt="${i + 1}단계: ${esc(t)}" loading="lazy"></div>`).join('')}<p class="gnote">💡 ${esc(GUIDE[k].note)}</p></div></div>`;
  $('#nBody').innerHTML = nTab === 'news' ? list.map(n => `<div class="card">${noticeHTML(n, !seen || NOTICES.findIndex(x => x.id === seen) > NOTICES.indexOf(n) || !NOTICES.some(x => x.id === seen))}</div>`).join('')
    : nTab === 'guide' ? g(/android/i.test(navigator.userAgent) ? 'android' : 'ios') + g(/android/i.test(navigator.userAgent) ? 'ios' : 'android')
    : nTab === 'faq' ? `<div class="card">${FAQ.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>`
    : `<div class="card"><h2>지금 고치고 있어요</h2><p class="hint">시간이 조금 걸리는 것들이에요. 끝나면 공지로 알려드릴게요.</p>${ROADMAP.map(([ic, t, d]) => `<div class="road"><span>${ic}</span><div><b>${esc(t)}</b><p>${esc(d)}</p></div></div>`).join('')}</div>`;
  $('#nVer').textContent = '앱 버전 ' + APP_VERSION.replace('gagyebu-', '');
  store.set('noticeSeen', NOTICES[0].id); paintNoticeDot();
}
const paintNoticeDot = () => document.querySelector('#menuList [data-sec=notice]')?.classList.toggle('dot', store.get('noticeSeen', '') !== NOTICES[0].id);
$('#v-notice').addEventListener('click', e => { const t = e.target.closest('[data-nt]')?.dataset.nt; if (t) { nTab = t; renderNotice(); } });
$('#reportForm').addEventListener('submit', async e => {
  e.preventDefault(); const t = $('#reportText').value.trim();
  if (!t) return $('#reportText').focus();
  if (!cfg.token) return toast('로그인한 뒤에 보낼 수 있어요');
  const btn = e.target.querySelector('button'); btn.disabled = true;
  try { const r = await api({ action: 'report', text: t, ver: APP_VERSION, ua: navigator.userAgent }); if (!r.ok) throw new Error(r.error); $('#reportText').value = ''; toast('제보 고마워요. 확인하고 고칠게요'); }
  catch (err) { toast('못 보냈어요 · ' + String(err.message).replace(/^입력값 오류: /, '')); }
  finally { btn.disabled = false; }
});
// 새 버전으로 바뀌었으면 한 번: 「업데이트됐어요」 창 + (알림 허용했으면) 휴대폰 알림
function showUpdate() {
  const seen = store.get('seenVer', '') || (cfg.token ? 'gagyebu-v87' : ''), now = APP_VERSION; // 이 기능 전부터 쓰던 사람은 v87에서 올라온 걸로
  store.set('seenVer', now);
  if (!seen || seen === now || !cfg.token) return; // 처음 설치한 사람에겐 안 띄움
  if (navigator.webdriver && !store.get('testUpd')) return; // 자동 테스트 화면에선 안 띄움 (tests/notice.js는 testUpd로 켬)
  const fresh = NOTICES.filter(n => n.ver > verNum(seen) && !n.pin);
  if (!fresh.length) return;
  $('#updVer').textContent = `${seen.replace('gagyebu-', '')} → ${now.replace('gagyebu-', '')}`;
  $('#updList').innerHTML = fresh.map(n => `<div class="notice">${noticeHTML(n)}</div>`).join('');
  const open = () => document.querySelector('dialog[open]') ? setTimeout(open, 1200) : $('#updSheet').showModal();
  setTimeout(open, 900);
  if ('Notification' in window && Notification.permission === 'granted') navigator.serviceWorker?.ready.then(r => r.showNotification('하트가 업데이트됐어요 ✨', { body: fresh[0].title, icon: 'icon-192.png', tag: 'update-' + now })).catch(() => {});
}
$('#updOk').addEventListener('click', () => $('#updSheet').close());
$('#updMore').addEventListener('click', () => { $('#updSheet').close(); nTab = 'news'; setSection('notice'); });

// ── N빵: 달력·내역에서 거래를 골라(누르거나 옆으로 쓸어 여러 개) 사람 수로 나누고, 항목 + 계좌 + 보낼 금액을 바로 복사 ──
// 계좌는 공개 저장소에 두지 않으려고 이 기기에만 저장 (처음 한 번 물어봄)
var splitUl = null, splitN = 2, splitDrag = null, splitDragged = false; // var: 위쪽 renderCal이 이 코드보다 먼저 불려도 오류 없게
const splitIds = new Set();
const splitItems = () => data.items.filter(i => splitIds.has(i.id)).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
const splitTotal = () => splitItems().reduce((t, i) => t + net(i), 0);
const splitPer = (total, n) => Math.ceil(total / n / 10) * 10; // 10원 단위 올림 (보내는 사람이 몇 원씩 덜 내지 않게)
function splitText(acct) {
  const items = splitItems(), total = splitTotal(), per = splitPer(total, splitN), md = d => `${+d.slice(5, 7)}/${+d.slice(8)}`;
  return [`[N빵 정산] ${splitN}명`, ...items.map(i => `· ${md(i.date)} ${i.content || i.minor || i.major} ${won(net(i))}`),
    `합계 ${won(total)} ÷ ${splitN}명`, `1인당 ${won(per)}`, '', acct, `${won(per)} 보내주세요`].join('\n');
}
function paintSplit() {
  if (!splitUl) return;
  splitUl.querySelectorAll('li[data-id]').forEach(li => li.classList.toggle('sel', splitIds.has(li.dataset.id)));
  const total = splitTotal();
  $('#splitCount').textContent = `${splitIds.size}개 · ${won(total)}`; $('#splitN').textContent = `${splitN}명`;
  $('#splitGo').disabled = !splitIds.size || total <= 0;
  $('#splitGo').textContent = splitIds.size && total > 0 ? `1인당 ${won(splitPer(total, splitN))} · 나누고 복사하기` : '나누고 복사하기';
}
function startSplit(ul) {
  endSplit(); splitUl = ul; splitIds.clear(); ul.classList.add('picking'); document.body.classList.add('splitting');
  ul.closest('.card').before($('#splitBar')); $('#splitBar').hidden = false; paintSplit();
}
function endSplit() {
  if (splitUl) splitUl.classList.remove('picking'), splitUl.querySelectorAll('li.sel').forEach(li => li.classList.remove('sel'));
  splitUl = null; splitIds.clear(); document.body.classList.remove('splitting'); $('#splitBar').hidden = true;
}
document.querySelectorAll('[data-split]').forEach(b => b.addEventListener('click', () => startSplit($(b.dataset.split))));
$('#splitCancel').addEventListener('click', endSplit);
$('#splitBar').addEventListener('click', e => { const d = +e.target.closest('[data-n]')?.dataset.n; if (d) { splitN = Math.min(30, Math.max(2, splitN + d)); paintSplit(); } });
['#list', '#dayList'].forEach(s => {
  const ul = $(s);
  ul.addEventListener('click', e => {
    if (splitUl !== ul) return;
    if (splitDragged) { splitDragged = false; return; } // 쓸어서 고른 직후의 클릭은 무시
    const id = e.target.closest('li[data-id]')?.dataset.id; if (!id) return;
    splitIds.has(id) ? splitIds.delete(id) : splitIds.add(id); paintSplit();
  });
  // 옆으로 쓸기 시작하면 그 뒤로 손가락이 지나간 줄을 모두 (처음 줄이 선택돼 있었으면 모두 해제)
  ul.addEventListener('pointerdown', e => { if (splitUl === ul) splitDrag = { x: e.clientX, y: e.clientY, on: null }; });
  ul.addEventListener('pointermove', e => {
    if (!splitDrag || splitUl !== ul) return;
    if (splitDrag.on == null) {
      if (Math.abs(e.clientX - splitDrag.x) < 12 || Math.abs(e.clientX - splitDrag.x) < Math.abs(e.clientY - splitDrag.y)) return;
      const first = document.elementFromPoint(splitDrag.x, splitDrag.y)?.closest('li[data-id]');
      splitDrag.on = !(first && splitIds.has(first.dataset.id)); splitDragged = true;
      if (first) splitDrag.on ? splitIds.add(first.dataset.id) : splitIds.delete(first.dataset.id);
    }
    const li = document.elementFromPoint(e.clientX, e.clientY)?.closest('li[data-id]');
    if (li && ul.contains(li)) { splitDrag.on ? splitIds.add(li.dataset.id) : splitIds.delete(li.dataset.id); paintSplit(); }
  });
  const stop = () => { splitDrag = null; };
  ul.addEventListener('pointerup', stop); ul.addEventListener('pointercancel', stop);
});
const askAcct = async () => {
  const v = await ask('정산 받을 계좌를 적어 주세요\n(이 기기에만 저장돼요)', { input: store.get('splitAcct', '') || '은행 계좌번호 이름', ok: '저장' });
  if (v == null || !v.trim()) return '';
  store.set('splitAcct', v.trim()); return v.trim();
};
async function copySplit(text) {
  try { await navigator.clipboard.writeText(text); toast('정산 글을 복사했어요 · 단톡방에 붙여넣으면 돼요'); return true; }
  catch (e) { toast('자동 복사가 막혔어요 · 「복사하기」를 눌러 주세요'); return false; }
}
$('#splitGo').addEventListener('click', async () => {
  let acct = store.get('splitAcct', '');
  if (!acct && !(acct = await askAcct())) return;
  const text = splitText(acct), n = splitIds.size;
  $('#splitText').value = text; $('#splitInfo').textContent = `${n}개 · ${splitN}명`;
  $('#splitSheet').showModal(); copySplit(text);
});
$('#splitCopy').addEventListener('click', () => copySplit($('#splitText').value).then(ok => ok && $('#splitSheet').close()));
$('#splitAcct').addEventListener('click', async () => { const a = await askAcct(); if (a) { $('#splitText').value = splitText(a); copySplit($('#splitText').value); } });
$('#splitSheet').addEventListener('close', () => { if (splitUl) endSplit(); });

{ const st = store.get('startSec', 'home'), want = st === 'last' ? store.get('sec', 'home') : st;
  if (!new URLSearchParams(location.search).get('sec')) setSection(SECTIONS[want] && !(want === 'money' && isFriend()) ? want : 'home'); }
applyRole(); loadMe(); // 친구 코드면 가계부 대신 독서로 (시트에 다시 물어 확인)
showUpdate();
function setBrag(on) {
  brag = on; store.set('brag', on);
  document.body.classList.toggle('brag', on); $('#bragBadge').hidden = !on;
  $('#bragBtn').setAttribute('aria-pressed', on);
  render(); if (sec === 'habit') renderHabits();
}
$('#bragBtn').addEventListener('click', () => { setBrag(!brag); $('#menu').close(); toast(brag ? '자랑하기 모드: 금액과 거래 내용을 가렸어요' : '자랑하기 모드를 껐어요'); });
$('#bragBadge').addEventListener('click', async () => { if (await ask('자랑하기 모드를 끌까요? 금액이 다시 보여요', { ok: '끄기' })) setBrag(false); });
// ── 사진으로 입력: 카드 문자·결제 내역 캡처·영수증 사진 → 시트(구글 드라이브 OCR)가 글자를 읽음 → 거래 후보 → 확인 후 저장 ──
// 이미 시트에 있는 거래(같은 날 같은 금액)와 사진 안에서 겹치는 건 체크를 빼 둠
const ruleFor = s => { s = (s || '').toLowerCase(); return s ? data.meta.rules.find(r => r[0] && s.includes(r[0].toLowerCase())) : null; };
function parseOcr(text, today) {
  const y0 = +today.slice(0, 4);
  const lines = String(text).split(/\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const dateOf = s => {
    let m = s.match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
    if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
    m = s.match(/(?:^|[^\d,])(\d{1,2})\s*[./월]\s*(\d{1,2})(?:일|(?![\d,]))/);
    if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > 31) return '';
    const d = `${y0}-${pad2(+m[1])}-${pad2(+m[2])}`;
    return d > today ? `${y0 - 1}${d.slice(4)}` : d; // 연도 없는 날짜가 미래면 작년
  };
  const amtOf = s => { const m = s.match(/(-?\d{1,3}(?:,\d{3})+|-?\d{3,})\s*원/) || s.match(/(-?\d{1,3}(?:,\d{3})+)(?![\d.])/); return m ? Math.abs(+m[1].replace(/,/g, '')) : 0; };
  const timeOf = s => (s.match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/) || []).slice(1).map((v, k) => k ? v : pad2(+v)).join(':');
  const NOISE = /\[?web발신\]?|승인|일시불|할부|\d+개월|누적|체크|신용|결제|사용|금액|카드|[-+]?\d[\d,]*\s*원|\d{1,2}:\d{2}|(?<![가-힣a-z\d])[\d,./\-:*()\[\]+]+(?![가-힣a-z\d])/gi; // 이름에 붙은 숫자(GS25)는 남김
  const nameOf = s => s.replace(/\S*\*\S*|[가-힣a-z]*카드|[()[\]]/gi, ' ').replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
  const typeOf = s => /취소|환불/.test(s) ? '환불' : /입금|급여|이자/.test(s) ? '수입' : '지출';
  const first = lines.map(dateOf).find(Boolean) || today;
  // 영수증: 합계 줄 하나만
  const total = lines.findIndex(l => /합\s*계|결제\s*금액|받을\s*금액|총\s*액|총\s*결제|판매\s*금액/.test(l) && amtOf(l));
  if (total >= 0) return [{ date: first, time: lines.map(timeOf).find(Boolean) || '', content: nameOf(lines.find(l => nameOf(l).length >= 2) || ''), amount: amtOf(lines[total]), type: '지출' }];
  // 목록·문자: 금액이 있는 줄마다 하나 (잔액·한도 줄은 빼고)
  // 카드 문자처럼 금액 뒤에 날짜·가맹점이 오면, 다음 줄로 채움 (pending). 카드사·승인 줄과 가려진 이름(홍*동)은 가맹점이 아님
  const out = []; let day = first, prevName = '', pending = null;
  lines.forEach(l => {
    const d = dateOf(l), a = amtOf(l), n = nameOf(l);
    if (d) day = d;
    if (!a || /잔액|한도|포인트|적립|누적/.test(l)) {
      if (pending && d) { pending.date = d; pending.time = pending.time || timeOf(l); }
      const ok = n.length >= 2 && !/\*/.test(l) && !/승인|카드|은행|web발신/i.test(l);
      if (ok && pending) { pending.content = n; pending = null; } else if (ok && !d) prevName = n;
      return;
    }
    const row = { date: day, time: timeOf(l), content: n.length >= 2 ? n : prevName, amount: a, type: typeOf(l + ' ' + (n.length >= 2 ? '' : prevName)) };
    out.push(row); pending = row.content ? null : row; prevName = '';
  });
  return out;
}
let phRows = [];
function renderPhoto(text) {
  const today = localISO().slice(0, 10), seen = new Set();
  phRows = parseOcr(text, today).map(r => {
    const key = r.date + '|' + r.amount, dup = data.items.some(i => i.date === r.date && i.amount === r.amount) ? '이미 시트에 있는 거래예요' : seen.has(key) ? '사진 안에서 겹쳐요' : '';
    seen.add(key);
    return { ...r, dup };
  });
  $('#phRaw').textContent = text;
  $('#phInfo').textContent = phRows.length ? `${phRows.length}건 찾음 · 겹치는 ${phRows.filter(r => r.dup).length}건은 빼 두었어요 · 고칠 곳은 바로 고쳐요` : '거래를 찾지 못했어요 · 「읽은 글자 보기」를 확인해 보세요';
  $('#phList').innerHTML = phRows.map((r, k) => `<li class="${r.dup ? 'dup' : ''}" data-k="${k}"><input type="checkbox" aria-label="저장" ${r.dup ? '' : 'checked'}>
    <input type="text" name="content" value="${esc(r.content)}" aria-label="내용" placeholder="내용"><input type="number" name="amount" inputmode="numeric" value="${r.amount}" aria-label="금액">
    <input type="date" name="date" value="${r.date}" aria-label="날짜"><b class="${r.type === '지출' ? 'out' : r.type === '수입' ? 'in' : 'refund'}" style="font-size:0.765rem">${r.type}</b>${r.dup ? `<small>${r.dup}</small>` : ''}</li>`).join('');
  $('#phSave').disabled = !phRows.length;
}
// 사진은 긴 변 1600px JPEG로 줄여서 보냄 (빠르고 OCR엔 충분)
const shrink = file => new Promise((res, rej) => {
  const img = new Image(); img.onerror = () => rej(new Error('사진을 열 수 없어요'));
  img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src); res(c.toDataURL('image/jpeg', 0.85).split(',')[1]); };
  img.src = URL.createObjectURL(file);
});
$('#photoIn').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  busy(true); toast('사진을 읽는 중이에요…');
  try {
    const r = await call({ action: 'ocr', image: await shrink(f) });
    if (r.text == null) throw new Error('시트의 Code.gs를 새 버전으로 배포해 주세요');
    renderPhoto(r.text); $('#photoSheet').showModal();
  } catch (err) { toast(err.message); } finally { busy(false); }
});
$('#phClose').addEventListener('click', () => $('#photoSheet').close());
$('#phSave').addEventListener('click', () => {
  const majors = [...new Set(data.meta.cats.map(c => c[0]))], fallback = majors.includes('기타') ? '기타' : majors[0] || '기타';
  let n = 0;
  $('#phList').querySelectorAll('li').forEach(li => {
    if (!li.querySelector('[type=checkbox]').checked) return;
    const r = phRows[li.dataset.k], g = n => li.querySelector(`[name=${n}]`).value;
    const content = g('content').trim(), amount = Math.round(+g('amount')), date = g('date'), rule = ruleFor(content);
    if (!(amount > 0) || !date) return;
    const type = r.type !== '지출' ? r.type : rule && TYPES.includes(rule[1]) ? rule[1] : '지출';
    const it = { id: crypto.randomUUID(), date, time: r.time || '', type, major: rule ? rule[2] : type === '수입' ? '수입' : fallback, minor: rule ? rule[3] : '',
      content, pay: '', amount, memo: '사진 입력', inst: '' };
    data.items.push(it); queue({ action: 'save', item: it }); n++;
  });
  $('#photoSheet').close();
  toast(n ? `${n}건을 저장했어요` : '저장할 거래를 고르지 않았어요');
  render();
});
// ── 올해의 BAB:ZIP: 12월~1월 중순 홈 위 배너 (?recap=1로 언제든) → 한 해 결산, 공유용 이미지 저장 ──
const recapYear = () => { const t = localISO(); return t.slice(5, 7) === '01' ? String(+t.slice(0, 4) - 1) : t.slice(0, 4); };
function recapData() {
  const y = recapYear(), tx = data.items.filter(i => i.date.startsWith(y));
  const exp = tx.reduce((t, i) => t + net(i), 0), byMajor = {}, byMonth = {};
  tx.forEach(i => { if (net(i)) { byMajor[i.major] = (byMajor[i.major] || 0) + net(i); byMonth[i.date.slice(5, 7)] = (byMonth[i.date.slice(5, 7)] || 0) + net(i); } });
  const topCat = Object.entries(byMajor).sort((a, b) => b[1] - a[1])[0], topMonth = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0];
  const books = L('book').filter(i => i.status === '완독' && i.year === y + '년');
  const inY = k => L(k).filter(i => (i.date || '').startsWith(y));
  const esc_ = inY('escape'), best = habits.map(h => [h.name, streak(h)]).sort((a, b) => b[1] - a[1])[0];
  return { y, exp, inc: tx.filter(i => i.type === '수입').reduce((t, i) => t + i.amount, 0), n: tx.length, topCat, topMonth, books,
    escape: esc_.length, escOk: esc_.filter(i => i.result === '성공').length, movies: inY('movie').length, plays: inY('play').length, boards: inY('board').length, best };
}
function recapLines(r) {
  return [
    ['💸', '한 해 동안 쓴 돈', won(r.exp), `${r.n}번 기록 · 수입 ${won(r.inc)}`],
    r.topCat && ['🏆', '가장 많이 쓴 곳', `${em(r.topCat[0])} ${r.topCat[0]}`, `${won(r.topCat[1])} · ${Math.round(r.topCat[1] / Math.max(1, r.exp) * 100)}%`],
    r.topMonth && ['📅', '지갑이 가장 바빴던 달', `${+r.topMonth[0]}월`, won(r.topMonth[1])],
    r.books.length && ['📚', '다 읽은 책', `${r.books.length}권`, r.books.slice(-3).map(b => b.title).join(' · ')],
    r.escape && ['🔐', '방탈출', `${r.escape}개 테마`, `성공 ${r.escOk}번`],
    (r.movies || r.plays) && ['🎬', '영화·공연', `${r.movies + r.plays}편`, `영화 ${r.movies} · 연극·뮤지컬 ${r.plays}`],
    r.boards && ['🎲', '보드게임', `${r.boards}번`, ''],
    r.best && r.best[1] && ['🔥', '가장 길게 이어 간 습관', `${r.best[1]}일 연속`, r.best[0]],
  ].filter(Boolean);
}
function openRecap() {
  const r = recapData();
  $('#rcTitle').textContent = `올해의 하트 ${r.y}`;
  $('#rcList').innerHTML = recapLines(r).map(([e, t, v, sub]) => `<li><span class="em" aria-hidden="true">${e}</span><div><small>${esc(t)}</small><b>${esc(v)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div></li>`).join('');
  $('#recap').showModal();
}
// 공유용 이미지: 캔버스에 직접 그림 (외부 라이브러리 없이) 1080×1350
function recapImage() {
  const r = recapData(), lines = recapLines(r), c = document.createElement('canvas'), x = c.getContext('2d');
  c.width = 1080; c.height = 1350;
  const g = x.createLinearGradient(0, 0, 1080, 1350); g.addColorStop(0, '#3182f6'); g.addColorStop(1, '#7b5cf5');
  x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
  const font = (w, px) => `${w} ${px}px "Pretendard Variable", -apple-system, sans-serif`;
  x.fillStyle = '#fff'; x.font = font(600, 40); x.fillText('하트', 80, 120);
  x.font = font(800, 84); x.fillText(`올해의 ${r.y}`, 80, 220);
  const rowH = Math.min(130, 960 / Math.max(1, lines.length));
  lines.forEach(([e, t, v, sub], k) => {
    const top = 320 + k * rowH;
    x.globalAlpha = .14; x.fillStyle = '#fff'; x.beginPath(); x.roundRect(60, top - 10, 960, rowH - 16, 28); x.fill(); x.globalAlpha = 1;
    x.font = font(400, 54); x.fillText(e, 90, top + 66);
    x.font = font(500, 28); x.fillStyle = 'rgba(255,255,255,.8)'; x.fillText(t, 180, top + 34);
    x.font = font(800, 46); x.fillStyle = '#fff'; x.fillText(v, 180, top + 86);
    if (sub) { x.font = font(500, 26); x.fillStyle = 'rgba(255,255,255,.75)'; const w = x.measureText(v).width; x.fillText(sub.length > 28 ? sub.slice(0, 27) + '…' : sub, Math.min(200 + w, 620), top + 84); }
  });
  return new Promise(res => c.toBlob(res, 'image/png'));
}
$('#rcSave').addEventListener('click', async () => {
  const blob = await recapImage(), file = new File([blob], `BABZIP-${recapYear()}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: `올해의 하트 ${recapYear()}` }); } catch (e) {} return; } // 아이폰: 공유 시트 → 이미지 저장
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});
$('#rcClose').addEventListener('click', () => $('#recap').close());
$('#recapBanner').addEventListener('click', openRecap);
{ const t = localISO(); $('#recapBanner').hidden = !(t.slice(5, 7) === '12' || (t.slice(5, 7) === '01' && +t.slice(8, 10) <= 15)); }
// 앱 아이콘 길게 누르기 메뉴(안드로이드)가 여는 주소: ?add=1 · ?view=cal · ?sec=book&add=1
const qp = new URLSearchParams(location.search);
if (qp.get('sec') && SECTIONS[qp.get('sec')]) setSection(qp.get('sec'));
if (['home', 'cal', 'list', 'rec'].includes(qp.get('view'))) show(qp.get('view'));
if (qp.has('recap')) setTimeout(openRecap, 300);
if (qp.has('add') && sec !== 'habit') setTimeout(() => (sec === 'money' ? openEntry(null, localISO().slice(0, 10)) : openItem()), 250);
if (location.search) history.replaceState(null, '', location.pathname + location.hash);
// 새 버전 확인: 화면에 돌아올 때마다 배포된 sw.js의 버전을 직접 받아 지금 화면의 버전과 비교
// 다르면 입력 중이 아닐 땐 바로 새로고침, 입력 창이 열려 있으면 「새 버전이 있어요」 안내
async function checkVersion() {
  try {
    const live = (await (await fetch('sw.js', { cache: 'no-store' })).text()).match(/gagyebu-v\d+/)?.[0];
    if (!live || live === APP_VERSION) return;
    if (!document.querySelector('dialog[open]')) return location.reload();
    $('#status').textContent = '새 버전이 있어요 · 눌러서 업데이트'; $('#status').classList.add('err'); statusAct = 'update';
  } catch {}
}
$('#status').addEventListener('click', () => { if (statusAct === 'update') location.reload(); });
if ('serviceWorker' in navigator) {
  pushSubscribe();
  checkVersion();
  const hadSW = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(reg => {
    // 홈 화면 앱은 껐다 켜도 멈춘 화면을 다시 보여 주기만 해서, 돌아올 때마다 새 버전을 확인
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { reg.update(); checkVersion(); } });
    addEventListener('pageshow', e => { if (e.persisted) { reg.update(); checkVersion(); } }); // 사파리 탭이 메모리에서 되살아날 때
  });
  // 새 버전으로 바뀌면 한 번 새로고침 (입력 창이 열려 있으면 닫힐 때까지 기다림)
  const reloadWhenIdle = () => (document.querySelector('dialog[open]') ? setTimeout(reloadWhenIdle, 1500) : location.reload());
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadSW) reloadWhenIdle(); });
}

