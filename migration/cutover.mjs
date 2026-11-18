// Called by the authenticated release workflow. Only aggregate status is printed.
import { readFile } from "node:fs/promises";
import { workerUrl } from "../apps-script/deploy/worker-url.mjs";
import { spawnSync } from "node:child_process";

const env = process.env;
let phase = "서버 확인";
async function run() {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const gas = app.match(
    /const SHEET_URL = '(https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec)'/,
  )[1];
  const worker = await workerUrl(env.CF_ACCOUNT, env.CF_TOKEN);
  async function post(url, body, headers = {}) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain", ...headers },
      body: JSON.stringify(body),
      redirect: "manual",
    });
    let result = res;
    if (url === gas && res.status === 302) {
      const target = new URL(res.headers.get("location"));
      if (target.origin !== "https://script.googleusercontent.com")
        throw Error();
      result = await fetch(target, { redirect: "error" });
    }
    if (!result.ok) throw Error();
    const data = await result.json();
    if (!data.ok) throw Error();
    return data;
  }
  const control = (command) =>
    post(gas, {
      action: "friendCutover",
      command,
      token: env.APP_TOKEN,
      proof: env.BRIDGE,
    });
  const internal = (action) =>
    post(worker, { action }, { Authorization: "Bearer " + env.BRIDGE });
  const state = await control("status");
  const alreadyActive = (await internal("cutoverStatus")).active;
  if (
    (state.mode === "worker" && !alreadyActive) ||
    (state.mode === "sheets" && alreadyActive)
  )
    throw Error();
  try {
    if (state.mode === "sheets") {
      phase = "전환 전 기준 시간 기록";
      const samples = {};
      for (const what of ["me", "lists", "habits"]) {
        samples[what] = [];
        for (let i = 0; i < 3; i++) {
          const start = performance.now();
          const r = await post(gas, {
            action: "friendCutover",
            command: "baseline",
            what,
            token: env.APP_TOKEN,
            proof: env.BRIDGE,
          });
          if (!r.sample) break;
          samples[what].push(Math.round(performance.now() - start));
        }
      }
      const { appendFile } = await import("node:fs/promises");
      await appendFile(
        env.GITHUB_STEP_SUMMARY,
        "\n전환 전 응답 시간(ms, GitHub 실행기에서 측정): " +
          JSON.stringify(samples) +
          "\n",
      );
      phase = "쓰기 일시정지";
      await control("freeze");
    }
    if (!alreadyActive) {
      phase = "마지막 변경 및 임시 내보내기 삭제 검증";
      const copy = spawnSync(process.execPath, ["migration/run.mjs"], {
        stdio: "inherit",
      });
      if (copy.status !== 0) throw Error();
      phase = "D1 원자적 전환";
      if (!(await internal("promoteSnapshot")).active) throw Error();
    }
    phase = "기존 접속 경로 전환";
    if (state.mode !== "worker") await control("activate");
    phase = "운영 권한과 조회 확인";
    if ((await control("status")).mode !== "worker") throw Error();
    const identity = await post(
      worker,
      { what: "me" },
      { Authorization: "Bearer " + env.BRIDGE },
    );
    const friend = identity.friends?.[0];
    if (friend) {
      const guest = await post(gas, {
        action: "redeem",
        invite: friend.invite,
      });
      if (
        guest.role !== "friend" ||
        guest.token !== friend.code ||
        guest.workerUrl !== worker
      )
        throw Error();
      for (const what of ["me", "lists", "habits"])
        await post(worker, { what, token: friend.code });
    }
    console.log("운영 전환 및 조회 확인 완료");
  } catch (e) {
    // A dropped promotion response is ambiguous. Query D1 before reopening Sheets.
    if (
      !(await internal("cutoverStatus")).active &&
      (await control("status")).mode === "freeze"
    )
      await control("resumeSheets");
    throw e;
  }
}
run().catch(() => {
  console.error("::error::전환 확인 필요 — " + phase);
  process.exitCode = 1;
});
