import { createHmac, createHash } from "node:crypto";

export const columns = {
  accounts: "id name code invite pw created",
  records: "person list id item updated",
  publications: "person list id",
  relations: "sender recipient accepted created",
  houses: "person icon intro",
  habits: "person id name icon color created",
  habit_days: "person id stamp",
  reports: "id created name text ver ua",
  archived: "kind seq original",
};
const text = (x) => String(x ?? "");
export class MigrationError extends Error {}
function requireValue(ok, label) {
  if (!ok) throw new MigrationError(label);
}

export function convert(s, key) {
  const tables = Object.fromEntries(Object.keys(columns).map((k) => [k, []]));
  const ids = new Map([["owner", "owner"]]);
  tables.accounts.push(["owner", text(s.owner), null, null, null, ""]);
  for (const [name, code, created, invite, pw] of s.accounts) {
    requireValue(
      name &&
        code &&
        code !== "owner" &&
        !ids.has(code) &&
        invite &&
        /^[A-Za-z0-9+/]{43}=$/.test(pw),
      "친구 계정 형식 확인 필요",
    );
    const id = createHmac("sha256", key)
      .update("friend-id:" + code)
      .digest("hex");
    ids.set(code, id);
    tables.accounts.push([
      id,
      text(name).trim(),
      code,
      invite,
      pw,
      text(created),
    ]);
  }
  // Sheets keeps dependent rows when an invite is revoked. Preserve those rows without restoring access.
  function visit(kind, keys, fn) {
    s[kind].forEach((row, i) => {
      if (keys.some((k) => !ids.has(row[k])))
        tables.archived.push([kind, i + 1, JSON.stringify(row)]);
      else fn(row);
    });
  }
  visit("records", [0], ([code, list, id, raw, updated]) => {
    const item = JSON.parse(raw);
    requireValue(
      item && text(item.id) === text(id) && id,
      "친구 기록 ID 확인 필요",
    );
    tables.records.push([
      ids.get(code),
      list,
      text(id),
      JSON.stringify(item),
      text(updated),
    ]);
  });
  for (const [list, id, item] of s.projection)
    tables.records.push(["owner", list, id, JSON.stringify(item), ""]);
  visit("publications", [0], ([code, list, id]) =>
    tables.publications.push([ids.get(code), list, text(id)]),
  );
  visit("relations", [0, 1], ([a, b, status, date]) => {
    requireValue(
      status === "친구" || status === "요청",
      "친구 관계 상태 확인 필요",
    );
    tables.relations.push([
      ids.get(a),
      ids.get(b),
      Number(status === "친구"),
      text(date),
    ]);
  });
  visit("houses", [0], ([code, icon, intro]) =>
    tables.houses.push([ids.get(code), text(icon), text(intro)]),
  );
  visit("habits", [0], ([code, id, name, icon, color, raw, created]) => {
    tables.habits.push([
      ids.get(code),
      text(id),
      text(name),
      text(icon),
      text(color),
      text(created),
    ]);
    const days = JSON.parse(raw || "[]");
    requireValue(Array.isArray(days), "친구 습관 형식 확인 필요");
    for (const day of days) {
      requireValue(/^\d{8}$/.test(day), "친구 습관 날짜 확인 필요");
      tables.habit_days.push([ids.get(code), text(id), Number(day)]);
    }
  });
  s.reports.forEach(([date, name, msg, ver, ua], i) =>
    tables.reports.push([
      i + 1,
      text(date),
      text(name),
      text(msg),
      text(ver),
      text(ua),
    ]),
  );
  return tables;
}

function digest(row) {
  return createHash("sha256").update(JSON.stringify(row)).digest("hex");
}
export async function stage(query, tables, schema) {
  const names = Object.keys(columns);
  // Stage separately while the app still writes to Sheets. Only the migration owns these tables.
  for (const name of names.slice(0, -1)) {
    const [count] = await query("SELECT count(*) n FROM " + name);
    requireValue(count.n === 0, "운영 D1에 이미 데이터가 있어 중단");
  }
  const staged = schema
    .replace(/^--.*$/gm, "")
    .replace(
      /\b(accounts|records|publications|relations|houses|habits|habit_days|reports|login_limits|relation_pair)\b/g,
      "stage_$1",
    )
    .replace(/CREATE TABLE /g, "CREATE TABLE IF NOT EXISTS ")
    .replace(/CREATE UNIQUE INDEX /g, "CREATE UNIQUE INDEX IF NOT EXISTS ");
  for (const ddl of staged.split(";").filter((s) => s.trim())) await query(ddl);
  await query(
    "CREATE TABLE IF NOT EXISTS stage_archived(kind TEXT,seq INTEGER,original TEXT,PRIMARY KEY(kind,seq))",
  );
  await query(
    "CREATE TABLE IF NOT EXISTS stage_verified(id INTEGER PRIMARY KEY CHECK(id=1), verified_at TEXT)",
  );
  await query("DELETE FROM stage_verified");
  for (const name of [...names].reverse())
    await query("DELETE FROM stage_" + name);
  const counts = {};
  for (const name of names) {
    const fields = columns[name].split(" "),
      rows = tables[name];
    const sql =
      "INSERT INTO stage_" +
      name +
      "(" +
      fields.join(",") +
      ") SELECT " +
      fields.map((_, i) => "json_extract(value,'$[" + i + "]')").join(",") +
      " FROM json_each(?)";
    // Stay below the D1 bound-value size limit even for mixed-language text.
    let chunk = [],
      bytes = 2;
    for (const row of rows) {
      const size = Buffer.byteLength(JSON.stringify(row)) + 1;
      requireValue(size < 1_000_000, "단일 행이 D1 전송 한도 초과");
      if (chunk.length && bytes + size > 500_000) {
        await query(sql, [JSON.stringify(chunk)]);
        chunk = [];
        bytes = 2;
      }
      chunk.push(row);
      bytes += size;
    }
    if (chunk.length) await query(sql, [JSON.stringify(chunk)]);
    const [count] = await query("SELECT count(*) n FROM stage_" + name);
    requireValue(count.n === rows.length, "개수 불일치: " + name);
    const expected = rows.map(digest).sort(),
      actual = [];
    let cursor = 0;
    while (actual.length < count.n) {
      const page = await query(
        "SELECT rowid AS scan_id," +
          fields.join(",") +
          " FROM stage_" +
          name +
          " WHERE rowid>? ORDER BY rowid LIMIT 50",
        [cursor],
      );
      requireValue(page.length, "검증 페이지 누락");
      for (const r of page) actual.push(digest(fields.map((f) => r[f])));
      cursor = page.at(-1).scan_id;
    }
    requireValue(sameHashes(expected, actual), "내용 불일치: " + name);
    counts[name] = count.n;
  }
  await query("INSERT INTO stage_verified VALUES(1,CURRENT_TIMESTAMP)");
  return counts;
}
function sameHashes(expected, actual) {
  actual.sort();
  return (
    expected.length === actual.length &&
    expected.every((v, i) => v === actual[i])
  );
}
