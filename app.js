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
  $('#budgets').innerHTML = rows.map(r => `<li>
      <span>${esc(r.k)}</span>
      <span class="bar ${cls(level(r.used, r.budget))}"><i style="--w:${pct(r.used, r.budget)}%"></i></span>
      <button class="budget-btn" data-major="${esc(r.k)}" aria-label="${esc(r.k)} 예산 수정">${won(r.used)}<small>/ ${r.budget ? won(r.budget) : '예산 없음'}</small></button>
    </li>`).join('') + (total ? `<li class="total"><span>전체</span>
      <span class="bar ${cls(level(exp, total))}"><i style="--w:${pct(exp, total)}%"></i></span>
      <span style="text-align:right;font-size:13px">${won(exp)}<small style="display:block;color:var(--muted)">/ ${won(total)}</small></span></li>` : '')
    || '<li class="empty">이번 달 지출 없음</li>';

  $('#alerts').innerHTML = rows.filter(r => level(r.used, r.budget)).map(r => level(r.used, r.budget) === 2
    ? `<div class="alert over">🚨 <b>${esc(r.k)}</b> 예산 초과 · ${won(r.used - r.budget)} 넘었어요 (${Math.round(r.used / r.budget * 100)}%)</div>`
    : `<div class="alert">⚠️ <b>${esc(r.k)}</b> 예산 ${Math.round(r.used / r.budget * 100)}% 사용 · ${won(r.budget - r.used)} 남았어요</div>`).join('');
  $('#notifyBtn').hidden = !('Notification' in window) || Notification.permission !== 'default';
}

function txRow(i) {
  const [cls, sign] = { 수입: ['in', '+'], 지출: ['out', '-'], 환불: ['refund', '+'], 이체: ['move', ''] }[i.type] || ['move', ''];
  const inst = i.instState ? `<span class="badge">${esc(i.instState)}</span>` : i.inst ? `<span class="badge">${esc(i.inst)}개월</span>` : '';
  return `<li data-id="${esc(i.id)}">
    <div><small>${esc(i.date.slice(2).replace(/-/g, '.'))} · ${esc(i.major)}${i.minor ? '·' + esc(i.minor) : ''}${i.pay ? ' · ' + esc(i.pay) : ''}</small>
    <span>${esc(i.content || i.minor || i.major)}${inst}</span></div>
    <b class="${cls}">${sign}${won(i.amount)}</b></li>`;
}
function renderList() {
  fillSelect($('#fType'), TYPES, '구분 전체');
  fillSelect($('#fMajor'), majorsAll(), '대분류 전체');
  fillSelect($('#fPay'), payments(), '결제수단 전체');
  const m = $('#month').value, all = $('#fAll').checked, q = $('#q').value.trim().toLowerCase();
  const t = $('#fType').value, mj = $('#fMajor').value, p = $('#fPay').value, [key, dir] = $('#fSort').value.split('-');
  const list = data.items.filter(i => (all || i.date.startsWith(m)) && (!t || i.type === t) && (!mj || i.major === mj) && (!p || i.pay === p) &&
      (!q || [i.content, i.memo, i.major, i.minor, i.pay].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => (key === 'amt' ? a.amount - b.amount || a.date.localeCompare(b.date) : a.date.localeCompare(b.date) || a.amount - b.amount) * (dir === 'asc' ? 1 : -1));
  const exp = list.reduce((s, i) => s + net(i), 0), inc = list.filter(i => i.type === '수입').reduce((s, i) => s + i.amount, 0);
  $('#listInfo').textContent = `${list.length.toLocaleString()}건 · 지출 ${won(exp)} · 수입 ${won(inc)}` +
    (list.length > SHOW_MAX ? ` · 앞의 ${SHOW_MAX}건만 표시 (검색·필터로 좁혀 보세요)` : '');
  $('#list').innerHTML = list.slice(0, SHOW_MAX).map(txRow).join('') || '<li class="empty">조건에 맞는 내역이 없어요</li>';
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

function render() { renderHome(); renderList(); renderRec(); }

// ── 거래 입력·수정 ──
const F = $('#entryForm').elements;
function entryCats(major, minor) {
  fillSelect(F.major, majorsFor(F.type.value)); setSel(F.major, major);
  fillSelect(F.minor, minorsFor(F.major.value), '소분류 없음'); setSel(F.minor, minor);
}
function openEntry(it) {
  $('#entryForm').reset();
  F.tid.value = it?.id || '';
  F.type.value = it?.type || '지출';
  F.date.value = it?.date || localISO().slice(0, 10);
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
  if (e.target.name === 'major') fillSelect(F.minor, minorsFor(F.major.value), '소분류 없음');
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
$('#fab').addEventListener('click', () => openEntry());
$('#list').addEventListener('click', e => {
  const id = e.target.closest('li[data-id]')?.dataset.id;
  const it = id && data.items.find(i => i.id === id);
  if (it) openEntry(it);
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
document.querySelector('nav').addEventListener('click', e => {
  const v = e.target.dataset.view;
  if (!v) return;
  document.querySelectorAll('nav button').forEach(b => b === e.target ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  ['home', 'list', 'rec'].forEach(x => { $('#v-' + x).hidden = x !== v; });
  $('#fab').hidden = v === 'rec';
});
['#month', '#fType', '#fMajor', '#fPay', '#fSort', '#fAll'].forEach(s => $(s).addEventListener('change', render));
$('#q').addEventListener('input', renderList);
$('#fReset').addEventListener('click', () => {
  ['#q', '#fType', '#fMajor', '#fPay'].forEach(s => { $(s).value = ''; });
  $('#fSort').value = 'date-desc'; $('#fAll').checked = false;
  renderList();
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
