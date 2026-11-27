// 카드 결제 문자 해석 (롯데·현대·국민, 국내·해외·할부·취소·자동납부). 문자 모양은 실제와 같고 이름·카드번호만 가짜
import assert from "node:assert/strict";
import { parseSms } from "../worker/index.mjs";
const now = new Date("2026-11-27T07:00:00Z"); // 한국 16:00
const p = (t) => parseSms(t, now);
const cases = [
  ["[Web발신]\n현대 M 승인\n홍*동\n43,500원 일시불\n11/20 12:30\n가나다식당\n누적1,234,567원",
    { card: "현대", type: "지출", amount: 43500, currency: "", inst: 0, date: "2026-11-20", time: "12:30", merchant: "가나다식당" }],
  ["[Web발신]\n현대 M 승인\n홍*동\n7,700원 일시불\n11/21 09:15\n(주)샘플상사\n누적1,242,267원",
    { card: "현대", amount: 7700, merchant: "(주)샘플상사", date: "2026-11-21", time: "09:15" }],
  ["[Web발신]\n현대 M 해외승인\n홍*동\nUSD 9.99\n11/21 10:05\nEXAMPLE SHOP",
    { card: "현대", amount: 0, currency: "USD", foreign: 9.99, merchant: "EXAMPLE SHOP", time: "10:05" }],
  ["[Web발신]\n[현대카드] 자동납부 승인 홍*동님\n샘플공사 11월-요금 12,340원",
    { card: "현대", amount: 12340, merchant: "샘플공사 11월-요금", date: "2026-11-27", time: "16:00" }],
  ["[Web발신]\n라마바 고기집 본점\n38,000원  승인\n홍*동 OO롯데카드 1*2*\n일시불 11/19 19:05\n누적 2,000,000원",
    { card: "롯데", amount: 38000, merchant: "라마바 고기집 본점", date: "2026-11-19", time: "19:05" }],
  ["[Web발신]\n(주)테스트페이\n15,000원  승인\n홍*동 OO롯데카드 1*2*\n일시불 11/21 11:11\n누적 2,015,000원",
    { card: "롯데", amount: 15000, merchant: "(주)테스트페이" }],
  ["[Web발신]\nSAMPLE RAMEN\nJPY 1,200 해외승인 홍*동\nOO롯데카드 1*2* 일시불\n11/15 20:00 누적 1,900,000원",
    { card: "롯데", currency: "JPY", foreign: 1200, amount: 0, merchant: "SAMPLE RAMEN", date: "2026-11-15", time: "20:00" }],
  ["제목없음\n[Web발신]\nKB국민카드1234승인\n홍*동님\n9,000원 일시불\n11/18 13:10\n사아자 분식(샘플점)\n누적800,000원",
    { card: "국민", type: "지출", amount: 9000, merchant: "사아자 분식(샘플점)", date: "2026-11-18", time: "13:10" }],
  ["[Web발신]\nKB국민카드1234승인\n홍*동님\n120,000원 05개월\n10/10 10:24\n샘플몰(페이)\n누적500,000원",
    { card: "국민", amount: 120000, inst: 5, merchant: "샘플몰(페이)", date: "2026-10-10" }],
  ["[Web발신]\nKB국민카드1234취소\n홍*동님\n120,000원 05개월\n10/10 10:32\n샘플몰(페이)\n누적380,000원",
    { card: "국민", type: "환불", amount: 120000, merchant: "샘플몰(페이)", time: "10:32" }],
];
for (const [text, want] of cases) {
  const got = p(text);
  for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, `${k} in\n${text}\n→ ${JSON.stringify(got)}`);
}
// 결제 문자가 아니면 null (광고·안내 문자)
assert.equal(p("[Web발신]\n[KB국민카드,할부 안내]\n■ http://m.kbcard.com/a/1"), null);
assert.equal(p("오늘 저녁 승인 났어?"), null);
// 12월 결제 문자를 1월에 받으면 작년
assert.equal(parseSms("[Web발신]\nKB국민카드1234승인\n홍*동님\n1,000원 일시불\n12/31 23:59\n편의점\n누적1원", new Date("2027-01-01T01:00:00Z")).date, "2026-12-31");
console.log("SMS OK");
