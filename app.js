const $ = s => document.querySelector(s);
const TYPES = ['지출', '수입', '환불', '이체'];
const SHOW_MAX = 300; // 내역은 최대 300건만 그림 (검색·필터로 좁히면 됨)
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let cfg = store.get('cfg', { url: '', token: '' });
// 시트(원본)의 화면용 사본. meta = 카테고리·예산·결제수단·분류규칙·반복
let data = store.get('data2', { items: [], meta: { cats: [], budgets: {}, payments: [], rules: [], recurring: [] } });
let pending = store.get('pending', []); // 아직 시트에 못 보낸 작업 (오프라인 대비, 순서대로 전송)

const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const localISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString(); };
const persist = () => { store.set('data2', data); store.set('pending', pending); };
const setStatus = t => { $('#status').textContent = t; };
let toastTimer;
function toast(t) {
  const el = $('#toast');
  el.textContent = t; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ── 시트 통신 ──
async function api(body) {
  if (!cfg.url) throw new Error('⚙ 설정에서 시트를 연결하세요');
  const res = body
    // text/plain 이어야 Apps Script가 CORS 사전요청 없이 받음
    ? await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, token: cfg.token }) })
    : await fetch(cfg.url + '?token=' + encodeURIComponent(cfg.token));
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
  setStatus('불러오는 중…');
  if (await sync()) {
    try {
      const r = await api();
      data = { items: r.items, meta: r.meta };
      persist();
      setStatus(`시트와 동기화됨 · ${data.items.length.toLocaleString()}건`);
    } catch (e) { setStatus('연결 안 됨 · ' + e.message); }
  }
  render();
}
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
      <span class="em" aria-hidden="true">${em(r.k)}</span>
      <span>${esc(r.k)}<small class="hint">${lvTxt(level(r.used, r.budget))}</small></span>
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

  $('#recent').innerHTML = [...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map(txRow).join('') || '<li class="empty">이번 달 거래가 없어요</li>';
}
let dailySel = 0;

function txRow(i) {
  const [cls, sign] = { 수입: ['in', '+'], 지출: ['out', '-'], 환불: ['refund', '+'], 이체: ['move', ''] }[i.type] || ['move', ''];
  const inst = i.instState ? `<span class="badge">${esc(i.instState)}</span>` : i.inst ? `<span class="badge">${esc(i.inst)}개월</span>` : '';
  return `<li data-id="${esc(i.id)}"><span class="em" aria-hidden="true">${em(i.major)}</span>
    <div><small>${esc(i.date.slice(2).replace(/-/g, '.'))} · ${esc(i.major)}${i.minor ? '·' + esc(i.minor) : ''}${i.pay ? ' · ' + esc(i.pay) : ''}</small>
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
    .sort((a, b) => (key === 'amt' ? a.amount - b.amount || a.date.localeCompare(b.date) : a.date.localeCompare(b.date) || a.amount - b.amount) * (dir === 'asc' ? 1 : -1));
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
function renderCal() {
  const m = $('#month').value;
  if (!m) return;
  const [y, mo] = m.split('-').map(Number), first = new Date(y, mo - 1, 1).getDay(), days = new Date(y, mo, 0).getDate();
  if (!selDay.startsWith(m)) selDay = m + '-01';
  const byDay = {};
  filtered().filter(i => i.date.startsWith(m)).forEach(i => (byDay[i.date] = byDay[i.date] || []).push(i));
  const sums = {};
  Object.keys(byDay).forEach(d => { sums[d] = daySums(byDay[d]); });
  const maxExp = Math.max(1, ...Object.values(sums).map(s => s.exp));
  const today = localISO().slice(0, 10);
  const month = daySums(Object.values(byDay).flat());
  $('#calTitle').textContent = `${y}년 ${mo}월`;
  $('#calSum').innerHTML = `수입 <b class="in">${won(month.inc)}</b> · 지출 <b class="out">${won(month.exp)}</b>`;
  let html = '<span class="blank"></span>'.repeat(first);
  for (let d = 1; d <= days; d++) {
    const ds = `${m}-${String(d).padStart(2, '0')}`, s = sums[ds], wd = (first + d - 1) % 7;
    const heat = s && s.exp > 0 ? Math.round(4 + s.exp / maxExp * 26) : 0; // 지출이 많은 날일수록 진하게
    html += `<button type="button" data-day="${ds}" class="${ds === today ? 'today ' : ''}${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}"
      style="--heat:${heat}%" aria-pressed="${ds === selDay}" aria-label="${mo}월 ${d}일${s ? ` 수입 ${won(s.inc)} 지출 ${won(s.exp)}` : ''}">
      <span class="d">${d}</span>${s && s.inc ? `<small class="in">+${compact(s.inc)}</small>` : ''}${s && s.exp ? (s.exp > 0 ? `<small class="out">-${compact(s.exp)}</small>` : `<small class="refund">+${compact(s.exp)}</small>`) : ''}</button>`;
  }
  $('#calGrid').innerHTML = html;

  const list = (byDay[selDay] || []).sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || b.amount - a.amount);
  const [, sm, sd] = selDay.split('-').map(Number), ds = daySums(list);
  $('#dayTitle').textContent = `${sm}월 ${sd}일 (${WEEK[new Date(y, sm - 1, sd).getDay()]})`;
  $('#daySum').innerHTML = list.length ? `${list.length}건 · 수입 <b class="in">${won(ds.inc)}</b> · 지출 <b class="out">${won(ds.exp)}</b>` : '';
  $('#dayList').innerHTML = list.map(txRow).join('') || '<li class="empty">이날 기록이 없어요</li>';
}
function moveMonth(k) {
  const [y, mo] = $('#month').value.split('-').map(Number), d = new Date(y, mo - 1 + k, 1);
  $('#month').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  dailySel = 0;
  render();
}

function render() { renderFilters(); renderHome(); renderCal(); renderList(); renderRec(); }

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
    id: F.tid.value || crypto.randomUUID(), date: F.date.value, type: F.type.value, major: F.major.value, minor: F.minor.value,
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
$('#fab').addEventListener('click', () => openEntry(null, $('#v-cal').hidden ? '' : selDay));
['#list', '#dayList'].forEach(s => $(s).addEventListener('click', e => {
  const id = e.target.closest('li[data-id]')?.dataset.id;
  const it = id && data.items.find(i => i.id === id);
  if (it) openEntry(it);
}));
$('#calGrid').addEventListener('click', e => {
  const d = e.target.closest('[data-day]')?.dataset.day;
  if (d) { selDay = d; renderCal(); $('#dayTitle').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
});
$('#dayAdd').addEventListener('click', () => openEntry(null, selDay));
$('#calPrev').addEventListener('click', () => moveMonth(-1));
$('#calNext').addEventListener('click', () => moveMonth(1));
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
function show(v) {
  document.querySelectorAll('nav button').forEach(b => b.dataset.view === v ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  ['home', 'cal', 'list', 'rec'].forEach(x => { $('#v-' + x).hidden = x !== v; });
  $('#filters').hidden = v !== 'list' && v !== 'cal';
  document.querySelectorAll('.list-only').forEach(el => { el.hidden = v !== 'list'; });
  $('#fab').hidden = v === 'rec' || v === 'cal'; // 달력은 「이날 추가」 버튼을 씀
  window.scrollTo(0, 0);
}
document.querySelector('nav').addEventListener('click', e => { const v = e.target.closest('[data-view]')?.dataset.view; if (v) show(v); });
$('#toList').addEventListener('click', () => show('list'));
$('#mPrev').addEventListener('click', () => moveMonth(-1));
$('#mNext').addEventListener('click', () => moveMonth(1));
$('#monthLabel').addEventListener('click', () => { try { $('#month').showPicker(); } catch { moveMonth(0); } });
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
$('#reload').addEventListener('click', refresh);
$('#openSettings').addEventListener('click', () => {
  const f = $('#settingsForm');
  f.url.value = cfg.url; f.token.value = cfg.token;
  $('#settings').showModal();
});
$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'save') return;
  const f = $('#settingsForm');
  cfg = { url: f.url.value.trim(), token: f.token.value };
  store.set('cfg', cfg);
  refresh();
});
window.addEventListener('online', refresh);

const now = localISO();
$('#month').value = now.slice(0, 7);
R.start.value = now.slice(0, 7);
render();
refresh();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
