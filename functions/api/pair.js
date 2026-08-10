import { json, err, genId, requireToken, clampRep, getDB, nowSec, rateLimit, getIp, adminBypass, dropPairClips } from '../_shared.js';

// 单次互练「建议时长」软上限 20 分钟（秒）：倒计时归零只提示 + 弹评价卡，**不关房间**，
// 双方在腾讯会议 / 飞书会议里练多久都行，回来照样能提交评价。
const SESSION_TTL = 1200;
// 房间行在库里的硬存活上限 1 天：超过即视为废弃，GET 查不到 + 每日 cleanup 回收，不长期占空间。
const ROOM_TTL = 86400;
// 房间结算关闭后再留 2 分钟可见，让还开着页面的一方能收到「房间已关闭」提示再跳回首页。
const CLOSED_LINGER = 120;
// 一方已交评价、另一方还没交时，给未交的一方 10 分钟宽限；到点自动结算，先交的那位不会被无限挂住。
const SOLO_GRACE = 600;
// 在线心跳阈值（秒）：前端每 5s 轮询一次 /api/pair 即刷新 last_seen；
// 对方 last_seen 距现在超过该值即视为离线（覆盖后台标签页节流到 ~1 次/分的情况，避免误判离线）。
const ONLINE_TTL = 90;

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
    // 心跳：每次轮询都刷新自己的 last_seen，供对方判断「是否在线」
    try { await db.prepare('UPDATE users SET last_seen=? WHERE id=?').bind(now, r.id).run(); } catch (e) {}
    const p = await db.prepare('SELECT * FROM pairs WHERE (a=? OR b=?) AND expires > ? ORDER BY created DESC LIMIT 1')
      .bind(r.id, r.id, now).first();
      if (!p) return json({ ok: true, pair: null });
      const ratings = safeParse(p.ratings);
      // 从 ratings JSON 的 at 时间推算兜底计时：即使 dissolve_at/closed_at 列未 ALTER 也能自动结算
      const leftAt = (ratings[p.a] && ratings[p.a].left ? (ratings[p.a].at || 0) : 0) || (ratings[p.b] && ratings[p.b].left ? (ratings[p.b].at || 0) : 0);
      const ratedAt = (ratings[p.a] && ratings[p.a].at && ratings[p.b] && ratings[p.b].at) ? Math.max(ratings[p.a].at, ratings[p.b].at) : 0;
      // 服务端兜底：任意一次轮询命中过期时间即直接关房，不依赖某一方还开着页面
      // 退出 60s / 双方互评完 5 分钟两个时机；列存在优先用列，列缺失回退用 ratings.at
      const exitDue = p.status === 'dissolving' && ((p.dissolve_at || 0) > 0 ? now >= p.dissolve_at : leftAt > 0 && now >= leftAt + 60);
      const settleDue = p.status === 'done' && ((p.closed_at || 0) > 0 ? now >= p.closed_at : ratedAt > 0 && now >= ratedAt + 300);
      // 只有一方交了评价（且不是"退出"标记）→ 给另一方 SOLO_GRACE 宽限，到点才结算关房。
      // 倒计时归零不再关房，所以这里是"单方已评"场景唯一的兜底出口。
      const rateAtOf = (uid) => (ratings[uid] && !ratings[uid].left && ratings[uid].at) ? ratings[uid].at : 0;
      const rAtA = rateAtOf(p.a), rAtB = rateAtOf(p.b);
      const soloAt = (rAtA && !rAtB) ? rAtA : ((rAtB && !rAtA) ? rAtB : 0);
      const soloDue = p.status === 'matched' && soloAt > 0 && now >= soloAt + SOLO_GRACE;
      if (exitDue || settleDue || soloDue) {
        await closeRoomDB(db, p.id);
        p.status = 'closed';
      }
      const other = r.id === p.a ? p.b : p.a;
      const o = await db.prepare('SELECT rep FROM users WHERE id=?').bind(other).first();
      const otherRep = o ? (o.rep | 0) : 50;
      // （已移除：对方 IP 地理 / 在线状态展示）
      const rated = !!ratings[r.id];
      const left = !!(ratings[r.id] && ratings[r.id].left);
      // 倒计时用「建房时间 + 20 分钟」算，与房间硬过期 expires（1 天）解耦：
      // 归零 = 建议时长到了，前端弹评价卡；房间本身仍在，双方可继续练 / 慢慢评。
      const remaining = Math.max(0, (p.created || now) + SESSION_TTL - now);
      const isA = r.id === p.a;
      const infoMine = (isA ? p.info_a : p.info_b) || '';
      const infoPeer = (isA ? p.info_b : p.info_a) || '';
      const dissolving = p.status === 'dissolving';
      let dissolveIn = dissolving ? Math.max(0, (p.dissolve_at || 0) - now) : 0;
      if (dissolving && dissolveIn === 0 && leftAt > 0) dissolveIn = Math.max(0, leftAt + 60 - now);
      let autoCloseIn = (p.status === 'done') ? Math.max(0, (p.closed_at || 0) - now) : 0;
      if (p.status === 'done' && autoCloseIn === 0 && ratedAt > 0) autoCloseIn = Math.max(0, ratedAt + 300 - now);
      // 单方已评时剩余的宽限秒数（0 = 不在该场景）。前端据此提示"对方还有 X 分钟提交评价"。
      const soloGraceIn = (p.status === 'matched' && soloAt > 0) ? Math.max(0, soloAt + SOLO_GRACE - now) : 0;
    return json({
      ok: true,
      pair: {
        pairId: p.id, otherRep, meet: p.meet, mode: p.mode, status: p.status,
        infoMine, infoPeer,
        ratingsCount: Object.keys(ratings || {}).length, remaining, rated, left,
        dissolving, dissolveIn, autoCloseIn, soloGraceIn,
        nextAllowed: p.status === 'done' && bothNext(ratings, p.a, p.b) && bothPass(ratings, p.a, p.b),
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
      if (intent.status !== 'open') return err('intent_closed', 409);

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

      // 防 race：该意图已生成过 pair（并发双 b-accept）→ 拒绝重复建房间
      const existing = await db.prepare("SELECT id FROM pairs WHERE intent_id=? AND status IN ('matched','dissolving') LIMIT 1").bind(intent.id).first();
      if (existing) return err('already_paired', 409);

      const pairId = 'p_' + genId(12);
      const now = nowSec();
      await db.batch([
        db.prepare(`INSERT INTO pairs (id, a, b, intent_id, mode, meet, status, ratings, created, expires)
          VALUES (?, ?, ?, ?, ?, ?, 'matched', '{}', ?, ?)`)
          .bind(pairId, intent.owner, app.applicant, intent.id, intent.mode, intent.meet || '', now, now + ROOM_TTL),
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
      const score = Math.max(1, Math.min(5, parseInt(body.score, 10) || 3));
      const tags = Array.isArray(body.tags) ? body.tags.slice(0, 5).map(String) : [];
      const next = !!body.next;
      const blockNext = !!body.blockNext;
      const other = r.id === p.a ? p.b : p.a;
      const now = nowSec();
      // 位置 key（用于 _evaluated 状态位）与用户 id（用于 ratings 顶层 key）是两套，别混用
      const myKey = (r.id === p.a) ? 'a' : 'b';
      const otherKey = (r.id === p.a) ? 'b' : 'a';
      const o = await db.prepare('SELECT rep FROM users WHERE id=?').bind(other).first();
      const newRep = clampRep((o ? (o.rep | 0) : 50) + (score - 3));

      // === 2.1 修复：读-改-写并发竞态 → CAS 乐观锁重试（最多 3 次） ===
      // 原实现双方同时提交时后写者会用旧 ratings 覆盖先写者 → _evaluated 丢失 → 房间永远 matched，
      // 前端 render/tick 反复开合评价卡造成"来回闪退"。CAS 以「旧 ratings 原文」作为 UPDATE 条件，
      // changes=0 说明本轮被并发修改，重读重试，保证双方评分与状态位都不丢。
      let bothEvaluated = false, timedOut = false, committed = false;
      for (let attempt = 0; attempt < 3 && !committed; attempt++) {
        const cur = await db.prepare('SELECT ratings FROM pairs WHERE id=?').bind(body.pairId).first();
        if (!cur) return err('pair_gone', 404);
        const ratings = safeParse(cur.ratings);
        if (ratings[r.id]) return err('already_rated', 409);
        if (!ratings._evaluated) ratings._evaluated = {};
        ratings._evaluated[myKey] = true;
        ratings[r.id] = { score, tags, next, blockNext, at: now };

        // 3 分钟超时兜底：对方已评（ratings 顶层 key = 用户 id，不是 'a'/'b'）且超过 180s 我还没评 → 强制结算
        const otherRatedTime = (ratings[other] && !ratings[other].left) ? (ratings[other].at || 0) : 0;
        if (ratings._evaluated[myKey] && !ratings._evaluated[otherKey] && otherRatedTime && (now - otherRatedTime) > 180) {
          timedOut = true;
        }

        bothEvaluated = ratings._evaluated.a && ratings._evaluated.b;
        const readyToClose = bothEvaluated || timedOut;
        const res = await db.prepare('UPDATE pairs SET ratings=?, status=? WHERE id=? AND ratings=?')
          .bind(JSON.stringify(ratings), readyToClose ? 'done' : 'matched', p.id, cur.ratings).run();
        if (res && res.meta && res.meta.changes === 1) {
          committed = true;
          // 双方都评完或超时 → 设 5 分钟后自动解散房间（清除对话）；closed_at 列未 ALTER 时静默跳过
          if (readyToClose) {
            try { await db.prepare("UPDATE pairs SET closed_at=? WHERE id=?").bind(now + 300, p.id).run(); } catch (e) {}
          }
        }
      }
      if (!committed) return err('rate_conflict', 409);

      // 评分落库 + 声誉值 + 屏蔽（这些不依赖 ratings 竞态，统一执行）
      const writes = [
        db.prepare('UPDATE users SET rep=? WHERE id=?').bind(newRep, other),
        db.prepare(`INSERT INTO ratings (id, pair_id, from_user, to_user, score, tags, next, created)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind('r_' + genId(12), p.id, r.id, other, score, JSON.stringify(tags), next ? 1 : 0, now),
      ];
      if (blockNext) {
        writes.push(db.prepare(`INSERT OR IGNORE INTO blocks (user_id, blocked_id, created) VALUES (?, ?, ?)`)
          .bind(r.id, other, now));
      }
      await db.batch(writes);
      return json({ ok: true, done: bothEvaluated, blocked: blockNext, waiting: !bothEvaluated, timedOut: timedOut });
    }

    if (action === 'set-info') {
      // 更新我方填写的联机信息（腾讯会议 / 联系方式），置顶常驻，对方实时可见
      const p = await db.prepare('SELECT * FROM pairs WHERE id=?').bind(body.pairId).first();
      if (!p) return err('pair_gone', 404);
      if (r.id !== p.a && r.id !== p.b) return err('not_party', 403);
      if (!await rateLimit(db, 'rl:info:' + getIp(request), 10, 300) && !adminBypass(env, request, body)) return err('rate_limited', 429);
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
      if (!await rateLimit(db, 'rl:report:' + getIp(request), 1, 60) && !adminBypass(env, request, body)) return err('rate_limited', 429);
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

    if (action === 'leave') {
      // 退出组队：把"我"标记为已退出（写进 ratings JSON 的 left:true），并置 status='dissolving'。
      // 设 dissolve_at = now+60，对方 GET /api/pair 会收到 dissolving + 倒计时，1 分钟后双方房间自动关闭。
      // 已评过分（ratings[r.id].score 存在）视为已结清，无需再退。
      const p = await db.prepare('SELECT * FROM pairs WHERE id=?').bind(body.pairId).first();
      if (!p) return err('pair_gone', 404);
      if (r.id !== p.a && r.id !== p.b) return err('not_party', 403);
      if (p.status !== 'matched' && p.status !== 'dissolving') return err('not_active', 409);
      const ratings = safeParse(p.ratings);
      if (ratings[r.id] && ratings[r.id].score) return err('already_rated', 409);
      ratings[r.id] = { left: true, at: nowSec() };
      const dissolveAt = nowSec() + 60;
      // 始终置 dissolving（status 枚举值，无需新列）；dissolve_at 列可能未 ALTER：try 写列，catch 忽略，
      // 计时改由 ratings JSON 的 left.at 兜底，保证不跑 SQL 也能 60s 自动解散
      let dissolving = true;
      try {
        await db.prepare("UPDATE pairs SET ratings=?, status='dissolving', dissolve_at=? WHERE id=?")
          .bind(JSON.stringify(ratings), dissolveAt, p.id).run();
      } catch (e) {
        await db.prepare("UPDATE pairs SET ratings=?, status='dissolving' WHERE id=?")
          .bind(JSON.stringify(ratings), p.id).run();
      }
      return json({ ok: true, dissolving, dissolveIn: 60 });
    }

    if (action === 'close') {
      // 销毁房间：删除全部对话 + 清空互评 + 状态置 closed。由前端在「倒计时归零」后调用
      // （一方退出 1 分钟 / 双方互评完 5 分钟两个时机），彻底清理，不留残留。
      const p = await db.prepare('SELECT * FROM pairs WHERE id=?').bind(body.pairId).first();
      if (!p) return err('pair_gone', 404);
      if (r.id !== p.a && r.id !== p.b) return err('not_party', 403);
      await closeRoomDB(db, p.id);
      return json({ ok: true });
    }

    return err('unknown_action', 400);
  }
  return err('method', 405);
}

function safeParse(s) {
  try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; }
}
// ratings 顶层 key = 用户 id（p.a / p.b），不是位置 'a'/'b'。
// 修复前用 ratings.a / ratings.b 取值恒为 undefined → 「双方都愿意再约」永远不会亮。
function bothNext(ratings, idA, idB) { return !!(ratings && ratings[idA] && ratings[idB] && ratings[idA].next && ratings[idB].next); }
function bothPass(ratings, idA, idB) { return !!(ratings && ratings[idA] && ratings[idB] && ratings[idA].score >= 3 && ratings[idB].score >= 3); }

// 销毁房间：清对话 + 置 closed。GET 服务端兜底与前端 close 动作共用。
// 把 closedAt 写进 ratings JSON（该 TEXT 列已存在，无需 ALTER），供每日清理按「关闭满 3 天」硬删。
// 同时把当初被本场匹配挤掉的「已拒绝」申请恢复为 pending —— 解锁需求，房主可重新选人。
async function closeRoomDB(db, id) {
  const p = await db.prepare('SELECT intent_id, ratings FROM pairs WHERE id=?').bind(id).first();
  const rt = safeParse(p && p.ratings);
  const closedAt = nowSec();
  rt._closedAt = closedAt;
  // 关房同时把 expires 压到「2 分钟后」：还开着页面的一方能看到 closed 提示再跳走，
  // 之后房间就从 GET 查询里消失，双方立刻可以去约下一位搭子，不被 1 天的 ROOM_TTL 挂住。
  const lingerTo = closedAt + CLOSED_LINGER;
  const intentId = (p && p.intent_id) || '';
  const base = [
    db.prepare('DELETE FROM messages WHERE pair_id=?').bind(id),
    db.prepare("UPDATE applications SET status='pending' WHERE intent_id=? AND status='rejected'").bind(intentId),
  ];
  try {
    await db.batch(base.concat([
      db.prepare("UPDATE pairs SET status='closed', ratings=?, info_a='', info_b='', expires=? WHERE id=?").bind(JSON.stringify(rt), lingerTo, id),
    ]));
  } catch (e) {
    // info_a/info_b 列未 ALTER 的库：退化为不清联机信息，至少保证房间能正常关闭
    await db.batch(base.concat([
      db.prepare("UPDATE pairs SET status='closed', ratings=?, expires=? WHERE id=?").bind(JSON.stringify(rt), lingerTo, id),
    ]));
  }
  // 2.0：房间关闭 → 连带焚毁双方试音录音，云端不留存
  await dropPairClips(db, id);
}
