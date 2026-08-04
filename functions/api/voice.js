import { json, err, genId, requireToken, getDB, nowSec, rateLimit, getIp, adminBypass, dropPairClips } from '../_shared.js';

// ============================================================
// FaceTalk 2.0 「30 秒试音互评」
// 流程：匹配成功 → 双方各录 30–60 秒答同一道题 → 互听互评 → 都点「愿意组队」才解锁房间
//       任一方婉拒 → 房间 60 秒后自动解散，双方回首页各找各的，互不浪费时间。
//
// 存储原则（用户要求：云端与本地都不留存）：
//   * 录音以 base64 分片写 voice_chunks，评价一提交立刻物理 DELETE；
//   * 兜底 2 小时过期强删（每日 cleanup 扫）；
//   * 浏览器侧只用内存 Blob + revokeObjectURL，不写 localStorage/IndexedDB。
//
// 兼容原则：voice_* 三张表未建时，全部接口返回 ready:false，
//           前端自动跳过试音环节，老房间与留言板不受任何影响（不会 500）。
// ============================================================

const MIN_SEC = 30;                 // 最短 30 秒（低于不让提交）
const MAX_SEC = 65;                 // 最长 60 秒，留 5 秒容错
const MAX_B64 = 900 * 1024;         // 单段录音 base64 上限 ≈ 675KB 原始音频
const MAX_CHUNK = 64 * 1024;        // 单片 base64 上限，避开 D1 单值限制
const MAX_PLAYS = 2;                // 对方最多回听 2 次
const CLIP_TTL = 2 * 3600;          // 无人评价时 2 小时兜底强删

// 试音题库：同一房间双方抽到同一道题（按 pairId 哈希，零存储、确定性）
const TOPICS = [
  '谈谈你为什么报考这个岗位？说说你的真实动机。',
  '你认为一名合格的辅警/公职人员应该具备哪些素质？请结合自身谈。',
  '单位安排你长期做最基础的窗口登记工作，同事说没前途，你怎么看？',
  '巡逻时发现两人在路边争吵，围观群众越来越多，你如何处置？',
  '群众来办事情绪激动，当众指责你们办事拖沓，你如何应对？',
  '领导交给你一项时间紧、任务重的工作，同事却不太配合，你怎么办？',
  '有人说"辅警没有执法权，干得再多也白搭"，你怎么看这种说法？',
  '请讲一次你在高压下完成任务的真实经历，以及你从中学到了什么。',
  '单位要在社区办一次反诈宣传活动，由你牵头，你打算怎么组织？',
  '值班时接到群众电话，反映邻居深夜噪音扰民，你如何处理？',
  '你和一位资历比你老的同事在工作方法上有分歧，你怎么处理？',
  '谈谈你对"枫桥经验"或"矛盾不上交"的理解。',
  '执勤时被群众用手机全程拍摄并质疑你的执法，你怎么办？',
  '你最大的缺点是什么？会不会影响这份工作？',
  '如果这次没有被录用，你接下来会怎么打算？',
  '一位老人走失，家属非常着急但能提供的信息很少，你如何开展工作？',
  '你如何理解"人民群众满意"是衡量工作的第一标准？',
  '同事工作中出现失误，领导却误以为是你造成的，你怎么办？',
  '早高峰路口信号灯突然故障，现场严重拥堵，你如何疏导？',
  '请用 30 秒介绍你自己，重点讲清楚为什么你适合这个岗位。',
];

function topicFor(pairId) {
  let h = 2166136261;
  for (let i = 0; i < pairId.length; i++) { h ^= pairId.charCodeAt(i); h = Math.imul(h, 16777619); }
  return TOPICS[(h >>> 0) % TOPICS.length];
}
function safeParse(s) { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } }
function clamp5(v) { return Math.max(1, Math.min(5, parseInt(v, 10) || 3)); }

// voice_* 三张表是否已建（未建时整个模块降级为"不可用"，绝不影响 1.0 功能）
async function voiceReady(db) {
  try { await db.prepare('SELECT 1 FROM voice_clips LIMIT 1').first(); return true; }
  catch (e) { return false; }
}

export async function onRequest(context) {
  const { request, env } = context;
  const db = getDB(env);
  if (!db) return err('DB_NOT_BOUND', 503);
  const ip = getIp(request);

  // 校验请求者是该房间成员
  async function memberCheck(me, pairId) {
    if (!pairId) return { error: 'missing_pair', status: 400 };
    const r = await requireToken(env, me);
    if (r.error) return { error: r.error, status: r.status };
    const p = await db.prepare('SELECT * FROM pairs WHERE id=?').bind(pairId).first();
    if (!p) return { error: 'pair_gone', status: 404 };
    if (r.id !== p.a && r.id !== p.b) return { error: 'not_party', status: 403 };
    return { r, p, other: r.id === p.a ? p.b : p.a };
  }

  // ─────────────── GET：状态 / 拉取对方录音 ───────────────
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const pairId = url.searchParams.get('pair');
    const m = await memberCheck(url.searchParams.get('me'), pairId);
    if (m.error) return err(m.error, m.status);
    if (!await voiceReady(db)) return json({ ok: true, ready: false, gate: 'skip' });

    // 取回对方录音（内存播放，不落盘）；每取一次算一次播放，上限 2 次
    if (url.searchParams.get('action') === 'fetch') {
      const clipId = url.searchParams.get('clip') || '';
      const c = await db.prepare('SELECT * FROM voice_clips WHERE id=? AND pair_id=?').bind(clipId, pairId).first();
      if (!c) return err('clip_gone', 404);
      if (c.owner === m.r.id) return err('own_clip', 403);   // 自己的录音不给回放，避免反复自听占带宽
      if (!c.ready) return err('clip_not_ready', 409);
      if ((c.plays | 0) >= MAX_PLAYS) return err('no_plays_left', 409);
      const { results } = await db.prepare('SELECT seq, data FROM voice_chunks WHERE clip_id=? ORDER BY seq ASC').bind(clipId).all();
      if (!results || !results.length) return err('clip_gone', 404);
      await db.prepare('UPDATE voice_clips SET plays=plays+1 WHERE id=?').bind(clipId).run();
      return json({
        ok: true, mime: c.mime, dur: c.dur, b64: results.map(x => x.data).join(''),
        playsLeft: Math.max(0, MAX_PLAYS - ((c.plays | 0) + 1)),
      });
    }

    // 默认：返回当前试音进度，供前端决定显示哪一步
    return json(await metaOf(db, m, pairId));
  }

  // ─────────────── POST：录制 / 上传 / 评价 ───────────────
  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) { return err('bad_json'); }
    const pairId = String(body.pair || body.pairId || '');
    const m = await memberCheck(body.me, pairId);
    if (m.error) return err(m.error, m.status);
    if (!await voiceReady(db)) return err('voice_not_ready', 503);
    const action = body.action;
    const now = nowSec();

    // 已出结果的房间不允许再动试音
    const ratings0 = safeParse(m.p.ratings);
    if (ratings0._voice && action !== 'meta') return err('voice_settled', 409);

    // 1) 开录：建 clip 壳子，返回题目
    if (action === 'init') {
      if (!await rateLimit(db, 'rl:vc:' + ip, 30, 600) && !adminBypass(env, request, body)) return err('rate_limited', 429);
      // 已有未评的旧录音 → 视为重录，先清干净（对方评过就不让重录）
      const mine = await db.prepare('SELECT id FROM voice_clips WHERE pair_id=? AND owner=?').bind(pairId, m.r.id).first();
      const peerReviewed = await db.prepare('SELECT 1 AS x FROM voice_reviews WHERE pair_id=? AND reviewer=?').bind(pairId, m.other).first();
      if (mine && peerReviewed) return err('peer_already_reviewed', 409);
      if (mine) await dropClip(db, mine.id);
      const id = 'vc_' + genId(12);
      await db.prepare(`INSERT INTO voice_clips (id, pair_id, owner, mime, dur, bytes, chunks, plays, ready, created, expires)
        VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?)`)
        .bind(id, pairId, m.r.id, String(body.mime || 'audio/webm').slice(0, 40), now, now + CLIP_TTL).run();
      return json({ ok: true, clipId: id, topic: topicFor(pairId), minSec: MIN_SEC, maxSec: 60 });
    }

    // 2) 传片：单片 base64 ≤ 64KB
    if (action === 'chunk') {
      const clipId = String(body.clipId || '');
      const c = await db.prepare('SELECT * FROM voice_clips WHERE id=? AND pair_id=? AND owner=?').bind(clipId, pairId, m.r.id).first();
      if (!c) return err('clip_gone', 404);
      if (c.ready) return err('clip_finalized', 409);
      const data = String(body.data || '');
      const seq = parseInt(body.seq, 10) || 0;
      if (!data) return err('empty_chunk', 400);
      if (data.length > MAX_CHUNK) return err('chunk_too_big', 413);
      if ((c.bytes | 0) + data.length > MAX_B64) return err('clip_too_big', 413);
      await db.batch([
        db.prepare('INSERT OR REPLACE INTO voice_chunks (clip_id, seq, data) VALUES (?, ?, ?)').bind(clipId, seq, data),
        db.prepare('UPDATE voice_clips SET bytes=bytes+?, chunks=chunks+1 WHERE id=?').bind(data.length, clipId),
      ]);
      return json({ ok: true, seq });
    }

    // 3) 收工：校验时长后标记可播放
    if (action === 'done') {
      const clipId = String(body.clipId || '');
      const dur = Math.round(Number(body.dur) || 0);
      const c = await db.prepare('SELECT * FROM voice_clips WHERE id=? AND pair_id=? AND owner=?').bind(clipId, pairId, m.r.id).first();
      if (!c) return err('clip_gone', 404);
      if (dur < MIN_SEC) { await dropClip(db, clipId); return err('too_short', 400); }
      if (dur > MAX_SEC) { await dropClip(db, clipId); return err('too_long', 400); }
      if (!(c.chunks | 0)) { await dropClip(db, clipId); return err('no_audio', 400); }
      await db.prepare('UPDATE voice_clips SET ready=1, dur=? WHERE id=?').bind(dur, clipId).run();
      return json({ ok: true, dur });
    }

    // 4) 撤回重录（对方还没评价时允许）
    if (action === 'retake') {
      const mine = await db.prepare('SELECT id FROM voice_clips WHERE pair_id=? AND owner=?').bind(pairId, m.r.id).first();
      if (!mine) return err('no_clip', 404);
      const peerReviewed = await db.prepare('SELECT 1 AS x FROM voice_reviews WHERE pair_id=? AND reviewer=?').bind(pairId, m.other).first();
      if (peerReviewed) return err('peer_already_reviewed', 409);
      await dropClip(db, mine.id);
      return json({ ok: true });
    }

    // 5) 提交互评 → 立即焚毁对方录音；双方都评完则结算（组队 or 解散）
    if (action === 'review') {
      if (!await rateLimit(db, 'rl:vr:' + ip, 20, 600) && !adminBypass(env, request, body)) return err('rate_limited', 429);
      const exists = await db.prepare('SELECT 1 AS x FROM voice_reviews WHERE pair_id=? AND reviewer=?').bind(pairId, m.r.id).first();
      if (exists) return err('already_reviewed', 409);
      const peerClip = await db.prepare('SELECT id, ready FROM voice_clips WHERE pair_id=? AND owner=?').bind(pairId, m.other).first();
      if (!peerClip || !peerClip.ready) return err('peer_no_clip', 409);
      const willing = body.willing ? 1 : 0;
      await db.prepare(`INSERT INTO voice_reviews (pair_id, reviewer, target, clarity, logic, pace, comment, willing, created)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(pairId, m.r.id, m.other, clamp5(body.clarity), clamp5(body.logic), clamp5(body.pace),
          String(body.comment || '').replace(/\s+/g, ' ').trim().slice(0, 100), willing, now).run();
      // 阅后即焚：我评完 → 对方那段录音立刻从数据库物理删除
      await dropClip(db, peerClip.id);

      // 双方都评完 → 结算
      const cnt = await db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(willing),0) AS w FROM voice_reviews WHERE pair_id=?').bind(pairId).first();
      let settled = null;
      if ((cnt.c | 0) >= 2) {
        const passed = (cnt.w | 0) >= 2;
        const ratings = safeParse(m.p.ratings);
        ratings._voice = { passed: passed ? 1 : 0, at: now };
        if (passed) {
          await db.prepare('UPDATE pairs SET ratings=? WHERE id=?').bind(JSON.stringify(ratings), pairId).run();
          settled = 'passed';
        } else {
          // 有人婉拒 → 走与「退出组队」一致的 60 秒解散流程，双方都能看到提示
          try {
            await db.prepare("UPDATE pairs SET ratings=?, status='dissolving', dissolve_at=? WHERE id=?")
              .bind(JSON.stringify(ratings), now + 60, pairId).run();
          } catch (e) {
            await db.prepare("UPDATE pairs SET ratings=?, status='dissolving' WHERE id=?")
              .bind(JSON.stringify(ratings), pairId).run();
          }
          settled = 'rejected';
        }
        // 结算后把房间里残留的录音（如对方没听的那段）一并清空
        await dropPairClips(db, pairId);
      }
      return json({ ok: true, settled });
    }

    return err('unknown_action', 400);
  }
  return err('method', 405);
}

// 当前试音进度：前端据此决定显示「录制 / 等待 / 评价 / 结果」哪一屏
async function metaOf(db, m, pairId) {
  const me = m.r.id, other = m.other;
  const ratings = safeParse(m.p.ratings);
  const mine = await db.prepare('SELECT id, dur, ready, created FROM voice_clips WHERE pair_id=? AND owner=?').bind(pairId, me).first();
  const peer = await db.prepare('SELECT id, dur, ready, plays FROM voice_clips WHERE pair_id=? AND owner=?').bind(pairId, other).first();
  const myRev = await db.prepare('SELECT * FROM voice_reviews WHERE pair_id=? AND reviewer=?').bind(pairId, me).first();
  const peerRev = await db.prepare('SELECT * FROM voice_reviews WHERE pair_id=? AND reviewer=?').bind(pairId, other).first();

  let gate;
  if (ratings._voice) gate = ratings._voice.passed ? 'passed' : 'rejected';
  else if (myRev) gate = 'wait_review';               // 我评完了，等对方
  else if (!mine || !mine.ready) gate = 'record';     // 我还没录
  else if (peer && peer.ready) gate = 'review';       // 双方都录了，该我听并评
  else gate = 'wait_peer';                            // 我录完了，等对方录

  return {
    ok: true, ready: true, gate,
    topic: topicFor(pairId),
    minSec: MIN_SEC, maxSec: 60, maxPlays: MAX_PLAYS,
    mine: mine ? { has: !!mine.ready, dur: mine.dur | 0, canRetake: !peerRev } : { has: false, canRetake: true },
    peer: peer && peer.ready ? { has: true, clipId: peer.id, dur: peer.dur | 0, playsLeft: Math.max(0, 2 - (peer.plays | 0)) } : { has: false },
    myReview: myRev ? pickRev(myRev) : null,
    // 对方给我的评价：双方都提交后才揭晓，避免互相看着打分
    peerReview: (myRev && peerRev) ? pickRev(peerRev) : null,
    peerReviewed: !!peerRev,
    passed: !!(ratings._voice && ratings._voice.passed),
  };
}
function pickRev(r) {
  return { clarity: r.clarity | 0, logic: r.logic | 0, pace: r.pace | 0, comment: r.comment || '', willing: !!r.willing };
}
// 物理删除一段录音（分片 + 主行）
async function dropClip(db, clipId) {
  try {
    await db.batch([
      db.prepare('DELETE FROM voice_chunks WHERE clip_id=?').bind(clipId),
      db.prepare('DELETE FROM voice_clips WHERE id=?').bind(clipId),
    ]);
  } catch (e) { /* 表不存在时忽略 */ }
}
