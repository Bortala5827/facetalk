// FaceTalk v2 共享助手（Cloudflare Pages Functions，ESM）
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
export function err(message, status = 400) {
  return json({ ok: false, error: message }, status);
}
export function genId(n = 12) {
  // crypto.randomUUID 在 Workers 运行时可用
  const u = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2);
  return u.slice(0, n);
}
export function getIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
}
// 频率限制：KV 计数器，窗口内超过 max 返回 false
export async function rateLimit(kv, key, max, windowSec) {
  try {
    const cur = await kv.get(key);
    const n = cur ? parseInt(cur, 10) : 0;
    if (n >= max) return false;
    await kv.put(key, String(n + 1), { expirationTtl: windowSec });
    return true;
  } catch (e) {
    return true; // 限流器异常不阻断主流程
  }
}
// 校验 token：返回 {user, id} 或 {error, status}
export async function requireToken(env, me) {
  if (!me) return { error: 'NO_TOKEN', status: 401 };
  const kv = env.DAZI_KV;
  if (!kv) return { error: 'KV_NOT_BOUND', status: 503 };
  const raw = await kv.get('u:' + me);
  if (!raw) return { error: 'BAD_TOKEN', status: 401 };
  let u;
  try { u = JSON.parse(raw); } catch (e) { return { error: 'BAD_TOKEN', status: 401 }; }
  if (u.banned) return { error: 'BANNED', status: 403 };
  return { user: u, id: me };
}
export function clampRep(v) { return Math.max(0, Math.min(100, v | 0)); }
export async function refreshUser(kv, id, patch) {
  const raw = await kv.get('u:' + id);
  let u = raw ? JSON.parse(raw) : { banned: false, rep: 50, created: Date.now() };
  u = { ...u, ...patch };
  await kv.put('u:' + id, JSON.stringify(u), { expirationTtl: 86400 });
  return u;
}
