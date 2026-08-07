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

// ─── 访客地理定位（Cloudflare 边缘注入，仅城市级）───
// request.cf 仅在 Cloudflare 边缘存在；本地 / 预览环境为 undefined，getGeo 返回空，调用方须优雅降级。
export function getGeo(request) {
  const cf = (request && request.cf) || {};
  const lat = (typeof cf.latitude === 'number') ? cf.latitude : (parseFloat(cf.latitude) || null);
  const lng = (typeof cf.longitude === 'number') ? cf.longitude : (parseFloat(cf.longitude) || null);
  return { city: cf.city || '', region: cf.region || '', country: cf.country || '', lat, lng };
}
// 省 / 州英文名 → 中文（Cloudflare cf.region 为英文名；用于「跨省搭子」等友好标签，符合中国行政区划）
const PROV_CN = {
  'Beijing':'北京','Shanghai':'上海','Tianjin':'天津','Chongqing':'重庆',
  'Guangdong':'广东','Jiangsu':'江苏','Zhejiang':'浙江','Shandong':'山东','Sichuan':'四川',
  'Hubei':'湖北','Hunan':'湖南','Henan':'河南','Hebei':'河北','Fujian':'福建','Anhui':'安徽',
  'Liaoning':'辽宁','Shaanxi':'陕西','Shanxi':'山西','Jiangxi':'江西','Yunnan':'云南',
  'Guizhou':'贵州','Gansu':'甘肃','Qinghai':'青海','Hainan':'海南','Jilin':'吉林','Heilongjiang':'黑龙江',
  'Guangxi':'广西','Nei Mongol':'内蒙古','Inner Mongolia':'内蒙古','Ningxia':'宁夏',
  'Xinjiang':'新疆','Tibet':'西藏','Hong Kong':'香港','Macau':'澳门','Taiwan':'台湾'
};
export function provCN(region) { return PROV_CN[region] || region || ''; }
// 展示用城市名：尽量给中文。cf.city 对中国城市常返回拼音 / 英文，含中文直接用；否则退回中文省份；都没有用原文或「某处」。
export function geoCityLabel(g) {
  if (!g) return '某处';
  if (g.city && /[一-龥]/.test(g.city)) return g.city;
  const pc = provCN(g.region);
  if (pc && !/^[A-Za-z]/.test(pc)) return pc; // 已转成中文省份
  if (g.city) return g.city;
  if (pc) return pc;
  return '某处';
}
// Haversine 距离（km），任一坐标缺失返回 null
export function haversineKm(aLat, aLng, bLat, bLng) {
  if (aLat == null || aLng == null || bLat == null || bLng == null) return null;
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}
// 把「我的地理」与「对方地理」算成展示信息：城市标签 + 距离 + 同城 / 同省 / 跨省
export function peerGeoInfo(myGeo, peerGeo) {
  if (!peerGeo || (!peerGeo.lat && !peerGeo.city)) return { city: '某处', distanceKm: null, tag: '' };
  const city = geoCityLabel(peerGeo);
  let tag = '', distanceKm = haversineKm(myGeo && myGeo.lat, myGeo && myGeo.lng, peerGeo.lat, peerGeo.lng);
  if (distanceKm != null) {
    if (distanceKm <= 30) tag = '同城搭子 🏠';
    else if (myGeo && peerGeo.region && myGeo.region && myGeo.region === peerGeo.region) tag = '同省搭子';
    else tag = '跨省搭子 ✈️';
  }
  return { city, distanceKm, tag };
}
// 把访客 IP 地理写入 users（节流 15 分钟，列缺失 / 无 cf 地理时静默跳过，不影响主流程）
export async function refreshGeo(db, request, userId) {
  const g = getGeo(request);
  if (g.lat == null || g.lng == null) return;
  const now = nowSec();
  try {
    const row = await db.prepare('SELECT geo_at FROM users WHERE id=?').bind(userId).first();
    if (!row || !row.geo_at || (now - row.geo_at) > 900) {
      await db.prepare('UPDATE users SET geo_city=?, geo_region=?, geo_lat=?, geo_lng=?, geo_at=? WHERE id=?')
        .bind(g.city, g.region, g.lat, g.lng, now, userId).run();
    }
  } catch (e) { /* 列未 ALTER：功能降级，不影响主流程 */ }
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
