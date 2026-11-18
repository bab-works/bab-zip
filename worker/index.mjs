const titles = new Map(
  Object.entries({
    book: "title",
    buy: "title",
    wish: "title",
    escape: "theme",
    board: "name",
    movie: "title",
    play: "title",
    escapeWant: "theme",
    boardWant: "name",
    movieWant: "title",
    playWant: "title",
  }),
);
const owner = "owner";
const separator = /[,·、/&+\s]+/;
class InputError extends Error {}
function check(ok, message = "입력값 오류") {
  if (!ok) throw new InputError(message);
}
const clip = (v, n) => String(v ?? "").slice(0, n);
async function hash(code, pw) {
  const bytes = new TextEncoder().encode(code + ":" + pw);
  return btoa(
    String.fromCharCode(
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    ),
  );
}
const friendsQuery = `SELECT a.id,a.name,coalesce(h.icon,'') icon,coalesce(h.intro,'') intro
 FROM accounts a LEFT JOIN houses h ON h.person=a.id
 WHERE a.id<>?1 AND (a.id='owner' OR ?1='owner' OR EXISTS
 (SELECT 1 FROM relations r WHERE r.accepted AND ((r.sender=?1 AND r.recipient=a.id) OR (r.recipient=?1 AND r.sender=a.id))))`;

async function dispatch(env, b, authorization) {
  const sql = (s, ...args) => env.DB.prepare(s).bind(...args);
  const rows = async (s, ...args) => (await sql(s, ...args).all()).results;
  const now = Math.floor(Date.now() / 1000);
  const action = b.action;
  if (action === "login") {
    const denied = "아이디 또는 비밀번호가 맞지 않아요";
    const a = await sql(
      "SELECT id,name,code,pw FROM accounts WHERE name=? AND id<>'owner'",
      clip(b.name, 200).trim(),
    ).first();
    check(
      a && typeof b.password === "string" && b.password.length <= 1000,
      denied,
    );
    // Reserve an attempt atomically so concurrent guesses cannot all pass the limit.
    const attempt = await sql(
      `INSERT INTO login_limits VALUES (?,1,?)
      ON CONFLICT(person) DO UPDATE SET failures=CASE WHEN expires<=? THEN 1 ELSE failures+1 END,expires=excluded.expires
      WHERE expires<=? OR failures<10 RETURNING failures`,
      a.id,
      now + 600,
      now,
      now,
    ).first();
    check(attempt, "너무 많이 틀렸어요 · 10분 뒤에 다시 해 주세요");
    check((await hash(a.code, b.password)) === a.pw, denied);
    await sql("DELETE FROM login_limits WHERE person=?", a.id).run();
    return { role: "friend", name: a.name, token: a.code };
  }
  if (action === "redeem") {
    const a = await sql(
      "SELECT name,code,pw FROM accounts WHERE invite=? AND id<>'owner'",
      String(b.invite || ""),
    ).first();
    check(a, "초대 링크가 맞지 않거나 취소됐어요");
    return { role: "friend", name: a.name, token: a.code, hasPassword: !!a.pw };
  }
  // Apps Script authenticates the owner before making a server-to-server request.
  const service =
    !!env.BRIDGE_SECRET && authorization === "Bearer " + env.BRIDGE_SECRET;
  const me = service
    ? await sql("SELECT id,name FROM accounts WHERE id='owner'").first()
    : await sql(
        "SELECT id,name FROM accounts WHERE code=?",
        String(b.token || ""),
      ).first();
  check(me, "로그인이 필요해요");
  const id = me.id;
  const network = () => rows(friendsQuery, id);
  async function social() {
    const friends = await network();
    const pending = await rows(
      `SELECT r.sender,r.recipient,a.name FROM relations r JOIN accounts a
      ON a.id=CASE WHEN r.sender=?1 THEN r.recipient ELSE r.sender END
      WHERE (r.sender=?1 OR r.recipient=?1) AND NOT r.accepted`,
      id,
    );
    return {
      friends: friends.map(({ name, icon, intro }) => ({ name, icon, intro })),
      incoming: pending.filter((r) => r.recipient === id).map((r) => r.name),
      outgoing: pending.filter((r) => r.sender === id).map((r) => r.name),
      house:
        (await sql(
          "SELECT icon,intro FROM houses WHERE person=?",
          id,
        ).first()) || {},
      ownerName:
        (await sql("SELECT name FROM accounts WHERE id='owner'").first())
          ?.name || "",
    };
  }
  if (!action) {
    if (b.what === "me") {
      const s = await social();
      return {
        role: service ? owner : "friend",
        name: me.name,
        social: s,
        people: [me.name, ...s.friends.map((f) => f.name)],
        friends: service
          ? await rows(
              "SELECT name,code,invite FROM accounts WHERE id<>'owner'",
            )
          : undefined,
      };
    }
    if (b.what === "house") {
      const target = (await network()).find((f) => f.name === b.name);
      check(target, "친구가 된 사람의 집만 놀러 갈 수 있어요");
      const items = Object.fromEntries(
        [...titles.keys()].filter((k) => k !== "wish").map((k) => [k, []]),
      );
      const publicRows = await rows(
        `SELECT r.list,r.item FROM records r JOIN publications p USING(person,list,id)
        WHERE r.person IN (SELECT id FROM (${friendsQuery}) WHERE name=?2)`,
        id,
        target.name,
      );
      for (const row of publicRows) {
        const {
          with: companions,
          cost,
          quotes,
          ...item
        } = JSON.parse(row.item);
        items[row.list]?.push(item);
      }
      return {
        house: {
          name: target.name,
          icon: target.icon,
          intro: target.intro,
          items,
        },
      };
    }
    if (b.what === "lists") {
      const lists = Object.fromEntries([...titles.keys()].map((k) => [k, []]));
      for (const r of await rows(
        "SELECT r.list,r.item,p.id published FROM records r LEFT JOIN publications p USING(person,list,id) WHERE r.person=?",
        id,
      )) {
        const item = JSON.parse(r.item);
        if (r.published) item.pub = true;
        lists[r.list].push(item);
      }
      const tagged = await rows(
        `SELECT r.*,f.name FROM records r JOIN (${friendsQuery}) f ON r.person=f.id
        WHERE instr(json_extract(r.item,'$.with'),?2)>0 ORDER BY (f.id='owner') DESC,r.rowid`,
        id,
        me.name,
      );
      for (const r of tagged) {
        const item = JSON.parse(r.item);
        if (
          !String(item.with || "")
            .split(separator)
            .includes(me.name)
        )
          continue;
        const key = titles.get(r.list),
          norm = (v) =>
            String(v || "")
              .replace(/\s+/g, "")
              .toLowerCase();
        const hit = lists[r.list].find(
          (it) =>
            norm(it[key]) &&
            norm(it[key]) === norm(item[key]) &&
            (r.list !== "board" ||
              !it.date ||
              !item.date ||
              it.date === item.date),
        );
        if (hit)
          (hit.others ||= []).push({
            name: r.name,
            rating: item.rating || item.stars || "",
            review: item.review || "",
          });
        else
          lists[r.list].push({
            ...item,
            id: "s:" + r.person + ":" + r.id,
            shared: r.name,
          });
      }
      return {
        lists,
        people: [me.name, ...(await network()).map((f) => f.name)],
      };
    }
    check(b.what === "habits" && !service);
    const habits = await rows(
      `SELECT h.id,h.name,h.icon,h.color,
      (SELECT json_group_array(stamp ORDER BY stamp) FROM habit_days d WHERE d.person=h.person AND d.id=h.id) days
      FROM habits h WHERE h.person=?`,
      id,
    );
    return {
      habits: habits.map(({ days, ...h }) => {
        const done = JSON.parse(days);
        return {
          ...h,
          done,
          total: done.length,
          rule: "RRULE:FREQ=DAILY",
          enc: "",
          local: true,
        };
      }),
    };
  }
  const wrote = { wrote: true };
  if (action === "invite" || action === "setName") {
    const name = clip(String(b.name || "").trim(), 20);
    check(name && !separator.test(name));
    if (action === "invite") check(service);
    check(
      !(await sql(
        "SELECT id FROM accounts WHERE name=? AND id<>?",
        name,
        action === "invite" ? "" : id,
      ).first()),
      "이미 있는 이름이에요",
    );
    if (action === "setName") {
      await sql("UPDATE accounts SET name=? WHERE id=?", name, id).run();
      return { ...wrote, name };
    }
    const random = () => crypto.randomUUID().replaceAll("-", "");
    const code = "f" + random().slice(0, 11),
      invite = "i" + random().slice(0, 9);
    check(env.FIRST_PASSWORD, "초대 설정이 필요해요");
    await sql(
      "INSERT INTO accounts(id,name,code,invite,pw) VALUES(?,?,?,?,?)",
      random(),
      name,
      code,
      invite,
      await hash(code, env.FIRST_PASSWORD),
    ).run();
    return { ...wrote, code, invite };
  }
  if (action === "uninvite") {
    check(service);
    await sql("DELETE FROM accounts WHERE code=?", String(b.code || "")).run();
  } else if (action === "setPassword") {
    check(
      !service &&
        typeof b.password === "string" &&
        b.password.length >= 4 &&
        b.password.length <= 40,
    );
    await sql(
      "UPDATE accounts SET pw=? WHERE id=?",
      await hash(b.token, b.password),
      id,
    ).run();
    return { ...wrote, token: b.token };
  } else if (
    ["friendRequest", "friendAccept", "friendRemove"].includes(action)
  ) {
    const target = await sql(
      "SELECT id FROM accounts WHERE name=?",
      String(b.name || "").trim(),
    ).first();
    check(target && target.id !== id);
    if (!service && target.id !== owner) {
      const t = target.id;
      if (action === "friendRemove")
        await sql(
          "DELETE FROM relations WHERE (sender=?1 AND recipient=?2) OR (sender=?2 AND recipient=?1)",
          id,
          t,
        ).run();
      else if (action === "friendAccept") {
        check(
          await sql(
            "UPDATE relations SET accepted=1 WHERE (sender=? AND recipient=?) OR (accepted AND sender=? AND recipient=?) RETURNING accepted",
            t,
            id,
            id,
            t,
          ).first(),
          "받은 친구 신청이 없어요",
        );
      } else
        await sql(
          `INSERT INTO relations(sender,recipient) VALUES(?,?) ON CONFLICT DO UPDATE SET
        accepted=(relations.accepted OR relations.sender=excluded.recipient)`,
          id,
          t,
        ).run();
    }
    return { ...wrote, social: await social() };
  } else if (action === "setHouse") {
    await sql(
      "INSERT OR REPLACE INTO houses VALUES(?,?,?)",
      id,
      clip(b.icon, 100)
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 8),
      clip(b.intro, 60),
    ).run();
  } else if (action === "report") {
    const msg = clip(String(b.text || "").trim(), 1000);
    check(msg);
    await sql(
      "INSERT INTO reports(name,text,ver,ua) VALUES(?,?,?,?)",
      me.name,
      msg,
      clip(b.ver, 20),
      clip(b.ua, 120),
    ).run();
  } else if (action === "setPub") {
    const ids = [...new Set(Array.isArray(b.ids) ? b.ids : [b.id])];
    check(
      titles.has(b.list) &&
        ids.length &&
        ids.length <= 2000 &&
        ids.every(validId),
    );
    const q = b.on
      ? "INSERT OR IGNORE INTO publications SELECT ?,?,value FROM json_each(?)"
      : "DELETE FROM publications WHERE person=? AND list=? AND id IN (SELECT value FROM json_each(?))";
    await sql(q, id, b.list, JSON.stringify(ids)).run();
  } else if (["bulk", "listSave", "listDelete"].includes(action)) {
    const ops = action === "bulk" ? b.ops : [b];
    check(Array.isArray(ops) && ops.length && ops.length <= 300);
    const statements = ops.map((o) => {
      check(o && titles.has(o.list));
      if (o.action === "listDelete") {
        check(validId(o.id));
        return sql(
          "DELETE FROM records WHERE person=? AND list=? AND id=?",
          id,
          o.list,
          o.id,
        );
      }
      check(o.action === "listSave" && validId(o.item?.id));
      const item = { ...o.item };
      for (const key of ["shared", "pub", "others"]) delete item[key];
      // json_set keeps explicit nulls and replaces arrays/objects as whole fields like Object.assign.
      const data = JSON.stringify(item);
      check(
        data.length <= 45000 &&
          Object.keys(item).every((k) => /^[A-Za-z][A-Za-z0-9_]*$/.test(k)),
      );
      const fields = Object.keys(item)
        .map((k) => "'$." + k + "',excluded.item->'$." + k + "'")
        .join(",");
      return sql(
        "INSERT INTO records(person,list,id,item) VALUES(?,?,?,?) ON CONFLICT(person,list,id) DO UPDATE SET updated=CURRENT_TIMESTAMP,item=json_set(records.item," +
          fields +
          ")",
        id,
        o.list,
        item.id,
        data,
      );
    });
    await env.DB.batch(statements);
  } else if (["habitAdd", "habitCheck", "habitDelete"].includes(action)) {
    check(!service && /^h[0-9a-f-]{8,40}$/.test(b.habitId));
    if (action === "habitAdd") {
      const name = clip(String(b.name || "").trim(), 40);
      check(name);
      await sql(
        "INSERT OR IGNORE INTO habits(person,id,name,icon,color) VALUES(?,?,?,?,?)",
        id,
        b.habitId,
        name,
        clip(b.icon || "⭐", 4),
        /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : "#3182f6",
      ).run();
    } else {
      check(
        await sql(
          "SELECT id FROM habits WHERE person=? AND id=?",
          id,
          b.habitId,
        ).first(),
        "없는 습관이에요",
      );
      if (action === "habitDelete")
        await sql(
          "DELETE FROM habits WHERE person=? AND id=?",
          id,
          b.habitId,
        ).run();
      else {
        check(/^\d{8}$/.test(b.stamp));
        await sql(
          b.done
            ? "INSERT OR IGNORE INTO habit_days VALUES(?,?,?)"
            : "DELETE FROM habit_days WHERE person=? AND id=? AND stamp=?",
          id,
          b.habitId,
          Number(b.stamp),
        ).run();
      }
    }
  } else check(false, "지원하지 않는 요청이에요");
  return wrote;
}
function validId(v) {
  return typeof v === "string" && v.length > 0 && !v.startsWith("s:");
}

export default {
  async fetch(request, env) {
    const headers = {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "https://bab-works.github.io",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    try {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        await env.DB.prepare("SELECT id FROM accounts LIMIT 1").first();
        return Response.json({ ok: true }, { headers });
      }
      check(url.pathname === "/" && ["GET", "POST"].includes(request.method));
      const b =
        request.method === "POST"
          ? await request.json()
          : Object.fromEntries(url.searchParams);
      check(
        b && typeof b === "object" && (request.method === "POST" || !b.action),
      );
      // Tokens for new requests travel in headers or POST bodies, never in URLs.
      check(!url.searchParams.has("token"));
      const authorization = request.headers.get("Authorization") || "";
      if (authorization.startsWith("Bearer ")) b.token = authorization.slice(7);
      return Response.json(
        { ok: true, ...(await dispatch(env, b, authorization)) },
        { headers },
      );
    } catch (e) {
      // D1 errors may include private values. Only expose our own input messages.
      const constraint = /(?:UNIQUE|CHECK|FOREIGN KEY) constraint failed/i.test(
        String(e?.cause?.message || e?.message),
      );
      const invalid =
        e instanceof InputError || e instanceof SyntaxError || constraint;
      return Response.json(
        {
          ok: false,
          error:
            !(e instanceof InputError) && invalid
              ? "입력값 오류"
              : invalid
                ? e.message
                : "잠시 후 다시 시도해 주세요",
          ...(!invalid && { retry: true }),
        },
        { headers },
      );
    }
  },
};
