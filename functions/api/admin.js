import { json, err, getDB } from '../_shared.js';

// 管理员接口：POST {admin, action, target, intentId}
// action: ban | unban | delete_intent | list_intents | list_users | delete_user | clear_all
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

  const action = String(body.action || '');

  // 封禁/解封用户
  if (action === 'ban' || action === 'unban') {
    const target = String(body.target || '');
    if (!target) return err('no_target');
    const u = await db.prepare('SELECT id FROM users WHERE id=?').bind(target).first();
    if (!u) return err('user_not_found', 404);
    const banned = action === 'ban';
    await db.prepare('UPDATE users SET banned=? WHERE id=?').bind(banned ? 1 : 0, target).run();
    return json({ ok: true, target, banned });
  }

  // 列出所有意图（管理员查看）
  if (action === 'list_intents') {
    const { results } = await db.prepare(`SELECT i.id, i.owner, i.role, i.city, i.mode, i.note, i.status, i.created, i.expires
      FROM intents i ORDER BY i.created DESC LIMIT 100`).all();
    return json({ ok: true, list: results });
  }

  // 列出所有用户（管理员查看）
  if (action === 'list_users') {
    const { results } = await db.prepare(
      'SELECT id, rep, banned, created FROM users ORDER BY created DESC LIMIT 100'
    ).all();
    return json({ ok: true, list: results });
  }

  // 列出留言墙全部留言（整合进 /admin 后台管理）
  if (action === 'list_walls') {
    try {
      const { results } = await db.prepare(
        'SELECT id, name, text, created_at FROM wall ORDER BY created_at DESC LIMIT 200'
      ).all();
      const items = (results || []).map(function (r) {
        return { id: r.id, name: r.name, text: r.text, createdAt: r.created_at };
      });
      return json({ ok: true, list: items });
    } catch (e) {
      return json({ ok: false, error: 'DB_ERR', list: [] }, 500);
    }
  }

  // 列出所有举报（按被举报人聚合：举报次数、举报人、原因、是否已达封禁线）
  if (action === 'list_reports') {
    try {
      const { results } = await db.prepare(
        'SELECT target, by, reason, created FROM reports ORDER BY created DESC LIMIT 500'
      ).all();
      const map = {};
      let total = 0;
      for (const r of (results || [])) {
        total++;
        if (!map[r.target]) map[r.target] = { target: r.target, count: 0, banned: false, items: [] };
        map[r.target].count++;
        map[r.target].items.push({ by: r.by, reason: r.reason, created: r.created });
      }
      // 取各被举报人的 banned 状态
      const targets = Object.keys(map);
      for (const t of targets) {
        try {
          const u = await db.prepare('SELECT banned FROM users WHERE id=?').bind(t).first();
          if (u) map[t].banned = !!u.banned;
        } catch (e) { /* users 表无 banned 列：降级为 false */ }
      }
      const list = targets.map(function (t) { return map[t]; })
        .sort(function (a, b) { return b.count - a.count; });
      return json({ ok: true, list: list, total: total });
    } catch (e) {
      return json({ ok: false, error: 'DB_ERR', list: [] }, 500);
    }
  }

  // 删除单条留言墙留言（管理员）
  if (action === 'delete_wall') {
    const wallId = String(body.wallId || '');
    if (!wallId) return err('no_wall_id');
    const chk = await db.prepare('SELECT id FROM wall WHERE id=?').bind(wallId).first();
    if (!chk) return err('wall_not_found', 404);
    await db.prepare('DELETE FROM wall WHERE id=?').bind(wallId).run();
    return json({ ok: true, removed: wallId });
  }

  // 删除任意意图（管理员）
  if (action === 'delete_intent') {
    const intentId = String(body.intentId || '');
    if (!intentId) return err('no_intent_id');
    const intent = await db.prepare('SELECT id FROM intents WHERE id=?').bind(intentId).first();
    if (!intent) return err('intent_not_found', 404);
    await db.prepare("DELETE FROM applications WHERE intent_id=?").bind(intentId).run();
    await db.prepare("DELETE FROM intents WHERE id=?").bind(intentId).run();
    return json({ ok: true, deleted: intentId });
  }

  // 删除用户及其所有数据（管理员）
  if (action === 'delete_user') {
    const target = String(body.target || '');
    if (!target) return err('no_target');
    const u = await db.prepare('SELECT id FROM users WHERE id=?').bind(target).first();
    if (!u) return err('user_not_found', 404);
    // 删除该用户的所有意图及相关申请
    const { results: intents } = await db.prepare('SELECT id FROM intents WHERE owner=?').bind(target).all();
    for (const it of intents) {
      await db.prepare("DELETE FROM applications WHERE intent_id=?").bind(it.id).run();
    }
    await db.prepare("DELETE FROM intents WHERE owner=?").bind(target).run();
    await db.prepare("DELETE FROM applications WHERE applicant=?").bind(target).run();
    await db.prepare("DELETE FROM users WHERE id=?").bind(target).run();
    return json({ ok: true, deleted: target, intentsDeleted: intents.length });
  }

  // 一键清空全部数据（测试/重置用；不可逆）
  if (action === 'clear_all') {
    const ops = [
      db.prepare('DELETE FROM messages'),
      db.prepare('DELETE FROM ratings'),
      db.prepare('DELETE FROM reports'),
      db.prepare('DELETE FROM pairs'),
      db.prepare('DELETE FROM applications'),
      db.prepare('DELETE FROM intents'),
      db.prepare('DELETE FROM rate_limits'),
      db.prepare('DELETE FROM users'),
    ];
    await db.batch(ops);
    return json({ ok: true, cleared: ops.length });
  }

  return err('unknown_action', 400);
}
