const $ = s => document.querySelector(s);
const CATS = {
  지출: ['식비', '카페/간식', '교통', '주거/통신', '생활용품', '쇼핑', '의료', '문화/여가', '경조사', '기타'],
  수입: ['급여', '용돈', '부수입', '이자', '기타'],
};
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let cfg = store.get('cfg', { url: '', token: '' });
let items = store.get('items', []);     // 화면용 사본 (시트가 원본)
let pending = store.get('pending', []); // 아직 시트에 못 보낸 작업 (오프라인 대비)

const won = n => Number(n).toLocaleString('ko-KR') + '원';
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const local = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
const persist = () => { store.set('items', items); store.set('pending', pending); };
const setStatus = t => { $('#status').textContent = t; };

async function api(body) {
  if (!cfg.url) throw new Error('⚙ 설정에서 시트를 연결하세요');
  const res = body
    // text/plain 이어야 Apps Script가 CORS 사전요청 없이 받음
    ? await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, token: cfg.token }) })
    : await fetch(cfg.url + '?token=' + encodeURIComponent(cfg.token));
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '서버 오류');
  return data;
}

async function sync() {
  while (pending.length) {
    try { await api(pending[0]); }
    catch (e) { setStatus(`시트 저장 대기 ${pending.length}건 · ${e.message}`); return false; }
    pending.shift();
    persist();
  }
  return true;
}

async function refresh() {
  setStatus('불러오는 중…');
  if (await sync()) {
    try { items = (await api()).items; persist(); setStatus('시트와 동기화됨'); }
    catch (e) { setStatus('연결 안 됨 · ' + e.message); }
  }
  render();
}

function render() {
  const m = $('#month').value;
  const list = items.filter(i => i.date.startsWith(m)).sort((a, b) => b.date.localeCompare(a.date));
  const sum = t => list.filter(i => i.type === t).reduce((s, i) => s + i.amount, 0);
  const inc = sum('수입'), exp = sum('지출');
  $('#inc').textContent = won(inc);
  $('#exp').textContent = won(exp);
  $('#bal').textContent = won(inc - exp);

  const byCat = {};
  list.filter(i => i.type === '지출').forEach(i => { byCat[i.category] = (byCat[i.category] || 0) + i.amount; });
  $('#cats').innerHTML = Object.entries(byCat).sort((a, b) => b[1] - a[1])
    .map(([c, v]) => `<li><span>${esc(c)}</span><span class="bar" style="--w:${(v / exp * 100).toFixed(1)}%"></span><b>${won(v)}</b></li>`)
    .join('') || '<li class="empty">지출 없음</li>';

  $('#list').innerHTML = list.map(i => `<li>
      <div><small>${esc(i.date.slice(5))} · ${esc(i.category)}</small><span>${esc(i.memo || i.category)}</span></div>
      <b class="${i.type === '수입' ? 'in' : 'out'}">${i.type === '수입' ? '+' : '-'}${won(i.amount)}</b>
      <button data-id="${esc(i.id)}" aria-label="삭제">×</button></li>`)
    .join('') || '<li class="empty">이번 달 기록 없음</li>';
}

function fillCats() {
  const type = $('#form').type.value;
  $('#form').category.innerHTML = CATS[type].map(c => `<option>${c}</option>`).join('');
}

$('#form').addEventListener('change', e => { if (e.target.name === 'type') fillCats(); });
$('#form').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const item = {
    id: crypto.randomUUID(), date: f.date.value, type: f.type.value,
    category: f.category.value, amount: Math.round(Number(f.amount.value)), memo: f.memo.value.trim(),
  };
  if (!(item.amount > 0) || !item.date) return;
  items.push(item);
  pending.push({ action: 'add', item });
  persist();
  f.amount.value = ''; f.memo.value = '';
  $('#month').value = item.date.slice(0, 7);
  render();
  sync().then(ok => ok && setStatus('시트에 저장됨'));
});
$('#list').addEventListener('click', e => {
  const id = e.target.dataset.id;
  if (!id || !confirm('이 기록을 삭제할까요?')) return;
  items = items.filter(i => i.id !== id);
  pending.push({ action: 'delete', id });
  persist();
  render();
  sync().then(ok => ok && setStatus('삭제됨'));
});
$('#month').addEventListener('change', render);
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

const now = local(new Date());
$('#form').date.value = now.slice(0, 10);
$('#month').value = now.slice(0, 7);
fillCats();
render();
refresh();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
