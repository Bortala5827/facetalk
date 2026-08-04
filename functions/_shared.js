// FaceTalk v2 共享助手（Cloudflare Pages Functions，ESM）—— D1 版
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
// 统一用「秒」时间戳，避免 ms/s 混用
export function nowSec() { return Math.floor(Date.now() / 1000); }
export function getIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
}
// 灵活解析 D1 绑定：优先 env.DB，否则 env 中第一个 D1 数据库型对象
export function getDB(env) {
  if (!env) return null;
  if (env.DB && typeof env.DB.prepare === 'function') return env.DB;
  for (const k of Object.keys(env)) {
    const v = env[k];
    if (v && typeof v.prepare === 'function' && typeof v.exec === 'function') return v;
  }
  return null;
}
// 频率限制：D1 计数器（窗口内超过 max 返回 false）
export async function rateLimit(db, key, max, windowSec) {
  try {
    const now = nowSec();
    const row = await db.prepare('SELECT count, reset_at FROM rate_limits WHERE key=?').bind(key).first();
    if (!row || row.reset_at < now) {
      await db.prepare('INSERT OR REPLACE INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)').bind(key, now + windowSec).run();
      return true;
    }
    if (row.count >= max) return false;
    await db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key=?').bind(key).run();
    return true;
  } catch (e) {
    return true; // 限流器异常不阻断主流程
  }
}
// 站点管理员密码解锁限流：设置环境变量 MS_ADMIN_KEY 后，超限请求带 admin key 可绕过限流（便于作者自测）。
// POST 走 body.adminKey；GET 走 ?admin=。未设置 MS_ADMIN_KEY 时恒返回 false（限流照常生效）。
export function adminBypass(env, request, body) {
  if (!env || !env.MS_ADMIN_KEY) return false;
  let key = null;
  if (body && body.adminKey != null) key = String(body.adminKey);
  else {
    try { const u = new URL(request.url); key = u.searchParams.get('admin'); } catch (e) {}
  }
  return !!key && key === String(env.MS_ADMIN_KEY);
}
// 校验 token：返回 {user, id} 或 {error, status}
export async function requireToken(env, me) {
  if (!me) return { error: 'NO_TOKEN', status: 401 };
  const db = getDB(env);
  if (!db) return { error: 'DB_NOT_BOUND', status: 503 };
  const u = await db.prepare('SELECT id, rep, banned FROM users WHERE id=?').bind(me).first();
  if (!u) return { error: 'BAD_TOKEN', status: 401 };
  if (u.banned) return { error: 'BANNED', status: 403 };
  return { user: { rep: (u.rep == null ? 50 : u.rep) | 0 }, id: me };
}
export function clampRep(v) { return Math.max(0, Math.min(100, v | 0)); }

// 清空一个房间里的全部试音录音（分片 + 主行）。
// 结算 / 关房 / 每日清理都会调用，保证"云端不留存"。
// voice_* 表未建时静默跳过，不影响 1.0 的既有功能。
export async function dropPairClips(db, pairId) {
  try {
    await db.batch([
      db.prepare('DELETE FROM voice_chunks WHERE clip_id IN (SELECT id FROM voice_clips WHERE pair_id=?)').bind(pairId),
      db.prepare('DELETE FROM voice_clips WHERE pair_id=?').bind(pairId),
    ]);
  } catch (e) { /* 表未建：无录音可清 */ }
}
