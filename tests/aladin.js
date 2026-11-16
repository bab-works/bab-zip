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
// 사진 OCR: 드라이브에 문서로 올림 → 글자 내보내기 → 파일은 휴지통
{ const calls = []; let trashed = '';
  Object.assign(ctx, { ScriptApp: { getOAuthToken: () => 'tok' }, Utilities: { base64Decode: s => [...Buffer.from(s, 'base64')], newBlob: t => ({ getBytes: () => [...Buffer.from(t)] }) },
    DriveApp: { getFileById: id => ({ setTrashed: v => { trashed = v && id; } }) } });
  ctx.UrlFetchApp.fetch = (u, o) => { calls.push([u, o]); return { getResponseCode: () => 200, getContentText: () => /upload/.test(u) ? '{"id":"F1"}' : '스타벅스 4,500원' }; };
  assert.equal(vm.runInContext('ocr_("aGVsbG8=")', ctx), '스타벅스 4,500원');
  assert.match(calls[0][0], /uploadType=multipart&ocrLanguage=ko/); assert.equal(calls[0][1].headers.Authorization, 'Bearer tok');
  assert.match(Buffer.from(calls[0][1].payload).toString(), /application\/vnd.google-apps.document[\s\S]*hello/);
  assert.match(calls[1][0], /files\/F1\/export\?mimeType=text\/plain/); assert.equal(trashed, 'F1', 'temp doc trashed');
  assert.throws(() => vm.runInContext('ocr_("")', ctx), /사진/); }
console.log('ALADIN OK');
