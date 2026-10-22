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

// （已移除：IP 地理定位 / 定位彩蛋功能）
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
// ======================== 签名会话 token（过渡式，可选启用） ========================
// 配置 env.FACETALK_SESSION_SECRET 后：
//   - 签发/校验新格式 `{id}.{expSec}.{hmacSig}`（HMAC-SHA256，base64url，7 天过期）
//   - 纯旧格式 id 在已配置 secret 时被拒（客户端会重新 POST /api/identity 获取新 token）
// 未配置 secret：完全走旧逻辑，线上现状不变（向后兼容）。
export const SESSION_TTL_SEC = 7 * 24 * 3600;

function b64urlEncode(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64urlEncode(sig);
}
async function hmacVerify(secret, data, sig) {
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('HMAC', key, b64urlDecode(sig), new TextEncoder().encode(data));
  } catch (e) { return false; }
}

// 签发新格式 token；未配置 secret 返回 null（调用方退回旧格式，现状不变）
export async function issueSessionToken(env, id) {
  const secret = env && env.FACETALK_SESSION_SECRET ? String(env.FACETALK_SESSION_SECRET) : '';
  if (!secret) return null;
  const exp = nowSec() + SESSION_TTL_SEC;
  const sig = await hmacSign(secret, id + '.' + exp);
  return id + '.' + exp + '.' + sig;
}

// 解析并校验 token：返回 { id: 纯用户id } 或 { error, status }
async function authenticateToken(env, token) {
  const secret = env && env.FACETALK_SESSION_SECRET ? String(env.FACETALK_SESSION_SECRET) : '';
  token = String(token == null ? '' : token).trim();
  if (!token) return { error: 'NO_TOKEN', status: 401 };
  if (token.includes('.')) {
    // 新格式 id.exp.sig
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return { error: 'BAD_TOKEN', status: 401 };
    const [id, expStr, sig] = parts;
    if (!/^\d+$/.test(expStr) || nowSec() > Number(expStr)) return { error: 'TOKEN_EXPIRED', status: 401 };
    if (secret && !(await hmacVerify(secret, id + '.' + expStr, sig))) return { error: 'BAD_TOKEN', status: 401 };
    // secret 未配置却拿到点号 token：宽松退回按 id 查库（兼容旧缓存）
    return { id };
  }
  if (secret) return { error: 'BAD_TOKEN', status: 401 }; // 已启用强会话：拒绝旧格式裸 id
  return { id: token };
}

// 校验 token：返回 {user, id} 或 {error, status}
export async function requireToken(env, me) {
  const auth = await authenticateToken(env, me);
  if (auth.error) return auth;
  const db = getDB(env);
  if (!db) return { error: 'DB_NOT_BOUND', status: 503 };
  const u = await db.prepare('SELECT id, rep, banned FROM users WHERE id=?').bind(auth.id).first();
  if (!u) return { error: 'BAD_TOKEN', status: 401 };
  if (u.banned) return { error: 'BANNED', status: 403 };
  return { user: { rep: (u.rep == null ? 50 : u.rep) | 0 }, id: auth.id };
}
export function clampRep(v) { return Math.max(0, Math.min(100, v | 0)); }

// 清空一个房间里的全部试音录音：R2 对象（clips/{id}）+ D1 元数据行。
// 结算 / 关房 / 每日清理都会调用，保证"云端不留存"。
// voice_* 表未建或 R2 未绑定时静默跳过，不影响 1.0 的既有功能。
export async function dropPairClips(env, db, pairId) {
  try {
    const r = await db.prepare('SELECT id FROM voice_clips WHERE pair_id=?').bind(pairId).all();
    const rows = (r && r.results) || [];
    const bucket = (env && env.VOICE && typeof env.VOICE.delete === 'function') ? env.VOICE : null;
    if (bucket) {
      await Promise.all(rows.map(c => bucket.delete('clips/' + c.id).catch(() => {})));
    }
    await db.batch([
      db.prepare('DELETE FROM voice_clips WHERE pair_id=?').bind(pairId),
    ]);
  } catch (e) { /* 表未建：无录音可清 */ }
}
