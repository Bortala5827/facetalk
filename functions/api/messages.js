// 面试搭子 · 留言板 API（Cloudflare Pages Functions + KV）
// KV 绑定名不限：优先 DAZI_KV，其次环境变量 KV_BINDING_NAME，再退化自动识别任意 KV 命名空间绑定。
//
import { getKV } from '../_shared.js';

// GET  /api/messages -> { items: [ {id, text, role, city, contact, created} ] }
// POST /api/messages -> body { text, role?, city?, contact? } -> { ok, id }
//
// 留言保留 3 天（KV expirationTtl）。内容自由，可说明飞书等其它会议方式。

const MSG_TTL = 60 * 60 * 24 * 3; // 留言 3 天
const RL_LIMIT = 10;             // 每 IP 每分钟最多提交次数
const RL_WINDOW = 60;            // 限流窗口（秒）

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') || 'anon';
}

function str(v, max) {
  v = (v || '').toString().trim();
  return v.length > max ? v.slice(0, max) : v;
}

async function rateLimited(kv, ip) {
  const key = 'rl:' + ip;
  const now = Math.floor(Date.now() / 1000);
  let rec = await kv.get(key, { type: 'json' });
  if (rec && now - rec.ts < RL_WINDOW) {
    if (rec.count >= RL_LIMIT) return true;
    rec.count++;
  } else {
    rec = { ts: now, count: 1 };
  }
  await kv.put(key, JSON.stringify(rec), { expirationTtl: RL_WINDOW + 5 });
  return false;
}

export async function onRequestGet(ctx) {
  const kv = getKV(ctx.env);
  if (!kv) return json({ error: 'KV_NOT_BOUND', message: '后端存储未配置，请联系站长' }, 500);
  try {
    const list = await kv.list({ prefix: 'msg:' });
    const now = Date.now();
    const items = [];
    for (const k of list.keys) {
      if (k.expiration && k.expiration * 1000 <= now) continue;
      const v = await kv.get(k.name, { type: 'json' });
      if (v && v.text) items.push(v);
    }
    items.sort((a, b) => (b.created || 0) - (a.created || 0));
    return json({ items: items.slice(0, 100) });
  } catch (e) {
    return json({ error: 'LIST_FAILED', message: String((e && e.message) || e) }, 500);
  }
}

export async function onRequestPost(ctx) {
  const kv = getKV(ctx.env);
  if (!kv) return json({ error: 'KV_NOT_BOUND', message: '后端存储未配置，请联系站长' }, 500);

  const ip = clientIp(ctx.request);
  if (await rateLimited(kv, ip)) {
    return json({ error: 'RATE_LIMIT', message: '提交太频繁，请稍后再试' }, 429);
  }

  let body;
  try { body = await ctx.request.json(); }
  catch (e) { return json({ error: 'BAD_JSON' }, 400); }

  const text = str(body.text, 280);
  if (!text) return json({ error: 'EMPTY', message: '留言内容不能为空' }, 400);

  const rec = {
    id: 'msg:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8),
    text,
    role: str(body.role, 20),
    city: str(body.city, 20),
    contact: str(body.contact, 40),
    created: Date.now()
  };
  try {
    await kv.put(rec.id, JSON.stringify(rec), { expirationTtl: MSG_TTL });
    return json({ ok: true, id: rec.id });
  } catch (e) {
    return json({ error: 'PUT_FAILED', message: String((e && e.message) || e) }, 500);
  }
}
