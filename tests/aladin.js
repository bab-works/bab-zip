// 알라딘 검색 결과 화면 읽기 (bookSearch_) — 실제 화면 구조를 줄인 예시로 확인
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const box = (t, a, c) => `<div class="ss_book_box" itemId="1"><img src="https://image.aladin.co.kr/product/1/2/cover200/${c}.jpg" class="front_cover i_cover">
<a href="https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=1" class="bo3">${t}</a> <li><a href="/Search/wSearchResult.aspx?AuthorSearch=x@1&BranchType=1">${a}</a> (지은이)</li></div>`;
const html = '<html>' + box('페스트', '알베르 카뮈', 'a') + box('톰 &amp; 제리', '작가', 'b') + box('셋', '', 'c') + box('넷', '', 'd');
let url = '';
const ctx = { UrlFetchApp: { fetch: u => { url = u; return { getContentText: () => html }; } } };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(__dirname + '/../apps-script/Code.gs', 'utf8'), ctx);
const r = vm.runInContext('bookSearch_("페스트")', ctx);
assert.equal(r.length, 3);
assert.deepEqual(r[0], { title: '페스트', author: '알베르 카뮈', image: 'https://image.aladin.co.kr/product/1/2/cover500/a.jpg' });
assert.equal(r[1].title, '톰 & 제리');
assert.match(url, /SearchWord=%ED%8E%98/);
assert.deepEqual(vm.runInContext('bookSearch_("a")', ctx), [], 'too short');
// 알라딘 결과가 비면 구글 도서로
ctx.UrlFetchApp.fetch = u => ({ getContentText: () => /googleapis/.test(u) ? JSON.stringify({ items: [{ volumeInfo: { title: '페스트', authors: ['알베르 카뮈'], imageLinks: { thumbnail: 'http://books.google.com/x.jpg' } } }] }) : '<html>차단</html>' });
assert.deepEqual(vm.runInContext('bookSearch_("페스트")', ctx), [{ title: '페스트', author: '알베르 카뮈', image: 'https://books.google.com/x.jpg' }]);
console.log('ALADIN OK');
