import { json, err, genId, requireToken, getDB, nowSec, rateLimit, getIp, adminBypass, dropPairClips } from '../_shared.js';

// ============================================================
// FaceTalk 2.0 「试音互评」
// 流程：匹配成功 → 双方各录 30–90 秒答同一道题 → 互听互评（含回听自己） → 都点「愿意组队」才解锁房间
//       任一方婉拒 → 房间 60 秒后自动解散，双方回首页各找各的，互不浪费时间。
//
// 存储原则（用户要求：云端与本地都不留存）：
//   * 录音本体（base64）一次性 POST 上传，服务端解码后写入 R2 对象（clips/{clipId}）；
//   * 评价一提交 → 立刻物理 DELETE（R2 对象 + D1 元数据行）；
//   * 兜底：R2 生命周期规则 1 天自动焚毁 + 每日 cleanup 扫过期，双保险；
//   * 浏览器侧只用内存 Blob + revokeObjectURL，不写 localStorage/IndexedDB。
//
// 兼容原则：voice_* 表未建或 R2 未绑定时，首次请求自动建表（详见 voiceReady）；
//           即使不可用也返回 ready:false，前端自动跳过试音环节，
//           老房间与留言板不受任何影响（不会 500）。
// ============================================================

const MIN_SEC = 30;                 // 服务端下限 30 秒（前端 30 秒解锁停止键；留 2 秒容错在 done 校验里由 dur 真实值兜底）
const MAX_SEC = 90;                 // 上限 90 秒（前端满 90 秒自动停止），留容错
const MAX_B64 = 900 * 1024;         // 单段录音 base64 上限 ≈ 675KB 原始音频
const MAX_RAW = 700 * 1024;         // 单段录音原始字节上限（二进制直传用，≈525KB，含 opus 容器头余量）
const MAX_PLAYS = 2;                // 每段对方最多回听 2 次
const MAX_ATTEMPTS = 2;             // 每人最多 2 段试音（首录 + 1 次追加），对方可全听到
const CLIP_TTL = 24 * 3600;         // 无人评价时 1 天兜底强删（与房间 ROOM_TTL 对齐，跨腾讯会议长时对练也不会中途丢录音）
const VOICE_KEY = (id) => 'clips/' + id;   // R2 对象 key：clips/{clipId}

// 试音题库：同一房间双方抽到同一道题（按 pairId 哈希，零存储、确定性）
// v2.11 起按语言本地化：通用结构化 + 近期 AI/科技话题观点题（海外优先，暂不加入自定义话题）。
const TOPICS = {
  zh: [
    '请做一下自我介绍，重点突出与目标岗位匹配的经历。',
    '你最近做过最难的一个决定是什么？当时是怎么权衡的？',
    '讲一件你经历过的失败，你从中学到了什么？',
    '你的优点和缺点分别是什么？缺点你打算怎么改进？',
    '为什么选择现在这个职业方向？未来 3 年的规划是什么？',
    '说说你对 AI 改变工作的看法：机会和风险分别在哪里？',
    '如果 AI 能完成你一半的工作，你会把省下的时间花在哪里？',
    'AI 时代你怎么理解终身学习？如何保持竞争力？',
    '你最近在关注什么新技术或新趋势？为什么？',
    '团队里意见出现分歧时你会怎么做？举个具体例子。',
    '你如何应对压力和高强度的工作节奏？',
    '讲一件你主动推动改变（流程、工具或想法）的经历。',
    '你怎样判断一份工作适不适合自己？',
    '远程协作和办公室协作你更倾向哪种？为什么？',
    '如果 AI 面试官来面你，你会怎么准备？',
  ],
  en: [
    'Please introduce yourself, highlighting experience relevant to the target role.',
    'What is the hardest decision you have made recently, and how did you weigh it?',
    'Tell me about a failure you have experienced and what you learned from it.',
    'What are your strengths and weaknesses? How are you working on the latter?',
    'Why did you choose your current career path? Where do you see yourself in 3 years?',
    'How do you think AI will change the way we work — opportunities and risks?',
    'If AI could do half of your job, where would you spend the time you save?',
    'What does lifelong learning mean in the AI era, and how do you stay competitive?',
    'What new technology or trend are you following recently, and why?',
    'How do you handle disagreement within a team? Give a concrete example.',
    'How do you manage pressure and high-intensity workloads?',
    'Tell me about a time you proactively drove a change (process, tool, or idea).',
    'How do you judge whether a job is a good fit for you?',
    'Do you prefer remote or in-office collaboration? Why?',
    'If an AI interviewer interviewed you, how would you prepare?',
  ],
  ja: [
    '自己紹介をお願いします。応募職種に合う経験を中心に話してください。',
    '最近下した最も難しい決断と、その判断の仕方を教えてください。',
    'これまでの失敗経験と、そこから学んだことを教えてください。',
    'あなたの長所と短所は？短所はどう改善していますか？',
    '今のキャリアを選んだ理由と、3年後の計画は？',
    'AIは働き方をどう変えると思いますか？チャンスとリスクは？',
    'AIが仕事の半分をこなせるとしたら、空いた時間を何に使いますか？',
    'AI時代の生涯学習とは？競争力をどう保ちますか？',
    '最近注目している技術やトレンドは？その理由は？',
    'チーム内で意見が割れたらどうしますか？具体例を挙げてください。',
    'プレッシャーやハードな仕事量にはどう対応しますか？',
    '自分から改善（プロセス・ツール・アイデア）を推進した経験はありますか？',
    '仕事が自分に合っているかどうか、どう判断しますか？',
    'リモートとオフィス、どちらを好みますか？理由は？',
    'AI面接官に面接されるなら、どう準備しますか？',
  ],
};

function topicFor(pairId, lang) {
  let h = 2166136261;
  for (let i = 0; i < pairId.length; i++) { h ^= pairId.charCodeAt(i); h = Math.imul(h, 16777619); }
  const list = TOPICS[lang] || TOPICS.en;
  return list[(h >>> 0) % list.length];
}
function safeParse(s) { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } }
function clamp5(v) { return Math.max(1, Math.min(5, parseInt(v, 10) || 3)); }

// R2 对象存储绑定：录音本体唯一存放处（阅后即焚）
function getBucket(env) {
  return (env && env.VOICE && typeof env.VOICE.put === 'function' && typeof env.VOICE.get === 'function' && typeof env.VOICE.delete === 'function') ? env.VOICE : null;
}
// base64 ↔ 二进制（Workers 全局 atob/btoa 可用）
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

// voice_* 表 + R2 是否就绪（未就绪时整个模块降级为"不可用"，绝不影响 1.0 功能）
async function voiceReady(env, db) {
  if (!getBucket(env)) return false;   // R2 未绑定 → 跳过试音（不 500）
  try { await db.prepare('SELECT 1 FROM voice_clips LIMIT 1').first(); return true; }
  catch (e) {
    // 表未建 → 尝试运行时自动建表（D1 绑定有写权限；CREATE TABLE IF NOT EXISTS 幂等安全）
    try { await ensureVoiceTables(db); return true; }
    catch (e2) { return false; }
  }
}

// 自动建表 DDL（与 voice-tables.sql 一致；CREATE TABLE IF NOT EXISTS 可重复执行）
// 注：voice_chunks 是旧版分片协议遗留表，现已不再写入（录音本体在 R2），保留 DDL 仅为幂等兼容。
const VOICE_DDL = [
  `CREATE TABLE IF NOT EXISTS voice_clips (
    id       TEXT PRIMARY KEY,
    pair_id  TEXT NOT NULL,
    owner    TEXT NOT NULL,
    mime     TEXT NOT NULL DEFAULT 'audio/webm',
    dur      INTEGER NOT NULL DEFAULT 0,
    bytes    INTEGER NOT NULL DEFAULT 0,
    plays    INTEGER NOT NULL DEFAULT 0,
    ready    INTEGER NOT NULL DEFAULT 0,
    created  INTEGER NOT NULL,
    expires  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vclips_pair ON voice_clips(pair_id)`,
  `CREATE INDEX IF NOT EXISTS idx_vclips_expires ON voice_clips(expires)`,
  `CREATE TABLE IF NOT EXISTS voice_chunks (
    clip_id TEXT NOT NULL,
    seq     INTEGER NOT NULL,
    data    TEXT NOT NULL,
    PRIMARY KEY (clip_id, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS voice_reviews (
    pair_id  TEXT NOT NULL,
    reviewer TEXT NOT NULL,
    target   TEXT NOT NULL,
    clarity  INTEGER NOT NULL DEFAULT 3,
    logic    INTEGER NOT NULL DEFAULT 3,
    pace     INTEGER NOT NULL DEFAULT 3,
    comment  TEXT DEFAULT '',
    willing  INTEGER NOT NULL DEFAULT 0,
    created  INTEGER NOT NULL,
    PRIMARY KEY (pair_id, reviewer)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vreviews_pair ON voice_reviews(pair_id)`,
];
async function ensureVoiceTables(db) {
  for (const sql of VOICE_DDL) await db.prepare(sql).run();
  return true;
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
    if (!await voiceReady(env, db)) return json({ ok: true, ready: false, gate: 'skip' });

    // 取回录音（内存播放，不落盘）。
    // 对方的录音：每取一次算一次回听，上限 MAX_PLAYS 次。
    // 自己的录音：允许回听（用户反馈"只能听对方、听不到自己不合理"），且**不计次、不占对方额度**——
    //            数据本来就是你自己录的，回放不泄露任何新信息，也不会影响互评公平性。
    if (url.searchParams.get('action') === 'fetch') {
      const clipId = url.searchParams.get('clip') || '';
      const c = await db.prepare('SELECT * FROM voice_clips WHERE id=? AND pair_id=?').bind(clipId, pairId).first();
      if (!c) return err('clip_gone', 404);
      if (!c.ready) return err('clip_not_ready', 409);
      const isOwn = c.owner === m.r.id;
      if (!isOwn && (c.plays | 0) >= MAX_PLAYS) return err('no_plays_left', 409);
      // 录音本体在 R2：一个 GET 拉回（读一次 = 一个对象，不再读 15+ 行拼接）
      const bucket = getBucket(env);
      const obj = bucket ? await bucket.get(VOICE_KEY(clipId)) : null;
      if (!obj) return err('clip_gone', 404);   // 对象已被焚毁/未上传成功 → 与删除同义
      const buf = await obj.arrayBuffer();
      if (!isOwn) await db.prepare('UPDATE voice_clips SET plays=plays+1 WHERE id=?').bind(clipId).run();
      return json({
        ok: true, mime: c.mime, dur: c.dur, b64: bytesToB64(new Uint8Array(buf)), own: isOwn,
        playsLeft: isOwn ? null : Math.max(0, MAX_PLAYS - ((c.plays | 0) + 1)),
      });
    }

    // 默认：返回当前试音进度，供前端决定显示哪一步
    return json(await metaOf(db, m, pairId, url.searchParams.get('lang') || 'en'));
  }

  // ─────────────── POST：录制 / 上传 / 评价 ───────────────
  if (request.method === 'POST') {
    const ct = (request.headers.get('content-type') || '').toLowerCase();
    let body = {};
    // 二进制直传（移动端优化）：body 为空，me/pair/clipId/dur/mime 走 header，避免 base64 体积膨胀 + 主线程编码卡顿
    if (ct.indexOf('application/json') >= 0) {
      try { body = await request.json(); } catch (e) { return err('bad_json'); }
    }
    const isBinary = ct.indexOf('application/octet-stream') >= 0;
    const me = body.me || request.headers.get('x-voice-me') || '';
    const pairId = String(body.pair || body.pairId || request.headers.get('x-voice-pair') || '');
    const m = await memberCheck(me, pairId);
    if (m.error) return err(m.error, m.status);
    if (!await voiceReady(env, db)) return err('voice_not_ready', 503);
    const action = body.action || (isBinary ? 'upload' : '');
    const now = nowSec();

    // 已出结果的房间不允许再动试音
    const ratings0 = safeParse(m.p.ratings);
    if (ratings0._voice && action !== 'meta') return err('voice_settled', 409);

    // 1) 开录：建 clip 壳子（D1 只存元数据，录音本体等 upload 后进 R2），返回题目
    if (action === 'init') {
      if (!await rateLimit(db, 'rl:vc:' + ip, 30, 600) && !adminBypass(env, request, body)) return err('rate_limited', 429);
      // 一人可有多段试音（首录 + 追加），按 created 排序；这里取全部旧段
      const mineAll = await db.prepare('SELECT id FROM voice_clips WHERE pair_id=? AND owner=?').bind(pairId, m.r.id).all();
      const mineRows = (mineAll && mineAll.results) || [];
      const peerReviewed = await db.prepare('SELECT 1 AS x FROM voice_reviews WHERE pair_id=? AND reviewer=?').bind(pairId, m.other).first();
      const append = !!body.append;
      if (append) {
        // 追加录制：保留旧段，仅在不超上限且对方未评我时允许
        if (peerReviewed) return err('peer_already_reviewed', 409);
        if (mineRows.length >= MAX_ATTEMPTS) return err('max_attempts', 409);
      } else {
        // 首录 / 重录：对方已评不允许；否则清掉全部旧录音再录
        if (mineRows.length && peerReviewed) return err('peer_already_reviewed', 409);
        if (mineRows.length) await dropAllMyClips(env, db, pairId, m.r.id);
      }
      const id = 'vc_' + genId(12);
      await db.prepare(`INSERT INTO voice_clips (id, pair_id, owner, mime, dur, bytes, chunks, plays, ready, created, expires)
        VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?)`)
        .bind(id, pairId, m.r.id, String(body.mime || 'audio/webm').slice(0, 40), now, now + CLIP_TTL).run();
      return json({ ok: true, clipId: id, topic: topicFor(pairId, body.lang || 'en'), minSec: MIN_SEC, maxSec: MAX_SEC, attempt: mineRows.length + 1 });
    }

    // 2) 上传：直写 R2 单对象。
    //    旧版 chunk 分片协议已废弃；现支持两条上传通道：
    //      a) JSON：整段 base64 一次提交（≤ MAX_B64 字符），服务端解码后写 R2（兼容旧前端）；
    //      b) 二进制直传：content-type=application/octet-stream，raw 音频直接作为 body，
    //         省去 base64 体积膨胀（≈+33%）与主线程编码卡顿——这是手机端迟滞的关键优化。
    //    两条通道共用下方校验 + R2 put，保证行为一致。
    if (action === 'upload') {
      const clipId = String((isBinary ? request.headers.get('x-voice-clip') : body.clipId) || '');
      const c = await db.prepare('SELECT * FROM voice_clips WHERE id=? AND pair_id=? AND owner=?').bind(clipId, pairId, m.r.id).first();
      if (!c) return err('clip_gone', 404);
      if (c.ready) return err('clip_finalized', 409);
      let bin, dur, byteLen;
      if (isBinary) {
        dur = Math.round(Number(request.headers.get('x-voice-dur')) || 0);
        try { const ab = await request.arrayBuffer(); bin = new Uint8Array(ab); } catch (e) { return err('bad_body', 400); }
        byteLen = bin ? bin.length : 0;
      } else {
        const data = String(body.data || '');
        dur = Math.round(Number(body.dur) || 0);
        if (!data) return err('empty_audio', 400);
        if (data.length > MAX_B64) return err('clip_too_big', 413);
        try { bin = b64ToBytes(data); } catch (e) { return err('bad_b64', 400); }
        byteLen = bin ? bin.length : 0;
      }
      if (!bin || !byteLen) { if (!isBinary) await dropClip(env, db, clipId); return err('no_audio', 400); }
      if (byteLen > MAX_RAW) { if (!isBinary) await dropClip(env, db, clipId); return err('clip_too_big', 413); }
      if (dur < MIN_SEC) { if (!isBinary) await dropClip(env, db, clipId); return err('too_short', 400); }
      if (dur > MAX_SEC) { if (!isBinary) await dropClip(env, db, clipId); return err('too_long', 400); }
      const bucket = getBucket(env);
      if (!bucket) return err('voice_not_ready', 503);
      try {
        await bucket.put(VOICE_KEY(clipId), bin, { httpMetadata: { contentType: c.mime || 'audio/webm' } });
      } catch (e) { return err('store_fail', 503); }
      await db.prepare('UPDATE voice_clips SET ready=1, dur=?, bytes=? WHERE id=?').bind(dur, byteLen, clipId).run();
      return json({ ok: true, dur });
    }

    // 3) 撤回重录（对方还没评价时允许）：删掉自己全部试音段，重新录一段
    if (action === 'retake') {
      const mine = await db.prepare('SELECT id FROM voice_clips WHERE pair_id=? AND owner=?').bind(pairId, m.r.id).all();
      if (!mine.results || !mine.results.length) return err('no_clip', 404);
      const peerReviewed = await db.prepare('SELECT 1 AS x FROM voice_reviews WHERE pair_id=? AND reviewer=?').bind(pairId, m.other).first();
      if (peerReviewed) return err('peer_already_reviewed', 409);
      await dropAllMyClips(env, db, pairId, m.r.id);
      return json({ ok: true });
    }

    // 4) 提交互评 → 等双方都评完再统一焚毁所有录音
    // 设计要点（修复"另一方闪退"）：
    //   若一方评完立即 dropClip(对方)，对方此时还没听完/还没评，录音就没了，会触发
    //   「我的录音刚才还在、怎么现在让我重新录」的状态错乱（前端表现为"闪退"）。
    //   改为延后焚毁：双方都评完（cnt.c>=2）由 dropPairClips 兜底清空所有录音（R2 对象 + D1 行）。
    //   兜底：单方评完后若对方迟迟不评，2h TTL 过期每日 cleanup 强删（不长期占用）；R2 生命周期 1 天兜底。
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

      // 双方都评完 → 结算 + 统一焚毁所有录音
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
        // 双方都评完 → 把房间里所有残留录音一并清空（阅后即焚：R2 对象 + D1 元数据）
        await dropPairClips(env, db, pairId);
      }
      return json({ ok: true, settled });
    }

    return err('unknown_action', 400);
  }
  return err('method', 405);
}

// 当前试音进度：前端据此决定显示「录制 / 等待 / 评价 / 结果」哪一屏
async function metaOf(db, m, pairId, lang) {
  const me = m.r.id, other = m.other;
  const ratings = safeParse(m.p.ratings);
  const mineAll = await db.prepare('SELECT id, dur, ready, created FROM voice_clips WHERE pair_id=? AND owner=? ORDER BY created ASC').bind(pairId, me).all();
  const mineClips = ((mineAll && mineAll.results) || []).map(function (c) {
    return { id: c.id, dur: c.dur | 0, ready: !!c.ready, created: c.created | 0 };
  });
  const peerAll = await db.prepare('SELECT id, dur, ready, plays, created FROM voice_clips WHERE pair_id=? AND owner=? ORDER BY created ASC').bind(pairId, other).all();
  const peerRows = (peerAll && peerAll.results) || [];
  const peerClips = peerRows.filter(function (c) { return !!c.ready; }).map(function (c) {
    return { id: c.id, dur: c.dur | 0, ready: true, playsLeft: Math.max(0, MAX_PLAYS - (c.plays | 0)) };
  });
  // 对方正在「追加再录一次」：已有至少 1 段录好的，同时还挂着一个未完成的空壳（init 建的 ready=0 行）。
  // 3 分钟过期判定：对方录到一半关页面时，空壳不会让提示一直挂着。
  const nowS = nowSec();
  const peerAppending = peerClips.length > 0 && peerRows.some(function (c) {
    return !c.ready && (nowS - (c.created | 0)) < 180;
  });
  const myRev = await db.prepare('SELECT * FROM voice_reviews WHERE pair_id=? AND reviewer=?').bind(pairId, me).first();
  const peerRev = await db.prepare('SELECT * FROM voice_reviews WHERE pair_id=? AND reviewer=?').bind(pairId, other).first();
  const peerReviewed = !!peerRev;

  let gate;
  const hasMineReady = mineClips.some(function (c) { return c.ready; });
  const hasPeerReady = peerClips.some(function (c) { return c.ready; });
  if (ratings._voice) gate = ratings._voice.passed ? 'passed' : 'rejected';
  else if (myRev) gate = 'wait_review';               // 我评完了，等对方
  else if (!mineClips.length || !hasMineReady) gate = 'record';   // 我还没录 / 正在追加录
  else if (hasPeerReady) gate = 'review';             // 双方都录了，该我听并评
  else gate = 'wait_peer';                            // 我录完了，等对方录

  return {
    ok: true, ready: true, gate,
    topic: topicFor(pairId, lang),
    minSec: MIN_SEC, maxSec: MAX_SEC, maxPlays: MAX_PLAYS, maxAttempts: MAX_ATTEMPTS,
    mineClips: mineClips,
    myClipCount: mineClips.length,
    canAppend: mineClips.length < MAX_ATTEMPTS && !peerReviewed && !ratings._voice,
    peerClips: peerClips,
    peerClipCount: peerClips.length,
    peerAppending: peerAppending,   // true → 前端提示「对方正在追加再录一次…」
    myReview: myRev ? pickRev(myRev) : null,
    // 对方给我的评价：双方都提交后才揭晓，避免互相看着打分
    peerReview: (myRev && peerRev) ? pickRev(peerRev) : null,
    peerReviewed: peerReviewed,
    passed: !!(ratings._voice && ratings._voice.passed),
  };
}
function pickRev(r) {
  return { clarity: r.clarity | 0, logic: r.logic | 0, pace: r.pace | 0, comment: r.comment || '', willing: !!r.willing };
}
// 物理删除一段录音：R2 对象 + D1 元数据行（阅后即焚）
async function dropClip(env, db, clipId) {
  const bucket = getBucket(env);
  if (bucket) { try { await bucket.delete(VOICE_KEY(clipId)); } catch (e) { /* 对象可能已被焚毁 */ } }
  try { await db.prepare('DELETE FROM voice_clips WHERE id=?').bind(clipId).run(); } catch (e) { /* 表不存在时忽略 */ }
}
// 物理删除某人在某房间的全部试音段（重录 / 撤回时调用）
async function dropAllMyClips(env, db, pairId, owner) {
  try {
    const r = await db.prepare('SELECT id FROM voice_clips WHERE pair_id=? AND owner=?').bind(pairId, owner).all();
    const rows = (r && r.results) || [];
    for (const c of rows) await dropClip(env, db, c.id);
  } catch (e) { /* 表不存在时忽略 */ }
}
