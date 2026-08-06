import { json, err, genId, requireToken, rateLimit, getIp, getDB, nowSec, adminBypass } from '../_shared.js';

// 申请组队 + 收件箱 / 发件箱
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
    if (!await rateLimit(db, 'rl:apply:' + ip, 40, 3600) && !adminBypass(env, request, body)) return err('rate_limited', 429);
    if (!await rateLimit(db, 'rl:apply:u:' + r.id, 20, 3600) && !adminBypass(env, request, body)) return err('too_many_applies', 429);

    const intentId = String(body.intentId || '');
    const intent = await db.prepare('SELECT * FROM intents WHERE id=?').bind(intentId).first();
    if (!intent) return err('intent_gone', 409);
    if (intent.status !== 'open') return err('intent_closed', 409);
    if (intent.owner === r.id) return err('self_apply', 400);

    // 屏蔽检查：对方的 user_id 在我的 block 列表 → 拒绝申请
    const blocked = await db.prepare('SELECT 1 FROM blocks WHERE user_id=? AND blocked_id=? LIMIT 1')
      .bind(r.id, intent.owner).first();
    if (blocked) return err('blocked', 403);

    // 同一意图重复申请去重
    const dup = await db.prepare('SELECT id FROM applications WHERE intent_id=? AND applicant=? AND status=?')
      .bind(intentId, r.id, 'pending').first();
    if (dup) return err('already_applied', 409);

    const appId = 'a_' + genId(12);
    const now = nowSec();
    await db.prepare(`INSERT INTO applications (id, intent_id, applicant, status, created, expires)
      VALUES (?, ?, ?, 'pending', ?, ?)`)
      .bind(appId, intentId, r.id, now, now + 86400).run();
    return json({ ok: true, appId, status: 'pending' });
  }

  if (request.method === 'DELETE') {
    // 申请方撤回自己的申请
    const url = new URL(request.url);
    const meTok = url.searchParams.get('me');
    const appId = url.searchParams.get('appId');
    const r = await requireToken(env, meTok);
    if (r.error) return err(r.error, r.status);
    if (!await rateLimit(db, 'rl:apply:' + ip, 40, 3600) && !adminBypass(env, request, null)) return err('rate_limited', 429);

    const app = await db.prepare('SELECT * FROM applications WHERE id=?').bind(appId).first();
    if (!app) return err('app_gone', 404);
    if (app.applicant !== r.id) return err('not_applicant', 403);
    if (app.status === 'both_accepted') return err('already_matched', 409);
    // pending / a_accepted 都可以撤回；rejected / cancelled / expired 重复撤回幂等返 ok
    await db.prepare("UPDATE applications SET status='cancelled' WHERE id=?")
      .bind(app.id).run();
    return json({ ok: true, status: 'cancelled' });
  }

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const me = url.searchParams.get('me');
    const box = url.searchParams.get('box') || 'in';
    const r = await requireToken(env, me);
    if (r.error) return err(r.error, r.status);

    if (box === 'in') {
      // 收件箱：按 (intent_id, applicant) 合并去重——同一对方对同一意图可能因
      // 「撤回再申请」产生多条 application，UI 只展示最新一条即可
      // 过滤掉申请方被我屏蔽的人（LEFT JOIN blocks + WHERE NULL 经典套路）
      const { results } = await db.prepare(`SELECT a.id AS appId, a.intent_id AS intentId, a.status, a.created, i.role, i.city, i.mode, i.note, COALESCE(u.rep,50) AS rep,
          (SELECT p.status FROM pairs p WHERE p.intent_id = a.intent_id AND p.status IN ('dissolving','closed') ORDER BY p.created DESC LIMIT 1) AS roomStatus
        FROM applications a
        JOIN intents i ON i.id = a.intent_id
        LEFT JOIN users u ON u.id = a.applicant
        LEFT JOIN blocks b ON b.user_id = ? AND b.blocked_id = a.applicant
        WHERE i.owner = ? AND a.expires > ? AND b.user_id IS NULL
          AND a.id = (
            SELECT a2.id FROM applications a2
            WHERE a2.intent_id = a.intent_id AND a2.applicant = a.applicant
            ORDER BY a2.created DESC LIMIT 1
          )
        ORDER BY a.created DESC`)
        .bind(r.id, r.id, nowSec()).all();
      return json({ ok: true, list: results });
    } else {
      // 发件箱：保留全部（自己能看到自己申请过谁）；UI 侧显示对方状态
      const { results } = await db.prepare(`SELECT a.id AS appId, a.intent_id AS intentId, a.status, a.created,
          (SELECT p.status FROM pairs p WHERE p.intent_id = a.intent_id AND p.status IN ('dissolving','closed') ORDER BY p.created DESC LIMIT 1) AS roomStatus
        FROM applications a
        WHERE a.applicant = ? AND a.expires > ?
        ORDER BY a.created DESC`)
        .bind(r.id, nowSec()).all();
      return json({ ok: true, list: results });
    }
  }
  return err('method', 405);
}
