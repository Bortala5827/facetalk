import { json, err, genId, requireToken, rateLimit, getIp, getDB, nowSec } from '../_shared.js';

// 搭子房间留言板：配对双方互留文字（约时间 / 留备用联系方式）。
// 安全规则：仅 pair 双方可读写；每人只能删自己发的留言（自删除）。
export async function onRequest(context) {
  const { request, env } = context;
  const db = getDB(env);
  if (!db) return err('DB_NOT_BOUND', 503);
  const ip = getIp(request);

  // 校验请求者是该 pair 成员，返回 {r, p} 或 {error, status}
  async function memberCheck(me, pairId) {
    if (!pairId) return { error: 'missing_pair', status: 400 };
    const r = await requireToken(env, me);
    if (r.error) return { error: r.error, status: r.status };
    const p = await db.prepare('SELECT * FROM pairs WHERE id=?').bind(pairId).first();
    if (!p) return { error: 'pair_gone', status: 404 };
    if (r.id !== p.a && r.id !== p.b) return { error: 'not_party', status: 403 };
    return { r, p };
  }

  if (request.method === 'GET') {
    // 拉取该房间全部留言（按时间正序）
    const url = new URL(request.url);
    const pairId = url.searchParams.get('pair');
    const m = await memberCheck(url.searchParams.get('me'), pairId);
    if (m.error) return err(m.error, m.status);
    const { results } = await db.prepare(
      'SELECT id, sender, text, created FROM messages WHERE pair_id=? ORDER BY created ASC LIMIT 500'
    ).bind(pairId).all();
    const me = m.r.id;
    const list = (results || []).map(function (x) {
      return { id: x.id, text: x.text, created: x.created, mine: x.sender === me };
    });
    return json({ ok: true, list });
  }

  if (request.method === 'POST') {
    // 发留言：1–300 字，房间双方均可
    let body;
    try { body = await request.json(); } catch (e) { return err('bad_json'); }
    const m = await memberCheck(body.me, String(body.pair || ''));
    if (m.error) return err(m.error, m.status);
    if (!await rateLimit(db, 'rl:msg:' + ip, 30, 300)) return err('rate_limited', 429);
    if (!await rateLimit(db, 'rl:msg:u:' + m.r.id, 60, 3600)) return err('too_many_msgs', 429);
    const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text) return err('empty_text', 400);
    const id = 'm_' + genId(12);
    const now = nowSec();
    await db.prepare('INSERT INTO messages (id, pair_id, sender, text, created) VALUES (?, ?, ?, ?, ?)')
      .bind(id, m.p.id, m.r.id, text, now).run();
    return json({ ok: true, id, created: now, mine: true });
  }

  if (request.method === 'DELETE') {
    // 自删除：只能删自己发的留言；不存在/重复删幂等处理为报错由前端提示
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const meTok = url.searchParams.get('me');
    if (!id || !meTok) return err('missing_params', 400);
    const r = await requireToken(env, meTok);
    if (r.error) return err(r.error, r.status);
    const msg = await db.prepare('SELECT * FROM messages WHERE id=?').bind(id).first();
    if (!msg) return err('msg_gone', 404);
    if (msg.sender !== r.id) return err('not_owner', 403);
    await db.prepare('DELETE FROM messages WHERE id=?').bind(id).run();
    return json({ ok: true });
  }
  return err('method', 405);
}
