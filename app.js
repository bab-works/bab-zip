const $ = s => document.querySelector(s);
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
// 시트(원본)의 화면용 사본. meta = 카테고리·예산·결제수단·분류규칙·반복
let data = store.get('data2', { items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } });
let pending = store.get('pending', []); // 아직 시트에 못 보낸 작업 (오프라인 대비, 순서대로 전송)

const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
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
  if (!this.open || this.classList.contains('closing') || calm()) return realClose.call(this, rv);
  this.classList.add('closing');
  setTimeout(() => { this.classList.remove('closing'); realClose.call(this, rv); }, 220);
};
// ESC·뒤로가기로 닫을 때도 같은 애니메이션
document.addEventListener('cancel', e => { if (e.target instanceof HTMLDialogElement) { e.preventDefault(); e.target.close(); } }, true);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const localISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString(); };
const persist = () => { store.set('data2', data); store.set('pending', pending); };
// 동기화·저장·삭제 완료는 잠깐 뜨는 팝업으로만, 연결 문제 같은 건 상단에 남김
let syncTimer;
const setStatus = t => {
  statusAct = ''; $('#status').classList.remove('err');
  if (/동기화됨|저장됨|삭제됨|반영됨/.test(t)) {
    const el = $('#syncPop');
    el.textContent = t; el.classList.add('show');
    clearTimeout(syncTimer); syncTimer = setTimeout(() => el.classList.remove('show'), 1500);
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
  if (/틱틱/.test(m)) return [m + ' · 눌러서 해결 방법 보기', 'help-ticktick'];
  if (/배포|Code\.gs/.test(m)) return ['시트 쪽 코드가 예전 버전이에요 · 눌러서 해결 방법 보기', 'help-deploy'];
  if (/열 구성|P열|열 이름|열이 없어요|탭 없음|목록 탭/.test(m)) return ['시트 모양이 달라요: ' + m + ' · 눌러서 해결 방법 보기', 'help-sheet'];
  return [m + ' · 눌러서 자세히', pending.length ? 'pending' : 'retry'];
}
let lastErr = '';
function showError(e, where) {
  lastErr = String(e?.message || e || '');
  const [text, act] = explain(e);
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
const LIST_NAME = { book: '독서', buy: '구매 목록', wish: '추천·관심', escape: '방탈출', board: '보드게임', movie: '영화', play: '연극·뮤지컬' };
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
  $('#pendErr').textContent = pending.length ? `맨 위 항목에서 멈췄어요 · 오류: ${lastErr || '없음'}` : '보낼 것이 없어요 · 모두 시트에 저장됐어요';
  $('#pendList').innerHTML = pending.map((o, k) => `<li><span>${esc(opText(o))}</span><button type="button" class="small danger" data-k="${k}">버리기</button></li>`).join('');
  $('#pendRetry').disabled = !pending.length;
}
$('#pendList').addEventListener('click', e => {
  const k = e.target.closest('[data-k]')?.dataset.k;
  if (k == null || !confirm('이 항목을 시트에 보내지 않고 버릴까요?')) return;
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
  else if (statusAct === 'settings') $('#openSettings').click();
  else if (HELP[statusAct]) openHelp(statusAct);
});
$('#helpRetry').addEventListener('click', () => { $('#help').close(); retry(); });
$('#helpClose').addEventListener('click', () => $('#help').close());
let toastTimer;
function toast(t, ms = 3500) {
  const el = $('#toast');
  el.textContent = t; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ── 시트 통신 ──
async function api(body, qs = '') {
  if (!cfg.url) throw new Error('⚙ 설정에서 시트를 연결하세요');
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
    throw new Error(e.name === 'AbortError' ? '시트가 45초 넘게 답이 없어요' : `시트에 닿지 못했어요 (${e.message})`);
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
      toast('시트가 거부해서 취소됨: ' + e.message);
    }
    pending.shift();
    persist();
  }
  return true;
}
async function refresh() {
  try {
    busy(true);
    document.body.classList.toggle('loading', !data.items.length);
    if (await sync()) {
      try {
        // 최근 두 달만 받고, 그 이전은 지문이 같으면 폰에 있는 것을 그대로 씀 (예전 줄이 바뀌었으면 전체를 다시 받음)
        const since = ymAdd(localISO().slice(0, 7), -2) + '-01';
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
  $('#alerts').innerHTML = (over.length ? `<div class="alert over">🚨 <b>예산 초과 ${over.length}개</b> · ${over.join(', ')}</div>` : '') +
    (warn.length ? `<div class="alert">⚠️ <b>80% 넘음 ${warn.length}개</b> · ${warn.join(', ')}</div>` : '');
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

  $('#recent').innerHTML = [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || '')).slice(0, 5).map(txRow).join('') || '<li class="empty">이번 달 거래가 없어요</li>';
}
let dailySel = 0;

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
const compact = n => (Math.abs(n) >= 1e6 ? cf0 : cf1).format(Math.abs(n)); // 칸이 좁아 100만 이상은 소수점 없이
const WEEK = '일월화수목금토';
let selDay = localISO().slice(0, 10);
function daySums(list) {
  return { inc: list.filter(i => i.type === '수입').reduce((s, i) => s + i.amount, 0), exp: list.reduce((s, i) => s + net(i), 0) };
}
let calPay = ''; // 달력 결제유형 탭 ('' = 전체)
// 달력 손잡이: 펼침(한 달) ↔ 접힘(선택한 주 한 줄). 끌면 그 사이 높이로 움직임 (가계부 달력·습관 달력 공용)
function foldCal(clip, grid, grab, open = true) {
  const f = { open, week: 0 };
  const row = () => (grid.querySelector('button, .other')?.offsetHeight || 60) + 2, full = () => grid.scrollHeight;
  const place = (h, animate) => {
    const rh = row(), fh = full(), t = fh > rh ? Math.min(1, Math.max(0, (h - rh) / (fh - rh))) : 1;
    clip.classList.toggle('anim', animate); grid.classList.toggle('anim', animate);
    clip.style.height = h + 'px';
    grid.style.transform = `translateY(${-(1 - t) * f.week * rh}px)`;
  };
  f.fit = () => { if (clip.offsetParent) place(f.open ? full() : row(), false); }; // 숨긴 상태에선 높이를 못 재므로 보일 때 다시 맞춤
  const toggle = () => { f.open = !f.open; place(f.open ? full() : row(), true); };
  let drag = null;
  grab.addEventListener('pointerdown', e => { drag = { y: e.clientY, h: clip.offsetHeight, moved: false }; grab.setPointerCapture(e.pointerId); });
  grab.addEventListener('pointermove', e => {
    if (!drag) return;
    const dy = e.clientY - drag.y; if (Math.abs(dy) > 4) drag.moved = true;
    place(Math.min(full(), Math.max(row(), drag.h + dy)), false);
  });
  const end = () => {
    if (!drag) return;
    const moved = drag.moved; drag = null;
    if (!moved) return toggle(); // 눌렀으면 토글, 끌었으면 가까운 쪽으로
    f.open = clip.offsetHeight > (row() + full()) / 2;
    place(f.open ? full() : row(), true);
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
  // 칸이 좁아서 100만 이상만 줄여 쓰고, 그 아래는 전부 표시
  const amt = n => Math.abs(n) >= 1e6 ? compact(n) : Math.abs(Math.round(n)).toLocaleString('ko-KR');
  let html = lead;
  for (let d = 1; d <= days; d++) {
    const ds = `${m}-${pad2(d)}`, s = sums[ds], wd = (first + d - 1) % 7;
    const cls = [ds === today && 'today', ds > today && 'future', wd === 0 && 'sun', wd === 6 && 'sat'].filter(Boolean).join(' ');
    html += `<button type="button" data-day="${ds}" class="${cls}" aria-pressed="${ds === selDay}" aria-label="${mo}월 ${d}일${s ? ` 수입 ${won(s.inc)} 지출 ${won(s.exp)}` : ''}">
      <span class="d">${d}</span>${s && s.inc ? `<small class="in">+${amt(s.inc)}</small>` : ''}${s && s.exp ? (s.exp > 0
        ? `<small class="${s.exp >= bigCut ? 'big' : 'spend'}">-${amt(s.exp)}</small>` : `<small class="refund">+${amt(s.exp)}</small>`) : ''}</button>`;
  }
  calGrid.innerHTML = html + tail;
  calF.week = Math.floor((first + +selDay.slice(8) - 1) / 7);
  calF.fit();
  const tdy = data.items.filter(i => i.date === today), tds = daySums(tdy);
  $('#calQuickSum').textContent = tdy.length ? `지출 ${won(tds.exp)} · ${tdy.length}건 · 눌러서 추가` : '아직 입력이 없어요 · 눌러서 추가';
  renderTrend(src, m, y, mo, days, today);

  const list = (byDay[selDay] || []).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || b.amount - a.amount);
  const [, sm, sd] = selDay.split('-').map(Number), ds = daySums(list);
  $('#dayTitle').textContent = `${sm}월 ${sd}일 ${WEEK[new Date(y, sm - 1, sd).getDay()]}요일`;
  $('#daySum').innerHTML = list.length ? `${list.length}건 · 수입 <b class="in">${won(ds.inc)}</b> · 지출 <b class="out">${won(ds.exp)}</b>` : '';
  $('#dayList').innerHTML = list.map(i => txRow(i, true)).join('') || '<li class="empty">이날 기록이 없어요</li>';
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
  F.amount.value = it?.amount || '';
  F.content.value = it?.content || '';
  F.memo.value = it?.memo || '';
  F.inst.value = it?.inst || '';
  $('#recRow').hidden = !!it; // 반복은 새 거래에서만 켬
  recHint();
  $('#entryDelete').hidden = !it;
  $('#entryTitle').textContent = it ? '거래 수정' : '거래 추가';
  $('#entry').showModal();
}
const recHint = () => { $('#recHint').textContent = F.rec.checked && F.date.value ? `매월 ${+F.date.value.slice(8)}일` : ''; };
$('#entryForm').addEventListener('change', e => {
  if (e.target.name === 'type') entryCats();
  if (e.target.name === 'rec' || e.target.name === 'date') recHint();
});
$('#recManage').addEventListener('click', () => { $('#entry').close(); show('rec'); });
// 내용을 치면 「분류규칙」 탭의 키워드로 구분·대분류·소분류 자동 선택 (새 거래만)
F.content.addEventListener('input', () => {
  if (F.tid.value) return;
  const s = F.content.value.toLowerCase();
  const r = s && data.meta.rules.find(r => r[0] && s.includes(r[0].toLowerCase()));
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
  if (it.pay) store.set('lastPay', it.pay);
  queue({ action: 'save', item: it });
  checkBudget(m, it.major, before);
});
$('#entryDelete').addEventListener('click', () => {
  if (!confirm('이 거래를 시트에서 삭제할까요?')) return;
  const id = F.tid.value;
  data.items = data.items.filter(i => i.id !== id);
  $('#entry').close();
  queue({ action: 'delete', id }).then(ok => ok && setStatus('삭제됨'));
});
$('#entryCancel').addEventListener('click', () => $('#entry').close());
$('#fab').addEventListener('click', () => sec === 'money' ? openEntry(null, $('#v-cal').hidden ? '' : selDay) : openItem());
['#list', '#dayList', '#recent', '#catList'].forEach(s => $(s).addEventListener('click', e => {
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
$('#budgets').addEventListener('click', e => {
  const cat = e.target.closest('[data-cat]')?.dataset.cat;
  if (cat) { catOpen = cat; renderCatSheet(); return $('#catSheet').showModal(); }
  const mj = e.target.closest('[data-major]')?.dataset.major;
  if (!mj) return;
  if (!majorsAll().includes(mj)) return toast('「카테고리」 탭에 없는 대분류예요');
  const v = prompt(`${mj} 월 예산 (원)`, data.meta.budgets[mj] || '');
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
$('#recList').addEventListener('click', e => {
  const id = e.target.dataset.rid;
  if (!id || !confirm('반복을 삭제할까요? (이미 기록된 거래는 남아요)')) return;
  data.meta.recurring = data.meta.recurring.filter(r => r.id !== id);
  queue({ action: 'recDelete', id });
});

// ── 공통 ──
let curView = 'home';
function show(v) {
  curView = v;
  document.querySelectorAll('nav button').forEach(b => b.dataset.view === v ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  ['home', 'cal', 'list', 'rec'].forEach(x => { $('#v-' + x).hidden = x !== v; });
  $('#filters').hidden = v !== 'list' && v !== 'cal';
  document.querySelectorAll('.list-only').forEach(el => { el.hidden = v !== 'list'; });
  setFab(v === 'cal'); // 달력은 「이날 추가」 버튼을 씀
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
$('#reload').addEventListener('click', () => sec === 'money' ? refresh() : sec === 'habit' ? refreshHabits() : refreshLists());
$('#openSettings').addEventListener('click', () => {
  const f = $('#settingsForm');
  f.url.value = cfg.url; f.token.value = cfg.token;
  $('#settings').showModal();
});
$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'save') return;
  const f = $('#settingsForm'), link = f.link.value.trim();
  const c = link ? cfgFrom(link.split('#')[1] || '') : { url: f.url.value.trim() || cfg.url || SHEET_URL, token: f.token.value };
  if (!c || !c.url || !c.token) { toast(link ? '설정 링크가 올바르지 않아요' : '비밀번호를 넣어 주세요'); return $('#settings').showModal(); }
  cfg = c;
  f.link.value = '';
  store.set('cfg', cfg);
  refresh();
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
  money: { title: 'MONEY', icon: '💰' },
  book: { title: '독서', icon: '📚', tabs: [['book', '독서 기록'], ['buy', '구매 목록'], ['wish', '추천·관심']] },
  escape: { title: '방탈출', icon: '🔐', tabs: [['escape', '방탈출 기록']] },
  board: { title: '보드게임', icon: '🎲', tabs: [['board', '보드게임 기록']] },
  movie: { title: '영화', icon: '🎬', tabs: [['movie', '영화 기록']] },
  play: { title: '연극·뮤지컬', icon: '🎭', tabs: [['play', '연극·뮤지컬 기록']] },
  habit: { title: '습관', icon: '🔥' },
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
    ['status', '독서 상태', 'select', ['읽는중', '완독', '보류', '중도포기']], ['stars', '평가', 'select', RATE_OPTS], ['memo', '메모', 'text'], ['image', '표지 이미지 주소', 'url']],
  buy: [['title', '책 제목', 'text'], ['author', '저자', 'text'], ['done', '구매 완료', 'bool'], ['memo', '메모', 'text'], ['image', '표지 이미지 주소', 'url']],
  wish: [['title', '책 제목', 'text'], ['author', '저자', 'text'], ['kind', '구분', 'select', ['추천받은 책', '추가 목록']], ['memo', '메모', 'text'], ['image', '표지 이미지 주소', 'url']],
  escape: [['theme', '테마', 'text'], ['date', '방문일', 'date'], ['shop', '매장', 'text'], ['area', '지역', 'text'], ['result', '결과', 'select', ['', '성공', '실패']],
    ['rating', '평점', 'select', RATE_OPTS], ['people', '인원', 'number'], ['hints', '힌트 수', 'number'], ['left', '남은 시간(분)', 'number'],
    ['cost', '비용(원)', 'number'], ['with', '함께한 사람', 'text'], ['review', '후기', 'text'], ['image', '포스터 이미지 주소', 'url']],
  board: [['name', '보드게임', 'text'], ['date', '날짜', 'date'], ['place', '장소', 'text'], ['with', '함께한 사람', 'text'], ['review', '후기', 'text']],
  movie: [['title', '영화 제목', 'text'], ['director', '감독', 'text'], ['date', '관람일', 'date'], ['place', '극장', 'text'], ['rating', '평점', 'select', RATE_OPTS],
    ['with', '함께한 사람', 'text'], ['review', '후기', 'text']],
  play: [['title', '작품명', 'text'], ['kind', '종류', 'select', ['연극', '뮤지컬']], ['date', '관람일', 'date'], ['place', '극장', 'text'], ['cast', '출연', 'text'],
    ['rating', '평점', 'select', RATE_OPTS], ['with', '함께한 사람', 'text'], ['review', '후기', 'text']],
};
const joinDot = a => a.filter(Boolean).join(' · ');
const LIST_ICON = { book: '📚', buy: '🛒', wish: '⭐', escape: '🔐', board: '🎲', movie: '🎬', play: '🎭' };
// 목록 한 줄: [제목, 설명, 오른쪽 표시]
const LIST_ROW = {
  book: i => [i.title, joinDot([i.author, [i.year, i.month].filter(Boolean).join(' '), i.memo]), i.stars || i.status],
  buy: i => [i.title, joinDot([i.author, i.memo]), i.done ? '✅ 구매함' : '미구매'],
  wish: i => [i.title, joinDot([i.author, i.kind, i.memo]), ''],
  escape: i => [i.theme, joinDot([i.date, i.shop, i.area, i.with, i.review]), joinDot([i.result, i.rating])],
  board: i => [i.name, joinDot([i.date, i.place, i.with, i.review]), ''],
  movie: i => [i.title, joinDot([i.director, i.date, i.place, i.with, i.review]), i.rating],
  play: i => [i.title, joinDot([i.kind, i.date, i.place, i.cast, i.with, i.review]), i.rating || i.kind],
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
function renderLists() {
  if (!SECTIONS[sec].tabs) return;
  const tabs = SECTIONS[sec].tabs;
  $('#lTabs').hidden = tabs.length < 2;
  $('#lTabs').innerHTML = tabs.map(([k, label]) => `<button type="button" data-list="${k}" aria-pressed="${k === curList}">${label}</button>`).join('');
  const q = $('#lq').value.trim().toLowerCase(), all = listSorted(curList);
  const a = all.filter(i => !q || Object.values(i).join(' ').toLowerCase().includes(q));
  $('#lInfo').textContent = listInfo(curList, all) + (q ? ` · 검색 ${a.length}건` : '');
  // 독서는 보기 3가지 (나머지 목록은 늘 목록 보기)
  const view = VIEWS[sec] ? lView() : 'list';
  $('#lViews').hidden = !VIEWS[sec];
  $('#lViews').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === view));
  $('#lFlowCard').hidden = view !== 'flow' || !a.length;
  $('#lListCard').hidden = !$('#lFlowCard').hidden;
  $('#lList').classList.toggle('grid', view === 'grid');
  $('#lHead').hidden = $('#lTabs').hidden && $('#lViews').hidden; // 탭도 보기 선택도 없으면 빈 상자를 숨김
  document.body.classList.toggle('white', view === 'flow' && a.length > 0);
  setFab(view === 'flow' && a.length > 0); // 커버플로우에선 평가 단추를 가리지 않게 카드 안 ＋ 사용
  if (view === 'flow' && a.length) return renderFlow(a);
  if (view === 'grid') {
    $('#lList').innerHTML = a.map(i => `<li data-id="${esc(i.id)}">${coverHTML(i)}<span>${esc(LIST_ROW[curList](i)[0])}</span><small>${esc(joinDot([i.author || i.shop, LIST_ROW[curList](i)[2]]))}</small></li>`).join('')
      || `<li class="empty">${q ? '검색 결과가 없어요' : '아직 기록이 없어요 · ＋ 버튼으로 추가하세요'}</li>`;
    return;
  }
  $('#lList').innerHTML = a.map(i => { const [t, sub, right] = LIST_ROW[curList](i);
    return `<li data-id="${esc(i.id)}">${i.image ? `<img class="thumb" src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="em" aria-hidden="true">${LIST_ICON[curList]}</span>`}<div><span>${esc(t)}</span><small>${esc(sub)}</small></div>${right ? `<b class="move" style="font-size:13px">${esc(right)}</b>` : ''}</li>`; }).join('')
    || `<li class="empty">${q ? '검색 결과가 없어요' : '아직 기록이 없어요 · ＋ 버튼으로 추가하세요'}</li>`;
}
// ── 독서 보기: flow(아이팟 커버플로우, 기본) · grid(표지 카드 3열) · list(목록) ──
// 보기 3가지는 표지·포스터가 있는 독서·방탈출. 평가 칸은 목록마다 이름이 달라요 (독서 별점 stars, 방탈출 평점 rating)
const VIEWS = { book: 'bookView', escape: 'escapeView' }, RATE_KEY = { book: 'stars', escape: 'rating' };
const lView = () => store.get(VIEWS[sec], 'flow');
let flowItems = [], flowId = '', flowShown = '';
const FC = 80; // 커버플로우에서 책 사이 간격(px) = 한 칸 넘길 때 움직이는 거리
const coverHTML = i => { const t = esc(LIST_ROW[curList](i)[0]);
  return i.image ? `<img class="cover" src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-t="${t}">` : `<span class="cover ph">${t}</span>`; };
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
  $('#fSub').textContent = curList === 'escape' ? joinDot([i.date, i.shop, i.result]) : joinDot([i.author, curList === 'book' ? i.status : i.memo]);
  const rk = RATE_KEY[curList];
  $('#fRate').hidden = !rk;
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
  it[rk] = it[rk] === r ? '' : r;
  store.set('lists', lists);
  flowShown = ''; flowPaint();
  const key = LIST_FIELDS[curList][0][0]; // 시트가 줄을 찾는 제목 칸 (독서 title, 방탈출 theme)
  queue({ action: 'listSave', list: curList, item: { id: it.id, [key]: it[key], [rk]: it[rk] } });
});
$('#fAdd').addEventListener('click', () => openItem());
$('#lViews').addEventListener('click', e => {
  const v = e.target.closest('[data-v]')?.dataset.v;
  if (v) { store.set(VIEWS[sec], v); renderLists(); }
});
async function refreshLists() {
  try {
    busy(true);
    document.body.classList.toggle('loading', !(lists[curList] || []).length);
    if (await sync()) {
      try {
        const r = await api(null, '&what=lists');
        if (!r.lists) setStatus('시트의 Code.gs를 새 버전으로 배포해야 목록을 볼 수 있어요');
        else { lists = r.lists; store.set('lists', lists); setStatus('시트와 동기화됨'); }
      } catch (e) { showError(e); }
    }
    renderLists();
  } finally { busy(false); document.body.classList.remove('loading'); }
}
function setSection(k) {
  sec = k;
  document.body.classList.remove('white'); // 독서 커버플로우에서만 흰 바탕 (renderLists가 다시 켬)
  document.body.classList.remove('searching');
  document.body.classList.toggle('money', k === 'money');
  $('#searchBtn').hidden = k === 'habit';
  if ($('#lq').value) $('#lq').value = '';
  store.set('sec', k);
  $('#appTitle').textContent = SECTIONS[k].title;
  const money = k === 'money', habit = k === 'habit';
  $('#monthRow').hidden = !money;
  document.querySelector('nav').hidden = !money;
  $('#v-lists').hidden = money || habit;
  $('#v-habit').hidden = !habit;
  if (!money) replay($('#v-' + (habit ? 'habit' : 'lists')), 'enter');
  if (money) show(curView);
  else {
    ['home', 'cal', 'list', 'rec'].forEach(x => { $('#v-' + x).hidden = true; });
    $('#filters').hidden = true;
    setFab(habit);
    if (habit) { renderHabits(); refreshHabits(); window.scrollTo(0, 0); return; }
    curList = SECTIONS[k].tabs[0][0];
    $('#lq').value = '';
    renderLists();
    refreshLists();
    window.scrollTo(0, 0);
  }
}
// ── 습관: 틱틱과 실시간 연동 (시트의 Apps Script가 중계) ──
let habits = store.get('habits', []), hDay = localISO().slice(0, 10);
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
  for (let d = today, i = 0; i < 120; i++, d = isoAdd(d, -1)) {
    if (!dueOn(h, d)) continue;
    if (h.done.includes(stampOf(d))) n++;
    else if (d !== today) break; // 오늘은 아직 안 했어도 연속은 유지
  }
  return n;
}
const hF = foldCal($('#hClip'), $('#hGrid'), $('#hGrab'), false); // 처음엔 이번 주만, 손잡이를 내리면 한 달
let hMon = hDay.slice(0, 7);
function renderHabits() {
  const today = localISO().slice(0, 10), { y, mo, first, days, lead, tail } = monthGrid(hMon);
  $('#hMonth').textContent = `${y}년 ${mo}월`;
  $('#hNext').disabled = hMon >= today.slice(0, 7);
  let html = lead;
  for (let d = 1; d <= days; d++) {
    const ds = `${hMon}-${pad2(d)}`, wd = (first + d - 1) % 7, due = habits.filter(h => dueOn(h, ds));
    const n = due.filter(h => h.done.includes(stampOf(ds))).length, pct = due.length ? Math.round(n / due.length * 100) : 0;
    const cls = [ds === today && 'today', ds > today && 'future', wd === 0 && 'sun', wd === 6 && 'sat'].filter(Boolean).join(' ');
    html += `<button type="button" data-d="${ds}" class="${cls}" aria-pressed="${ds === hDay}" ${ds > today ? 'disabled' : ''} aria-label="${mo}월 ${d}일 ${n}/${due.length} 완료">
      <span class="d">${d}</span>${due.length && ds <= today ? `<i class="${pct === 100 ? 'all' : ''}" style="--p:${pct}%" aria-hidden="true"></i>` : ''}</button>`;
  }
  $('#hGrid').innerHTML = html + tail;
  hF.week = hDay.startsWith(hMon) ? Math.floor((first + +hDay.slice(8) - 1) / 7) : 0;
  hF.fit();
  const due = habits.filter(h => dueOn(h, hDay)), st = stampOf(hDay), n = due.filter(h => h.done.includes(st)).length;
  $('#hInfo').textContent = habits.length ? `${hDay === today ? '오늘' : `${+hDay.slice(5, 7)}월 ${+hDay.slice(8)}일`} ${n}/${due.length} 완료` : '';
  $('#hList').innerHTML = due.map(h => {
    const on = h.done.includes(st), s = streak(h);
    return `<li style="--c:${esc(h.color)}" class="${on ? 'done' : ''}"><span class="hic" aria-hidden="true">${HICON[h.icon] || '⭐'}</span>
      <div><span>${esc(h.name)}</span><small>${s ? `🔥 ${s}일 연속 · ` : ''}총 ${h.total}일${h.enc ? ' · ' + esc(h.enc) : ''}</small></div>
      <button type="button" class="hcheck" data-h="${esc(h.id)}" aria-pressed="${on}" aria-label="${esc(h.name)} ${on ? '체크 해제' : '체크'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button></li>`;
  }).join('') || `<li class="empty">${habits.length ? '이날은 할 습관이 없어요' : '틱틱 습관을 불러오는 중이거나, 아직 연결 전이에요'}</li>`;
  const rest = habits.length - due.length;
  $('#hRest').textContent = rest ? `이날 쉬는 습관 ${rest}개` : '';
}
async function refreshHabits() {
  try {
    busy(true);
    if (await sync()) {
      try {
        const r = await api(null, '&what=habits');
        if (!r.habits) setStatus('시트의 Code.gs를 새 버전으로 배포해야 습관을 볼 수 있어요');
        else { habits = r.habits; store.set('habits', habits); setStatus('틱틱과 동기화됨'); }
      } catch (e) { showError(e); }
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
  if (!h) return;
  const st = stampOf(hDay), done = !h.done.includes(st);
  h.done = done ? [...h.done, st] : h.done.filter(x => x !== st);
  h.total = Math.max(0, h.total + (done ? 1 : -1));
  store.set('habits', habits);
  renderHabits();
  queue({ action: 'habitCheck', habitId: h.id, stamp: st, done }).then(ok => ok && setStatus('틱틱에 반영됨'));
});
// 메뉴 순서: 저장된 순서 + 새로 생긴 섹션은 뒤에
const menuOrder = () => { const o = store.get('menuOrder', []).filter(k => SECTIONS[k]); return [...o, ...Object.keys(SECTIONS).filter(k => !o.includes(k))]; };
function openMenu() {
  $('#menuList').innerHTML = menuOrder().map(k => [k, SECTIONS[k]]).map(([k, v]) =>
    `<button type="button" data-sec="${k}" ${k === sec ? 'aria-current="page"' : ''}><svg class="i" aria-hidden="true"><use href="#i-s-${k}"/></svg>${v.title}</button>`).join('');
  $('#menu').showModal();
}
$('#menuBtn').addEventListener('click', openMenu);
// 화면 어디서든 오른쪽으로 밀면 메뉴가 손가락을 따라 나오고, 열린 메뉴는 왼쪽으로 밀면 닫힘 (TickTick 방식)
// 달력(달 넘김)·휠·가로 스크롤 줄에서 시작한 밀기는 원래 동작 그대로
{
  const menu = $('#menu'), dim = p => `0 0 0 200vmax rgba(0,0,0,${(0.4 * p).toFixed(3)})`;
  const hScroll = el => { for (; el && el !== document.body; el = el.parentElement) if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true; return false; };
  const paint = p => { menu.style.transform = `translateX(${(p - 1) * 100}%)`; menu.style.boxShadow = dim(p); };
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
      if (!sw.open) { openMenu(); document.activeElement?.blur(); } // 손가락으로 연 건 포커스 테두리 없이
      menu.classList.add('dragging'); menu.style.transition = 'none';
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
    menu.style.transition = 'transform .3s var(--ease-out), box-shadow .3s var(--ease-out)';
    paint(keep ? 1 : 0);
    setTimeout(() => {
      if (!keep) closeNow(menu);
      menu.classList.remove('dragging'); menu.style.transition = menu.style.transform = menu.style.boxShadow = '';
    }, 300);
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
$('#lTabs').addEventListener('click', e => {
  const k = e.target.closest('[data-list]')?.dataset.list;
  if (k) { curList = k; renderLists(); }
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
let lEditing = null;
function openItem(it) {
  const fs = LIST_FIELDS[curList], label = SECTIONS[sec].tabs.find(t => t[0] === curList)[1];
  lEditing = it || null;
  const opt = (n, base) => base.map(([v, l]) => `<label><input type="radio" name="${n}" value="${esc(v)}"><span>${esc(l)}</span></label>`).join('');
  $('#lFields').innerHTML = fs.map(([n, lab, type, opts], k) => {
    if (k === 0) return `<input class="full ltitle" name="${n}" placeholder="${lab}" aria-label="${lab}" maxlength="1000" required>`;
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
    return `<label class="f${full}">${lab}<input name="${n}" type="${type}" ${extra}></label>`;
  }).join('');
  const f = $('#lForm').elements, today = localISO();
  const init = it || { year: today.slice(0, 4) + '년', month: today.slice(5, 7) + '월', status: '읽는중', date: today.slice(0, 10), kind: '추천받은 책' };
  fs.forEach(([n, , type]) => { if (type === 'bool') f[n].checked = !!init[n]; else if (init[n] != null) f[n].value = init[n]; });
  $('#lFields').querySelectorAll('input[type=date]').forEach(i => dateField(i));
  $('#lForm').dataset.id = it?.id || '';
  $('#lDelete').hidden = !it;
  $('#lTitle').textContent = `${label} ${it ? '수정' : '추가'}`;
  lPreview(it?.image || '');
  $('#lItem').showModal();
}
const lPreview = src => { $('#lPreview').innerHTML = /^https?:\/\//.test(src) ? `<img class="thumb big" src="${esc(src)}" alt="" referrerpolicy="no-referrer">` : ''; };
$('#lFields').addEventListener('input', e => { if (e.target.name === 'image') lPreview(e.target.value.trim()); });
// 이미 고른 평가를 다시 누르면 지움
$('#lFields').addEventListener('pointerdown', e => { const i = e.target.closest('.rate-pick label')?.querySelector('input'); if (i) i.dataset.was = i.checked ? '1' : ''; });
$('#lFields').addEventListener('click', e => { const i = e.target.closest('.rate-pick input'); if (i && i.dataset.was === '1') { i.checked = false; i.dataset.was = ''; } });
$('#lList').addEventListener('click', e => {
  const id = e.target.closest('li[data-id]')?.dataset.id, it = id && L(curList).find(i => i.id === id);
  if (it) openItem(it);
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
  if (idx >= 0) arr[idx] = { ...arr[idx], ...item }; else arr.push(item);
  store.set('lists', lists);
  $('#lItem').close();
  queue({ action: 'listSave', list: curList, item });
});
$('#lDelete').addEventListener('click', () => {
  if (!confirm('이 기록을 시트에서 삭제할까요?')) return;
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

document.body.classList.add('money');
const now = localISO();
$('#month').value = now.slice(0, 7);
render();
refresh();
if (!cfg.token) $('#settings').showModal(); // 비밀번호 전이면 바로 설정 창
if (SECTIONS[store.get('sec', 'money')] && store.get('sec', 'money') !== 'money') setSection(store.get('sec')); // 마지막에 보던 섹션으로
$('#calQuick').addEventListener('click', () => openEntry(null, localISO().slice(0, 10)));
// 앱 아이콘 길게 누르기 메뉴(안드로이드)가 여는 주소: ?add=1 · ?view=cal · ?sec=book&add=1
const qp = new URLSearchParams(location.search);
if (qp.get('sec') && SECTIONS[qp.get('sec')]) setSection(qp.get('sec'));
if (['home', 'cal', 'list', 'rec'].includes(qp.get('view'))) show(qp.get('view'));
if (qp.has('add') && sec !== 'habit') setTimeout(() => (sec === 'money' ? openEntry(null, localISO().slice(0, 10)) : openItem()), 250);
if (location.search) history.replaceState(null, '', location.pathname + location.hash);
if ('serviceWorker' in navigator) {
  pushSubscribe();
  const hadSW = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(reg => {
    // 홈 화면 앱은 껐다 켜도 멈춘 화면을 다시 보여 주기만 해서, 돌아올 때마다 새 버전을 확인
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update(); });
  });
  // 새 버전으로 바뀌면 한 번 새로고침 (입력 창이 열려 있으면 닫힐 때까지 기다림)
  const reloadWhenIdle = () => (document.querySelector('dialog[open]') ? setTimeout(reloadWhenIdle, 1500) : location.reload());
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadSW) reloadWhenIdle(); });
}
