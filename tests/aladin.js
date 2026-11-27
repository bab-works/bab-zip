// 알라딘 검색 결과 화면 읽기 (bookSearch_) — 실제 화면 구조를 줄인 예시로 확인
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const box = (t, a, c) => `<div class="ss_book_box" itemId="1"><img src="https://image.aladin.co.kr/product/1/2/cover200/${c}.jpg" class="front_cover i_cover">
<a href="https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=1" class="bo3">${t}</a> <li><a href="/Search/wSearchResult.aspx?AuthorSearch=x@1&BranchType=1">${a}</a> (지은이)</li></div>`;
const html = '<html>' + box('페스트', '알베르 카뮈', 'a') + box('톰 &amp; 제리', '작가', 'b') + box('셋', '', 'c') + box('넷', '', 'd');
let url = '';
const ctx = { UrlFetchApp: { fetch: u => { url = u; return { getContentText: () => html }; } } };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(__dirname + '/../apps-script/Code.gs', 'utf8'), ctx);
const r = vm.runInContext('bookSearch_("페스트")', ctx);
assert.equal(r.length, 4, 'all results on the page (app shows 5 at a time with 더 보기)');
assert.deepEqual(r[0], { title: '페스트', author: '알베르 카뮈', image: 'https://image.aladin.co.kr/product/1/2/cover500/a.jpg' });
assert.equal(r[1].title, '톰 & 제리');
assert.match(url, /SearchWord=%ED%8E%98/);
assert.deepEqual(vm.runInContext('bookSearch_("a")', ctx), [], 'too short');
// 알라딘 결과가 비면 구글 도서로
ctx.UrlFetchApp.fetch = u => ({ getContentText: () => /googleapis/.test(u) ? JSON.stringify({ items: [{ volumeInfo: { title: '페스트', authors: ['알베르 카뮈'], imageLinks: { thumbnail: 'http://books.google.com/x.jpg' } } }] }) : '<html>차단</html>' });
assert.deepEqual(vm.runInContext('bookSearch_("페스트")', ctx), [{ title: '페스트', author: '알베르 카뮈', image: 'https://books.google.com/x.jpg' }]);
// 보드게임: 코리아보드게임즈 검색 화면 안의 상품 목록 → 이름 정확히 맞는 것 먼저, 굿즈 빼기, 이미지 주소
{ const item = (n, img, p) => ({ prdNm: n, prdMainImg: img, unitPrice: p, note: '괄호 ] [ 와 "따옴표\\" 섞인 글' });
  const page = 'x var searchPrdList = ' + JSON.stringify([item('[세트] 스플렌더 + 확장', 'upload/a.jpg', 143000), item('스플렌더 아트 슬리브', 'upload/s.jpg', 25000), item('스플렌더', 'upload/thumb/스플렌더.jpg', 65000)]) + ';\n var other = [1];';
  ctx.UrlFetchApp.fetch = u => ({ getContentText: () => page });
  const g = JSON.parse(JSON.stringify(vm.runInContext('boardSearch_("스플렌더")', ctx)));
  assert.deepEqual(g.map(x => x.name), ['스플렌더', '스플렌더 + 확장']);
  assert.equal(g[0].image, 'https://cdnfile.koreaboardgames.com/upload/thumb/%EC%8A%A4%ED%94%8C%EB%A0%8C%EB%8D%94.jpg'); assert.equal(g[0].price, 65000); }
// 영화: 키노라이츠 검색 화면에 이스케이프돼 실린 결과 → 영화 먼저, 포스터 없어도 됨
{ const it = (id, t, ty, img, y) => `{\\"content\\":{\\"id\\":\\"${id}\\",\\"titleKr\\":\\"${t}\\",\\"contentTypes\\":[\\"${ty}\\"],\\"posterImage\\":${img ? `{\\"id\\":\\"9\\",\\"pathUrl\\":\\"${img}\\"` : 'null'},\\"x\\":1,\\"openYear\\":${y ? `\\"${y}\\"` : 'null'}}}`;
  const page = 'self.__next_f.push([1,"' + [it(1, '위키드', '예능', 'https://f/a.jpg', '2016'), it(2, '위키드', '영화', 'https://f/b.jpg', '2024'), it(3, '위키드 2', '영화', '', '')].join(',') + '"])';
  ctx.UrlFetchApp.fetch = u => { assert.match(u, /^https:\/\/kinolights\.com\/search\?keyword=/); return { getContentText: () => page }; };
  const m = JSON.parse(JSON.stringify(vm.runInContext('movieSearch_("위키드")', ctx)));
  assert.deepEqual(m.map(x => [x.title, x.type, x.year, x.image]), [['위키드', '영화', '2024', 'https://f/b.jpg'], ['위키드 2', '영화', '', ''], ['위키드', '예능', '2016', 'https://f/a.jpg']]); }
// 카드 결제 문자 → 거래 한 줄: 결제수단은 카테고리 탭 이름에서 카드사로, 대분류는 분류규칙(가맹점 글자), 없으면 기타
{ const meta = { cats: [['식비', '외식'], ['기타', '']], payments: [['샘플 현대카드', '신용'], ['OO롯데카드', '신용'], ['KB국민 샘플', '체크']], rules: [['가나다', '지출', '식비', '외식']] };
  const tx = JSON.parse(JSON.stringify(vm.runInContext(`smsTx_('sms:a', { card: '현대', type: '지출', amount: 43500, inst: 0, date: '2026-11-20', time: '12:30', merchant: '가나다식당', currency: '' }, ${JSON.stringify(meta)})`, ctx)));
  assert.deepEqual([tx.pay, tx.major, tx.minor, tx.content, tx.amount, tx.memo], ['샘플 현대카드', '식비', '외식', '가나다식당', 43500, '문자 자동']);
  const fx = JSON.parse(JSON.stringify(vm.runInContext(`smsTx_('sms:b', { card: '국민', type: '환불', amount: 13986, inst: 5, date: '2026-11-27', time: '10:33', merchant: 'EXAMPLE SHOP', currency: 'USD', foreign: 9.99, rate: 1400 }, ${JSON.stringify(meta)})`, ctx)));
  assert.deepEqual([fx.pay, fx.major, fx.type, fx.inst, fx.content, fx.memo], ['KB국민 샘플', '기타', '환불', 5, 'EXAMPLE SHOP 취소', '문자 자동 · USD 9.99 · 환율 1400']); }
console.log('ALADIN OK');
