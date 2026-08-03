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
// 判断一个对象是否像 KV 命名空间（有 get/put/delete 三个方法）
function isKV(v) {
  return !!v && typeof v.get === 'function' && typeof v.put === 'function' && typeof v.delete === 'function';
}
// 灵活解析 KV 绑定，避免死磕变量名：
//   1) 优先 env.DAZI_KV
//   2) 其次环境变量 KV_BINDING_NAME 指定的键
//   3) 退化为 env 中第一个 KV 命名空间型对象（解决「后台绑定的名字不是 DAZI_KV」问题）
export function getKV(env) {
  if (!env) return null;
  if (isKV(env.DAZI_KV)) return env.DAZI_KV;
  const name = env.KV_BINDING_NAME;
  if (name && isKV(env[name])) return env[name];
  for (const k of Object.keys(env)) {
    if (k === 'DAZI_KV') continue;
    if (isKV(env[k])) return env[k];
  }
  return null;
}
// 校验 token：返回 {user, id} 或 {error, status}
export async function requireToken(env, me) {
  if (!me) return { error: 'NO_TOKEN', status: 401 };
  const kv = getKV(env);
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
