import { json, err, genId, requireToken, rateLimit, getIp, getDB, nowSec, adminBypass } from '../_shared.js';

const MODES = ['voice', 'video'];

// 意图：POST 发布（语音优先）；GET 浏览他人开放意图
export async function onRequest(context) {
  const { request, env } = context;
  const db = getDB(env);
  if (!db) return err('DB_NOT_BOUND', 503);
  const ip = getIp(request);

  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) { return err('bad_json'); }
    const r = await requireToken(env, body.me);
    if (r.error) return err(r.error, r.status);

    if (!await rateLimit(db, 'rl:intent:' + ip, 30, 3600) && !adminBypass(env, request, body)) return err('rate_limited', 429);
    if (!await rateLimit(db, 'rl:intent:u:' + r.id, 10, 3600) && !adminBypass(env, request, body)) return err('too_many_intents', 429);

    const role = String(body.role || '').slice(0, 20) || '其他';
    const city = String(body.city || '').slice(0, 20);
    const mode = MODES.includes(body.mode) ? body.mode : 'voice'; // 默认语音优先
    const note = String(body.note || '').slice(0, 140);
    const meet = String(body.meet || '').slice(0, 300);

    // 每人只留一个开放意图：把旧的置为 closed
    await db.prepare("UPDATE intents SET status='closed' WHERE owner=? AND status='open'").bind(r.id).run();

    const id = 'i_' + genId(12);
    const now = nowSec();
    await db.prepare(`INSERT INTO intents (id, owner, role, city, mode, note, meet, status, created, expires)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`)
      .bind(id, r.id, role, city, mode, note, meet, now, now + 86400).run();
    return json({ ok: true, id, mode });
  }

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const me = url.searchParams.get('me');
    const r = await requireToken(env, me);
    if (r.error) return err(r.error, r.status);

    if (!await rateLimit(db, 'rl:list:' + ip, 120, 600) && !adminBypass(env, request, null)) return err('rate_limited', 429);

    // browse 列表：过滤掉「我屏蔽的人」发布的意图（LEFT JOIN blocks + WHERE NULL）
    const { results } = await db.prepare(`SELECT i.id, i.role, i.city, i.mode, i.note, i.created, i.owner, COALESCE(u.rep,50) AS rep
      FROM intents i
      LEFT JOIN users u ON u.id = i.owner
      LEFT JOIN blocks b ON b.user_id = ? AND b.blocked_id = i.owner
      WHERE i.status='open' AND i.expires > ? AND i.owner != ? AND b.user_id IS NULL
      ORDER BY RANDOM() LIMIT 40`)
      .bind(r.id, nowSec(), r.id).all();
    // 标记哪些是自己的（理论上 owner != r.id 已排除，这里再保险一次）
    const list = results.map(it => {
      const isOwn = it.owner === r.id;
      return { id: it.id, role: it.role, city: it.city, mode: it.mode, note: it.note, created: it.created, rep: it.rep, isOwn };
    });
    return json({ ok: true, list });
  }

  // 删除自己的意图
  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const me = url.searchParams.get('me');
    const intentId = url.searchParams.get('id');
    const r = await requireToken(env, me);
    if (r.error) return err(r.error, r.status);
    if (!intentId) return err('no_id');

    const intent = await db.prepare('SELECT owner FROM intents WHERE id=?').bind(intentId).first();
    if (!intent) return err('not_found', 404);
    if (intent.owner !== r.id) return err('not_owner', 403);

    await db.prepare("DELETE FROM applications WHERE intent_id=?").bind(intentId).run();
    await db.prepare("DELETE FROM intents WHERE id=?").bind(intentId).run();
    return json({ ok: true });
  }

  return err('method', 405);
}
