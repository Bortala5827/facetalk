import { json, err, getDB, nowSec, requireToken } from '../_shared.js';

/**
 * FaceTalk 2.0 · 心跳保活 API
 * POST：更新用户最后活跃时间
 * GET ：批量查询用户在线状态
 *
 * 状态规则：
 *   ≤5 分钟  → online  🟢 当前在线
 *   5-30 分钟 → active  🟠 刚刚活跃
 *   >30 分钟  → offline ⚪ 历史离线
 */
export async function onRequest(context) {
  const { request, env } = context;
  const db = getDB(env);
  if (!db) return err('DB_NOT_BOUND', 503);
  const now = nowSec();

  // POST：更新心跳
  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch (e) { return err('bad_json'); }
    const r = await requireToken(env, body.me);
    if (r.error) return err(r.error, r.status);
    try {
      await db.prepare('UPDATE users SET last_active=? WHERE id=?').bind(now, r.id).run();
      return json({ ok: true, at: now });
    } catch (e) {
      // last_active 列不存在 → 静默降级
      return json({ ok: true, legacy: true });
    }
  }

  // GET：批量查在线状态
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const userList = (url.searchParams.get('users') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!userList.length) return json({ ok: true, online: {} });

    try {
      const placeholders = userList.map(() => '?').join(',');
      const { results } = await db.prepare(
        `SELECT id, last_active FROM users WHERE id IN (${placeholders})`
      ).bind(...userList).all();

      const map = {};
      (results || []).forEach(u => {
        const delta = now - (u.last_active || 0);
        if (delta <= 300) map[u.id] = 'online';
        else if (delta <= 1800) map[u.id] = 'active';
        else map[u.id] = 'offline';
      });
      return json({ ok: true, online: map });
    } catch (e) {
      return json({ ok: true, online: {}, legacy: true });
    }
  }

  return err('method', 405);
}
