// Miniflare runs the actual Worker and local D1. All credentials are generated for this run.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
const fromWorker = createRequire(
  new URL("../worker/package.json", import.meta.url),
);
const { Miniflare } = fromWorker("miniflare");
const root = new URL("../worker/", import.meta.url);
const bridge = randomUUID(),
  first = randomUUID(),
  password = "한글" + randomUUID();
const mf = new Miniflare({
  modules: true,
  script: await readFile(new URL("index.mjs", root), "utf8"),
  compatibilityDate: "2025-11-18",
  d1Databases: ["DB"],
  bindings: {
    BRIDGE_SECRET: bridge,
    FIRST_PASSWORD: first,
    TMDB_READ_TOKEN: first,
    KAKAO_REST_KEY: first + "-kakao",
    SMS_HOOK_SHA: createHash("sha256").update("sms-" + first).digest("hex"),
  },
  outboundService(request) {
    const url = new URL(request.url);
    if (url.origin === "https://api.frankfurter.app") {
      assert.equal(url.searchParams.get("to"), "KRW");
      return Response.json({ rates: { KRW: url.searchParams.get("from") === "USD" ? 1400 : 9.5 } });
    }
    if (url.origin === "https://dapi.kakao.com") {
      assert.equal(url.pathname, "/v3/search/book");
      assert.equal(url.searchParams.get("size"), "20");
      assert.equal(request.headers.get("Authorization"), "KakaoAK " + first + "-kakao");
      return Response.json({ documents: [
        { title: "만조를 기다리며", authors: ["조예은"], thumbnail: "https://search1.kakaocdn.net/thumb/x.jpg", publisher: "위즈덤하우스", datetime: "2023-05-10T00:00:00.000+09:00" },
        { title: "표지 없는 책", authors: [], thumbnail: "http://insecure/x.jpg" },
      ] });
    }
    assert.equal(
      url.origin + url.pathname,
      "https://api.themoviedb.org/3/search/multi",
    );
    assert.equal(url.searchParams.get("language"), "ko-KR");
    assert.equal(request.headers.get("Authorization"), "Bearer " + first);
    return Response.json({
      results: [
        { media_type: "tv", name: "가상 시리즈", first_air_date: "2021-02-01" },
        { media_type: "person", name: "인물" },
        {
          media_type: "movie",
          title: "가상 영화",
          release_date: "2024-03-01",
          poster_path: "/poster.jpg",
        },
      ],
    });
  },
});
try {
  const db = await mf.getD1Database("DB");
  const schema = await readFile(
    new URL("migrations/0001_friends.sql", root),
    "utf8",
  );
  for (const stmt of schema
    .replace(/^--.*$/gm, "")
    .split(";")
    .filter((s) => s.trim()))
    await db.prepare(stmt).run();
  const request = async (body, token) => {
    const res = await mf.dispatchFetch("http://localhost/", {
      method: "POST",
      headers: token ? { Authorization: "Bearer " + token } : {},
      body: JSON.stringify(body),
    });
    return res.json();
  };
  const call = async (body, token) => {
    const result = await request(body, token);
    assert.equal(result.ok, true, result.error);
    return result;
  };
  await db
    .prepare(
      await readFile(new URL("migrations/0002_cutover.sql", root), "utf8"),
    )
    .run();
  for (const t of [
    "accounts",
    "records",
    "publications",
    "relations",
    "houses",
    "habits",
    "habit_days",
    "reports",
  ])
    await db
      .prepare("CREATE TABLE stage_" + t + " AS SELECT * FROM " + t)
      .run();
  await db.prepare("CREATE TABLE stage_verified(id INTEGER)").run();
  await db
    .prepare(
      "INSERT INTO stage_accounts(id,name,created) VALUES('owner','테스트주인','test')",
    )
    .run();
  assert.equal(
    (await request({ action: "promoteSnapshot" }, bridge)).ok,
    false,
  );
  await db.prepare("INSERT INTO stage_verified VALUES(1)").run();
  assert.equal((await request({ action: "promoteSnapshot" })).ok, false);
  assert.equal(
    (await call({ action: "promoteSnapshot" }, bridge)).active,
    true,
  );
  assert.equal(
    (await call({ action: "promoteSnapshot" }, bridge)).active,
    true,
  );
  for (const f of ["migrations/0003_sms.sql", "migrations/0004_sessions.sql", "migrations/0005_ledger.sql"]) for (const stmt of (await readFile(new URL(f, root), "utf8")).replace(/^--.*$/gm, "").split(";").filter((s) => s.trim())) await db.prepare(stmt).run();
  const invite = (name) => call({ action: "invite", name }, bridge);
  const a = await invite("가"),
    b = await invite("나"),
    outsider = await invite("다");
  const login = (name, password) => ({ action: "login", name, password });
  // 로그인하면 출입증(sf.…)을 받음. 처음 로그인에 예전 방식 비밀번호가 PBKDF2로 바뀜
  for (const [x, n] of [[a, "가"], [b, "나"], [outsider, "다"]]) x.tok = (await call(login(n, first))).token;
  assert.match(a.tok, /^sf\.[\w-]{43}$/);
  assert.match((await db.prepare("SELECT pw FROM accounts WHERE code=?").bind(a.code).first()).pw, /^p2\$/);
  assert.equal((await call(login("가", first))).role, "friend", "PBKDF2 password still logs in");
  // 예전 접속코드는 2027년 전까지만, 출입증으로 바꾸는 데 씀
  if (Date.now() < Date.parse("2027-01-01T00:00:00+09:00")) {
    const swapped = await call({ action: "session" }, a.code);
    assert.match(swapped.token, /^sf\./);
    assert.equal((await request({ action: "session" }, swapped.token)).ok, false, "a session cannot mint more sessions");
    await call({ action: "logout" }, swapped.token);
    assert.equal((await request({ what: "me" }, swapped.token)).ok, false, "logout ends that session");
  }
  assert.equal(
    (await request({ what: "projectionContext" }, a.tok)).ok,
    false,
  );
  await call(
    {
      action: "replaceProjection",
      records: [
        {
          list: "movie",
          item: { id: "owner-test", title: "가상", with: "가" },
        },
      ],
    },
    bridge,
  );
  assert.equal((await call({ what: "lists" }, a.tok)).lists.movie.length, 1);
  await call({ action: "replaceProjection", records: [] }, bridge);
  assert.equal((await call({ what: "lists" }, a.tok)).lists.movie.length, 0);
  const search = { what: "movie", q: "가상" };
  assert.equal((await request(search)).ok, false);
  for (const token of [bridge, a.tok]) {
    const result = await call(search, token);
    assert.equal(result.source, "tmdb");
    assert.deepEqual(
      result.movies.map((x) => [x.type, x.year]),
      [
        ["영화", "2024"],
        ["시리즈", "2021"],
      ],
    );
    assert.equal(
      result.movies[0].image,
      "https://image.tmdb.org/t/p/w185/poster.jpg",
    );
  }
  // 책: 카카오 도서 검색 (친구·시트 둘 다), 로그인 없으면 안 됨, https 표지만
  const bookQ = { what: "book", q: "만조" };
  assert.equal((await request(bookQ)).ok, false);
  for (const token of [bridge, a.tok]) {
    const result = await call(bookQ, token);
    assert.equal(result.source, "kakao");
    assert.deepEqual(result.books, [
      { title: "만조를 기다리며", author: "조예은", image: "https://search1.kakaocdn.net/thumb/x.jpg", publisher: "위즈덤하우스", year: "2023" },
      { title: "표지 없는 책", author: "", image: "", publisher: "", year: "" },
    ]);
  }
  // 주인: 시트가 알려 준 출입증으로 책·영화 검색만 친구 서버로 바로, 다른 기능은 안 됨
  const ownerTok = "so." + randomUUID();
  assert.equal((await request({ action: "ownerSession", hash: createHash("sha256").update(ownerTok).digest("hex"), expires: 2e9 }, a.tok)).ok, false, "only the Sheet registers owner sessions");
  await call({ action: "ownerSession", hash: createHash("sha256").update(ownerTok).digest("hex"), expires: 2e9 }, bridge);
  assert.equal((await call({ what: "book", q: "만조", token: ownerTok })).source, "kakao");
  assert.equal((await call({ what: "movie", q: "가상", token: ownerTok })).source, "tmdb");
  assert.equal((await request({ what: "lists", token: ownerTok })).ok, false, "owner token opens searches only");
  assert.equal((await request({ what: "book", q: "만조", token: "wrong" })).ok, false);
  await call({ action: "dropOwnerSessions" }, bridge);
  assert.equal((await request({ what: "book", q: "만조", token: ownerTok })).ok, false, "owner logout-all reaches the friend server");
  // 카드 결제 문자 웹훅: 열쇠 확인 → 해석해 보관함에 저장(같은 문자는 한 번만) → 시트가 가져가고 완료 표시
  const hook = (text, key = "sms-" + first) => mf.dispatchFetch("http://localhost/hook/sms", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).then((r) => r.json());
  const sms1 = "[Web발신]\n현대 M 승인\n홍*동\n43,500원 일시불\n11/20 12:30\n가나다식당\n누적1,234,567원";
  const sms2 = "[Web발신]\n현대 M 해외승인\n홍*동\nUSD 9.99\n11/21 10:05\nEXAMPLE SHOP";
  assert.equal((await hook(sms1, "wrong")).ok, false, "wrong key rejected");
  assert.equal((await hook("오늘 승인 났어?")).ok, false, "not a card message");
  const h1 = await hook(sms1); assert.deepEqual([h1.ok, h1.saved], [true, true]); assert.match(h1.summary, /현대 지출 43,500원 가나다식당/);
  assert.deepEqual([(await hook(sms1)).duplicate, (await hook(sms1)).id], [true, h1.id], "same text saved once");
  assert.match((await hook(sms2)).summary, /USD 9.99 EXAMPLE SHOP/);
  assert.equal((await request({ action: "smsPull" }, a.tok)).ok, false, "only the Sheet can pull");
  const pulled = (await call({ action: "smsPull" }, bridge)).items;
  assert.deepEqual(pulled.map((x) => [x.parsed.merchant, x.parsed.amount]), [["가나다식당", 43500], ["EXAMPLE SHOP", 13986]], "foreign amount converted to KRW");
  await call({ action: "smsAck", done: [pulled[0].id], failed: [{ id: pulled[1].id, error: "test" }] }, bridge);
  assert.deepEqual((await call({ action: "smsPull" }, bridge)).items.map((x) => x.id), [pulled[1].id], "done ones are not pulled again");
  assert.deepEqual(await db.prepare("SELECT text, parsed FROM sms_inbox WHERE id=?").bind(pulled[0].id).first(), { text: "", parsed: "{}" }, "written messages are wiped from the server");
  assert.equal((await hook(sms1)).duplicate, true, "still deduped after wiping");
  for (const t of [a.tok, undefined]) assert.equal((await request({ action: "smsAck", done: [], failed: [] }, t)).ok, false, "friends cannot touch the inbox");
  // 슬라이딩: 쓸 때마다 마지막 사용 + 30일 (기록은 하루 한 번), 30일 넘게 안 쓰면 끝
  const sec = () => Math.floor(Date.now() / 1000), H = (t) => createHash("sha256").update(t).digest("hex");
  const row = (t) => db.prepare("SELECT expires, created FROM sessions WHERE hash=?").bind(H(t)).first();
  await db.prepare("UPDATE sessions SET expires=? WHERE hash=?").bind(sec() + 3 * 86400, H(a.tok)).run();
  await call({ what: "lists" }, a.tok);
  assert.ok((await row(a.tok)).expires > sec() + 29 * 86400, "using the app pushes expiry back to 30 days");
  await db.prepare("UPDATE sessions SET expires=? WHERE hash=?").bind(sec() - 1, H(a.tok)).run();
  assert.equal((await request({ what: "lists" }, a.tok)).ok, false, "30 days unused → signed out");
  a.tok = (await call(login("가", first))).token;
  // 7일 넘은 출입증은 앱을 열 때(what=me) 새것으로, 예전 것은 2분만 더
  await db.prepare("UPDATE sessions SET created=? WHERE hash=?").bind(sec() - 8 * 86400, H(a.tok)).run();
  const fresh = (await call({ what: "me" }, a.tok)).token;
  assert.match(fresh, /^sf\.[\w-]{43}$/);
  assert.ok((await row(a.tok)).expires <= sec() + 120, "old token only lives 2 more minutes");
  assert.equal((await call({ what: "lists" }, a.tok)).ok, true, "in-flight requests with the old token still work");
  assert.equal((await call({ what: "me" }, a.tok)).token, undefined, "old one is not rotated twice");
  assert.ok((await row(a.tok)).expires <= sec() + 120, "nor extended");
  assert.equal((await call({ what: "me" }, fresh)).token, undefined, "a fresh token is not rotated again");
  a.tok = fresh;
  // 비밀번호를 바꾸면 모든 출입증(이 기기 것 포함)이 끝나고 이 기기는 새 출입증
  const other = (await call(login("가", first))).token, before = a.tok;
  a.tok = (await call({ action: "setPassword", password }, a.tok)).token;
  assert.match(a.tok, /^sf\./);
  assert.equal((await request({ what: "me" }, other)).ok, false, "other devices are signed out");
  assert.equal((await request({ what: "me" }, before)).ok, false, "this device's old token is revoked too");
  assert.equal((await call({ what: "me" }, a.tok)).social.ownerName !== undefined, true);
  const stored = await db.prepare("SELECT pw FROM accounts WHERE code=?").bind(a.code).first();
  assert.match(stored.pw, /^p2\$/);
  assert.ok(!stored.pw.includes(password));
  assert.equal((await request(login("가", first))).ok, false, "old password stops working");
  assert.equal((await call(login("가", password))).role, "friend");
  assert.match((await call({ action: "redeem", invite: a.invite })).token, /^sf\./);
  // 모든 기기에서 로그아웃
  const second = (await call(login("가", password))).token;
  await call({ action: "logoutAll" }, second);
  assert.equal((await request({ what: "me" }, a.tok)).ok, false, "logoutAll ends every session");
  a.tok = (await call(login("가", password))).token;
  for (const body of [
    { action: "invite", name: "라" },
    { what: "summary" },
    { action: "save" },
    { what: "house", name: "나" },
  ])
    assert.equal((await request(body, a.tok)).ok, false);
  await call({ action: "friendRequest", name: "나" }, a.tok);
  assert.deepEqual((await call({ what: "me" }, b.tok)).social.incoming, [
    "가",
  ]);
  await call({ action: "friendAccept", name: "가" }, b.tok);
  const save = {
    action: "listSave",
    list: "movie",
    item: {
      id: "x",
      title: "가상 영화",
      with: "나 다",
      cost: 99,
      quotes: ["test"],
    },
  };
  await call(save, a.tok);
  await call({ ...save, item: { id: "x", review: "수정" } }, a.tok);
  assert.equal(
    (await call({ what: "lists" }, outsider.tok)).lists.movie.length,
    0,
  );
  const shared = (await call({ what: "lists" }, b.tok)).lists.movie[0];
  assert.equal(shared.shared, "가");
  assert.ok(!shared.id.includes(a.code));
  assert.equal(shared.review, "수정");
  await call({ action: "setPub", list: "movie", id: "x", on: true }, a.tok);
  const house = (await call({ what: "house", name: "가" }, b.tok)).house;
  assert.deepEqual(house.items.movie, [
    { id: "x", title: "가상 영화", review: "수정" },
  ]);
  await call({ ...save, item: { id: "b", title: "가상 영화" } }, b.tok);
  assert.equal(
    (await call({ what: "lists" }, b.tok)).lists.movie[0].others[0].name,
    "가",
  );
  await call({ action: "friendRemove", name: "가" }, b.tok);
  assert.equal(
    (await request({ what: "house", name: "가" }, b.tok)).ok,
    false,
  );
  await call(
    { ...save, item: { id: "o", title: "주인 테스트", with: "나" } },
    bridge,
  );
  assert.equal(
    (await call({ what: "lists" }, b.tok)).lists.movie.find((x) => x.shared)
      ?.shared,
    "테스트주인",
  );
  await call({ action: "setHouse", icon: "book", intro: "가짜 소개" }, b.tok);
  assert.equal((await call({ what: "me" }, b.tok)).social.house.icon, "book");
  await call({ action: "setName", name: "라" }, outsider.tok);
  assert.match((await call(login("라", first))).token, /^sf\./);
  await call(
    { action: "report", text: "가짜 제보", ver: "test", ua: "test" },
    outsider.tok,
  );
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM reports").first()).n,
    1,
  );
  await call({ action: "setPub", list: "movie", id: "x", on: false }, a.tok);
  assert.equal(
    (await call({ what: "house", name: "가" }, bridge)).house.items.movie
      .length,
    0,
  );
  await call(
    {
      action: "bulk",
      ops: [save, { action: "listDelete", list: "movie", id: "x" }],
    },
    outsider.tok,
  );
  const habitId = "hdeadbeef";
  await call({ action: "habitAdd", habitId, name: "테스트" }, a.tok);
  for (let i = 0; i < 2; i++)
    await call(
      { action: "habitCheck", habitId, done: true, stamp: "20260101" },
      a.tok,
    );
  assert.deepEqual((await call({ what: "habits" }, a.tok)).habits[0].done, [
    20260101,
  ]);
  await call({ action: "habitDelete", habitId }, a.tok);
  assert.deepEqual((await call({ what: "habits" }, a.tok)).habits, []);
  assert.equal(
    (
      await request(
        { action: "bulk", ops: [save, { action: "save" }] },
        outsider.tok,
      )
    ).ok,
    false,
  );
  assert.equal(
    (await call({ what: "lists" }, outsider.tok)).lists.movie.length,
    0,
  );
  await call({ action: "uninvite", code: a.code }, bridge);
  assert.equal(
    (await request({ action: "redeem", invite: a.invite })).ok,
    false,
  );
  assert.equal((await request({ what: "me" }, a.tok)).ok, false);
  for (let i = 0; i < 10; i++)
    assert.equal((await request(login("나", password))).ok, false);
  assert.match((await request(login("나", first))).error, /10분/);
  {
  // ── 2단계 가계부 (주인 전용): 시트 → D1 옮기기 → 켜기 → 읽기·쓰기·반복·문자·요약·백업. 값은 전부 가짜 ──
  const ownerT = "so." + randomUUID();
  await call({ action: "ownerSession", hash: createHash("sha256").update(ownerT).digest("hex"), expires: 2e9 }, bridge);
  const kstDay = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), mon = kstDay.slice(0, 7);
  const ymAdd = (m, k) => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + k, 1)); return d.toISOString().slice(0, 7); };
  const meta = { cats: [["식비", "외식"], ["식비", "배달"], ["기타", "미분류"], ["수입", "급여"]], payments: [["샘플 현대카드", "카드"], ["가짜통장", "현금·계좌"]],
    rules: [["가나다", "지출", "식비", "외식"]], budgets: { 식비: 500000 }, budgetMajors: ["식비", "기타"],
    recurring: [{ id: "r1", content: "가짜 구독", type: "지출", major: "기타", minor: "", pay: "가짜통장", amount: 9900, day: 1, start: ymAdd(mon, -1), end: "", done: ymAdd(mon, -2) }],
    cards: [{ name: "현대카드", match: "현대", goal: 300000 }] };
  const rowsIn = [
    { id: "t1", date: ymAdd(mon, -3) + "-05", time: "", type: "지출", major: "식비", minor: "외식", content: "가짜식당", pay: "샘플 현대카드", amount: 120000, memo: "", orig: "원본", inst: 3, seq: 1 },
    { id: "t2", date: mon + "-01", time: "09:00", type: "수입", major: "수입", minor: "급여", content: "가짜급여", pay: "가짜통장", amount: 1000000, memo: "", orig: "", inst: 0, seq: 2 },
  ];
  assert.equal((await request({ what: "ledger" }, ownerT)).ok, false, "not readable before the switch");
  assert.equal((await request({ action: "ledgerImport", reset: true, rows: rowsIn, meta }, ownerT)).ok, false, "only the Sheet can import");
  await call({ action: "ledgerImport", reset: true, rows: rowsIn.slice(0, 1), meta }, bridge);
  await call({ action: "ledgerImport", rows: rowsIn.slice(1) }, bridge);
  assert.deepEqual(await call({ action: "ledgerVerify" }, bridge), { ok: true, count: 2, sum: 1120000 });
  await call({ action: "ledgerActivate" }, bridge);
  assert.equal((await request({ action: "ledgerImport", reset: true, rows: [] }, bridge)).ok, false, "never re-imported over live data");
  // 친구·로그아웃한 출입증·아무것도 없이: 가계부 못 봄
  for (const t of [a.tok, b.tok, "so.fake", undefined]) {
    assert.equal((await request({ what: "ledger" }, t)).ok, false, "friends never see the ledger");
    assert.equal((await request({ what: "summary" }, t)).ok, false);
    assert.equal((await request({ action: "save", item: { id: "x", date: kstDay, type: "지출", major: "식비", amount: 1 } }, t)).ok, false);
  }
  // 주인: 읽기 (결제유형·할부 회차는 시트 수식과 같게 계산, 반복 거래는 지난달·이번 달 생성)
  let L = await call({ what: "ledger" }, ownerT);
  const t1 = L.items.find((x) => x.id === "t1");
  assert.equal(t1.payType, "카드"); assert.equal(t1.instState, "완료"); assert.equal(t1.inst, 3);
  assert.deepEqual(L.items.filter((x) => x.id.startsWith("rec-")).map((x) => x.id), ["rec-r1-" + ymAdd(mon, -1), "rec-r1-" + mon]);
  assert.equal(L.meta.recurring[0].done, mon);
  const own = (x) => !x.id.startsWith("sms:"); assert.equal(L.items.filter(own).length, 4); assert.equal(L.full, true);
  // since: 그 전은 지문만, 같으면 그대로
  const since = ymAdd(mon, -1) + "-01";
  const part = await call({ what: "ledger", since }, ownerT);
  assert.equal(part.full, false); assert.ok(part.items.every((x) => x.date >= since)); assert.match(part.old.h, /^d1:1:120000:/);
  // 쓰기: 저장(새·수정), 삭제, 예산, 카드 실적, 반복
  const item = { id: "n1", date: kstDay, time: "12:30", type: "지출", major: "식비", minor: "배달", content: "=수식 아님", pay: "샘플 현대카드", amount: "15,000", memo: "" };
  await call({ action: "save", item }, ownerT);
  await call({ action: "save", item: { ...item, amount: 16000 } }, ownerT);
  assert.equal((await request({ action: "save", item: { ...item, amount: 0 } }, ownerT)).error, "입력값 오류");
  L = await call({ what: "ledger" }, ownerT);
  assert.equal(L.items.at(-1).id, "n1"); assert.equal(L.items.at(-1).amount, 16000); assert.equal(L.items.filter(own).length, 5);
  const fp0 = (await call({ what: "ledger", since }, ownerT)).old.h;
  await call({ action: "save", item: { ...rowsIn[0], amount: 130000 } }, ownerT);
  assert.notEqual((await call({ what: "ledger", since }, ownerT)).old.h, fp0, "editing an old row changes the fingerprint");
  assert.equal((await db.prepare("SELECT orig FROM ledger_tx WHERE id='t1'").first()).orig, "원본", "app saves keep 원본분류");
  await call({ action: "budget", major: "식비", amount: 450000 }, ownerT);
  assert.equal((await request({ action: "budget", major: "없는분류", amount: 1 }, ownerT)).ok, false);
  await call({ action: "cardGoal", name: "현대카드", goal: 350000 }, ownerT);
  await call({ action: "recSave", rule: { id: "r2", content: "가짜 월세", type: "이체", major: "기타", minor: "", pay: "가짜통장", amount: 500000, day: 31, start: mon } }, ownerT);
  L = await call({ what: "ledger" }, ownerT);
  assert.equal(L.meta.budgets.식비, 450000); assert.equal(L.meta.cards[0].goal, 350000);
  assert.equal(L.items.some((x) => x.id === "rec-r2-" + mon), kstDay.slice(8) === String(new Date(Date.UTC(+mon.slice(0, 4), +mon.slice(5, 7), 0)).getUTCDate()), "day 31 → last day of month only once it comes");
  await call({ action: "recDelete", id: "r2" }, ownerT);
  await call({ action: "delete", id: "n1" }, ownerT);
  assert.equal((await call({ what: "ledger" }, ownerT)).items.some((x) => x.id === "n1"), false);
  // 카드 문자: 켜진 뒤엔 바로 거래로 (시트 smsPull은 빈 목록 → 두 번 안 적힘), 취소는 「 취소」
  const smsIn = `[Web발신]\n현대 M 승인\n홍*동\n8,800원 일시불\n${mon.slice(5)}/${kstDay.slice(8)} 08:10\n가나다김밥\n누적1원`;
  const h1 = await hook(smsIn); assert.equal(h1.saved, true);
  assert.deepEqual((await call({ action: "smsPull" }, bridge)).items, [], "the Sheet does not also write it");
  L = await call({ what: "ledger" }, ownerT);
  const sx = L.items.find((x) => x.id === h1.id);
  assert.deepEqual([sx.pay, sx.major, sx.minor, sx.content, sx.amount, sx.memo], ["샘플 현대카드", "식비", "외식", "가나다김밥", 8800, "문자 자동"]);
  const h2 = await hook(smsIn.replace("승인", "승인취소"));
  assert.equal((await call({ what: "ledger" }, ownerT)).items.find((x) => x.id === h2.id).content, "가나다김밥 취소");
  assert.equal((await hook(smsIn)).duplicate, true);
  // 위젯 요약
  const sm = await call({ what: "summary" }, ownerT);
  assert.equal(sm.cards[0].name, "현대카드"); assert.equal(sm.budget, 450000);
  // 시트 백업: 바뀐 게 없으면 줄을 안 보냄
  const ex = await call({ what: "ledgerExport" }, bridge);
  assert.ok(ex.rows.length >= 5 && ex.rows[0].id === "t1" && ex.rows[0].orig === "원본");
  assert.equal((await call({ what: "ledgerExport", ver: ex.ver }, bridge)).same, true);
  assert.equal((await request({ what: "ledgerExport" }, ownerT)).ok, false, "export is for the Sheet only");
  // 되돌리기: 끄면 주인도 못 읽고(시트가 다시 원본), 문자는 다시 시트가 가져감
  await call({ action: "ledgerDeactivate" }, bridge);
  assert.match((await request({ what: "ledger" }, ownerT)).error, /옮기는 중/);
  await call({ action: "ledgerActivate" }, bridge);
  }
  console.log("WORKER OK");
} finally {
  await mf.dispose();
}
