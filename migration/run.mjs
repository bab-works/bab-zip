// Operator-only migration. Never print upstream responses, query parameters, rows or caught errors.
import { readFile, appendFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { stage, convert, MigrationError } from "./stage.mjs";
const env = process.env;
let phase = "권한 설정 확인";
class SafeError extends MigrationError {}
function checked(ok, message) {
  if (!ok) throw new SafeError(message);
}
async function response(r, label) {
  checked(r.ok, label + " (HTTP " + r.status + ")");
  return r.json();
}
function replaceOnce(source, needle, replacement) {
  checked(
    source.includes(needle) &&
      source.indexOf(needle) === source.lastIndexOf(needle),
    "서버 코드 호환성 확인 필요",
  );
  return source.replace(needle, () => replacement);
}
function ordered(_, value) {
  if (!value || Array.isArray(value) || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
  );
}
function contentKey(files) {
  return JSON.stringify(
    files
      .map(({ name, type, source }) => [
        name,
        type,
        type === "JSON"
          ? JSON.stringify(JSON.parse(source), ordered)
          : source.replaceAll("\r\n", "\n").trimEnd(),
      ])
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}

async function snapshot() {
  const rc = JSON.parse(env.CLASPRC_JSON),
    cfg = rc.oauth2ClientSettings;
  checked(
    cfg?.clientId && cfg?.clientSecret && rc.token?.refresh_token,
    "기존 clasp 인증 설정 확인 필요",
  );
  const token = await response(
    await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: rc.token.refresh_token,
        grant_type: "refresh_token",
      }),
    }),
    "Google 인증",
  );
  const base =
    "https://script.googleapis.com/v1/projects/" +
    encodeURIComponent(env.SCRIPT_ID);
  async function google(path, method = "GET", data) {
    const r = await fetch(base + path, {
      method,
      headers: {
        Authorization: "Bearer " + token.access_token,
        "Content-Type": "application/json",
      },
      body: data && JSON.stringify(data),
    });
    if (method === "DELETE") {
      checked(r.ok, "Apps Script DELETE (HTTP " + r.status + ")");
      return;
    }
    return response(r, "Apps Script " + method);
  }
  const { parentId } = await google("");
  checked(parentId, "시트에 연결된 프로젝트 확인 필요");
  const { files } = await google("/content");
  const original = files.map(({ name, type, source }) => ({
    name,
    type,
    source,
  }));
  const proof = randomBytes(32).toString("hex"),
    expires = Date.now() + 12 * 60_000;
  const helper = (
    await readFile(new URL("./export.gs", import.meta.url), "utf8")
  )
    .replace("__EXPIRY__", String(expires))
    .replace(
      "__PROOF_HASH__",
      createHash("sha256").update(proof).digest("base64"),
    );
  const temp = structuredClone(original),
    script = temp.find((f) => f.name === "Code" && f.type === "SERVER_JS");
  checked(script, "Code 파일 확인 필요");
  script.source = replaceOnce(
    script.source,
    "function doPost(e) {",
    "function snapshotUnusedPost_(e) {",
  );
  script.source = replaceOnce(
    script.source,
    "function doGet(e) {",
    "function snapshotUnusedGet_(e) {",
  );
  const manifest = temp.find(
    (f) => f.name === "appsscript" && f.type === "JSON",
  );
  checked(manifest, "Apps Script manifest 확인 필요");
  const config = JSON.parse(manifest.source);
  config.webapp = { executeAs: "USER_DEPLOYING", access: "ANYONE_ANONYMOUS" };
  delete config.executionApi;
  manifest.source = JSON.stringify(config, null, 2);
  temp.push({
    name: "TemporaryFriendSnapshot",
    type: "SERVER_JS",
    source:
      "function doPost(e){return exportFriendsOnce_(e); }\nfunction exportSheet_(){return SpreadsheetApp.openById(" +
      JSON.stringify(parentId) +
      ");}\n" +
      helper,
  });
  let deployment,
    originalRestored = false;
  async function restore() {
    const current = contentKey((await google("/content")).files);
    if (current === contentKey(original)) return;
    checked(
      current === contentKey(temp),
      "편집기 동시 변경 감지: 원본 복원 확인 필요",
    );
    await google("/content", "PUT", { files: original });
    checked(
      contentKey((await google("/content")).files) === contentKey(original),
      "원본 복원 검증 실패",
    );
  }
  try {
    phase = "일회용 내보내기 생성";
    checked(
      contentKey((await google("/content")).files) === contentKey(original),
      "편집기 동시 변경 감지",
    );
    await google("/content", "PUT", { files: temp });
    const { versionNumber } = await google("/versions", "POST", {
      description: "temporary friend snapshot",
    });
    await restore();
    originalRestored = true;
    deployment = await google("/deployments", "POST", {
      versionNumber,
      manifestFileName: "appsscript",
      description: "temporary friend snapshot",
    });
    const url = deployment.entryPoints?.find(
      (p) => p.entryPointType === "WEB_APP",
    )?.webApp?.url;
    checked(
      url && new URL(url).hostname === "script.google.com",
      "내보내기 주소 확인 필요",
    );
    phase = "주인 인증 및 시트 읽기";
    let data;
    for (let i = 0; i < 4; i++) {
      const r = await fetch(url, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          __friendExport: true,
          token: env.APP_TOKEN,
          proof,
        }),
      });
      const target = r.headers.get("location");
      if (
        target &&
        new URL(target).hostname === "script.googleusercontent.com"
      ) {
        data = await response(await fetch(target), "내보내기 읽기");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    checked(data?.ok, "주인 인증 또는 임시 배포 확인 필요");
    return data;
  } finally {
    if (!originalRestored) await restore();
    if (deployment) {
      const p = "/deployments/" + encodeURIComponent(deployment.deploymentId);
      await google(p, "DELETE");
      let pageToken = "";
      do {
        const page = await google(
          "/deployments?pageSize=50&pageToken=" + encodeURIComponent(pageToken),
        );
        checked(
          !page.deployments?.some(
            (d) => d.deploymentId === deployment.deploymentId,
          ),
          "임시 배포 삭제 검증 실패",
        );
        pageToken = page.nextPageToken;
      } while (pageToken);
    }
  }
}

async function main() {
  for (const k of [
    "CLASPRC_JSON",
    "SCRIPT_ID",
    "APP_TOKEN",
    "CF_ACCOUNT",
    "CF_DATABASE",
    "CF_TOKEN",
    "BRIDGE",
  ])
    checked(env[k], k + " 설정 필요");
  const endpoint =
    "https://api.cloudflare.com/client/v4/accounts/" +
    encodeURIComponent(env.CF_ACCOUNT) +
    "/d1/database/" +
    encodeURIComponent(env.CF_DATABASE) +
    "/query";
  async function query(sql, params = []) {
    const result = await response(
      await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.CF_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
      }),
      "D1",
    );
    checked(result.success && result.result?.[0]?.success, "D1 쿼리 실패");
    return result.result[0].results;
  }
  await query("SELECT id FROM accounts LIMIT 0");
  const data = await snapshot();
  phase = "D1 복사 및 검증";
  const counts = await stage(
    query,
    convert(data, env.BRIDGE),
    await readFile(
      new URL("../worker/migrations/0001_friends.sql", import.meta.url),
      "utf8",
    ),
  );
  const summary = [
    "임시 배포 삭제 및 각 행의 내용 검증 완료.",
    "",
    "| D1 준비 테이블 | 원본 | D1 |",
    "|---|---:|---:|",
    ...Object.entries(counts).map(
      ([k, n]) => "| " + k + " | " + n + " | " + n + " |",
    ),
  ].join("\n");
  await appendFile(env.GITHUB_STEP_SUMMARY, summary + "\n");
}
main().catch((e) => {
  console.error(
    "::error::실패 단계 — " +
      phase +
      (e instanceof MigrationError ? " (" + e.message + ")" : ""),
  );
  process.exitCode = 1;
});
