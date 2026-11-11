// BAB:ZIP 알림 서버 (Cloudflare Worker, 무료)
// - POST /subscribe {token, sub}: 휴대폰 알림 구독을 KV에 저장
// - 정해진 시각(cron, UTC)에 저장된 모든 기기로 웹 푸시 전송
// 필요한 설정: KV 바인딩 SUBS, 비밀값 TOKEN(앱 비밀번호)·VAPID_JWK(개인키 JWK), 변수 VAPID_SUB(https 주소)

// cron은 UTC 기준 → 한국 시간 = UTC+9
const MSG = {
  '0 0 * * *': ['좋은 아침이에요 ☀️', '어제 쓴 돈, 빠진 거 없이 적었나요?'],
  '30 1 * * *': ['오전 지출 체크 ☕', '출근길·커피값 잊기 전에 적어 둬요'],
  '50 9 * * MON-FRI': ['퇴근 전이에요 🏃', '오늘 쓴 돈 적고 퇴근해요'],
};

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const hkdf = async (salt, ikm, info, bytes) => new Uint8Array(await crypto.subtle.deriveBits(
  { name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), bytes * 8));

// RFC 8291 (aes128gcm) 페이로드 암호화
export async function encrypt(sub, text) {
  const ua = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const as = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(enc.encode('WebPush: info\0'), ua, as), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 16, 0, as.length]), as, ct); // rs=4096
}

// VAPID 서명 (ES256 JWT)
export async function vapid(endpoint, jwk, subject) {
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const c = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(h + '.' + c));
  return `vapid t=${h}.${c}.${b64u(sig)}, k=${b64u(cat(new Uint8Array([4]), unb64u(jwk.x), unb64u(jwk.y)))}`;
}

export async function send(sub, payload, env) {
  const jwk = JSON.parse(env.VAPID_JWK);
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapid(sub.endpoint, jwk, env.VAPID_SUB), 'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high' },
    body: await encrypt(sub, JSON.stringify(payload)),
  });
}

async function sendAll(env, payload) {
  const { keys } = await env.SUBS.list();
  for (const { name } of keys) {
    const sub = JSON.parse(await env.SUBS.get(name));
    const r = await send(sub, payload, env);
    if (r.status === 404 || r.status === 410) await env.SUBS.delete(name); // 알림 끈 기기는 정리
  }
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'content-type': 'application/json' } });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const path = new URL(req.url).pathname;
    if (req.method !== 'POST' || !['/subscribe', '/test'].includes(path)) return json({ ok: false }, 404);
    let b; try { b = await req.json(); } catch { return json({ ok: false, error: '잘못된 요청' }, 400); }
    if (!b || b.token !== env.TOKEN) return json({ ok: false, error: '비밀번호가 맞지 않습니다' }, 403);
    if (path === '/test') { await sendAll(env, { title: 'BAB:ZIP 알림 테스트 🔔', body: '알림이 잘 와요!' }); return json({ ok: true }); }
    const s = b.sub;
    if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) return json({ ok: false, error: '구독 정보 오류' }, 400);
    const id = b64u(await crypto.subtle.digest('SHA-256', enc.encode(s.endpoint)));
    await env.SUBS.put(id, JSON.stringify({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }));
    return json({ ok: true });
  },
  async scheduled(event, env, ctx) {
    const m = MSG[event.cron];
    if (m) ctx.waitUntil(sendAll(env, { title: m[0], body: m[1], url: './?add=1' }));
  },
};
