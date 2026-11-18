import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { convert, stage } from "../migration/stage.mjs";

const schema = await readFile(
  new URL("../worker/migrations/0001_friends.sql", import.meta.url),
  "utf8",
);
const db = new DatabaseSync(":memory:");
db.exec(schema);
const query = async (sql, args = []) => db.prepare(sql).all(...args);
const code = randomUUID(),
  proof = createHash("sha256").update(randomUUID()).digest("base64");
const input = {
  owner: "테스트주인",
  accounts: [["가상친구", code, "test", randomUUID(), proof]],
  records: [
    [code, "book", "item", '{"id":"item","title":"가상 책"}', "test"],
    ["closed", "book", "old", "{}", "test"],
  ],
  projection: [["movie", "projected", { id: "projected", title: "가상 영화" }]],
  publications: [[code, "book", "item"]],
  relations: [],
  houses: [[code, "test", "소개"]],
  habits: [
    [code, "test", "습관", "t", "#aaaaaa", "[20260101,20260102]", "test"],
  ],
  reports: [["test", "친구", "제보", "test", "test"]],
};
const tables = convert(input, randomUUID());
const counts = await stage(query, tables, schema);
assert.equal(counts.accounts, 2);
assert.equal(counts.records, 2);
assert.equal(counts.habit_days, 2);
assert.equal(counts.archived, 1);
assert.equal((await query("SELECT * FROM accounts")).length, 0);
assert.deepEqual(counts, await stage(query, tables, schema));
assert.equal((await query("SELECT * FROM stage_verified")).length, 1);
await assert.rejects(
  stage(
    async (sql, args) => {
      const rows = await query(sql, args);
      if (
        sql.startsWith("SELECT rowid AS scan_id") &&
        sql.includes("FROM stage_reports") &&
        rows.length
      )
        rows[0].text = "손상";
      return rows;
    },
    tables,
    schema,
  ),
);
assert.equal((await query("SELECT * FROM stage_verified")).length, 0);
db.close();
console.log("MIGRATION OK");

// Exercise the temporary Apps Script entry point without Google or Cloudflare credentials.
const { runInNewContext } = await import("node:vm");
const { Script } = await import("node:vm");
const proofValue = randomUUID(),
  ownerToken = randomUUID();
const helper = (
  await readFile(new URL("../migration/export.gs", import.meta.url), "utf8")
)
  .replace("__EXPIRY__", String(Date.now() + 60000))
  .replace(
    "__PROOF_HASH__",
    createHash("sha256").update(proofValue).digest("base64"),
  );
new Script(helper);
const ctx = {
  authOk_: (value) => value === ownerToken,
  out_: (value) => value,
  withLock_: (fn) => fn(),
  Utilities: {
    DigestAlgorithm: { SHA_256: 1 },
    computeDigest: (_, v) => createHash("sha256").update(v).digest(),
    base64Encode: (v) => v.toString("base64"),
  },
  exportSheet_: () => ({
    getSheetByName: (name) => name,
    getSpreadsheetTimeZone: () => "UTC",
  }),
  FRIEND_TAB_: "accounts",
  PUB_TAB_: "pub",
  FHAB_TAB_: "habits",
  FREC_TAB_: "records",
  REL_TAB_: "relations",
  HOUSE_TAB_: "houses",
  ownerName_: () => "테스트",
  LISTS: { movie: { tab: "movie" } },
  body_: (name) =>
    ({ accounts: [["가", code]], pub: [["owner", "movie", "public"]] })[name] ||
    [],
  tagged_: (item, name) => item.with === name,
};
runInNewContext(helper, ctx);
ctx.exportListRead_ = () => [
  { id: "public", cost: 1, quotes: ["a"], with: "" },
  { id: "tag", with: "가" },
  { id: "private" },
];
const exportWith = (token, proof) =>
  ctx.exportFriendsOnce_({
    postData: { contents: JSON.stringify({ token, proof }) },
  });
assert.equal(exportWith(ownerToken, "").ok, false);
assert.equal(exportWith("", proofValue).ok, false);
assert.equal(
  JSON.stringify(exportWith(ownerToken, proofValue).projection),
  JSON.stringify([
    ["movie", "public", { id: "public" }],
    ["movie", "tag", { id: "tag", with: "가" }],
  ]),
);
console.log("EXPORT OK");
