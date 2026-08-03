// 面试搭子 · 腾讯会议室 API（Cloudflare Pages Functions + KV）
// KV 绑定名不限：优先 DAZI_KV，其次环境变量 KV_BINDING_NAME，再退化自动识别任意 KV 命名空间绑定。
//
import { getKV } from '../_shared.js';

// GET  /api/meetings  -> { items: [ {id, meeting, raw, role, city, note, contact, contactType, created} ] }
// POST /api/meetings  -> body { meeting, role?, city?, note?, contact?, contactType? } -> { ok, id }
//
// 会议室 24 小时后自动过期（KV expirationTtl）。本版仅支持腾讯会议，飞书等请在留言板说明。

const MEET_TTL = 60 * 60 * 24;   // 会议室 24h
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

// 校验并归一化腾讯会议输入：返回 { ok, link, raw, msg }
function normalizeTencent(input) {
  const s = (input || '').trim();
  if (!s) return { ok: false, msg: '请填写腾讯会议链接或会议号' };

  // 已是腾讯会议链接
  if (/meeting\.tencent\.com/i.test(s)) {
    const m = s.match(/meeting\.tencent\.com\/(dm|p)\/([A-Za-z0-9]+)/i);
    if (m) {
      return { ok: true, link: 'https://meeting.tencent.com/' + m[1].toLowerCase() + '/' + m[2], raw: m[2] };
    }
    return { ok: true, link: s, raw: s };
  }

  // 飞书 / Zoom 等其它会议 -> 拒绝（本版仅腾讯会议）
  if (/feishu|larksuite|zoom/i.test(s)) {
    return { ok: false, msg: '本版仅支持腾讯会议，飞书 / 其它会议请在下方留言板说明' };
  }

  // 纯会议号：抽取数字（兼容空格 / 连字符）
  const digits = s.replace(/[^0-9]/g, '');
  if (digits.length >= 9 && digits.length <= 11) {
    return { ok: true, link: 'https://meeting.tencent.com/p/' + digits, raw: s };
  }
  return { ok: false, msg: '无法识别为腾讯会议链接或 9–11 位会议号' };
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
    const list = await kv.list({ prefix: 'meet:' });
    const now = Date.now();
    const items = [];
    for (const k of list.keys) {
      if (k.expiration && k.expiration * 1000 <= now) continue; // 安全过滤：未到过期
      const v = await kv.get(k.name, { type: 'json' });
      if (v && v.meeting) items.push(v);
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

  const norm = normalizeTencent(body.meeting);
  if (!norm.ok) return json({ error: 'BAD_MEETING', message: norm.msg }, 400);

  const rec = {
    id: 'meet:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8),
    meeting: norm.link,
    raw: norm.raw,
    type: '腾讯会议',
    role: str(body.role, 20),
    city: str(body.city, 20),
    note: str(body.note, 200),
    contact: str(body.contact, 40),
    contactType: str(body.contactType, 10),
    created: Date.now()
  };
  try {
    await kv.put(rec.id, JSON.stringify(rec), { expirationTtl: MEET_TTL });
    return json({ ok: true, id: rec.id });
  } catch (e) {
    return json({ error: 'PUT_FAILED', message: String((e && e.message) || e) }, 500);
  }
}
