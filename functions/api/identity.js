import { json, err, genId, requireToken, getDB, nowSec } from '../_shared.js';

// 匿名一次性身份：POST 发新 token；GET ?id= 取信誉/封禁状态
export async function onRequest(context) {
  const { request, env } = context;
  const db = getDB(env);
  if (!db) return err('DB_NOT_BOUND', 503);

  if (request.method === 'POST') {
    const id = 'u_' + genId(16);
    await db.prepare('INSERT INTO users (id, rep, banned, created) VALUES (?, 50, 0, ?)')
      .bind(id, nowSec()).run();
    return json({ ok: true, id });
  }

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const r = await requireToken(env, id);
    if (r.error) return err(r.error, r.status);
    return json({ ok: true, id: r.id, rep: r.user.rep, banned: false });
  }
  return err('method', 405);
}
