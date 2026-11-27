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
const sha256hex = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");
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

async function movieSearch(env, query) {
  const url = new URL("https://api.themoviedb.org/3/search/multi");
  const q = clip(query, 80).trim();
  if (q.length < 2) return { movies: [] };
  url.search = new URLSearchParams({
    query: q,
    language: "ko-KR",
    include_adult: "false",
  });
  if (!env.TMDB_READ_TOKEN)
    throw new InputError("영화 검색 연결 설정이 필요해요");
  const response = await fetch(url, {
    headers: {
      Authorization: "Bearer " + env.TMDB_READ_TOKEN,
      Accept: "application/json",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    return {
      ok: false,
      retry: true,
      error:
        response.status === 429
          ? "영화 검색이 몰렸어요. 잠시 후 다시 검색해 주세요"
          : "영화 정보를 불러오지 못했어요",
    };
  const { results } = await response.json();
  const movies = results
    .filter(
      (r) =>
        ["movie", "tv"].includes(r.media_type) &&
        !r.adult &&
        (r.title || r.name),
    )
    .sort(
      (a, b) =>
        Number(b.media_type === "movie") - Number(a.media_type === "movie"),
    )
    .slice(0, 20)
    .map((r) => ({
      title: r.title || r.name,
      type: r.media_type === "movie" ? "영화" : "시리즈",
      year: (r.release_date || r.first_air_date || "").slice(0, 4),
      image: /^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(r.poster_path)
        ? "https://image.tmdb.org/t/p/w185" + r.poster_path
        : "",
    }));
  return { movies, source: "tmdb" };
}

// 책: 카카오 도서 검색 (REST 키 KAKAO_REST_KEY = 깃허브 비밀값 → 배포 때 Worker 비밀값). 키가 없거나 실패하면 ok:false → 시트(알라딘)가 대신 찾음
async function bookSearch(env, query) {
  const q = clip(query, 80).trim();
  if (q.length < 2) return { books: [] };
  if (!env.KAKAO_REST_KEY) return { ok: false, retry: true, error: "책 검색 연결 설정이 필요해요" };
  const url = new URL("https://dapi.kakao.com/v3/search/book");
  url.search = new URLSearchParams({ query: q, size: "20" });
  const response = await fetch(url, {
    headers: { Authorization: "KakaoAK " + env.KAKAO_REST_KEY },
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!response?.ok) return { ok: false, retry: true, error: "책 정보를 불러오지 못했어요" };
  const { documents = [] } = await response.json();
  const books = documents
    .filter((d) => d.title)
    .map((d) => ({
      title: d.title,
      author: (d.authors || []).join(", "),
      image: /^https:\/\//.test(d.thumbnail || "") ? d.thumbnail : "",
      publisher: d.publisher || "",
      year: (d.datetime || "").slice(0, 4),
    }));
  return { books, source: "kakao" };
}

// ── 카드 결제 문자 → 가계부 ──
// 단축어가 「승인」(또는 「취소」) 문자를 그대로 보내면 해석해서 sms_inbox에 저장. 시트(Apps Script)가 smsPull로 가져가 거래 탭에 씀
// 단축어 열쇠: 열쇠 자체는 저장소에 두지 않고 SHA-256만 둠 (긴 무작위 값이라 거꾸로 알아낼 수 없음). 바꾸려면 새 열쇠의 해시로 교체
const SMS_HOOK_SHA = "354b2bde9f3adf6a418e5bfce9ee0199a4e0aa9e0e66a65a560123bc668c043f";
// 카드사별 문자 모양 (롯데·현대·국민). 이름·카드번호는 쓰지 않고 날짜·시간·금액·가맹점·할부·취소만 뽑음
export function parseSms(text, now = new Date()) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l && !/^\[?Web발신\]?$/.test(l) && l !== "제목없음");
  const t = lines.join("\n");
  const card = /롯데/.test(t) ? "롯데" : /현대/.test(t) ? "현대" : /KB|국민/.test(t) ? "국민" : "";
  if (!card || !/승인|취소/.test(t)) return null;
  const cancel = /취소/.test(t);
  const noTotal = t.replace(/누적\s*[\d,]+원/g, "");
  const fx = noTotal.match(/\b(USD|JPY|EUR|CNY|GBP|HKD|TWD|SGD|THB|VND|AUD|CAD|CHF|PHP)\s*([\d,]+(?:\.\d+)?)/);
  const won = noTotal.match(/([\d,]+)원/);
  const amount = won ? Number(won[1].replace(/,/g, "")) : 0;
  if (!fx && !(amount > 0)) return null;
  const inst = Number((noTotal.match(/(\d{1,2})개월/) || [])[1] || 0);
  const kst = new Date(now.getTime() + 9 * 3600e3), dt = t.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  let year = kst.getUTCFullYear(), month = dt ? +dt[1] : kst.getUTCMonth() + 1, day = dt ? +dt[2] : kst.getUTCDate();
  if (month > kst.getUTCMonth() + 2) year--; // 12월 결제 문자를 1월에 받은 경우
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${year}-${pad(month)}-${pad(day)}`, time = dt ? `${pad(dt[3])}:${dt[4]}` : `${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`;
  // 가맹점: 현대·국민은 날짜 줄 다음 줄, 롯데는 첫 줄, 자동납부는 금액이 있는 줄에서 금액을 뺀 것
  const at = lines.findIndex((l) => /\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}/.test(l)), next = lines[at + 1] || "";
  let merchant = at >= 0 && next && !/^누적/.test(next) ? next
    : card === "롯데" ? lines[0]
    : (lines.find((l) => /[\d,]+원/.test(l) && !/^누적/.test(l) && !/승인|취소/.test(l)) || "").replace(/\s*[\d,]+원.*$/, "");
  merchant = merchant.replace(/^\[[^\]]*\]\s*/, "").trim().slice(0, 60);
  return { card, type: cancel ? "환불" : "지출", amount: fx ? 0 : amount, currency: fx ? fx[1] : "", foreign: fx ? Number(fx[2].replace(/,/g, "")) : 0,
    inst: inst >= 2 ? inst : 0, date, time, merchant: merchant || `${card}카드` };
}
// 해외 결제: 그날 환율로 원화 (유럽중앙은행 기준 공개 환율). 실패하면 0 → 다음에 다시
async function toKrw(p) {
  if (!p.currency || p.amount) return p;
  const r = await fetch(`https://api.frankfurter.app/latest?from=${p.currency}&to=KRW`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  const rate = r?.ok ? (await r.json())?.rates?.KRW : 0;
  return rate ? { ...p, amount: Math.round(p.foreign * rate), rate } : p;
}
async function smsHook(env, request) {
  const key = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/, "");
  check(key && (await sha256hex(key)) === (env.SMS_HOOK_SHA || SMS_HOOK_SHA), "열쇠가 맞지 않아요"); // 테스트는 env로 바꿔 끼움
  const b = await request.json(), text = clip(b?.text, 2000);
  const p = parseSms(text);
  check(p, "결제 문자가 아니에요");
  const id = "sms:" + (await sha256hex([p.card, p.type, p.date, p.time, p.amount, p.currency, p.foreign, p.merchant].join("|"))).slice(0, 24);
  const parsed = await toKrw(p);
  const r = await env.DB.prepare("INSERT OR IGNORE INTO sms_inbox (id, received, text, parsed) VALUES (?, ?, ?, ?)")
    .bind(id, Math.floor(Date.now() / 1000), text, JSON.stringify(parsed)).run();
  return { saved: r.meta.changes > 0, duplicate: r.meta.changes === 0, id,
    summary: `${parsed.card} ${parsed.type} ${parsed.currency ? parsed.currency + " " + parsed.foreign : parsed.amount.toLocaleString("ko-KR") + "원"} ${parsed.merchant}` };
}

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
  if (action === "cutoverStatus" || action === "promoteSnapshot") {
    check(service);
    const active = !!(await sql(
      "SELECT id FROM friend_cutover WHERE id=1",
    ).first());
    if (action === "cutoverStatus" || active) return { active };
    check(await sql("SELECT id FROM stage_verified WHERE id=1").first());
    const tables = [
      "accounts",
      "records",
      "publications",
      "relations",
      "houses",
      "habits",
      "habit_days",
      "reports",
    ];
    const batch = [sql("INSERT INTO friend_cutover VALUES(1)")];
    for (const t of tables) {
      check(!(await sql("SELECT 1 FROM " + t + " LIMIT 1").first()));
      batch.push(sql("INSERT INTO " + t + " SELECT * FROM stage_" + t));
    }
    for (const t of ["verified", "login_limits", ...tables.slice().reverse()])
      batch.push(sql("DROP TABLE IF EXISTS stage_" + t));
    await env.DB.batch(batch);
    return { active: true };
  }
  // 주인은 책·영화 검색만 시트를 거치지 않고 바로 (토큰의 SHA-256 = OWNER_TOKEN_SHA일 때만, 다른 기능은 안 됨)
  const ownerSearch = !action && ["book", "movie"].includes(b.what) && !!env.OWNER_TOKEN_SHA && !!b.token &&
    (await sha256hex(String(b.token))) === env.OWNER_TOKEN_SHA;
  // 시트가 문자 보관함에서 새 결제를 가져가고(smsPull) 다 쓴 것을 알려 줌(smsAck). 시트 연결 비밀값으로만
  if (action === "smsPull") {
    check(service);
    const items = (await rows("SELECT id, parsed FROM sms_inbox WHERE status='new' ORDER BY received LIMIT 50")).map((x) => ({ id: x.id, parsed: JSON.parse(x.parsed) }));
    for (const x of items) if (x.parsed.currency && !x.parsed.amount) { x.parsed = await toKrw(x.parsed); await sql("UPDATE sms_inbox SET parsed=? WHERE id=?", JSON.stringify(x.parsed), x.id).run(); }
    return { items: items.filter((x) => x.parsed.amount > 0) };
  }
  if (action === "smsAck") {
    check(service && Array.isArray(b.done) && Array.isArray(b.failed));
    // 시트에 적은 문자는 원본·해석 내용을 지우고 중복 확인용 id만 남김 (서버에 결제 내역이 쌓이지 않게)
    for (const id of b.done.slice(0, 50)) await sql("UPDATE sms_inbox SET status='done', note='', text='', parsed='{}' WHERE id=?", String(id)).run();
    for (const f of b.failed.slice(0, 50)) await sql("UPDATE sms_inbox SET note=? WHERE id=?", clip(f.error, 120), String(f.id)).run();
    return {};
  }
  const me = service || ownerSearch
    ? await sql("SELECT id,name FROM accounts WHERE id='owner'").first()
    : await sql(
        "SELECT id,name FROM accounts WHERE code=?",
        String(b.token || ""),
      ).first();
  check(me, "로그인이 필요해요");
  if (!action && b.what === "movie") return movieSearch(env, b.q);
  if (!action && b.what === "book") return bookSearch(env, b.q);
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
  if (["ownerOverlay", "projectionContext"].includes(b.what)) {
    check(service);
    const people = (await network()).map((f) => f.name);
    const publications = await rows(
      "SELECT list,id FROM publications WHERE person='owner'",
    );
    if (b.what === "projectionContext") return { people, publications };
    const tags = [];
    for (const r of await rows(
      `SELECT r.person,r.list,r.item,a.name FROM records r JOIN accounts a ON a.id=r.person
      WHERE r.person<>'owner' AND instr(json_extract(r.item,'$.with'),?)>0 ORDER BY r.rowid`,
      me.name,
    )) {
      const item = JSON.parse(r.item);
      if (
        String(item.with || "")
          .split(separator)
          .includes(me.name)
      )
        tags.push({ item, list: r.list, from: r.person, name: r.name });
    }
    return { people: [me.name, ...people], publications, tags };
  }
  if (action === "replaceProjection") {
    check(service && Array.isArray(b.records));
    const batch = [sql("DELETE FROM records WHERE person='owner'")];
    let chunk = [],
      size = 0;
    const insert = () =>
      sql(
        `INSERT INTO records(person,list,id,item) SELECT 'owner',json_extract(value,'$.list'),
      json_extract(value,'$.item.id'),json_extract(value,'$.item') FROM json_each(?)`,
        JSON.stringify(chunk),
      );
    for (const r of b.records) {
      check(titles.has(r.list) && validId(r.item?.id));
      const n = JSON.stringify(r).length;
      if (chunk.length && size + n > 120000) {
        batch.push(insert());
        chunk = [];
        size = 0;
      }
      chunk.push(r);
      size += n;
    }
    if (chunk.length) batch.push(insert());
    await env.DB.batch(batch);
    return { wrote: true };
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
      if (url.pathname === "/hook/sms" && request.method === "POST")
        return Response.json({ ok: true, ...(await smsHook(env, request)) }, { headers });
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
