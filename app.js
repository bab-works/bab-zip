const $ = s => document.querySelector(s);
const TYPES = ['지출', '수입', '환불', '이체'];
const SHOW_MAX = 300; // 내역은 최대 300건만 그림 (검색·필터로 좁히면 됨)
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let cfg = store.get('cfg', { url: '', token: '' });
// 설정 링크(…/#url=웹앱URL&token=비밀번호)로 열면 연결 정보를 저장. 폰이 저장소를 지워도 이 링크로 열면 다시 연결됨
// (홈 화면 앱은 사파리와 저장소가 따로라서, 앱 안에서도 ⚙에 링크를 붙여넣을 수 있게 함)
function cfgFrom(hash) {
  const h = new URLSearchParams(hash), url = h.get('url') || '', token = h.get('token');
  return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url) && token ? { url, token } : null;
}
const fromLink = cfgFrom(location.hash.slice(1));
if (fromLink) { cfg = fromLink; store.set('cfg', cfg); }
navigator.storage?.persist?.(); // 브라우저가 저장 데이터를 임의로 지우지 않게 요청
// 시트(원본)의 화면용 사본. meta = 카테고리·예산·결제수단·분류규칙·반복
let data = store.get('data2', { items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } });
let pending = store.get('pending', []); // 아직 시트에 못 보낸 작업 (오프라인 대비, 순서대로 전송)

const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const localISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString(); };
const persist = () => { store.set('data2', data); store.set('pending', pending); };
// 동기화·저장·삭제 완료는 잠깐 뜨는 팝업으로만, 연결 문제 같은 건 상단에 남김
let syncTimer;
const setStatus = t => {
  if (/동기화됨|저장됨|삭제됨/.test(t)) {
    const el = $('#syncPop');
    el.textContent = t; el.classList.add('show');
    clearTimeout(syncTimer); syncTimer = setTimeout(() => el.classList.remove('show'), 1500);
    $('#status').textContent = '';
    return;
  }
  $('#status').textContent = t;
};
let toastTimer;
function toast(t, ms = 3500) {
  const el = $('#toast');
  el.textContent = t; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ── 시트 통신 ──
async function api(body, qs = '') {
  if (!cfg.url) throw new Error('⚙ 설정에서 시트를 연결하세요');
  const res = body
    // text/plain 이어야 Apps Script가 CORS 사전요청 없이 받음
    ? await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, token: cfg.token }) })
    : await fetch(cfg.url + '?token=' + encodeURIComponent(cfg.token) + qs);
  const r = await res.json();
  if (!r.ok) throw Object.assign(new Error(r.error || '서버 오류'), { rejected: !r.retry && !/비밀번호/.test(r.error) });
  return r;
}
async function sync() {
  while (pending.length) {
    try { await api(pending[0]); }
    catch (e) {
      // 시트가 내용 자체를 거부한 작업은 버림 (계속 막히지 않게). 네트워크·비밀번호 문제는 대기
      if (!e.rejected) { setStatus(`시트 저장 대기 ${pending.length}건 · ${e.message}`); return false; }
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
    if (await sync()) {
      try {
        const r = await api();
        data = { items: r.items, meta: r.meta };
        persist();
        setStatus(`시트와 동기화됨 · ${data.items.length.toLocaleString()}건`);
      } catch (e) { setStatus('연결 안 됨 · ' + e.message); }
    }
    render();
  } finally { busy(false); }
}
// 불러오는 동안은 문구 대신 새로고침 버튼이 회전
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
  $('#inc').textContent = won(inc);
  $('#exp').textContent = won(exp);
  $('#bal').textContent = won(inc - exp);

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
  const cut = today.startsWith(m) ? +today.slice(8) : 31, pd = new Date(y, mo - 2, 1);
  const pm = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`;
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

function txRow(i) {
  const [cls, sign] = { 수입: ['in', '+'], 지출: ['out', '-'], 환불: ['refund', '+'], 이체: ['move', ''] }[i.type] || ['move', ''];
  const inst = i.instState ? `<span class="badge">${esc(i.instState)}</span>` : i.inst ? `<span class="badge">${esc(i.inst)}개월</span>` : '';
  return `<li data-id="${esc(i.id)}"><span class="em" aria-hidden="true">${em(i.major)}</span>
    <div><small>${esc(i.date.slice(2).replace(/-/g, '.'))}${i.time ? ' ' + esc(i.time) : ''} · ${esc(i.major)}${i.minor ? '·' + esc(i.minor) : ''}${i.pay ? ' · ' + esc(i.pay) : ''}</small>
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
  $('#list').innerHTML = list.slice(0, SHOW_MAX).map(i => {
    if (key !== 'date' || i.date === last) return txRow(i);
    last = i.date;
    const ds = daySums(list.filter(x => x.date === i.date)), [yy, mm, dd] = i.date.split('-').map(Number);
    return `<li class="day-h"><span>${mm}월 ${dd}일 ${WEEK[new Date(yy, mm - 1, dd).getDay()]}요일</span>
      <span>${ds.inc ? `<span class="in" style="display:inline">+${won(ds.inc)}</span> ` : ''}${ds.exp ? `-${won(ds.exp)}` : ''}</span></li>` + txRow(i);
  }).join('') || '<li class="empty">조건에 맞는 내역이 없어요</li>';
}

function renderRec() {
  $('#recList').innerHTML = data.meta.recurring.map(r => `<li>
      <div><small>매월 ${esc(r.day)}일 · ${esc(r.major)}${r.minor ? '·' + esc(r.minor) : ''}${r.pay ? ' · ' + esc(r.pay) : ''} · ${esc(r.start)}부터${r.end ? ' ' + esc(r.end) + '까지' : ''}</small>
      <span>${esc(r.content)} <b class="${r.type === '수입' ? 'in' : r.type === '지출' ? 'out' : 'move'}">${won(r.amount)}</b></span></div>
      <button class="small danger" data-rid="${esc(r.id)}" aria-label="${esc(r.content)} 반복 삭제">삭제</button></li>`).join('')
    || '<li class="empty">등록된 반복 거래가 없어요</li>';
  const f = $('#recForm').elements;
  fillSelect(f.major, majorsFor(f.type.value));
  fillSelect(f.minor, minorsFor(f.major.value), '소분류 없음');
  fillSelect(f.pay, payments(), '결제수단 선택 안 함');
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
// 달력 손잡이: 펼침(한 달) ↔ 접힘(선택한 주 한 줄). 끌면 그 사이 높이로 움직임
let calOpen = true, calWeek = 0;
const clip = $('#calClip'), calGrid = $('#calGrid');
const calRow = () => (calGrid.querySelector('button, .other')?.offsetHeight || 60) + 2;
const calFull = () => calGrid.scrollHeight;
const calFit = () => { if (!clip.offsetParent) return; calPlace(calOpen ? calFull() : calRow(), false); }; // 숨긴 상태에선 높이를 못 재므로 보일 때 다시 맞춤
function calPlace(h, animate) {
  const rh = calRow(), full = calFull(), t = full > rh ? Math.min(1, Math.max(0, (h - rh) / (full - rh))) : 1;
  clip.classList.toggle('anim', animate); calGrid.classList.toggle('anim', animate);
  clip.style.height = h + 'px';
  calGrid.style.transform = `translateY(${-(1 - t) * calWeek * rh}px)`;
}
function renderCal() {
  const m = $('#month').value;
  if (!m) return;
  const [y, mo] = m.split('-').map(Number), first = new Date(y, mo - 1, 1).getDay(), days = new Date(y, mo, 0).getDate();
  if (!selDay.startsWith(m)) selDay = m + '-01';
  const types = [...new Set(data.meta.payments.map(p => p[1]).filter(Boolean))];
  $('#calTabs').innerHTML = ['', ...types].map(t => `<button type="button" data-pt="${esc(t)}" aria-pressed="${t === calPay}">${t ? esc(t) : '전체'}</button>`).join('');
  // 결제유형은 「카테고리」 탭의 결제수단→유형 표로 판단 (방금 입력해 시트 수식이 아직 안 돈 거래도 포함되게)
  const ptOf = Object.fromEntries(data.meta.payments);
  const src = filtered().filter(i => !calPay || (ptOf[i.pay] || i.payType) === calPay);
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
  const pd = new Date(y, mo - 1, 0).getDate();
  let html = '';
  for (let k = first - 1; k >= 0; k--) html += `<span class="other" aria-hidden="true">${pd - k}</span>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${m}-${String(d).padStart(2, '0')}`, s = sums[ds], wd = (first + d - 1) % 7;
    const cls = [ds === today && 'today', ds > today && 'future', wd === 0 && 'sun', wd === 6 && 'sat'].filter(Boolean).join(' ');
    html += `<button type="button" data-day="${ds}" class="${cls}" aria-pressed="${ds === selDay}" aria-label="${mo}월 ${d}일${s ? ` 수입 ${won(s.inc)} 지출 ${won(s.exp)}` : ''}">
      <span class="d">${d}</span>${s && s.inc ? `<small class="in">+${amt(s.inc)}</small>` : ''}${s && s.exp ? (s.exp > 0
        ? `<small class="${s.exp >= bigCut ? 'big' : 'spend'}">-${amt(s.exp)}</small>` : `<small class="refund">+${amt(s.exp)}</small>`) : ''}</button>`;
  }
  const tail = (7 - (first + days) % 7) % 7;
  for (let d = 1; d <= tail; d++) html += `<span class="other" aria-hidden="true">${d}</span>`;
  calGrid.innerHTML = html;
  calWeek = Math.floor((first + +selDay.slice(8) - 1) / 7);
  calFit();
  const tdy = data.items.filter(i => i.date === today), tds = daySums(tdy);
  $('#calQuickSum').textContent = tdy.length ? `지출 ${won(tds.exp)} · ${tdy.length}건 · 눌러서 추가` : '아직 입력이 없어요 · 눌러서 추가';
  renderTrend(src, m, y, mo, days, today);

  const list = (byDay[selDay] || []).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || b.amount - a.amount);
  const [, sm, sd] = selDay.split('-').map(Number), ds = daySums(list);
  $('#dayTitle').textContent = `${sm}월 ${sd}일 ${WEEK[new Date(y, sm - 1, sd).getDay()]}요일`;
  $('#daySum').innerHTML = list.length ? `${list.length}건 · 수입 <b class="in">${won(ds.inc)}</b> · 지출 <b class="out">${won(ds.exp)}</b>` : '';
  $('#dayList').innerHTML = list.map(txRow).join('') || '<li class="empty">이날 기록이 없어요</li>';
}
// 이번 달 누적 지출(선) vs 지난달 누적(회색 면): 같은 날짜 기준으로 비교
function renderTrend(src, m, y, mo, days, today) {
  const pd = new Date(y, mo - 2, 1), pm = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`;
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
  const [y, mo] = $('#month').value.split('-').map(Number), d = new Date(y, mo - 1 + k, 1);
  $('#month').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  dailySel = 0;
  render();
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
  fillSelect(F.pay, payments(), '결제수단 선택 안 함'); F.pay.value = ''; setSel(F.pay, it?.pay);
  F.amount.value = it?.amount || '';
  F.content.value = it?.content || '';
  F.memo.value = it?.memo || '';
  F.inst.value = it?.inst || '';
  $('#entryDelete').hidden = !it;
  $('#entryTitle').textContent = it ? '거래 수정' : '거래 추가';
  $('#entry').showModal();
}
$('#entryForm').addEventListener('change', e => {
  if (e.target.name === 'type') entryCats();
});
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
  const m = it.date.slice(0, 7), before = spent(m, it.major);
  const idx = data.items.findIndex(x => x.id === it.id);
  if (idx >= 0) data.items[idx] = { ...data.items[idx], ...it, instState: '' }; else data.items.push(it);
  $('#entry').close();
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
let grabDrag = null;
const grab = $('#calGrab');
grab.addEventListener('pointerdown', e => { grabDrag = { y: e.clientY, h: clip.offsetHeight, moved: false }; grab.setPointerCapture(e.pointerId); });
grab.addEventListener('pointermove', e => {
  if (!grabDrag) return;
  const dy = e.clientY - grabDrag.y; if (Math.abs(dy) > 4) grabDrag.moved = true;
  calPlace(Math.min(calFull(), Math.max(calRow(), grabDrag.h + dy)), false);
});
const grabEnd = () => {
  if (!grabDrag) return;
  const moved = grabDrag.moved; grabDrag = null;
  calOpen = moved ? clip.offsetHeight > (calRow() + calFull()) / 2 : !calOpen; // 끌었으면 가까운 쪽으로, 눌렀으면 토글
  calPlace(calOpen ? calFull() : calRow(), true);
};
grab.addEventListener('pointerup', grabEnd);
grab.addEventListener('pointercancel', grabEnd);
grab.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); calOpen = !calOpen; calPlace(calOpen ? calFull() : calRow(), true); } });
$('#calGrid').addEventListener('click', e => {
  const d = e.target.closest('[data-day]')?.dataset.day;
  if (d) { selDay = d; renderCal(); $('#dayTitle').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
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
  toast(p === 'granted' ? '예산 알림을 켰어요' : '알림이 허용되지 않았어요');
  renderHome();
});

// ── 반복 ──
const R = $('#recForm').elements;
$('#recForm').addEventListener('change', e => {
  if (e.target.name === 'type') fillSelect(R.major, majorsFor(R.type.value));
  if (e.target.name === 'type' || e.target.name === 'major') fillSelect(R.minor, minorsFor(R.major.value), '소분류 없음');
});
$('#recForm').addEventListener('submit', e => {
  e.preventDefault();
  const rule = {
    id: crypto.randomUUID(), content: R.content.value.trim(), type: R.type.value, major: R.major.value, minor: R.minor.value,
    pay: R.pay.value, amount: Math.round(+R.amount.value), day: Math.round(+R.day.value), start: R.start.value, end: R.end.value,
  };
  if (!rule.content || !(rule.amount > 0) || !(rule.day >= 1 && rule.day <= 31) || !rule.start) return;
  if (rule.end && rule.end < rule.start) return toast('종료 월이 시작 월보다 빨라요');
  data.meta.recurring.push(rule);
  e.target.content.value = ''; e.target.amount.value = '';
  // 서버가 이번 달 분까지 거래를 만들어 주므로 저장 후 다시 불러옴
  queue({ action: 'recSave', rule }).then(ok => ok && refresh());
});
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
  $('#fab').hidden = v === 'rec' || v === 'cal'; // 달력은 「이날 추가」 버튼을 씀
  if (v === 'cal') calFit();
  window.scrollTo(0, 0);
}
document.querySelector('nav').addEventListener('click', e => { const v = e.target.closest('[data-view]')?.dataset.view; if (v) show(v); });
$('#toList').addEventListener('click', () => show('list'));
$('#mPrev').addEventListener('click', () => moveMonth(-1));
$('#mNext').addEventListener('click', () => moveMonth(1));
$('#monthLabel').addEventListener('click', () => $('#monthPick').showModal());
$('#monthPickOk').addEventListener('click', () => $('#monthPick').close());
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
  selDay = `${$('#month').value}-${String(dailySel).padStart(2, '0')}`;
  show('cal'); renderCal();
});
['#month', '#fType', '#fMajor', '#fPay', '#fSort', '#fAll'].forEach(s => $(s).addEventListener('change', render));
$('#q').addEventListener('input', () => { renderFilters(); renderCal(); renderList(); });
$('#fReset').addEventListener('click', () => {
  ['#q', '#fType', '#fMajor', '#fPay'].forEach(s => { $(s).value = ''; });
  $('#fSort').value = 'date-desc'; $('#fAll').checked = false;
  render();
});
$('#reload').addEventListener('click', () => sec === 'money' ? refresh() : refreshLists());
$('#openSettings').addEventListener('click', () => {
  const f = $('#settingsForm');
  f.url.value = cfg.url; f.token.value = cfg.token;
  $('#settings').showModal();
});
$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'save') return;
  const f = $('#settingsForm'), link = f.link.value.trim();
  const c = link ? cfgFrom(link.split('#')[1] || '') : { url: f.url.value.trim(), token: f.token.value };
  if (!c || !c.url || !c.token) { toast(link ? '설정 링크가 올바르지 않아요' : 'URL과 비밀번호를 모두 넣어주세요'); return $('#settings').showModal(); }
  cfg = c;
  f.link.value = '';
  store.set('cfg', cfg);
  refresh();
});
window.addEventListener('online', refresh);
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
};
let lists = store.get('lists', {}); // 시트 목록의 화면용 사본
let sec = 'money', curList = 'book';
const L = k => (lists[k] || []).filter(i => k !== 'board' || i.kind === '보드게임');
const yearOpts = () => [...new Set([localISO().slice(0, 4) + '년', ...L('book').map(i => i.year).filter(Boolean)])].sort().reverse();
// 필드: [이름, 라벨, 종류, 선택지]
const LIST_FIELDS = {
  book: [['title', '책 제목', 'text'], ['author', '저자', 'text'], ['year', '연도', 'select', yearOpts],
    ['month', '월', 'select', ['', ...Array.from({ length: 12 }, (_, k) => String(k + 1).padStart(2, '0') + '월')]],
    ['status', '독서 상태', 'select', ['완독', '읽는 중', '보류', '중도포기']], ['stars', '별점', 'select', ['', '★', '★★', '★★★', '★★★★', '★★★★★']], ['memo', '메모', 'text']],
  buy: [['title', '책 제목', 'text'], ['author', '저자', 'text'], ['done', '구매 완료', 'bool'], ['memo', '메모', 'text']],
  wish: [['title', '책 제목', 'text'], ['author', '저자', 'text'], ['kind', '구분', 'select', ['추천받은 책', '추가 목록']], ['memo', '메모', 'text']],
  escape: [['theme', '테마', 'text'], ['date', '방문일', 'date'], ['shop', '매장', 'text'], ['area', '지역', 'text'], ['result', '결과', 'select', ['', '성공', '실패']],
    ['rating', '평점', 'select', ['', '1', '2', '3', '4', '5']], ['people', '인원', 'number'], ['hints', '힌트 수', 'number'], ['left', '남은 시간(분)', 'number'],
    ['cost', '비용(원)', 'number'], ['with', '함께한 사람', 'text'], ['review', '후기', 'text']],
  board: [['name', '보드게임', 'text'], ['date', '날짜', 'date'], ['place', '장소', 'text'], ['with', '함께한 사람', 'text'], ['review', '후기', 'text']],
  movie: [['title', '영화 제목', 'text'], ['director', '감독', 'text'], ['date', '관람일', 'date'], ['place', '극장', 'text'], ['rating', '평점', 'select', ['', '★', '★★', '★★★', '★★★★', '★★★★★']],
    ['with', '함께한 사람', 'text'], ['review', '후기', 'text']],
  play: [['title', '작품명', 'text'], ['kind', '종류', 'select', ['연극', '뮤지컬']], ['date', '관람일', 'date'], ['place', '극장', 'text'], ['cast', '출연', 'text'],
    ['rating', '평점', 'select', ['', '★', '★★', '★★★', '★★★★', '★★★★★']], ['with', '함께한 사람', 'text'], ['review', '후기', 'text']],
};
const joinDot = a => a.filter(Boolean).join(' · ');
// 목록 한 줄: [제목, 설명, 오른쪽 표시]
const LIST_ROW = {
  book: i => [i.title, joinDot([i.author, [i.year, i.month].filter(Boolean).join(' '), i.memo]), i.stars || i.status],
  buy: i => [i.title, joinDot([i.author, i.memo]), i.done ? '✅ 구매함' : '미구매'],
  wish: i => [i.title, joinDot([i.author, i.kind, i.memo]), ''],
  escape: i => [i.theme, joinDot([i.date, i.shop, i.area, i.with, i.review]), joinDot([i.result, i.rating && '★' + i.rating])],
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
  if (sec === 'money') return;
  const tabs = SECTIONS[sec].tabs;
  $('#lTabs').hidden = tabs.length < 2;
  $('#lTabs').innerHTML = tabs.map(([k, label]) => `<button type="button" data-list="${k}" aria-pressed="${k === curList}">${label}</button>`).join('');
  const q = $('#lq').value.trim().toLowerCase(), all = listSorted(curList);
  const a = all.filter(i => !q || Object.values(i).join(' ').toLowerCase().includes(q));
  $('#lInfo').textContent = listInfo(curList, all) + (q ? ` · 검색 ${a.length}건` : '');
  $('#lList').innerHTML = a.map(i => { const [t, sub, right] = LIST_ROW[curList](i);
    return `<li data-id="${esc(i.id)}"><div><span>${esc(t)}</span><small>${esc(sub)}</small></div>${right ? `<b class="move" style="font-size:13px">${esc(right)}</b>` : ''}</li>`; }).join('')
    || `<li class="empty">${q ? '검색 결과가 없어요' : '아직 기록이 없어요 · ＋ 버튼으로 추가하세요'}</li>`;
}
async function refreshLists() {
  try {
    busy(true);
    if (await sync()) {
      try {
        const r = await api(null, '&what=lists');
        if (!r.lists) setStatus('시트의 Code.gs를 새 버전으로 배포해야 목록을 볼 수 있어요');
        else { lists = r.lists; store.set('lists', lists); setStatus('시트와 동기화됨'); }
      } catch (e) { setStatus('연결 안 됨 · ' + e.message); }
    }
    renderLists();
  } finally { busy(false); }
}function setSection(k) {
  sec = k;
  store.set('sec', k);
  $('#appTitle').textContent = SECTIONS[k].title;
  const money = k === 'money';
  $('#monthRow').hidden = !money;
  document.querySelector('nav').hidden = !money;
  $('#v-lists').hidden = money;
  if (money) show(curView);
  else {
    ['home', 'cal', 'list', 'rec'].forEach(x => { $('#v-' + x).hidden = true; });
    $('#filters').hidden = true;
    $('#fab').hidden = false;
    curList = SECTIONS[k].tabs[0][0];
    $('#lq').value = '';
    renderLists();
    refreshLists();
    window.scrollTo(0, 0);
  }
}
$('#menuBtn').addEventListener('click', () => {
  $('#menuList').innerHTML = Object.entries(SECTIONS).map(([k, v]) =>
    `<button type="button" data-sec="${k}" ${k === sec ? 'aria-current="page"' : ''}><span class="em" aria-hidden="true">${v.icon}</span>${v.title}</button>`).join('');
  $('#menu').showModal();
});
$('#menuList').addEventListener('click', e => {
  const k = e.target.closest('[data-sec]')?.dataset.sec;
  if (k) { $('#menu').close(); setSection(k); }
});
$('#lTabs').addEventListener('click', e => {
  const k = e.target.closest('[data-list]')?.dataset.list;
  if (k) { curList = k; renderLists(); }
});
$('#lq').addEventListener('input', renderLists);

// 목록 항목 추가·수정 창 (필드 표로 자동 생성)
function openItem(it) {
  const fs = LIST_FIELDS[curList], label = SECTIONS[sec].tabs.find(t => t[0] === curList)[1];
  $('#lFields').innerHTML = fs.map(([n, lab, type, opts], k) => {
    if (type === 'bool') return `<label class="chk"><input type="checkbox" name="${n}"> ${lab}</label>`;
    const full = k === 0 || n === 'memo' || n === 'review' ? ' full' : '';
    if (type === 'select') {
      const o = [...new Set([...(typeof opts === 'function' ? opts() : opts), ...(it && it[n] ? [String(it[n])] : [])])];
      return `<label class="f${full}">${lab}<select name="${n}">${o.map(v => `<option value="${esc(v)}">${esc(v) || '선택 안 함'}</option>`).join('')}</select></label>`;
    }
    return `<label class="f${full}">${lab}<input name="${n}" type="${type}" ${type === 'number' ? 'inputmode="numeric" min="0"' : 'maxlength="1000"'} ${k === 0 ? 'required' : ''}></label>`;
  }).join('');
  const f = $('#lForm').elements, today = localISO();
  const init = it || { year: today.slice(0, 4) + '년', month: today.slice(5, 7) + '월', status: '완독', date: today.slice(0, 10), kind: '추천받은 책' };
  fs.forEach(([n, , type]) => { if (type === 'bool') f[n].checked = !!init[n]; else if (init[n] != null) f[n].value = init[n]; });
  $('#lFields').querySelectorAll('input[type=date]').forEach(i => wheel(i));
  $('#lForm').dataset.id = it?.id || '';
  $('#lDelete').hidden = !it;
  $('#lTitle').textContent = `${label} ${it ? '수정' : '추가'}`;
  $('#lItem').showModal();
}
$('#lList').addEventListener('click', e => {
  const id = e.target.closest('li[data-id]')?.dataset.id, it = id && L(curList).find(i => i.id === id);
  if (it) openItem(it);
});
$('#lForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target.elements, id = e.target.dataset.id, item = { id: id || crypto.randomUUID() };
  LIST_FIELDS[curList].forEach(([n, , type]) => { item[n] = type === 'bool' ? f[n].checked : type === 'number' ? (f[n].value === '' ? '' : Math.round(+f[n].value)) : f[n].value.trim(); });
  if (!item[LIST_FIELDS[curList][0][0]]) return;
  if (curList === 'board') item.kind = '보드게임';
  if (curList === 'escape' && item.rating !== '') item.rating = +item.rating;
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

// ── 날짜 스크롤 휠: 날짜·월 칸을 년·월·일 선택 상자(iOS 휠)로 바꿈 ──
// 숨긴 원래 input이 값의 원천이라 기존 코드(.value 읽기·쓰기, change 이벤트)는 그대로 동작
const valDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
function wheel(input, opt = {}) {
  const isMonth = input.type === 'month', blank = !!opt.blank;
  const wrap = document.createElement('span'); wrap.className = 'wheel';
  const opts = (items, lead) => (blank ? [['', lead]] : []).concat(items);
  const yr = document.createElement('select'), mo = document.createElement('select'), dy = isMonth ? null : document.createElement('select');
  const label = input.getAttribute('aria-label') || '';
  yr.setAttribute('aria-label', label + ' 년'); mo.setAttribute('aria-label', label + ' 월'); if (dy) dy.setAttribute('aria-label', label + ' 일');
  const fill = (sel, list) => { sel.innerHTML = list.map(([v, t]) => `<option value="${v}">${t}</option>`).join(''); };
  const nowY = new Date().getFullYear();
  fill(yr, opts(range(2015, nowY + 1).map(y => [String(y), y + '년']), '--'));
  fill(mo, opts(range(1, 12).map(m => [String(m).padStart(2, '0'), m + '월']), '--'));
  wrap.append(yr, mo); if (dy) wrap.append(dy);
  const fillDays = () => {
    if (!dy) return;
    const keep = dy.value, n = yr.value && mo.value ? new Date(+yr.value, +mo.value, 0).getDate() : 31;
    fill(dy, opts(range(1, n).map(d => [String(d).padStart(2, '0'), d + '일']), '--'));
    if (keep && +keep <= n) dy.value = keep;
  };
  const show = v => {
    const [y = '', m = '', d = ''] = (v || '').split('-');
    if (y && ![...yr.options].some(o => o.value === y)) yr.add(new Option(y + '년', y));
    yr.value = y; mo.value = m; fillDays(); if (dy) dy.value = d;
  };
  const push = () => {
    fillDays();
    const y = yr.value, m = mo.value, d = dy ? dy.value : '01';
    const v = !y || !m || (dy && !d) ? '' : isMonth ? `${y}-${m}` : `${y}-${m}-${d}`;
    if (valDesc.get.call(input) !== v) { valDesc.set.call(input, v); input.dispatchEvent(new Event('change', { bubbles: true })); }
  };
  [yr, mo, dy].forEach(s => s && s.addEventListener('change', push));
  // 코드에서 input.value = … 로 바꿔도 휠이 같이 바뀜
  Object.defineProperty(input, 'value', { configurable: true,
    get() { return valDesc.get.call(this); }, set(v) { valDesc.set.call(this, v); show(valDesc.get.call(this)); } });
  input.classList.add('sr-only'); input.tabIndex = -1; input.setAttribute('aria-hidden', 'true');
  if (opt.into) opt.into.append(wrap); else input.after(wrap); // 입력칸 바로 뒤(원래 자리)
  show(valDesc.get.call(input));
}
wheel($('#entryForm [name=date]'));
wheel($('#recForm [name=start]'));
wheel($('#recForm [name=end]'), { blank: true });
wheel($('#month'), { into: $('#monthWheel') });

const now = localISO();
$('#month').value = now.slice(0, 7);
R.start.value = now.slice(0, 7);
render();
refresh();
if (!cfg.url) $('#settings').showModal(); // 연결 전이면 바로 설정 창
if (SECTIONS[store.get('sec', 'money')] && store.get('sec', 'money') !== 'money') setSection(store.get('sec')); // 마지막에 보던 섹션으로
$('#calQuick').addEventListener('click', () => openEntry(null, localISO().slice(0, 10)));
// 앱 아이콘 길게 누르기 메뉴(안드로이드)가 여는 주소: ?add=1 · ?view=cal · ?sec=book&add=1
const qp = new URLSearchParams(location.search);
if (qp.get('sec') && SECTIONS[qp.get('sec')]) setSection(qp.get('sec'));
if (['home', 'cal', 'list', 'rec'].includes(qp.get('view'))) show(qp.get('view'));
if (qp.has('add')) setTimeout(() => (sec === 'money' ? openEntry(null, localISO().slice(0, 10)) : openItem()), 250);
if (location.search) history.replaceState(null, '', location.pathname + location.hash);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
