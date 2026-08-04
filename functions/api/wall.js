// FaceTalk 全站公开留言墙 API（Cloudflare Pages Functions + D1）
// GET    /api/wall                 -> 留言列表（最新在前）
// POST   /api/wall                 -> 发帖（body: {name, text}），60s + 每日 20 条限流，敏感词过滤，5min 去重
// DELETE /api/wall?id=xxx&admin=口令 -> 管理员删除（口令优先取 env.MS_ADMIN_KEY 即全站限流解锁密码，
// 再回退 env.WALL_ADMIN 旧名，最后默认 rcj9527；任一匹配即通过，避免两套密码割裂）
const adminPassOk = function(env, admin) {
  const a = String(admin || '').trim();
  if (!a) return false;
  const list = [env && env.MS_ADMIN_KEY, env && env.WALL_ADMIN, 'rcj9527']
    .map(s => s && String(s)).filter(Boolean);
  return list.includes(a);
};
// 存储：D1 表 wall（绑定名 DB）。created_at 用「秒」时间戳（与全站一致），7 天自动清理（见 _cleanup.js）。
const MAX_ITEMS = 200;
const RATE_LIMIT_SEC = 60;
const DAILY_IP_LIMIT = 20;
const SENSITIVE = ["赌博","色情","代考","炸药","炸弹","毒品","诈骗","办证","招嫖","代刷","枪","微信","加我","私聊","加微信","vx","v信","代练"];

function dayLeftSec() {
  var end = new Date(new Date().toISOString().slice(0, 10) + "T23:59:59Z").getTime();
  return Math.max(Math.ceil((end - Date.now()) / 1000), 60);
}
function sanitize(s, max) {
  s = (s || "").toString().trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}
function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
function hasSensitive(s) {
  s = (s || "").toLowerCase();
  for (var i = 0; i < SENSITIVE.length; i++) {
    if (s.indexOf(SENSITIVE[i]) >= 0) return SENSITIVE[i];
  }
  return null;
}
function getDB(env) {
  if (env && env.DB) return env.DB;
  if (env) {
    for (const k of Object.keys(env)) {
      const v = env[k];
      if (v && typeof v.prepare === "function" && typeof v.exec === "function") return v;
    }
  }
  return null;
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

export async function onRequestGet(context) {
  const db = getDB(context.env);
  if (!db) return json({ ok: false, error: "DB_NOT_BOUND", items: [] }, 503);
  try {
    const { results } = await db.prepare(
      "SELECT id,name,text,created_at FROM wall ORDER BY created_at DESC LIMIT ?"
    ).bind(MAX_ITEMS).all();
    const items = (results || []).map(function (r) {
      return { id: r.id, name: r.name, text: r.text, createdAt: r.created_at };
    });
    return json({ ok: true, items: items });
  } catch (e) {
    return json({ ok: false, error: "DB_ERR", items: [] }, 500);
  }
}

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch (e) { return json({ ok: false, error: "BAD_JSON" }, 400); }
  const db = getDB(context.env);
  if (!db) return json({ ok: false, error: "DB_NOT_BOUND" }, 503);

  const ip = context.request.headers.get("cf-connecting-ip") || context.request.headers.get("x-forwarded-for") || "unknown";
  const now = Math.floor(Date.now() / 1000); // 秒
  const today = new Date().toISOString().slice(0, 10);

  // 60s 频率限制（按 IP）
  try {
    const rl = await db.prepare("SELECT last_ts FROM wall_rl WHERE ip=?").bind(ip).all();
    if (rl.results.length) {
      const last = rl.results[0].last_ts;
      if (now - Number(last) < RATE_LIMIT_SEC) {
        const left = Math.ceil(RATE_LIMIT_SEC - (now - Number(last)));
        return json({ ok: false, error: "RATE_LIMIT", left: left }, 429);
      }
    }
    await db.prepare("INSERT OR REPLACE INTO wall_rl (ip,last_ts) VALUES (?,?)").bind(ip, now).run();
  } catch (e) { /* 限速失败不阻断发帖 */ }

  // 单 IP 单日配额
  try {
    const dr = await db.prepare("SELECT n FROM wall_day WHERE ip=? AND day=?").bind(ip, today).all();
    const dayCount = dr.results.length ? Number(dr.results[0].n) || 0 : 0;
    if (dayCount >= DAILY_IP_LIMIT) {
      return json({ ok: false, error: "DAILY_LIMIT", left: dayLeftSec() }, 429);
    }
  } catch (e) { /* 计数失败不阻断发帖 */ }

  const name = sanitize(body.name, 20) || "匿名搭子";
  const text = sanitize(body.text, 300);
  if (!text) return json({ ok: false, error: "EMPTY_TEXT" }, 400);
  const hit = hasSensitive(text) || hasSensitive(name);
  if (hit) return json({ ok: false, error: "BAD_WORD", word: hit }, 400);

  // 去重：最近 5 条内同昵称+同内容视为重复
  try {
    const { results } = await db.prepare(
      "SELECT name,text,created_at FROM wall ORDER BY created_at DESC LIMIT 5"
    ).all();
    for (var i = 0; i < results.length; i++) {
      if (results[i].name === name && results[i].text === text &&
          now - (Number(results[i].created_at) || 0) < 5 * 60) {
        return json({ ok: false, error: "DUP" }, 400);
      }
    }
  } catch (e) {}

  const id = now.toString(36) + Math.random().toString(36).slice(2, 6);
  try {
    await db.prepare("INSERT INTO wall (id,name,text,created_at) VALUES (?,?,?,?)").bind(id, name, text, now).run();
    await db.prepare("INSERT INTO wall_day (ip,day,n) VALUES (?,?,1) ON CONFLICT(ip,day) DO UPDATE SET n = n + 1").bind(ip, today).run();
  } catch (e) {
    return json({ ok: false, error: "WRITE_FAIL" }, 500);
  }
  return json({ ok: true, item: { id: id, name: name, text: text, createdAt: now } });
}

export async function onRequestDelete(context) {
  const url = new URL(context.request.url);
  const id = sanitize(url.searchParams.get("id"), 40);
  const admin = url.searchParams.get("admin") || "";
  if (!adminPassOk(context.env, admin)) return json({ ok: false, error: "BAD_ADMIN" }, 403);
  const db = getDB(context.env);
  if (!db) return json({ ok: false, error: "DB_NOT_BOUND" }, 503);
  try {
    const chk = await db.prepare("SELECT id FROM wall WHERE id=?").bind(id).all();
    if (!chk.results.length) return json({ ok: false, error: "NOT_FOUND" }, 404);
    await db.prepare("DELETE FROM wall WHERE id=?").bind(id).run();
    return json({ ok: true, removed: 1 });
  } catch (e) {
    return json({ ok: false, error: "WRITE_FAIL" }, 500);
  }
}
