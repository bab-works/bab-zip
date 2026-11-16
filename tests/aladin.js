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
// Drive API 서비스가 있으면 그걸로: 문서로 만들고 → 글자 읽고 → 휴지통
{ let made = null, trashed = '';
  Object.assign(ctx, { Drive: { Files: { create: (meta, blob, opt) => { made = { meta, opt }; return { id: 'D1' }; } } },
    DocumentApp: { openById: id => ({ getBody: () => ({ getText: () => id === 'D1' ? '쿠팡이츠 18,900원' : '' }) }) },
    DriveApp: { getFileById: id => ({ setTrashed: v => { trashed = v && id; } }) } });
  ctx.Utilities.newBlob = (b, t, n) => ({ bytes: b, type: t, name: n, getBytes: () => b });
  assert.equal(vm.runInContext('ocr_("aGVsbG8=")', ctx), '쿠팡이츠 18,900원');
  assert.equal(made.meta.mimeType, 'application/vnd.google-apps.document'); assert.equal(made.opt.ocrLanguage, 'ko'); assert.equal(trashed, 'D1');
  delete ctx.Drive; }
// 보드게임: 코리아보드게임즈 검색 화면 안의 상품 목록 → 이름 정확히 맞는 것 먼저, 굿즈 빼기, 이미지 주소
{ const item = (n, img, p) => ({ prdNm: n, prdMainImg: img, unitPrice: p, note: '괄호 ] [ 와 "따옴표\\" 섞인 글' });
  const page = 'x var searchPrdList = ' + JSON.stringify([item('[세트] 스플렌더 + 확장', 'upload/a.jpg', 143000), item('스플렌더 아트 슬리브', 'upload/s.jpg', 25000), item('스플렌더', 'upload/thumb/스플렌더.jpg', 65000)]) + ';\n var other = [1];';
  ctx.UrlFetchApp.fetch = u => ({ getContentText: () => page });
  const g = JSON.parse(JSON.stringify(vm.runInContext('boardSearch_("스플렌더")', ctx)));
  assert.deepEqual(g.map(x => x.name), ['스플렌더', '스플렌더 + 확장']);
  assert.equal(g[0].image, 'https://cdnfile.koreaboardgames.com/upload/thumb/%EC%8A%A4%ED%94%8C%EB%A0%8C%EB%8D%94.jpg'); assert.equal(g[0].price, 65000); }
console.log('ALADIN OK');
