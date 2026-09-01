import { json, err, genId, requireToken, rateLimit, getIp, getDB, nowSec, adminBypass } from '../_shared.js';

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
    const url = new URL(request.url);
    const pairId = url.searchParams.get('pair');
    const m = await memberCheck(url.searchParams.get('me'), pairId);
    if (m.error) return err(m.error, m.status);

    // SSE 推送模式：实时把新留言推到房间双方浏览器（25s 窗口后自动断，客户端 EventSource 自动重连）
    if (url.searchParams.get('stream') === '1') {
      return streamMessages(env, db, m, pairId);
    }

    // 普通 GET：拉取该房间全部留言（按时间正序）；阅后即焚消息在接收方读取后自动销毁
    // 兼容：burn/read 列可能尚未 ALTER 加入，失败时退回不带该列的查询（焚功能暂不可用）
    let rows;
    try {
      ({ results: rows } = await db.prepare(
        'SELECT id, sender, text, created, burn, read FROM messages WHERE pair_id=? ORDER BY created ASC LIMIT 500'
      ).bind(pairId).all());
    } catch (e) {
      ({ results: rows } = await db.prepare(
        'SELECT id, sender, text, created FROM messages WHERE pair_id=? ORDER BY created ASC LIMIT 500'
      ).bind(pairId).all());
    }
    const list = await mapAndBurn(db, m.r.id, rows || []);
    return json({ ok: true, list });
  }

  if (request.method === 'POST') {
    // 发留言：1–300 字，房间双方均可
    let body;
    try { body = await request.json(); } catch (e) { return err('bad_json'); }
    const m = await memberCheck(body.me, String(body.pair || ''));
    if (m.error) return err(m.error, m.status);
    if (!await rateLimit(db, 'rl:msg:' + ip, 30, 300) && !adminBypass(env, request, body)) return err('rate_limited', 429);
    if (!await rateLimit(db, 'rl:msg:u:' + m.r.id, 60, 3600) && !adminBypass(env, request, body)) return err('too_many_msgs', 429);
    const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text) return err('empty_text', 400);
    const burn = body.burn ? 1 : 0;
    const id = 'm_' + genId(12);
    const now = nowSec();
    // 兼容：burn/read 列可能尚未 ALTER 加入；若失败则退回不带该列的写入（焚功能暂不可用）
    try {
      await db.prepare('INSERT INTO messages (id, pair_id, sender, text, created, burn, read) VALUES (?, ?, ?, ?, ?, ?, 0)')
        .bind(id, m.p.id, m.r.id, text, now, burn).run();
    } catch (e) {
      await db.prepare('INSERT INTO messages (id, pair_id, sender, text, created) VALUES (?, ?, ?, ?, ?)')
        .bind(id, m.p.id, m.r.id, text, now).run();
    }
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

// 与 pair.js 保持一致的兜底计时解析（避免重复 import）
function safeParse(s) { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } }

// SSE 推送：维持连接 ~25s，期间每 2s 查一次 D1，把新留言推到客户端。
// 用 ReadableStream + encoder 在 Workers 里很轻量，到点主动关流让前端 EventSource 自动重连。
function streamMessages(env, db, member, pairId) {
  const me = member.r.id;
  const encoder = new TextEncoder();
  let lastSeen = nowSec(); // 上次推送后的最大 created；首屏先发历史
  let lastPairStatus = ''; // 上次推送的房间状态，仅变化时推 pair 事件，避免刷屏
  let alive = true;
  let timer = null;

  const stream = new ReadableStream({
    async start(controller) {
      function send(event, data) {
        if (!alive) return;
        try {
          controller.enqueue(encoder.encode('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'));
        } catch (e) {
          alive = false;
          try { controller.close(); } catch (_) {}
        }
      }
      function ping() {
        if (!alive) return;
        try { controller.enqueue(encoder.encode(': ping\n\n')); } catch (e) { alive = false; }
      }

      // 首屏：先发历史留言（用 since=0 把现有全推一次）；阅后即焚在接收方读取即焚
      try {
        let rows;
        try {
          ({ results: rows } = await db.prepare(
            'SELECT id, sender, text, created, burn, read FROM messages WHERE pair_id=? AND created > 0 ORDER BY created ASC LIMIT 500'
          ).bind(pairId).all());
        } catch (e) {
          ({ results: rows } = await db.prepare(
            'SELECT id, sender, text, created FROM messages WHERE pair_id=? AND created > 0 ORDER BY created ASC LIMIT 500'
          ).bind(pairId).all());
        }
        const list = await mapAndBurn(db, me, rows || []);
        if (list.length) lastSeen = list[list.length - 1].created;
        send('init', { list });
      } catch (e) {
        send('error', { msg: 'init_failed' });
      }

      // 循环：每 2s 查新增；每 15s 发个心跳保活
      async function tick() {
        if (!alive) return;
        try {
          let rows;
          try {
            ({ results: rows } = await db.prepare(
              'SELECT id, sender, text, created, burn, read FROM messages WHERE pair_id=? AND created > ? ORDER BY created ASC LIMIT 50'
            ).bind(pairId, lastSeen).all());
          } catch (e) {
            ({ results: rows } = await db.prepare(
              'SELECT id, sender, text, created FROM messages WHERE pair_id=? AND created > ? ORDER BY created ASC LIMIT 50'
            ).bind(pairId, lastSeen).all());
          }
          if (rows && rows.length) {
            const list = await mapAndBurn(db, me, rows);
            lastSeen = list[list.length - 1].created;
            send('messages', { list });
          }
          // 顺带检测房间状态变化（对方退出 / 互评完 / 已关闭）→ 实时推 pair 事件给双方，
          // 弥补「15s 轮询 + 后台标签被节流」导致对方退出时看不到提示。
          // 仅状态跃迁时推一次（25s 重连后会重新同步），避免刷屏。
          try {
            const p = await db.prepare('SELECT * FROM pairs WHERE id=?').bind(pairId).first();
            if (p) {
              const st = p.status;
              if ((st === 'dissolving' || st === 'done' || st === 'closed') && st !== lastPairStatus) {
                lastPairStatus = st;
                const ratings = safeParse(p.ratings);
                const now = nowSec();
                const leftAt = (ratings[p.a] && ratings[p.a].left ? (ratings[p.a].at || 0) : 0) || (ratings[p.b] && ratings[p.b].left ? (ratings[p.b].at || 0) : 0);
                const ratedAt = (ratings[p.a] && ratings[p.a].at && ratings[p.b] && ratings[p.b].at) ? Math.max(ratings[p.a].at, ratings[p.b].at) : 0;
                let dissolveIn = st === 'dissolving' ? Math.max(0, (p.dissolve_at || 0) - now) : 0;
                if (st === 'dissolving' && dissolveIn === 0 && leftAt > 0) dissolveIn = Math.max(0, leftAt + 60 - now);
                let autoCloseIn = st === 'done' ? Math.max(0, (p.closed_at || 0) - now) : 0;
                if (st === 'done' && autoCloseIn === 0 && ratedAt > 0) autoCloseIn = Math.max(0, ratedAt + 300 - now);
                send('pair', {
                  pairId, status: st, dissolving: st === 'dissolving', dissolveIn, autoCloseIn,
                  // 会话剩余时长（与 pair.js GET 保持一致：房间建起 20 分钟），不能发房间过期(1天)否则前端计时错乱
                  remaining: Math.max(0, (p.created || 0) + 1200 - now),
                  left: !!(ratings[me] && ratings[me].left), rated: !!ratings[me],
                });
              } else if (st !== lastPairStatus) {
                lastPairStatus = st;
              }
            }
          } catch (_) { /* pair 表异常不影响留言流 */ }
        } catch (e) {
          // 表未建等异常：不掐流，让前端继续重连
        }
      }
      timer = setInterval(tick, 2000);
      const pingTimer = setInterval(ping, 15000);

      // 25s 主动关流（避 CF 免费版 30s 上限），前端 EventSource 自动重连
      setTimeout(function () {
        alive = false;
        clearInterval(timer);
        clearInterval(pingTimer);
        try { send('bye', { ok: true }); controller.close(); } catch (_) {}
      }, 25000);
    },
    cancel() {
      alive = false;
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}

// 阅后即焚：把查询结果映射为前端结构；若某条是「接收方（非发送者）」的焚消息且尚未读，
// 标记 read=1 并删除——接收方本次已拿到内容，下次拉取即消失（双方都只看一次）。
async function mapAndBurn(db, me, rows) {
  const toBurn = [];
  const list = (rows || []).map(function (x) {
    const mine = x.sender === me;
    if (!mine && x.burn && !x.read) toBurn.push(x.id);
    return { id: x.id, text: x.text, created: x.created, mine: mine, burn: !!x.burn };
  });
  if (toBurn.length) {
    await db.batch(toBurn.map(function (id) { return db.prepare('UPDATE messages SET read=1 WHERE id=?').bind(id); }));
    await db.batch(toBurn.map(function (id) { return db.prepare('DELETE FROM messages WHERE id=?').bind(id); }));
  }
  return list;
}
