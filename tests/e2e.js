const { chromium } = require('playwright');
const fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert'), os = require('os'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..'), SHOTS = process.argv[2] || os.tmpdir(); // 스크린샷 저장 폴더 (기본: 임시 폴더)
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date(), TODAY = ymd(now), CUR = TODAY.slice(0, 7);
const ago = k => { const d = new Date(now.getFullYear(), now.getMonth() - k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

class Sheet {
  constructor(rows, maxR, maxC, guard) { this.d = rows; this.maxR = maxR; this.maxC = maxC; this.guard = guard || []; }
  cell(r, c) { const v = (this.d[r - 1] || [])[c - 1]; return v == null ? '' : v; }
  set(r, c, v) {
    if (r > 1 && this.guard.includes(c)) throw new Error(`수식 열 ${c}에 쓰기 시도 (row ${r})`);
    if (r > this.maxR || c > this.maxC) throw new Error(`범위 밖 쓰기 r${r} c${c}`);
    if (typeof v === 'string') { if (v.startsWith("'")) v = v.slice(1); else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) v = new Date(v + 'T00:00'); }
    while (this.d.length < r) this.d.push([]);
    this.d[r - 1][c - 1] = v;
  }
  getRange(r, c, nr = 1, nc = 1) {
    if (typeof r === 'string') return { setNumberFormat() {} };
    const s = this;
    return { getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => s.cell(r + i, c + j))),
      setValues: v => v.forEach((row, i) => row.forEach((x, j) => s.set(r + i, c + j, x))),
      getFormulas: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = s.cell(r + i, c + j); return [typeof v === 'string' ? v : '']; }).map(x => x[0])).map(x => x.map(v => v)),
      getValue: () => s.cell(r, c), setValue: x => s.set(r, c, x),
      deleteCells: () => { for (let cc = c; cc < c + nc; cc++) for (let rr = r; rr <= s.d.length; rr++) (s.d[rr - 1] = s.d[rr - 1] || [])[cc - 1] = (s.d[rr] || [])[cc - 1]; } };
  }
  getMaxRows() { return this.maxR } getMaxColumns() { return this.maxC }
  getLastColumn() { return Math.max(1, ...this.d.map(r => (r || []).length)); }
  insertColumnsAfter(a, n) { this.maxC += n } insertRowsAfter(a, n) { this.maxR += n }
  getLastRow() { let l = 0; this.d.forEach((r, i) => { if (r && r.some(x => x !== '' && x != null)) l = i + 1; }); return l; }
  deleteRow(r) { this.d.splice(r - 1, 1); }
  appendRow(v) { const r = this.getLastRow() + 1; v.forEach((x, j) => this.set(r, j + 1, x)); }
  setFrozenRows() {}
}
const D = s => new Date(s + 'T00:00');
const sheets = {
  거래: new Sheet([
    ['날짜', '시간', '구분', '대분류', '소분류', '내용', '결제유형', '결제수단', '금액', '메모', '원본분류', '할부(개월)', '할부 진행', '남은 개월', '할부 총액', 'id'],
    [D(CUR + '-01'), '', '지출', '식비', '외식', '고깃집', '', 'A신용카드', 450000, '', '식사'],
    [D(CUR + '-02'), '', '이체', '이체', '카드대금', '카드사', '', 'B통장', 99000, '', ''],
  ], 4, 16, [7, 13, 14, 15]),
  카테고리: new Sheet([
    ['대분류', '소분류', '', '대분류', '월 예산', '메모', '', '결제수단', '결제유형'],
    ['식비', '외식', '', '식비', 600000, '', '', 'A신용카드', '카드'],
    ['식비', '배달', '', '카페·간식', 130000, '', '', 'B통장', '현금·계좌'],
    ['카페·간식', '카페', '', '수입', '', '', '', 'C체크카드', '카드'],
    ['주거·통신', '통신비', '', '주거·통신', 400000],
    ['수입', '급여'], ['이체', '카드대금'],
  ], 100, 10),
  분류규칙: new Sheet([['키워드', '적용구분', '대분류', '소분류'], ['스타벅스', '지출', '카페·간식', '카페'], ['배달의민족', '지출', '식비', '배달']], 50, 8),
};
const extraTabs = { '영화 기록': new Sheet([['번호', '영화 제목', '감독', '관람일', '극장', '평점', '함께한 사람', '후기', 'id']], 1000, 10), '연극·뮤지컬 기록': new Sheet([['번호', '작품명', '종류', '관람일', '극장', '출연', '평점', '함께한 사람', '후기', 'id']], 1000, 11), '보드게임 기록': new Sheet([['기록 ID', '날짜', '종류', '테마·보드게임', '장소', '함께한 사람', '후기', '연결 일정', '일정 키']], 1000, 26) };
const ss = { getSheetByName: n => sheets[n] || extraTabs[n] || (bookSS[n] || null) || (hobbySS[n] || null), insertSheet: n => (sheets[n] = new Sheet([], 1000, 26)), getSpreadsheetTimeZone: () => 'Asia/Seoul' };
let uid = 0;
const SUM = Array(10).fill(undefined).concat(['요약']); // K열 요약 표 흉내
const withId = (hdr, idx) => [...hdr, ...Array(idx - hdr.length).fill(''), 'id'];
const bookSS = { '독서 기록': new Sheet([
    withId(['번호', '기록 시기', '', '순번', '표지', '책 제목', '저자', '독서 상태', '별점', '메모', '', '연도별 월간 독서량'], 29),
    [1, '2025년', '', 1, '', '채식주의자', '한강', '완독', '', '', '', '요약1'],
    [2, CUR.slice(0, 4) + '년', CUR.slice(5) + '월', 1, '', '급류', '정대건', '완독', '', '', '', '요약2'],
    [3, CUR.slice(0, 4) + '년', CUR.slice(5) + '월', 2, '', '데미안', '헤르만 헤세', '중도포기', '', '', '', '요약3'],
  ], 1000, 30, [11, 12, 13]),
  '구매 목록': new Sheet([withId(['번호', '책 제목', '저자', '구매 완료', '메모', '표지'], 6), [1, '퍼즐바디', '김청귤', false, '', '']], 1000, 26),
  '추천·관심 도서': new Sheet([withId(['번호', '책 제목', '저자', '구분', '메모', '표지'], 6), [1, '호밀밭의 파수꾼', '샐린저', '추천받은 책', '', '']], 1000, 26) };
const hobbySS = { '방탈출 기록': new Sheet([[], ['총 진행 테마 수', '2 개'],
    withId(['방문일', '테마', '포스터', '매장', '지역', '결과', '인원', '힌트 수', '남은 시간(분)', '비용(원)', '평점(1~5)', '함께한 사람', '후기', ''], 14),
    [D('2023-07-16'), '인투더와일드', '', '마스터키 프라임', '신촌'], ['', '에피소드 1', '', '포인트나인', '강남']], 1000, 26),
  '취미 기록': new Sheet([['기록 ID', '날짜', '종류', '테마·보드게임', '장소', '함께한 사람', '후기', '연결 일정', '일정 키']], 1000, 26) };
const g = { SpreadsheetApp: { getActiveSpreadsheet: () => ss, Dimension: { ROWS: 'ROWS' } },
  ContentService: { MimeType: { JSON: 1 }, createTextOutput: s => ({ setMimeType: () => s }) },
  Utilities: { formatDate: (d, tz, p) => p === 'yyyy-MM' ? ymd(d).slice(0, 7) : ymd(d), getUuid: () => 'u' + (++uid),
    DigestAlgorithm: { MD5: 'MD5' }, computeDigest: (a, t) => [...crypto.createHash('md5').update(t).digest()], base64Encode: b => Buffer.from(b).toString('base64') },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, ScriptApp: {} };
const gs = new Function(...Object.keys(g), fs.readFileSync(path.join(ROOT, 'apps-script/Code.gs'), 'utf8') + ';return {doGet, doPost}')(...Object.values(g));
const TOKEN = '여기에-나만-아는-비밀번호를-적으세요';
const T = sheets.거래, col = c => T.d.slice(1).map(r => r[c - 1]);
let offline = false;
http.createServer((q, r) => { const f = path.join(ROOT, (q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]));
  fs.readFile(f, (e, b) => { r.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.woff2') ? 'font/woff2' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(b); }); })
  .listen(8766, async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => { console.error('PAGE ERROR', e); process.exit(1); });
  let promptAnswer = '';
  p.on('dialog', d => d.type() === 'prompt' ? d.accept(promptAnswer) : d.accept());
  await p.route('https://script.google.com/**', async rt => {
    if (offline) return rt.abort();
    const q = rt.request(), u = new URL(q.url());
    const body = q.method() === 'POST' ? gs.doPost({ postData: { contents: q.postData() } }) : gs.doGet({ parameter: Object.fromEntries(u.searchParams) });
    if (/"ok":false/.test(body)) console.log('SERVER', body.slice(0,200)); rt.fulfill({ contentType: 'application/json', body });
  });
  const status = re => p.waitForFunction(r => new RegExp(r).test(document.querySelector('#syncPop').textContent + ' ' + document.querySelector('#status').textContent), re.source);
  await p.goto('http://localhost:8766/');
  assert.ok(await p.isVisible('#settings'), 'settings auto-open when not connected');
  // 잘못된 링크 → 거부, 창 유지
  await p.fill('[name=link]', 'https://x/#url=https%3A%2F%2Fevil.example%2Fx&token=t');
  await p.click('button[value=save]');
  await p.waitForSelector('#settings', { state: 'visible' });
  await p.fill('[name=link]', '');
  await p.fill('[name=url]', 'https://script.google.com/macros/s/X/exec');
  await p.fill('[name=token]', TOKEN);
  await p.click('button[value=save]');
  await status(/동기화됨 · 2건/);
  // 기존 행에 id 부여, O열 헤더
  assert.equal(T.d[0][15], 'id'); assert.ok(col(16).every(Boolean), 'ids filled');
  // 홈: 식비 450,000/600,000 = 75% → 알림 없음
  await p.waitForFunction(() => document.querySelector('#exp').textContent === '450,000원'); // 숫자가 굴러간 뒤 최종값
  assert.equal(await p.locator('.alert').count(), 0);

  // 1) 분류규칙 자동분류 + 예산 경고 (식비 450k + 40k = 490k → 81%)
  await p.click('#fab');
  await p.fill('#entryForm [name=amount]', '40000');
  await p.fill('#entryForm [name=content]', '배달의민족 치킨');
  assert.equal(await p.inputValue('#entryForm [name=major]'), '식비');
  assert.equal(await p.inputValue('#entryForm [name=minor]'), '배달');
  await p.selectOption('#entryForm [name=pay]', 'C체크카드');
  await p.fill('#entryForm [name=memo]', '=HYPERLINK("x")');
  await p.click('#entryForm button.primary');
  await p.waitForFunction(() => /식비 예산 82%/.test(document.querySelector('#toast').textContent));
  await status(/저장됨/);
  let last = T.d[T.d.length - 1];
  assert.equal(ymd(last[0]), TODAY); assert.match(last[1], /^\d{2}:\d{2}$/, 'time saved'); assert.equal(last[2], '지출'); assert.equal(last[3], '식비'); assert.equal(last[4], '배달'); assert.equal(last[7], 'C체크카드');
  assert.equal(last[8], 40000); assert.equal(last[9], '=HYPERLINK("x")'); assert.ok(last[15]);
  assert.ok(T.maxR >= 4);
  // 2) 초과 (스타벅스 → 카페·간식 자동, 식비로 바꿔 200k)
  await p.click('#fab'); await p.fill('#entryForm [name=amount]', '200000'); await p.fill('#entryForm [name=content]', '회식');
  await p.click('#entryForm button.primary');
  await p.waitForFunction(() => /식비 예산 초과/.test(document.querySelector('#toast').textContent));
  await status(/저장됨/);
  assert.match(await p.textContent('.alert.over'), /식비/);
  assert.equal(T.d.length, 5); assert.ok(T.maxR > 4, 'rows grown');

  // 3) 내역: 검색·필터·정렬·수정
  await p.click('nav button[data-view=list]');
  await p.click('#fToggle');
  await p.fill('#q', '치킨');
  assert.equal(await p.locator('#list li[data-id]').count(), 1);
  await p.click('#fReset');
  await p.selectOption('#fType', '이체');
  assert.equal(await p.locator('#list li[data-id]').count(), 1);
  await p.click('#fReset');
  await p.selectOption('#fSort', 'amt-desc');
  assert.match(await p.textContent('#list li[data-id] >> nth=0'), /고깃집/);
  await p.selectOption('#fSort', 'amt-asc');
  assert.match(await p.textContent('#list li[data-id] >> nth=0'), /치킨/);
  await p.click('#list li[data-id] >> nth=0');
  await p.fill('#entryForm [name=amount]', '45000');
  await p.click('#entryForm button.primary'); await status(/저장됨/); await p.waitForSelector('#entry', { state: 'hidden' });
  assert.equal(T.d.length, 5); assert.equal(T.d[3][8], 45000, 'updated in place');
  // 삭제
  await p.locator('#list li[data-id]', { hasText: '회식' }).click();
  await p.click('#entryDelete'); await status(/삭제됨/); await p.waitForSelector('#entry', { state: 'hidden' });
  assert.equal(T.d.length, 4);

  // 4) 예산 수정
  await p.click('nav button[data-view=home]');
  promptAnswer = '700,000';
  await p.click('.budget-btn[data-major="식비"]'); await status(/저장됨/);
  assert.equal(sheets.카테고리.d[1][4], 700000);

  // 5) 반복: 2달 전부터 매월 1일 → 3건, 매월 31일 이번 달(오늘 이후면 미생성)
  await p.click('#fab'); await p.waitForSelector('#entry', { state: 'visible' });
  await p.evaluate(d => { const f = document.querySelector('#entryForm'); f.date.value = d; f.date.dispatchEvent(new Event('change', { bubbles: true })); }, ago(2) + '-01');
  await p.fill('#entryForm [name=content]', '휴대폰 요금');
  await p.fill('#entryForm [name=amount]', '55000');
  await p.click('#majorChips [data-v="주거·통신"]');
  await p.click('#recRow .switch');
  assert.equal(await p.textContent('#recHint'), '매월 1일');
  await p.click('#entryForm button.primary'); await status(/동기화됨/);
  const recs = () => T.d.filter(r => String(r[15]).startsWith('rec-'));
  assert.equal(recs().length, 3);
  assert.deepEqual(recs().map(r => ymd(r[0])).sort(), [ago(2) + '-01', ago(1) + '-01', CUR + '-01']);
  assert.equal(sheets.반복.d[1][10], CUR);
  await p.click('#reload'); await status(/동기화됨/);
  assert.equal(recs().length, 3, 'no duplicates on re-run');
  await p.click('#fab'); await p.click('#recManage');
  assert.equal(await p.locator('#recList li button').count(), 1);
  await p.screenshot({ path: SHOTS + '/rec.png' });
  await p.click('#recList button'); await status(/저장됨/);
  assert.equal(sheets.반복.d.length, 1);

  // 6) 오프라인 → 대기 → 복구
  await p.click('nav button[data-view=home]');
  offline = true;
  await p.click('#fab'); await p.fill('#entryForm [name=amount]', '4500'); await p.fill('#entryForm [name=content]', '스타벅스');
  assert.equal(await p.inputValue('#entryForm [name=major]'), '카페·간식');
  await p.click('#entryForm button.primary'); await status(/대기 1건/);
  const before = T.d.length;
  offline = false; await p.click('#reload'); await status(/동기화됨/);
  assert.equal(T.d.length, before + 1);
  await p.screenshot({ path: SHOTS + '/home.png' });
  await p.click('nav button[data-view=list]');
  await p.screenshot({ path: SHOTS + '/list.png' });
  await p.click('#list li[data-id] >> nth=0');
  await p.screenshot({ path: SHOTS + '/entry.png' });

  await p.click('#entryCancel'); await p.waitForSelector('#entry', { state: 'hidden' });
  // 7) 달력
  await p.click('nav button[data-view=cal]');
  assert.ok(await p.isVisible('#filters')); assert.ok(!(await p.isVisible('#fAll')), 'list-only hidden on cal');
  const d01 = CUR + '-01';
  const cell = p.locator(`#calGrid [data-day="${d01}"]`);
  assert.match(await cell.textContent(), /-505,000/); // 고깃집 450,000 + 휴대폰 55,000
  assert.match(await p.textContent('#calTrend'), /지난달보다/);
  await p.click('#calTabs [data-pt="카드"]'); assert.match(await cell.textContent(), /-450,000/); assert.doesNotMatch(await cell.textContent(), /505,000/); await p.click('#calTabs [data-pt=""]');
  await cell.click();
  assert.equal(await cell.getAttribute('aria-pressed'), 'true');
  assert.equal(await p.locator('#dayList li[data-id]').count(), 2);
  assert.match(await p.textContent('#daySum'), /지출 505,000원/);
  // 필터가 달력에도 적용
  await p.selectOption('#fMajor', '식비');
  assert.equal(await p.locator('#dayList li[data-id]').count(), 1);
  assert.match(await p.textContent('#fActive'), /식비/);
  await p.click('#fReset');
  // 이날 추가 → 날짜 미리 채움
  await p.click('#dayAdd');
  assert.equal(await p.inputValue('#entryForm [name=date]'), d01);
  await p.click('#entryCancel'); await p.waitForSelector('#entry', { state: 'hidden' });
  // 항목 눌러 수정 창
  await p.click('#dayList li[data-id] >> nth=0');
  assert.equal(await p.textContent('#entryTitle'), '거래 수정');
  await p.click('#entryCancel'); await p.waitForSelector('#entry', { state: 'hidden' });
  await p.screenshot({ path: SHOTS + '/cal.png' });
  await p.click('#mPrev');
  assert.equal(await p.inputValue('#month'), ago(1));
  assert.equal(await p.locator(`#calGrid [data-day="${ago(1)}-01"] small.spend`).count(), 1); // 반복으로 생긴 지난달 1일
  await p.click('#mNext');
  assert.equal(await p.inputValue('#month'), CUR);
  await p.click('nav button[data-view=list]');
  assert.ok(await p.isVisible('#fAll'));

  // 8) 새 UI
  const [cy, cm] = CUR.split('-').map(Number);
  assert.equal(await p.textContent('#monthLabel'), `${cy}년 ${cm}월`);
  assert.ok((await p.locator('#list li.day-h').count()) >= 2, 'date headers');
  await p.click('nav button[data-view=home]');
  assert.equal(await p.locator('#daily button').count(), new Date(cy, cm, 0).getDate());
  await p.click('#daily button[data-d="1"]');
  assert.match(await p.textContent('#dailyInfo'), new RegExp(`${cm}월 1일 505,000원`));
  await p.click('#dailyGo');
  assert.ok(await p.isVisible('#v-cal')); assert.match(await p.textContent('#dayTitle'), new RegExp(`${cm}월 1일`));
  await p.click('nav button[data-view=home]');
  assert.equal(await p.locator('#recent li[data-id]').count(), 5);
  await p.click('#fab');
  await p.click('#quick [data-add="10000"]'); await p.click('#quick [data-add="5000"]');
  assert.equal(await p.inputValue('#entryForm [name=amount]'), '15000');
  await p.click('#majorChips [data-v="카페·간식"]');
  assert.equal(await p.inputValue('#entryForm [name=major]'), '카페·간식');
  await p.click('#minorChips [data-v="카페"]');
  assert.equal(await p.inputValue('#entryForm [name=minor]'), '카페');
  await p.click('#entryForm button.primary'); await status(/저장됨/); await p.waitForSelector('#entry', { state: 'hidden' });
  last = T.d[T.d.length - 1]; assert.equal(last[3], '카페·간식'); assert.equal(last[4], '카페'); assert.equal(last[8], 15000);
  await p.click('#mPrev'); assert.equal(await p.inputValue('#month'), ago(1)); await p.click('#mNext');
  await p.screenshot({ path: SHOTS + '/ui-home.png', fullPage: true });

  // 9) 오늘 버튼 + 설정 링크
  await p.click('nav button[data-view=cal]');
  await p.click('#mPrev'); await p.click('#calGrid [data-day="' + ago(1) + '-01"]');
  await p.click('#calToday');
  assert.equal(await p.inputValue('#month'), CUR);
  assert.equal(await p.getAttribute(`#calGrid [data-day="${TODAY}"]`, 'aria-pressed'), 'true');
  const p2 = await (await b.newContext()).newPage();
  await p2.route('https://script.google.com/**', rt => rt.fulfill({ contentType: 'application/json', body: gs.doGet({ parameter: Object.fromEntries(new URL(rt.request().url()).searchParams) }) }));
  await p2.goto('http://localhost:8766/#url=' + encodeURIComponent('https://script.google.com/macros/s/AKfy_-z9/exec') + '&token=' + encodeURIComponent(TOKEN));
  await p2.waitForFunction(() => /동기화됨/.test(document.querySelector('#syncPop').textContent + document.querySelector('#status').textContent));
  const p4 = await (await b.newContext()).newPage();
  await p4.route('https://script.google.com/**', rt => rt.fulfill({ contentType: 'application/json', body: gs.doGet({ parameter: Object.fromEntries(new URL(rt.request().url()).searchParams) }) }));
  await p4.goto('http://localhost:8766/');
  await p4.fill('[name=link]', 'https://babjange1.github.io/Budget-book/#url=' + encodeURIComponent('https://script.google.com/macros/s/AKfy_-z9/exec') + '&token=' + encodeURIComponent(TOKEN));
  await p4.click('button[value=save]');
  await p4.waitForFunction(() => /동기화됨/.test(document.querySelector('#syncPop').textContent + document.querySelector('#status').textContent));
  const p3 = await (await b.newContext()).newPage();
  await p3.goto('http://localhost:8766/#url=' + encodeURIComponent('https://evil.example/x') + '&token=t');
  assert.equal(await p3.evaluate(() => localStorage.getItem('cfg')), null, 'foreign url rejected');

  // 10) 홈 편집 + 카테고리 내역
  await p.click('nav button[data-view=home]');
  const order = () => p.$$eval('#v-home > [data-card]', els => els.map(e => e.dataset.card).join(','));
  assert.equal(await order(), 'hero,alerts,daily,budget,recent');
  assert.ok(!(await p.isVisible('.mover')));
  await p.click('#homeEdit');
  await p.click('[data-card="recent"] [data-mv="-1"]'); await p.click('[data-card="recent"] [data-mv="-1"]');
  await p.click('[data-card="hero"] [data-mv="-1"]'); // 맨 위에서 위로 → 변화 없음
  assert.equal(await order(), 'hero,alerts,recent,daily,budget');
  await p.click('#homeEdit');
  await p.reload(); await status(/동기화됨/);
  assert.equal(await order(), 'hero,alerts,recent,daily,budget', 'order persisted');
  assert.equal(await p.locator('[data-card="alerts"] > .mover + #alerts').count(), 1, 'mover kept, alerts inside wrapper');
  await p.click('#budgets [data-cat="식비"]');
  await p.waitForSelector('#catSheet', { state: 'visible' });
  assert.match(await p.textContent('#catTitle'), /식비/);
  const nCat = await p.locator('#catList li[data-id]').count();
  assert.ok(nCat >= 2, 'cat items ' + nCat);
  await p.locator('#catList li[data-id]', { hasText: '치킨' }).click();
  assert.equal(await p.textContent('#entryTitle'), '거래 수정');
  await p.fill('#entryForm [name=amount]', '46000');
  await p.click('#entryForm button.primary'); await status(/저장됨/); await p.waitForSelector('#entry', { state: 'hidden' });
  await p.waitForSelector('#catSheet', { state: 'visible' });
  assert.match(await p.textContent('#catList'), /46,000원/);
  await p.locator('#catList li[data-id]', { hasText: '치킨' }).click();
  await p.click('#entryDelete'); await status(/삭제됨/); await p.waitForSelector('#entry', { state: 'hidden' });
  assert.equal(await p.locator('#catList li[data-id]').count(), nCat - 1);
  await p.click('#catClose');
  await p.waitForSelector('#catSheet', { state: 'hidden' });

  // 11) 창 바깥을 누르면 닫힘, 안쪽은 안 닫힘
  await p.click('nav button[data-view=home]');
  await p.click('#fab'); await p.waitForSelector('#entry', { state: 'visible' });
  await p.click('#entryTitle'); assert.ok(await p.isVisible('#entry'));
  await p.mouse.click(195, 10); await p.waitForSelector('#entry', { state: 'hidden' });
  await p.click('#budgets [data-cat] >> nth=0'); await p.waitForSelector('#catSheet', { state: 'visible' });
  await p.mouse.click(195, 10); await p.waitForSelector('#catSheet', { state: 'hidden' });
  await p.click('#openSettings'); await p.mouse.click(195, 10); await p.waitForSelector('#settings', { state: 'hidden' });
  await status(/저장됨|동기화됨|삭제됨/); // 설정을 바깥 클릭으로 닫아도 연결 유지
  console.log('font:', await p.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family)[0] || 'not loaded'; }));

  // 12) BAB:ZIP 메뉴: 독서·방탈출·보드게임
  assert.equal(await p.textContent('#appTitle'), 'MONEY');
  const go = async name => { await p.click('#menuBtn'); await p.click(`#menuList button:has-text("${name}")`); await status(/동기화됨/); };
  await go('독서');
  assert.equal(await p.textContent('#appTitle'), '독서');
  assert.equal(await p.getAttribute('#lViews [data-v=flow]', 'aria-pressed'), 'true', 'cover flow is the default');
  await p.click('#lViews [data-v=list]'); // 아래 목록 테스트는 목록 보기에서
  assert.ok(!(await p.isVisible('nav')) && !(await p.isVisible('#monthRow')));
  const B = bookSS['독서 기록'];
  // 표지 칸에 =IMAGE("주소")를 넣으면 목록에 사진이 뜸
  B.d[1][4] = '=IMAGE("https://example.com/cover.jpg")';
  await p.click('#reload'); await status(/동기화됨/);
  await p.waitForFunction(() => document.querySelector('#lList img.thumb') || document.querySelector('#lList li:first-child .em'));
  const html = await p.innerHTML('#lList');
  assert.ok(html.includes('https://example.com/cover.jpg') || /📚/.test(html), 'cover rendered or fell back to emoji');
  assert.ok(!/<img[^>]*thumb[^>]*>/.test(html) || /referrerpolicy="no-referrer"/.test(html), 'no-referrer on thumbs');
  assert.equal(B.d[0][29], 'id'); assert.ok(B.d[1][29] && B.d[3][29], 'book ids assigned');
  assert.equal(await p.locator('#lList li[data-id]').count(), 3);
  assert.match(await p.textContent('#lInfo'), /3권 · 완독 2권 · 올해 완독 1권/);
  await p.click('#fab'); await p.waitForSelector('#lItem', { state: 'visible' });
  await p.fill('#lForm [name=title]', '=새 책'); await p.fill('#lForm [name=author]', '작가'); await p.selectOption('#lForm [name=stars]', '🙂');
  await p.click('#lForm button.primary'); await status(/저장됨/); await p.waitForSelector('#lItem', { state: 'hidden' });
  assert.deepEqual([B.d[4][0], B.d[4][1], B.d[4][2], B.d[4][3], B.d[4][5], B.d[4][6], B.d[4][7], B.d[4][8]], [4, CUR.slice(0, 4) + '년', CUR.slice(5) + '월', 3, '=새 책', '작가', '완독', '🙂']);
  assert.match(await p.textContent('#lList li >> nth=0'), /새 책/);
  // 수정
  await p.click('#lList li[data-id] >> nth=0'); await p.selectOption('#lForm [name=status]', '보류');
  await p.click('#lForm button.primary'); await status(/저장됨/); await p.waitForSelector('#lItem', { state: 'hidden' });
  assert.equal(B.d[4][7], '보류'); assert.equal(B.d[4][0], 4, '번호 유지'); assert.equal(B.d.filter(r => r && r[5]).length, 5);
  // 삭제: 2번째 줄(채식주의자)을 지워도 같은 줄 요약 표(K열)는 그대로
  await p.fill('#lq', '채식'); assert.equal(await p.locator('#lList li[data-id]').count(), 1);
  await p.click('#lList li[data-id] >> nth=0'); await p.click('#lDelete'); await status(/삭제됨/); await p.waitForSelector('#lItem', { state: 'hidden' });
  assert.equal(B.d[1][5], '급류'); assert.equal(B.d[1][11], '요약1'); assert.equal(B.d[2][11], '요약2'); assert.equal(B.d[3][5], '=새 책');
  assert.ok(!B.d[4] || !B.d[4][5], 'row removed');
  await p.fill('#lq', '');
  // 구매 목록 체크
  await p.click('#lTabs [data-list=buy]'); await p.click('#lList li[data-id] >> nth=0');
  await p.check('#lForm [name=done]'); await p.click('#lForm button.primary'); await status(/저장됨/); await p.waitForSelector('#lItem', { state: 'hidden' });
  assert.strictEqual(bookSS['구매 목록'].d[1][3], true);
  assert.match(await p.textContent('#lList'), /구매함/);
  // 방탈출
  await go('방탈출');
  const E = hobbySS['방탈출 기록'];
  assert.equal(E.d[2][14], 'id'); assert.equal(await p.locator('#lList li[data-id]').count(), 2);
  await p.click('#fab'); await p.fill('#lForm [name=theme]', '새 테마'); await p.fill('#lForm [name=shop]', '키이스케이프');
  await p.selectOption('#lForm [name=result]', '성공'); await p.selectOption('#lForm [name=rating]', '😍'); await p.fill('#lForm [name=cost]', '28000');
  await p.click('#lForm button.primary'); await status(/저장됨/); await p.waitForSelector('#lItem', { state: 'hidden' });
  assert.equal(E.d[5][1], '새 테마'); assert.equal(ymd(E.d[5][0]), TODAY); assert.equal(E.d[5][5], '성공'); assert.equal(E.d[5][9], 28000); assert.equal(E.d[5][10], '😍');
  assert.equal(E.d[1][1], '2 개', '요약 줄 보존');
  // 보드게임 → 취미 기록 탭에 종류=보드게임
  await go('보드게임');
  await p.click('#fab'); await p.fill('#lForm [name=name]', '스플렌더'); await p.fill('#lForm [name=place]', '보드카페');
  await p.click('#lForm button.primary'); await status(/저장됨/); await p.waitForSelector('#lItem', { state: 'hidden' });
  const H = extraTabs['보드게임 기록'];
  assert.equal(H.d[1][2], '보드게임'); assert.equal(H.d[1][3], '스플렌더'); assert.ok(H.d[1][0], '기록 ID 채움');
  await p.reload(); await status(/동기화됨/);
  assert.equal(await p.textContent('#appTitle'), '보드게임', '마지막 섹션 기억');
  assert.equal(await p.locator('#lList li[data-id]').count(), 1);
  await p.screenshot({ path: SHOTS + '/l-board.png' });
  await go('MONEY');
  assert.ok(await p.isVisible('nav') && await p.isVisible('#monthRow') && await p.isVisible('#v-home'));
  // 13) 영화·연극 저장
  await go('영화');
  await p.click('#fab'); await p.fill('#lForm [name=title]', '파묘'); await p.fill('#lForm [name=director]', '장재현');
  await p.click('#lForm button.primary'); await status(/저장됨/); await p.waitForSelector('#lItem', { state: 'hidden' });
  assert.equal(extraTabs['영화 기록'].d[1][1], '파묘'); assert.ok(extraTabs['영화 기록'].d[1][8], 'movie id');
  await go('연극·뮤지컬');
  await p.click('#fab'); await p.fill('#lForm [name=title]', '킹키부츠'); await p.selectOption('#lForm [name=kind]', '뮤지컬');
  await p.click('#lForm button.primary'); await status(/저장됨/); await p.waitForSelector('#lItem', { state: 'hidden' });
  assert.equal(extraTabs['연극·뮤지컬 기록'].d[1][2], '뮤지컬'); assert.ok(extraTabs['연극·뮤지컬 기록'].d[1][9], 'play id');

  // 14) 날짜 휠
  await p.click('#menuBtn'); await p.click('#menuList button:has-text("MONEY")'); await p.waitForSelector('nav', { state: 'visible' });
  await p.click('nav button[data-view=home]');
  await p.click('#fab'); await p.waitForSelector('#entry', { state: 'visible' });
  // 날짜: 한 줄 버튼 → 캘린더 창에서 고르기
  await p.click('#entryForm .dbtn'); await p.waitForSelector('#calPick', { state: 'visible' });
  await p.click('#cpGrid [data-d="' + TODAY.slice(0, 8) + '05"]');
  await p.waitForSelector('#calPick', { state: 'hidden' });
  assert.equal(await p.inputValue('#entryForm [name=date]'), TODAY.slice(0, 8) + '05');
  assert.match(await p.textContent('#entryForm .dbtn'), /\d+일 \(/);
  // 시간: 하단 휠 (시·분)
  const spin = async (vals) => {
    await p.waitForSelector('#wheelSheet', { state: 'visible' });
    await p.evaluate(vs => [...document.querySelectorAll('#wsCols .wcol')].forEach((col, k) => {
      const i = [...col.children].findIndex(el => el.dataset.v === vs[k]); col.scrollTop = i * 44; col.dispatchEvent(new Event('scroll'));
    }), vals);
    await p.waitForTimeout(150); await p.click('#wsOk'); await p.waitForSelector('#wheelSheet', { state: 'hidden' });
  };
  await p.click('#entryForm .dt-row .dbtn >> nth=1');
  assert.equal(await p.locator('#wsCols .wcol').count(), 2, 'hour + minute wheels');
  await spin(['09', '30']);
  assert.equal(await p.textContent('#entryForm .dt-row .dbtn >> nth=1'), '09:30');
  assert.equal(await p.inputValue('#entryForm [name=time]'), '09:30');
  await p.click('#entryCancel'); await p.waitForSelector('#entry', { state: 'hidden' });
  await p.click('#mPrev'); await p.click('#monthLabel');
  await spin([CUR.slice(0, 4), '03']);
  assert.match(await p.textContent('#monthLabel'), /3월/);

  // 15) 달력 상단 오늘 입력 + 바로가기 주소
  await p.click('nav button[data-view=cal]');
  await p.click('#calQuick'); await p.waitForSelector('#entry', { state: 'visible' });
  assert.equal(await p.inputValue('#entryForm [name=date]'), TODAY);
  await p.click('#entryCancel'); await p.waitForSelector('#entry', { state: 'hidden' });
  await p.goto('http://localhost:8766/?add=1'); await p.waitForSelector('#entry', { state: 'visible' });
  assert.equal(await p.evaluate(() => location.search), '', 'query cleaned');
  await p.click('#entryCancel'); await p.waitForSelector('#entry', { state: 'hidden' });
  await p.goto('http://localhost:8766/?sec=book&add=1'); await p.waitForSelector('#lItem', { state: 'visible' });
  assert.equal(await p.textContent('#appTitle'), '독서');
  await p.click('#lCancel'); await p.waitForSelector('#lItem', { state: 'hidden' });


  // 16) 달력 손잡이: 누르면 접히고 다시 펼쳐짐
  await p.click('#menuBtn'); await p.click('#menuList button:has-text("MONEY")'); await p.waitForSelector('nav', { state: 'visible' });
  await p.click('nav button[data-view=cal]');
  const clipH = () => p.evaluate(() => document.querySelector('#calClip').offsetHeight);
  const openH = await clipH();
  await p.click('#calGrab'); await p.waitForTimeout(300);
  const closedH = await clipH();
  assert.ok(closedH < openH / 3, `collapsed ${closedH} < ${openH}`);
  await p.click('#calGrab'); await p.waitForTimeout(300);
  assert.ok(Math.abs((await clipH()) - openH) < 3, 'expanded again');
  // 끌기: 아래에서 위로 끌면 접힘 쪽으로 가고, 놓으면 붙음
  const gb = await p.locator('#calGrab').boundingBox();
  await p.mouse.move(gb.x + gb.width / 2, gb.y + 2); await p.mouse.down();
  await p.mouse.move(gb.x + gb.width / 2, gb.y - 200, { steps: 8 });
  const mid = await clipH(); assert.ok(mid < openH - 100, 'follows finger ' + mid);
  await p.mouse.up(); await p.waitForTimeout(300);
  assert.ok((await clipH()) < openH / 3, 'snaps to week');
  await p.click('#calGrab'); await p.waitForTimeout(300);
  // 바뀐 것만 받기: 최근 두 달만 받고, 예전 줄이 바뀌면 전체를 다시 받음
  { const since = ago(2) + '-01', reqs = [];
    p.on('request', q => { if (q.url().startsWith('https://script.google.com') && q.method() === 'GET') reqs.push(q.url()); });
    const oldDay = new Date(now.getFullYear(), now.getMonth() - 5, 3);
    T.d.push([oldDay, '', '지출', '식비', '', '옛날 거래', '', '', 1234, '', '', '', '', '', '', 'old-1']);
    // 이전 「동기화됨」 문구가 남아 있으면 기다림이 바로 끝나므로 지우고 새로고침
    const reload = async () => { await p.evaluate(() => { document.querySelector('#syncPop').textContent = ''; document.querySelector('#status').textContent = ''; }); await p.click('#reload'); await status(/동기화됨/); };
    const has = (id, amt) => p.evaluate(([id, amt]) => data.items.some(i => i.id === id && i.amount === amt), [id, amt]);
    await reload();
    assert.ok(await has('old-1', 1234), 'old row added in the sheet shows up');
    reqs.length = 0;
    await reload();
    assert.equal(reqs.length, 1, 'unchanged: one request'); assert.ok(reqs[0].includes('since=' + since) && !reqs[0].includes('full=1'), reqs[0]);
    const part = JSON.parse(gs.doGet({ parameter: { token: TOKEN, since } }));
    assert.ok(!part.full && part.items.length > 0 && part.items.every(i => i.date >= since), 'partial has recent only');
    assert.ok(part.items.length < JSON.parse(gs.doGet({ parameter: { token: TOKEN } })).items.length, 'partial is smaller');
    assert.equal(await p.evaluate(() => data.items.length), T.d.slice(1).filter(r => r[0] !== '' && r[0] != null).length, 'app has every row');
    T.d[T.d.length - 1][8] = 9999; reqs.length = 0;
    await reload();
    assert.ok(await has('old-1', 9999), 'edited old row refreshed'); assert.equal(reqs.length, 2, 'changed: partial then full');
    T.d.pop(); await reload();
    assert.ok(!(await has('old-1', 9999)), 'deleted old row disappears'); }
  // 잠금화면 위젯 요약
  { const sm = JSON.parse(gs.doGet({ parameter: { token: TOKEN, what: 'summary' } }));
    const d0 = r => r[0] instanceof Date ? ymd(r[0]) : String(r[0]), amt = r => Number(String(r[8]).replace(/,/g, '')) || 0;
    const net = r => r[2] === '지출' ? amt(r) : r[2] === '환불' ? -amt(r) : 0;
    const rows = T.d.slice(1).filter(r => d0(r).startsWith(CUR));
    const bud = sheets.카테고리.d.slice(1).reduce((s, r) => s + (r[3] ? Number(r[4]) || 0 : 0), 0);
    assert.deepEqual([sm.ok, sm.date, sm.month, sm.today, sm.budget, sm.left],
      [true, TODAY, rows.reduce((s, r) => s + net(r), 0), rows.filter(r => d0(r) === TODAY).reduce((s, r) => s + net(r), 0), bud, bud - rows.reduce((s, r) => s + net(r), 0)]);
    assert(sm.month > 0, 'summary has spending'); console.log('summary', JSON.stringify(sm)); }
  console.log('ALL PASS'); await b.close(); process.exit(0);
});
