export async function workerUrl(account, token) {
  const res = await fetch(
    "https://api.cloudflare.com/client/v4/accounts/" +
      encodeURIComponent(account) +
      "/workers/subdomain",
    { headers: { Authorization: "Bearer " + token } },
  );
  if (!res.ok)
    throw Error("Cloudflare Workers 주소 확인 실패 (" + res.status + ")");
  const name = (await res.json()).result?.subdomain;
  if (!/^[a-z0-9-]+$/.test(name || ""))
    throw Error("workers.dev 주소 확인 필요");
  return "https://bab-zip-friends." + name + ".workers.dev";
}
