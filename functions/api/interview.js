import { json, err, genId, requireToken, getDB, nowSec, rateLimit, getIp, adminBypass } from '../_shared.js';

// ============================================================
// FaceTalk v2.1 「面试间」数据通道
// 双轨轻量同步，全部走轮询（~1.5s），不依赖 SSE，避免改动现有消息流：
//   1) interview_lines  —— 实时转录行（我方 STT / 对方 STT 同步过来），双方都能看到完整对话稿
//   2) rtc_signals      —— WebRTC 原生 P2P 语音的信令中转（offer/answer/ice），无 TURN 时自动回落腾讯会议
// 两张表未建时首次请求自动建表（同 voice 模块思路），老功能零影响。
// ============================================================

export async function onRequest(context) {
  const { request, env } = context;
  const db = getDB(env);
  if (!db) return err('DB_NOT_BOUND', 503);

  async function memberCheck(me, pairId) {
    if (!pairId) return { error: 'missing_pair', status: 400 };
    const r = await requireToken(env, me);
    if (r.error) return { error: r.error, status: r.status };
    const p = await db.prepare('SELECT * FROM pairs WHERE id=?').bind(pairId).first();
    if (!p) return { error: 'pair_gone', status: 404 };
    if (r.id !== p.a && r.id !== p.b) return { error: 'not_party', status: 403 };
    return { r, p, other: r.id === p.a ? p.b : p.a, side: r.id === p.a ? 'a' : 'b' };
  }

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const m = await memberCheck(url.searchParams.get('me'), url.searchParams.get('pair'));
    if (m.error) return err(m.error, m.status);
    if (!await interviewReady(db)) return json({ ok: true, lines: [], signals: [], fallback: emptyFallback() }); // 表未建：降级为空

    const sinceSignal = parseInt(url.searchParams.get('sinceSignal') || '0', 10) || 0;
    const { results: lines } = await db.prepare(
      'SELECT id, who, text, created FROM interview_lines WHERE pair_id=? ORDER BY created ASC, id ASC LIMIT 2000'
    ).bind(m.p.id).all();
    const { results: sigs } = await db.prepare(
      'SELECT id, from_id, kind, data, created FROM rtc_signals WHERE pair_id=? AND to_id=? AND created > ? ORDER BY created ASC LIMIT 50'
    ).bind(m.p.id, m.r.id, sinceSignal).all();
    // 备选会议号（双方共用）：只取"对方"那一面的，对方没填时该字段为空
    const fbRow = await db.prepare('SELECT tencent_a, tencent_b, feishu_a, feishu_b, updated FROM interview_fallback WHERE pair_id=?')
      .bind(m.p.id).first();
    const fallback = fbRow
      ? { tencent: m.side === 'a' ? (fbRow.tencent_b || '') : (fbRow.tencent_a || ''), feishu: m.side === 'a' ? (fbRow.feishu_b || '') : (fbRow.feishu_a || ''), updated: fbRow.updated }
      : emptyFallback();

    return json({
      ok: true,
      lines: (lines || []).map(function (x) {
        return { id: x.id, who: x.who, text: x.text, created: x.created, mine: x.who === m.side };
      }),
      signals: (sigs || []).map(function (x) {
        return { id: x.id, from: x.from_id, kind: x.kind, data: x.data, created: x.created };
      }),
      fallback: fallback,
      serverNow: nowSec(),
    });
  }

  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) { return err('bad_json'); }
    const m = await memberCheck(body.me, String(body.pair || ''));
    if (m.error) return err(m.error, m.status);
    if (!await interviewReady(db)) return err('not_ready', 503);
    const action = body.action;
    const now = nowSec();
    const ip = getIp(request);

    // 追加一条转录行（我方 STT 产出或手动补充）
    if (action === 'line') {
      if (!await rateLimit(db, 'rl:il:' + ip, 40, 60) && !adminBypass(env, request, body)) return err('rate_limited', 429);
      const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
      if (!text) return err('empty_text', 400);
      const id = 'il_' + genId(12);
      await db.prepare('INSERT INTO interview_lines (id, pair_id, who, text, created) VALUES (?, ?, ?, ?, ?)')
        .bind(id, m.p.id, m.side, text, now).run();
      return json({ ok: true, id, created: now, who: m.side, mine: true });
    }

    // 投递一条 WebRTC 信令（offer / answer / ice）
    if (action === 'signal') {
      const kind = String(body.kind || '').trim();
      if (!['offer', 'answer', 'ice'].includes(kind)) return err('bad_kind', 400);
      const data = String(body.data || '').slice(0, 20000);
      if (!data) return err('empty_signal', 400);
      const id = 'sg_' + genId(12);
      await db.prepare('INSERT INTO rtc_signals (id, pair_id, from_id, to_id, kind, data, created) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, m.p.id, m.r.id, m.other, kind, data, now).run();
      return json({ ok: true, id, created: now });
    }

    // 备选会议号（WebRTC 连不上时的兜底：腾讯会议号 / 飞书会议号），各存一面，对方只能看到对面的
    if (action === 'set-fallback') {
      const tencent = String(body.tencent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      const feishu = String(body.feishu || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      const colTen = m.side === 'a' ? 'tencent_a' : 'tencent_b';
      const colFei = m.side === 'a' ? 'feishu_a' : 'feishu_b';
      // upsert：先看有没有行，没行 INSERT，有行 UPDATE 自己的两列
      const ex = await db.prepare('SELECT pair_id FROM interview_fallback WHERE pair_id=?').bind(m.p.id).first();
      if (!ex) {
        await db.prepare('INSERT INTO interview_fallback (pair_id, ' + colTen + ', ' + colFei + ', updated) VALUES (?, ?, ?, ?)')
          .bind(m.p.id, tencent, feishu, now).run();
      } else {
        await db.prepare('UPDATE interview_fallback SET ' + colTen + '=?, ' + colFei + '=?, updated=? WHERE pair_id=?')
          .bind(tencent, feishu, now, m.p.id).run();
      }
      return json({ ok: true, tencent: tencent, feishu: feishu, updated: now });
    }

    return err('unknown_action', 400);
  }
  return err('method', 405);
}

// 自动建表（三张），失败则整模块降级
async function interviewReady(db) {
  try {
    await db.prepare('SELECT 1 FROM interview_lines LIMIT 1').first();
    return true;
  } catch (e) {
    try { await ensureTables(db); return true; } catch (e2) { return false; }
  }
}
function emptyFallback() { return { tencent: '', feishu: '', updated: 0 }; }
const DDL = [
  `CREATE TABLE IF NOT EXISTS interview_lines (
    id TEXT PRIMARY KEY,
    pair_id TEXT NOT NULL,
    who TEXT NOT NULL,
    text TEXT NOT NULL,
    created INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_il_pair ON interview_lines(pair_id)`,
  `CREATE TABLE IF NOT EXISTS rtc_signals (
    id TEXT PRIMARY KEY,
    pair_id TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    data TEXT NOT NULL,
    created INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sg_pair_to ON rtc_signals(pair_id, to_id)`,
  // 备选会议号：双方各存自己的一面；GET 时只回对方那一面，避免看自己的键回显覆盖
  `CREATE TABLE IF NOT EXISTS interview_fallback (
    pair_id TEXT PRIMARY KEY,
    tencent_a TEXT DEFAULT '',
    tencent_b TEXT DEFAULT '',
    feishu_a TEXT DEFAULT '',
    feishu_b TEXT DEFAULT '',
    updated INTEGER DEFAULT 0
  )`,
];
async function ensureTables(db) {
  for (const sql of DDL) await db.prepare(sql).run();
  return true;
}
