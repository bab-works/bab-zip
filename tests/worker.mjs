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
  bindings: { BRIDGE_SECRET: bridge, FIRST_PASSWORD: first },
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
  await db
    .prepare("INSERT INTO accounts(id,name) VALUES('owner','테스트주인')")
    .run();
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
  const invite = (name) => call({ action: "invite", name }, bridge);
  const a = await invite("가"),
    b = await invite("나"),
    outsider = await invite("다");
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
