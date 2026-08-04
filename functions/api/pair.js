import { json, err, genId, requireToken, clampRep, getDB, nowSec, rateLimit, getIp } from '../_shared.js';

const SESSION_TTL = 1800; // 单次互练软上限 30 分钟（秒）

// 配对：决定(同意/拒绝) / 状态 / 互评 / 举报
export async function onRequest(context) {
  const { request, env } = context;
  const db = getDB(env);
  if (!db) return err('DB_NOT_BOUND', 503);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const me = url.searchParams.get('me');
    const r = await requireToken(env, me);
    if (r.error) return err(r.error, r.status);
    const now = nowSec();
    const p = await db.prepare('SELECT * FROM pairs WHERE (a=? OR b=?) AND expires > ? ORDER BY created DESC LIMIT 1')
      .bind(r.id, r.id, now).first();
    if (!p) return json({ ok: true, pair: null });
    const ratings = safeParse(p.ratings);
    const other = r.id === p.a ? p.b : p.a;
    const o = await db.prepare('SELECT rep FROM users WHERE id=?').bind(other).first();
    const otherRep = o ? (o.rep | 0) : 50;
    const rated = !!ratings[r.id];
    const remaining = Math.max(0, p.expires - now);
    const isA = r.id === p.a;
    const infoMine = (isA ? p.info_a : p.info_b) || '';
    const infoPeer = (isA ? p.info_b : p.info_a) || '';
    return json({
      ok: true,
      pair: {
        pairId: p.id, otherRep, meet: p.meet, mode: p.mode, status: p.status,
        infoMine, infoPeer,
        ratingsCount: Object.keys(ratings || {}).length, remaining, rated,
        nextAllowed: p.status === 'done' && bothNext(ratings) && bothPass(ratings),
      },
    });
  }

  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) { return err('bad_json'); }
    const r = await requireToken(env, body.me);
    if (r.error) return err(r.error, r.status);
    const action = body.action;

    if (action === 'decide') {
      const app = await db.prepare('SELECT * FROM applications WHERE id=?').bind(body.appId).first();
      if (!app) return err('app_gone', 404);
      const intent = await db.prepare('SELECT * FROM intents WHERE id=?').bind(app.intent_id).first();
      if (!intent) return err('intent_gone', 409);
      if (intent.owner !== r.id) return err('not_owner', 403);

      if (body.decision === 'accept') {
        // 双向互选第 1 步：A（意图方）点了「同意」。
        // 此时不建 pair，只把这条申请置为 a_accepted，等 B 也点头。
        // 注意：不要再顺手把同意图下其它 pending 申请置 rejected——
        // 否则 A 一点「同意」，其余申请瞬间全变「已拒绝」，用户会以为是"自动拒绝" bug。
        // 改成只把之前已点过同意的其它申请回退为 pending（允许反悔改选），
        // pending 的其它申请保持原样，等真正建房间(b-accept)时再统一清理。
        await db.batch([
          db.prepare("UPDATE applications SET status='pending' WHERE intent_id=? AND status='a_accepted' AND id<>?")
            .bind(app.intent_id, app.id),
          db.prepare("UPDATE applications SET status='a_accepted' WHERE id=?")
            .bind(app.id),
        ]);
        return json({ ok: true, status: 'a_accepted' });
      }

      if (body.decision === 'cancel-accept') {
        // A 反悔撤回刚才的同意，回退到 pending，等他重新选别人
        if (app.status !== 'a_accepted') return err('not_a_accepted', 409);
        await db.prepare("UPDATE applications SET status='pending' WHERE id=?")
          .bind(app.id).run();
        return json({ ok: true, status: 'pending' });
      }

      // decision === 'reject'
      await db.prepare("UPDATE applications SET status='rejected' WHERE id=?")
        .bind(app.id).run();
      return json({ ok: true, status: 'rejected' });
    }

    if (action === 'b-accept') {
      // 双向互选第 2 步：B（申请方）看到 A 已点头，点了「我也同意」。
      // 此时才正式创建 pair + intent.matched。
      const app = await db.prepare('SELECT * FROM applications WHERE id=?').bind(body.appId).first();
      if (!app) return err('app_gone', 404);
      if (app.applicant !== r.id) return err('not_applicant', 403);
      if (app.status !== 'a_accepted') return err('not_a_accepted', 409);
      const intent = await db.prepare('SELECT * FROM intents WHERE id=?').bind(app.intent_id).first();
      if (!intent) return err('intent_gone', 409);
      if (intent.status !== 'open') return err('intent_closed', 409);

      const pairId = 'p_' + genId(12);
      const now = nowSec();
      await db.batch([
        db.prepare(`INSERT INTO pairs (id, a, b, intent_id, mode, meet, status, ratings, created, expires)
          VALUES (?, ?, ?, ?, ?, ?, 'matched', '{}', ?, ?)`)
          .bind(pairId, intent.owner, app.applicant, intent.id, intent.mode, intent.meet || '', now, now + SESSION_TTL),
        db.prepare("UPDATE applications SET status='both_accepted' WHERE id=?")
          .bind(app.id),
        // 真正配对成功后，才把该意图下其它申请（pending / 之前的 a_accepted）统一置为 rejected
        db.prepare("UPDATE applications SET status='rejected' WHERE intent_id=? AND status IN ('pending','a_accepted') AND id<>?")
          .bind(intent.id, app.id),
        db.prepare("UPDATE intents SET status='matched' WHERE id=?")
          .bind(intent.id),
      ]);
      return json({ ok: true, pairId });
    }

    if (action === 'rate') {
      const p = await db.prepare('SELECT * FROM pairs WHERE id=?').bind(body.pairId).first();
      if (!p) return err('pair_gone', 404);
      if (r.id !== p.a && r.id !== p.b) return err('not_party', 403);
      const ratings = safeParse(p.ratings);
      if (ratings[r.id]) return err('already_rated', 409);
      const score = Math.max(1, Math.min(5, parseInt(body.score, 10) || 3));
      const tags = Array.isArray(body.tags) ? body.tags.slice(0, 5).map(String) : [];
      const next = !!body.next;
      const other = r.id === p.a ? p.b : p.a;
      ratings[r.id] = { score, tags, next, at: nowSec() };

      const o = await db.prepare('SELECT rep FROM users WHERE id=?').bind(other).first();
      const newRep = clampRep((o ? (o.rep | 0) : 50) + (score - 3));

      const done = Object.keys(ratings).length >= 2;
      await db.batch([
        db.prepare('UPDATE users SET rep=? WHERE id=?').bind(newRep, other),
        db.prepare("UPDATE pairs SET ratings=?, status=? WHERE id=?").bind(JSON.stringify(ratings), done ? 'done' : 'matched', p.id),
        db.prepare(`INSERT INTO ratings (id, pair_id, from_user, to_user, score, tags, next, created)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind('r_' + genId(12), p.id, r.id, other, score, JSON.stringify(tags), next ? 1 : 0, nowSec()),
      ]);
      return json({ ok: true, done });
    }

    if (action === 'set-info') {
      // 更新我方填写的联机信息（腾讯会议 / 联系方式），置顶常驻，对方实时可见
      const p = await db.prepare('SELECT * FROM pairs WHERE id=?').bind(body.pairId).first();
      if (!p) return err('pair_gone', 404);
      if (r.id !== p.a && r.id !== p.b) return err('not_party', 403);
      if (!await rateLimit(db, 'rl:info:' + getIp(request), 10, 300)) return err('rate_limited', 429);
      const info = String(body.info || '').replace(/\s+/g, ' ').trim().slice(0, 500);
      const col = r.id === p.a ? 'info_a' : 'info_b';
      await db.prepare('UPDATE pairs SET ' + col + '=? WHERE id=?').bind(info, p.id).run();
      return json({ ok: true });
    }

    if (action === 'report') {
      const p = await db.prepare('SELECT * FROM pairs WHERE id=?').bind(body.pairId).first();
      if (!p) return err('pair_gone', 404);
      if (r.id !== p.a && r.id !== p.b) return err('not_party', 403);

      // ─── 反恶意举报 5 重门槛 ───
      // 1) 必须有有效配对（双方均接受 → status matched/done），禁止未配对就举报
      if (p.status !== 'matched' && p.status !== 'done') return err('pair_not_active', 409);
      // 2) 举报方必须实际填过联机信息（证明确实"聊过"，防注册即举报）
      const myCol = r.id === p.a ? 'info_a' : 'info_b';
      const myInfo = (p[myCol] || '').trim();
      if (myInfo.length < 4) return err('need_contact_first', 409);
      // 3) 理由必填且 ≥5 字符（防误点 / 无脑举报）
      const reason = String(body.reason || '').trim();
      if (reason.length < 5) return err('reason_too_short', 400);
      // 4) 同 IP 60s 限流 1 次（防脚本刷）
      if (!await rateLimit(db, 'rl:report:' + getIp(request), 1, 60)) return err('rate_limited', 429);
      // 5) (by, target) 去重：UNIQUE 索引 + INSERT OR IGNORE 双重兜底
      try { await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_by_target ON reports(by, target)`); } catch (e) { /* 历史数据偶发重复，忽略 */ }

      const other = r.id === p.a ? p.b : p.a;
      const now = nowSec();
      const ins = await db.prepare(`INSERT OR IGNORE INTO reports (id, target, by, reason, created) VALUES (?, ?, ?, ?, ?)`)
        .bind('rep_' + genId(12), other, r.id, reason.slice(0, 200), now).run();
      const inserted = !!(ins && ins.meta && ins.meta.changes > 0);
      // 计数改为不同举报人数（防同一举报者反复凑数 → 需 3 个不同人举报才封禁）
      const cntRow = await db.prepare('SELECT COUNT(DISTINCT by) AS c FROM reports WHERE target=?').bind(other).first();
      const cnt = cntRow ? cntRow.c : 0;
      let banned = false;
      if (cnt >= 3) {
        await db.prepare('UPDATE users SET banned=1 WHERE id=?').bind(other).run();
        banned = true;
      }
      return json({ ok: true, banned, reports: cnt, dup: !inserted });
    }

    return err('unknown_action', 400);
  }
  return err('method', 405);
}

function safeParse(s) {
  try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; }
}
function bothNext(ratings) { return ratings && ratings.a && ratings.b && ratings.a.next && ratings.b.next; }
function bothPass(ratings) { return ratings && ratings.a && ratings.b && ratings.a.score >= 3 && ratings.b.score >= 3; }
