import { json, err, genId, requireToken, rateLimit, getIp, refreshUser, getKV } from '../_shared.js';

const MODES = ['voice', 'video'];

// 意图：POST 发布（语音优先）；GET 浏览他人开放意图
export async function onRequest(context) {
  const { request, env } = context;
  const kv = getKV(env);
  if (!kv) return err('KV_NOT_BOUND', 503);
  const ip = getIp(request);

  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) { return err('bad_json'); }
    const r = await requireToken(env, body.me);
    if (r.error) return err(r.error, r.status);

    if (!await rateLimit(kv, 'rl:intent:' + ip, 30, 3600)) return err('rate_limited', 429);
    if (!await rateLimit(kv, 'rl:intent:u:' + r.id, 10, 3600)) return err('too_many_intents', 429);

    const role = String(body.role || '').slice(0, 20) || '其他';
    const city = String(body.city || '').slice(0, 20);
    const mode = MODES.includes(body.mode) ? body.mode : 'voice'; // 默认语音优先
    const note = String(body.note || '').slice(0, 140);
    const meet = String(body.meet || '').slice(0, 300);

    // 每人只留一个开放意图：清掉旧的
    if (r.user.intentId) {
      await kv.delete('intent:' + r.user.intentId).catch(() => {});
    }
    const id = 'i_' + genId(12);
    const intent = { id, owner: r.id, role, city, mode, note, meet, status: 'open', created: Date.now() };
    await kv.put('intent:' + id, JSON.stringify(intent), { expirationTtl: 86400 });
    await refreshUser(kv, r.id, { intentId: id });
    return json({ ok: true, id, mode });
  }

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const me = url.searchParams.get('me');
    const r = await requireToken(env, me);
    if (r.error) return err(r.error, r.status);

    if (!await rateLimit(kv, 'rl:list:' + ip, 120, 600)) return err('rate_limited', 429);

    const out = [];
    try {
      let cursor;
      do {
        const opts = { prefix: 'intent:' };
        if (cursor) opts.cursor = cursor;
        const page = await kv.list(opts);
        for (const k of page.keys) {
          const raw = await kv.get(k.name);
          if (!raw) continue;
          let it;
          try { it = JSON.parse(raw); } catch (e) { continue; }
          // 已关闭/已匹配的意图提前清掉（不占 24h，也不污染列表）
          if (it.status !== 'open') { await kv.delete(k.name).catch(() => {}); continue; }
          if (it.owner === r.id) continue;
          const owner = await kv.get('u:' + it.owner);
          const rep = owner ? JSON.parse(owner).rep : 50;
          out.push({ id: it.id, role: it.role, city: it.city, mode: it.mode, note: it.note, rep, created: it.created });
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
    } catch (e) { /* 列表异常返回空 */ }
    // 随机打散，防爬抓顺序
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return json({ ok: true, list: out.slice(0, 40) });
  }
  return err('method', 405);
}
