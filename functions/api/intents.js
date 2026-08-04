import { json, err, genId, requireToken, rateLimit, getIp, getDB, nowSec } from '../_shared.js';

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

    if (!await rateLimit(db, 'rl:intent:' + ip, 30, 3600)) return err('rate_limited', 429);
    if (!await rateLimit(db, 'rl:intent:u:' + r.id, 10, 3600)) return err('too_many_intents', 429);

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

    if (!await rateLimit(db, 'rl:list:' + ip, 120, 600)) return err('rate_limited', 429);

    const { results } = await db.prepare(`SELECT i.id, i.role, i.city, i.mode, i.note, i.created, COALESCE(u.rep,50) AS rep
      FROM intents i LEFT JOIN users u ON u.id = i.owner
      WHERE i.status='open' AND i.owner<>? AND i.expires > ?
      ORDER BY RANDOM() LIMIT 40`)
      .bind(r.id, nowSec()).all();
    return json({ ok: true, list: results });
  }
  return err('method', 405);
}
