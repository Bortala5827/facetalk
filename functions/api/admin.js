import { json, err, getDB } from '../_shared.js';

// 手动封禁（管理员）：POST {admin, target, action:'ban'|'unban'}
// admin 为 CF 环境变量 ADMIN_KEY（用户在控制台设置）
export async function onRequest(context) {
  const { request, env } = context;
  const db = getDB(env);
  if (!db) return err('DB_NOT_BOUND', 503);
  if (request.method !== 'POST') return err('method', 405);

  const key = env.ADMIN_KEY;
  if (!key) return err('ADMIN_NOT_SET', 503);

  let body;
  try { body = await request.json(); } catch (e) { return err('bad_json'); }
  if (body.admin !== key) return err('forbidden', 401);

  const target = String(body.target || '');
  if (!target) return err('no_target');
  const u = await db.prepare('SELECT id FROM users WHERE id=?').bind(target).first();
  if (!u) return err('user_not_found', 404);
  const banned = body.action === 'ban';
  await db.prepare('UPDATE users SET banned=? WHERE id=?').bind(banned ? 1 : 0, target).run();
  return json({ ok: true, target, banned });
}
