import { json, err, genId, requireToken, rateLimit, getIp, getDB, nowSec, adminBypass, refreshGeo } from '../_shared.js';

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
    await refreshGeo(db, request, r.id); // 抓发布者(A) IP 地理，匹配前就存好

    if (!await rateLimit(db, 'rl:intent:' + ip, 30, 3600) && !adminBypass(env, request, body)) return err('rate_limited', 429);
    if (!await rateLimit(db, 'rl:intent:u:' + r.id, 10, 3600) && !adminBypass(env, request, body)) return err('too_many_intents', 429);

    const role = String(body.role || '').slice(0, 20) || '其他';
    const city = String(body.city || '').slice(0, 20);
    const mode = MODES.includes(body.mode) ? body.mode : 'voice'; // 默认语音优先
    const note = String(body.note || '').slice(0, 140);
    const meet = String(body.meet || '').slice(0, 300);

    const id = 'i_' + genId(12);
    const now = nowSec();
    // 每人只留一个开放意图：把旧的置为 closed（事务化，避免并发竞态）
    // ip 列用于「在线发需求人数」统计；若尚未 ALTER 加入，回退不带 ip 的写法
    try {
      await db.batch([
        db.prepare("UPDATE intents SET status='closed' WHERE owner=? AND status='open'").bind(r.id),
        db.prepare(`INSERT INTO intents (id, owner, role, city, mode, note, meet, status, created, expires, ip)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`)
          .bind(id, r.id, role, city, mode, note, meet, now, now + 86400, ip),
      ]);
    } catch (e) {
      await db.batch([
        db.prepare("UPDATE intents SET status='closed' WHERE owner=? AND status='open'").bind(r.id),
        db.prepare(`INSERT INTO intents (id, owner, role, city, mode, note, meet, status, created, expires)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`)
          .bind(id, r.id, role, city, mode, note, meet, now, now + 86400),
      ]);
    }
    return json({ ok: true, id, mode });
  }

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const me = url.searchParams.get('me');
    const box = url.searchParams.get('box') || 'browse';
    const r = await requireToken(env, me);
    if (r.error) return err(r.error, r.status);

    if (box === 'mine') {
      // 「我发布的需求」：返回自己当前开放的意图 + 申请人数（供首页即时展示，避免重复提交）
      const { results } = await db.prepare(`SELECT i.id, i.role, i.city, i.mode, i.note, i.meet, i.created,
          (SELECT COUNT(*) FROM applications a WHERE a.intent_id=i.id AND a.expires > ? AND a.status IN ('pending','a_accepted')) AS applicants
        FROM intents i
        WHERE i.owner=? AND i.status='open' AND i.expires > ?
        ORDER BY i.created DESC`)
        .bind(nowSec(), r.id, nowSec()).all();
      return json({ ok: true, list: results });
    }

    if (!await rateLimit(db, 'rl:list:' + ip, 120, 600) && !adminBypass(env, request, null)) return err('rate_limited', 429);

    // browse 列表：过滤掉「我屏蔽的人」发布的意图（LEFT JOIN blocks + WHERE NULL）
    const { results } = await db.prepare(`SELECT i.id, i.role, i.city, i.mode, i.note, i.created, i.owner, COALESCE(u.rep,50) AS rep
      FROM intents i
      LEFT JOIN users u ON u.id = i.owner
      LEFT JOIN blocks b ON b.user_id = ? AND b.blocked_id = i.owner
      WHERE i.status='open' AND i.expires > ? AND i.owner != ? AND b.user_id IS NULL
      ORDER BY RANDOM() LIMIT 40`)
      .bind(r.id, nowSec(), r.id).all();
    const list = results.map(it => {
      return { id: it.id, role: it.role, city: it.city, mode: it.mode, note: it.note, created: it.created, rep: it.rep, isOwn: false };
    });

    // 当前在线发需求人数：统计「当前仍开放且未过期」需求的去重 IP 数。
    // 注意：不能用 created > now-1800（近30分钟发布）过滤——那样会把昨天发布、今天仍 open 的需求算成 0。
    // 语义 = 「此刻还挂着开放需求的人」，不是「近30分钟内活跃过的人」（后者需要心跳机制，v1.0 没做）。
    let online = 0;
    try {
      const oc = await db.prepare("SELECT COUNT(DISTINCT ip) AS c FROM intents WHERE status='open' AND expires > ?")
        .bind(nowSec()).first();
      online = oc ? oc.c : 0;
    } catch (e) {
      const oc = await db.prepare("SELECT COUNT(DISTINCT owner) AS c FROM intents WHERE status='open' AND expires > ?")
        .bind(nowSec()).first();
      online = oc ? oc.c : 0;
    }
    return json({ ok: true, list, online });
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
