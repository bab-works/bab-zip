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
    OWNER_TOKEN_SHA: createHash("sha256").update("owner-" + first).digest("hex"),
  },
  outboundService(request) {
    const url = new URL(request.url);
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
  const invite = (name) => call({ action: "invite", name }, bridge);
  const a = await invite("가"),
    b = await invite("나"),
    outsider = await invite("다");
  assert.equal(
    (await request({ what: "projectionContext" }, a.code)).ok,
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
  assert.equal((await call({ what: "lists" }, a.code)).lists.movie.length, 1);
  await call({ action: "replaceProjection", records: [] }, bridge);
  assert.equal((await call({ what: "lists" }, a.code)).lists.movie.length, 0);
  const search = { what: "movie", q: "가상" };
  assert.equal((await request(search)).ok, false);
  for (const token of [bridge, a.code]) {
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
  for (const token of [bridge, a.code]) {
    const result = await call(bookQ, token);
    assert.equal(result.source, "kakao");
    assert.deepEqual(result.books, [
      { title: "만조를 기다리며", author: "조예은", image: "https://search1.kakaocdn.net/thumb/x.jpg", publisher: "위즈덤하우스", year: "2023" },
      { title: "표지 없는 책", author: "", image: "", publisher: "", year: "" },
    ]);
  }
  // 주인: 책·영화 검색만 친구 서버로 바로 (주인 비밀번호의 SHA-256이 맞을 때), 다른 기능은 안 됨
  const ownerTok = "owner-" + first;
  assert.equal((await call({ what: "book", q: "만조", token: ownerTok })).source, "kakao");
  assert.equal((await call({ what: "movie", q: "가상", token: ownerTok })).source, "tmdb");
  assert.equal((await request({ what: "lists", token: ownerTok })).ok, false, "owner token opens searches only");
  assert.equal((await request({ what: "book", q: "만조", token: "wrong" })).ok, false);
  const login = (name, password) => ({ action: "login", name, password });
  assert.equal((await call(login("가", first))).token, a.code);
  await call({ action: "setPassword", password }, a.code);
  const stored = await db
    .prepare("SELECT pw FROM accounts WHERE code=?")
    .bind(a.code)
    .first();
  assert.equal(
    stored.pw,
    createHash("sha256")
      .update(a.code + ":" + password)
      .digest("base64"),
  );
  assert.equal((await call(login("가", password))).role, "friend");
  assert.equal(
    (await call({ action: "redeem", invite: a.invite })).token,
    a.code,
  );
  for (const body of [
    { action: "invite", name: "라" },
    { what: "summary" },
    { action: "save" },
    { what: "house", name: "나" },
  ])
    assert.equal((await request(body, a.code)).ok, false);
  await call({ action: "friendRequest", name: "나" }, a.code);
  assert.deepEqual((await call({ what: "me" }, b.code)).social.incoming, [
    "가",
  ]);
  await call({ action: "friendAccept", name: "가" }, b.code);
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
  await call(save, a.code);
  await call({ ...save, item: { id: "x", review: "수정" } }, a.code);
  assert.equal(
    (await call({ what: "lists" }, outsider.code)).lists.movie.length,
    0,
  );
  const shared = (await call({ what: "lists" }, b.code)).lists.movie[0];
  assert.equal(shared.shared, "가");
  assert.ok(!shared.id.includes(a.code));
  assert.equal(shared.review, "수정");
  await call({ action: "setPub", list: "movie", id: "x", on: true }, a.code);
  const house = (await call({ what: "house", name: "가" }, b.code)).house;
  assert.deepEqual(house.items.movie, [
    { id: "x", title: "가상 영화", review: "수정" },
  ]);
  await call({ ...save, item: { id: "b", title: "가상 영화" } }, b.code);
  assert.equal(
    (await call({ what: "lists" }, b.code)).lists.movie[0].others[0].name,
    "가",
  );
  await call({ action: "friendRemove", name: "가" }, b.code);
  assert.equal(
    (await request({ what: "house", name: "가" }, b.code)).ok,
    false,
  );
  await call(
    { ...save, item: { id: "o", title: "주인 테스트", with: "나" } },
    bridge,
  );
  assert.equal(
    (await call({ what: "lists" }, b.code)).lists.movie.find((x) => x.shared)
      ?.shared,
    "테스트주인",
  );
  await call({ action: "setHouse", icon: "book", intro: "가짜 소개" }, b.code);
  assert.equal((await call({ what: "me" }, b.code)).social.house.icon, "book");
  await call({ action: "setName", name: "라" }, outsider.code);
  assert.equal((await call(login("라", first))).token, outsider.code);
  await call(
    { action: "report", text: "가짜 제보", ver: "test", ua: "test" },
    outsider.code,
  );
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM reports").first()).n,
    1,
  );
  await call({ action: "setPub", list: "movie", id: "x", on: false }, a.code);
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
    outsider.code,
  );
  const habitId = "hdeadbeef";
  await call({ action: "habitAdd", habitId, name: "테스트" }, a.code);
  for (let i = 0; i < 2; i++)
    await call(
      { action: "habitCheck", habitId, done: true, stamp: "20260101" },
      a.code,
    );
  assert.deepEqual((await call({ what: "habits" }, a.code)).habits[0].done, [
    20260101,
  ]);
  await call({ action: "habitDelete", habitId }, a.code);
  assert.deepEqual((await call({ what: "habits" }, a.code)).habits, []);
  assert.equal(
    (
      await request(
        { action: "bulk", ops: [save, { action: "save" }] },
        outsider.code,
      )
    ).ok,
    false,
  );
  assert.equal(
    (await call({ what: "lists" }, outsider.code)).lists.movie.length,
    0,
  );
  await call({ action: "uninvite", code: a.code }, bridge);
  assert.equal(
    (await request({ action: "redeem", invite: a.invite })).ok,
    false,
  );
  assert.equal((await request({ what: "me" }, a.code)).ok, false);
  for (let i = 0; i < 10; i++)
    assert.equal((await request(login("나", password))).ok, false);
  assert.match((await request(login("나", first))).error, /10분/);
  console.log("WORKER OK");
} finally {
  await mf.dispose();
}
