'use strict';
// 面试搭子 2.0 · 试音互评 端到端逻辑自测（录音时长 30~90 秒）
// 直接导入生产函数 functions/api/voice.js 的 onRequest，用内存 mock D1 跑通完整链路，
// 覆盖：init/chunk/done/fetch 回听上限、双方互评即焚、双方婉拒自动解散、时长校验、重录、表缺失降级。
// 运行：node scripts/selftest-voice.js  （接入 .github/workflows/selftest.yml，push 到 main 自动跑）

const path = require('path');
const { pathToFileURL } = require('url');

// ── 极简 D1 mock：按 SQL 片段分发到 JS 实现，与 voice.js 真实 SQL 语义一致 ──
function makeDb(opts) {
  const allowDDL = !(opts && opts.allowDDL === false); // 默认允许运行时建表；allowDDL:false 模拟 D1 拒绝 DDL
  const store = {
    users: (opts && opts.users) || [],
    pairs: (opts && opts.pairs) || [],
    rate_limits: [],
    voice_clips: (opts && opts.voiceTables === false) ? undefined : [],
    voice_chunks: (opts && opts.voiceTables === false) ? undefined : [],
    voice_reviews: (opts && opts.voiceTables === false) ? undefined : [],
  };
  function doWrite(sql, p) {
    // 运行时自动建表：CREATE TABLE IF NOT EXISTS → 在 mock 里真正初始化数组；拒绝 DDL 时抛错
    if (sql.startsWith("CREATE TABLE IF NOT EXISTS voice_clips")) { if (!allowDDL) throw new Error('DDL denied'); if (store.voice_clips === undefined) store.voice_clips = []; return 0; }
    if (sql.startsWith("CREATE TABLE IF NOT EXISTS voice_chunks")) { if (!allowDDL) throw new Error('DDL denied'); if (store.voice_chunks === undefined) store.voice_chunks = []; return 0; }
    if (sql.startsWith("CREATE TABLE IF NOT EXISTS voice_reviews")) { if (!allowDDL) throw new Error('DDL denied'); if (store.voice_reviews === undefined) store.voice_reviews = []; return 0; }
    if (sql.startsWith("CREATE INDEX")) { if (!allowDDL) throw new Error('DDL denied'); return 0; }
    // 阅后即焚：dropClip（单片）
    if (sql.startsWith("DELETE FROM voice_chunks WHERE clip_id=?")) {
      const before = store.voice_chunks.length;
      store.voice_chunks = store.voice_chunks.filter(c => c.clip_id !== p[0]);
      return before - store.voice_chunks.length;
    }
    if (sql.startsWith("DELETE FROM voice_clips WHERE id=?")) {
      const before = store.voice_clips.length;
      store.voice_clips = store.voice_clips.filter(c => c.id !== p[0]);
      return before - store.voice_clips.length;
    }
    // dropPairClips：整房间清录音
    if (sql.includes("clip_id IN (SELECT id FROM voice_clips WHERE pair_id=?")) {
      const ids = new Set(store.voice_clips.filter(c => c.pair_id === p[0]).map(c => c.id));
      const before = store.voice_chunks.length;
      store.voice_chunks = store.voice_chunks.filter(c => !ids.has(c.clip_id));
      return before - store.voice_chunks.length;
    }
    if (sql.startsWith("DELETE FROM voice_clips WHERE pair_id=?")) {
      const before = store.voice_clips.length;
      store.voice_clips = store.voice_clips.filter(c => c.pair_id !== p[0]);
      return before - store.voice_clips.length;
    }
    // 计数 +1（回放次数）
    if (sql.startsWith("UPDATE voice_clips SET plays=plays+1")) {
      const c = store.voice_clips.find(x => x.id === p[0]);
      if (c) { c.plays = (c.plays | 0) + 1; return 1; }
      return 0;
    }
    // 新建录音壳
    if (sql.startsWith("INSERT INTO voice_clips (id")) {
      store.voice_clips.push({
        id: p[0], pair_id: p[1], owner: p[2], mime: p[3],
        dur: 0, bytes: 0, chunks: 0, plays: 0, ready: 0, created: p[4], expires: p[5],
      });
      return 1;
    }
    // 分片入库
    if (sql.startsWith("INSERT OR REPLACE INTO voice_chunks")) {
      store.voice_chunks = store.voice_chunks.filter(c => !(c.clip_id === p[0] && c.seq === p[1]));
      store.voice_chunks.push({ clip_id: p[0], seq: p[1], data: p[2] });
      return 1;
    }
    if (sql.startsWith("UPDATE voice_clips SET bytes=bytes+")) {
      const c = store.voice_clips.find(x => x.id === p[1]);
      if (c) { c.bytes += p[0]; c.chunks += 1; return 1; }
      return 0;
    }
    if (sql.startsWith("UPDATE voice_clips SET ready=1")) {
      const c = store.voice_clips.find(x => x.id === p[1]);
      if (c) { c.ready = 1; c.dur = p[0]; return 1; }
      return 0;
    }
    // 评价格
    if (sql.startsWith("INSERT INTO voice_reviews")) {
      store.voice_reviews.push({
        pair_id: p[0], reviewer: p[1], target: p[2],
        clarity: p[3], logic: p[4], pace: p[5], comment: p[6], willing: p[7], created: p[8],
      });
      return 1;
    }
    // pairs 结算
    if (sql.includes("status='dissolving', dissolve_at=")) {
      const pr = store.pairs.find(x => x.id === p[2]);
      if (pr) { pr.ratings = p[0]; pr.status = 'dissolving'; pr.dissolve_at = p[1]; return 1; }
      return 0;
    }
    if (sql.includes("status='dissolving' WHERE")) {
      const pr = store.pairs.find(x => x.id === p[1]);
      if (pr) { pr.ratings = p[0]; pr.status = 'dissolving'; return 1; }
      return 0;
    }
    if (sql.startsWith("UPDATE pairs SET ratings=? WHERE id=?")) {
      const pr = store.pairs.find(x => x.id === p[1]);
      if (pr) { pr.ratings = p[0]; return 1; }
      return 0;
    }
    // rate_limits
    if (sql.startsWith("INSERT OR REPLACE INTO rate_limits")) {
      const i = store.rate_limits.findIndex(r => r.key === p[0]);
      if (i >= 0) store.rate_limits[i] = { key: p[0], count: 1, reset_at: p[1] };
      else store.rate_limits.push({ key: p[0], count: 1, reset_at: p[1] });
      return 1;
    }
    if (sql.startsWith("UPDATE rate_limits SET count = count + 1")) {
      const r = store.rate_limits.find(x => x.key === p[0]);
      if (r) { r.count += 1; return 1; }
      return 0;
    }
    return 0;
  }
  function doFirst(sql, p) {
    if (sql.startsWith("SELECT 1 FROM voice_clips LIMIT 1")) {
      if (store.voice_clips === undefined) throw new Error('no voice_clips table');
      return null;
    }
    if (sql.startsWith("SELECT * FROM voice_clips WHERE id=? AND pair_id=? AND owner=?")) {
      const r = store.voice_clips.find(c => c.id === p[0] && c.pair_id === p[1] && c.owner === p[2]) || null;
      return r ? Object.assign({}, r) : null; // 返回副本，模拟真实 D1 快照（UPDATE 不改此处计数）
    }
    if (sql.startsWith("SELECT * FROM voice_clips WHERE id=? AND pair_id=?")) {
      const r = store.voice_clips.find(c => c.id === p[0] && c.pair_id === p[1]) || null;
      return r ? Object.assign({}, r) : null;
    }
    if (sql.startsWith("SELECT id, ready FROM voice_clips WHERE pair_id=? AND owner=?")) {
      const r = store.voice_clips.find(c => c.pair_id === p[0] && c.owner === p[1]) || null;
      return r ? Object.assign({}, r) : null;
    }
    if (sql.startsWith("SELECT") && sql.includes("FROM voice_clips WHERE pair_id=? AND owner=?")) {
      const r = store.voice_clips.find(c => c.pair_id === p[0] && c.owner === p[1]) || null;
      return r ? Object.assign({}, r) : null;
    }
    if (sql.startsWith("SELECT * FROM voice_reviews WHERE pair_id=? AND reviewer=?")) {
      const r = store.voice_reviews.find(x => x.pair_id === p[0] && x.reviewer === p[1]) || null;
      return r ? Object.assign({}, r) : null;
    }
    if (sql.startsWith("SELECT 1 AS x FROM voice_reviews WHERE pair_id=? AND reviewer=?")) {
      return store.voice_reviews.find(r => r.pair_id === p[0] && r.reviewer === p[1]) || null;
    }
    if (sql.startsWith("SELECT COUNT(*) AS c, COALESCE(SUM(willing)")) {
      const rs = store.voice_reviews.filter(r => r.pair_id === p[0]);
      return { c: rs.length, w: rs.reduce((s, r) => s + (r.willing | 0), 0) };
    }
    if (sql.startsWith("SELECT id, rep, banned FROM users WHERE id=?")) {
      return store.users.find(u => u.id === p[0]) || null;
    }
    if (sql.startsWith("SELECT * FROM pairs WHERE id=?")) {
      return store.pairs.find(x => x.id === p[0]) || null;
    }
    if (sql.startsWith("SELECT count, reset_at FROM rate_limits WHERE key=?")) {
      return store.rate_limits.find(r => r.key === p[0]) || null;
    }
    return null;
  }
  function doAll(sql, p) {
    if (sql.startsWith("SELECT seq, data FROM voice_chunks WHERE clip_id=?")) {
      return store.voice_chunks.filter(c => c.clip_id === p[0]).sort((a, b) => a.seq - b.seq).map(c => ({ seq: c.seq, data: c.data }));
    }
    // init / retake：读取某人全部试音段 id（不依赖 owner 唯一性，支持多段）
    if (sql.startsWith("SELECT id FROM voice_clips WHERE pair_id=? AND owner=?")) {
      return store.voice_clips.filter(c => c.pair_id === p[0] && c.owner === p[1]).map(c => ({ id: c.id }));
    }
    // metaOf：我的全部试音段（按 created 升序）
    if (sql.startsWith("SELECT id, dur, ready, created FROM voice_clips WHERE pair_id=? AND owner=?")) {
      return store.voice_clips.filter(c => c.pair_id === p[0] && c.owner === p[1]).map(c => ({ id: c.id, dur: c.dur | 0, ready: !!c.ready, created: c.created | 0 }));
    }
    // metaOf：对方的全部试音段（带每段剩余回听次数 + created 用于「正在追加」检测）
    if (sql.startsWith("SELECT id, dur, ready, plays, created FROM voice_clips WHERE pair_id=? AND owner=?")) {
      return store.voice_clips.filter(c => c.pair_id === p[0] && c.owner === p[1]).map(c => ({ id: c.id, dur: c.dur | 0, ready: !!c.ready, playsLeft: Math.max(0, 2 - (c.plays | 0)), created: c.created | 0 }));
    }
    return [];
  }
  const db = {
    prepare(sql) {
      const base = {
        async run() { return { meta: { changes: doWrite(sql, []) } }; },
        async first() { return doFirst(sql, []); },
        async all() { return { results: doAll(sql, []) }; },
      };
      base.bind = function (...params) {
        return {
          async run() { return { meta: { changes: doWrite(sql, params) } }; },
          async first() { return doFirst(sql, params); },
          async all() { return { results: doAll(sql, params) }; },
        };
      };
      return base;
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
  db._store = store;
  return db;
}

// ── 请求构造 ──
function GET(me, pair, qp) {
  const u = new URL('https://t/');
  u.searchParams.set('me', me);
  u.searchParams.set('pair', pair);
  if (qp) Object.keys(qp).forEach(k => u.searchParams.set(k, qp[k]));
  return new Request(u.toString());
}
function POST(body) {
  return new Request('https://t/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

// ── 断言工具 ──
let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

// ── 运行 ──
(async function () {
  const { onRequest } = await import(pathToFileURL(path.join(__dirname, '..', 'functions', 'api', 'voice.js')).href);
  const ctx = (db, req) => ({ request: req, env: { DB: db } });
  const pairBase = [{ id: 'p1', a: 'uA', b: 'uB', ratings: '{}', status: 'matched' }];
  const users = [{ id: 'uA', rep: 50, banned: 0 }, { id: 'uB', rep: 50, banned: 0 }];
  const CHUNK = 'A'.repeat(48 * 1024); // 单片 < MAX_CHUNK(64K)

  async function record(db, me, dur) {
    const init = await (await onRequest(ctx(db, POST({ me, pair: 'p1', action: 'init', mime: 'audio/webm' })))).json();
    if (!init.ok) return init;
    for (let i = 0, seq = 0; i < 2; i++, seq++) {
      await onRequest(ctx(db, POST({ me, pair: 'p1', action: 'chunk', clipId: init.clipId, seq, data: CHUNK })));
    }
    return await (await onRequest(ctx(db, POST({ me, pair: 'p1', action: 'done', clipId: init.clipId, dur })))).json();
  }
  async function gate(db, me) {
    const d = await (await onRequest(ctx(db, GET(me, 'p1')))).json();
    return d;
  }

  console.log('=== 1) 表缺失且 DDL 被拒 → 跳过试音，不影响 v1.0 ===');
  {
    const db = makeDb({ voiceTables: false, allowDDL: false, users, pairs: pairBase });
    const g = await gate(db, 'uA');
    check('GET 返回 ready:false', g.ready === false);
    check('GET 返回 gate:"skip"', g.gate === 'skip');
    const initRes = await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'init' })));
    const ib = await initRes.json();
    check('POST init 返回 503 voice_not_ready（不 500）', initRes.status === 503 && ib.error === 'voice_not_ready');
  }

  console.log('\n=== 1B) 自动建表：首次请求发现表缺失 → 运行时建表 → v2.0 自动激活 ===');
  {
    const db = makeDb({ voiceTables: false, allowDDL: true, users, pairs: JSON.parse(JSON.stringify(pairBase)) });
    const g0 = await gate(db, 'uA');
    check('首次请求后 ready 变为 true（表已自动建好）', g0.ready === true);
    check('自动建表后 gate 进入 record（试音环节可用）', g0.gate === 'record');
    check('voice_clips 数组已被建出', Array.isArray(db._store.voice_clips));
    const ia = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'init' })))).json();
    check('自动建表后 init 正常返回 clipId', !!ia.clipId && ia.clipId.startsWith('vc_'));
  }

  console.log('\n=== 2) 完整链路：双方都愿意组队 → 解锁，且双方录音阅后即焚 ===');
  {
    const db = makeDb({ users, pairs: JSON.parse(JSON.stringify(pairBase)) });
    const ia = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'init' })))).json();
    check('init 返回 clipId 且带题目', !!ia.clipId && ia.clipId.startsWith('vc_') && !!ia.topic);
    check('init 返回最短 30 / 最长 90', ia.minSec === 30 && ia.maxSec === 90);
    const ib = await (await onRequest(ctx(db, POST({ me: 'uB', pair: 'p1', action: 'init' })))).json();

    // A 上传 2 片 + done(55s)
    for (let i = 0, seq = 0; i < 2; i++, seq++) {
      const r = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'chunk', clipId: ia.clipId, seq, data: CHUNK })))).json();
      check('A 分片' + seq + ' 上传成功', r.ok);
    }
    const doneA = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'done', clipId: ia.clipId, dur: 55 })))).json();
    check('A done 成功', doneA.ok && doneA.dur === 55);
    // B 上传 + done(55s)
    for (let i = 0, seq = 0; i < 2; i++, seq++) {
      await onRequest(ctx(db, POST({ me: 'uB', pair: 'p1', action: 'chunk', clipId: ib.clipId, seq, data: CHUNK })));
    }
    const doneB = await (await onRequest(ctx(db, POST({ me: 'uB', pair: 'p1', action: 'done', clipId: ib.clipId, dur: 55 })))).json();
    check('B done 成功', doneB.ok && doneB.dur === 55);

    const ga = await gate(db, 'uA');
    const gb = await gate(db, 'uB');
    check('双方都录完 → 各自 gate="review"', ga.gate === 'review' && gb.gate === 'review');
    check('题目确定性：双方抽到同一题', ga.topic === gb.topic);
    check('peer 录音可拉取（clipId 暴露）', gb.peerClips && gb.peerClips.length && !!gb.peerClips[0].id);

    // B 拉 A 的录音：第 1 次 playsLeft=1，第 2 次=0，第 3 次 no_plays_left
    const f1 = await (await onRequest(ctx(db, GET('uB', 'p1', { action: 'fetch', clip: ia.clipId })))).json();
    check('首次回听返回音频与 playsLeft=1', f1.ok && !!f1.b64 && f1.playsLeft === 1);
    const f2 = await (await onRequest(ctx(db, GET('uB', 'p1', { action: 'fetch', clip: ia.clipId })))).json();
    check('二次回听 playsLeft=0', f2.ok && f2.playsLeft === 0);
    const f3 = await (await onRequest(ctx(db, GET('uB', 'p1', { action: 'fetch', clip: ia.clipId })))).json();
    check('三次回听被拦 no_plays_left', !f3.ok && f3.error === 'no_plays_left');
    // 可以回放自己的录音（#6 产品变更：用户反馈"只能听对方、听不到自己不合理"）
    const fself = await (await onRequest(ctx(db, GET('uA', 'p1', { action: 'fetch', clip: ia.clipId })))).json();
    check('可以回放自己的录音（own:true，不计次、不扣对方额度）', fself.ok && fself.own === true && fself.playsLeft === null);

    // A 评价 willing=1 → 等双方都评完才统一焚毁（B 的录音暂留）
    const ra = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'review', clarity: 5, logic: 4, pace: 3, comment: '不错', willing: 1 })))).json();
    check('A 评价提交成功，未结算（B 未评）', ra.ok && ra.settled == null);
    check('延后焚毁：A 评完 → B 的录音仍在库（等双方都评完才焚）', !!db._store.voice_clips.find(c => c.owner === 'uB'));
    check('延后焚毁：A 自己的录音也仍在', !!db._store.voice_clips.find(c => c.owner === 'uA'));
    const ga2 = await gate(db, 'uA');
    check('A 评完 → gate="wait_review"', ga2.gate === 'wait_review');

    // B 评价 willing=1 → 双方都评完 → 统一焚毁双方录音
    const rb = await (await onRequest(ctx(db, POST({ me: 'uB', pair: 'p1', action: 'review', clarity: 4, logic: 5, pace: 4, comment: '可以', willing: 1 })))).json();
    check('B 评价 → settled="passed"', rb.ok && rb.settled === 'passed');
    check('阅后即焚：双方都评完 → 所有录音清空', db._store.voice_clips.length === 0);
    const ga3 = await gate(db, 'uA');
    check('双方通过 → gate="passed" 解锁房间', ga3.gate === 'passed' && ga3.passed === true);
    check('pair.ratings 写入 _voice.passed=1', JSON.parse(db._store.pairs[0].ratings)._voice.passed === 1);
    check('pair 状态保持 matched（未解散）', db._store.pairs[0].status === 'matched');
  }

  console.log('\n=== 3) 双方婉拒 → 房间 60s 自动解散 ===');
  {
    const db = makeDb({ users, pairs: JSON.parse(JSON.stringify(pairBase)) });
    const ia = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'init' })))).json();
    const ib = await (await onRequest(ctx(db, POST({ me: 'uB', pair: 'p1', action: 'init' })))).json();
    await record(db, 'uA', 55); await record(db, 'uB', 55);
    const ra = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'review', willing: 0 })))).json();
    check('A 婉拒提交成功', ra.ok && ra.settled == null);
    const rb = await (await onRequest(ctx(db, POST({ me: 'uB', pair: 'p1', action: 'review', willing: 0 })))).json();
    check('B 婉拒 → settled="rejected"', rb.settled === 'rejected');
    check('房间置 dissolving 待 60s 解散', db._store.pairs[0].status === 'dissolving' && db._store.pairs[0].dissolve_at > 0);
    check('gate 显示 rejected（前端文案区分婉拒解散）', (await gate(db, 'uA')).gate === 'rejected');
    check('婉拒后录音焚毁', db._store.voice_clips.length === 0);
  }

  console.log('\n=== 4) 时长校验：<30s 与 >90s 都拒收并删除 ===');
  {
    const db = makeDb({ users, pairs: JSON.parse(JSON.stringify(pairBase)) });
    await record(db, 'uA', 20); // dur<30（当前下限 30s）→ too_short 删除
    const gShort = await gate(db, 'uA');
    check('不足 30s → 录音被删，gate 回到 record', gShort.gate === 'record' && db._store.voice_clips.filter(c => c.owner === 'uA').length === 0);
    // 重新录但 done 传 100s（>90 上限）→ too_long 拒收
    const init = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'init' })))).json();
    for (let i = 0, seq = 0; i < 2; i++, seq++) await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'chunk', clipId: init.clipId, seq, data: CHUNK })));
    const longRes = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'done', clipId: init.clipId, dur: 100 })))).json();
    check('超过 90s → 拒收 too_long', !longRes.ok && longRes.error === 'too_long');
  }

  console.log('\n=== 5) 单片过大被拦 + 重录规则 ===');
  {
    const db = makeDb({ users, pairs: JSON.parse(JSON.stringify(pairBase)) });
    const init = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'init' })))).json();
    const big = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'chunk', clipId: init.clipId, seq: 0, data: 'X'.repeat(70 * 1024) })))).json();
    check('单片 > 64K → chunk_too_big', !big.ok && big.error === 'chunk_too_big');
    // A 录完，B 未评 → A 可重录
    await record(db, 'uA', 55);
    const retake = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'retake' })))).json();
    check('对方未评 → 可重录', retake.ok && db._store.voice_clips.filter(c => c.owner === 'uA').length === 0);
    // 重新录 + B 先评价（willing=1）→ A 的录音仍在（延后焚毁），但对方已评不让重录
    await record(db, 'uA', 55);
    await record(db, 'uB', 55);
    const rb = await (await onRequest(ctx(db, POST({ me: 'uB', pair: 'p1', action: 'review', willing: 1 })))).json();
    check('B 评价提交成功（cnt.c=1，未结算）', rb.ok && rb.settled == null);
    check('延后焚毁：A 的录音仍在（等 A 评完才焚）', !!db._store.voice_clips.find(c => c.owner === 'uA'));
    // A 想重录：对方已评 → 重录被拒（peer_already_reviewed），而非 no_clip
    const retakeA = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'retake' })))).json();
    check('对方已评 → 重录被拒 peer_already_reviewed', !retakeA.ok && retakeA.error === 'peer_already_reviewed');
  }

  console.log('\n=== 6) 追加试音：首录后可再录一次（最多 2 段），对方可听到前后两段 ===');
  {
    const db = makeDb({ users, pairs: JSON.parse(JSON.stringify(pairBase)) });
    await record(db, 'uA', 55);
    let ga = await gate(db, 'uA');
    check('首录后 mineClips 长度=1', ga.mineClips.length === 1);
    check('首录后 canAppend=true（可追加）', ga.canAppend === true);
    // A 追加一段（append:true）
    const initA2 = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'init', append: true, mime: 'audio/webm' })))).json();
    check('追加 init 返回 clipId', !!initA2.clipId);
    for (let i = 0, seq = 0; i < 2; i++, seq++) await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'chunk', clipId: initA2.clipId, seq, data: CHUNK })));
    const doneA2 = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'done', clipId: initA2.clipId, dur: 55 })))).json();
    check('追加 done 成功', doneA2.ok);
    ga = await gate(db, 'uA');
    check('追加后 mineClips 长度=2', ga.mineClips.length === 2);
    check('追加到 2 段后 canAppend=false（达上限）', ga.canAppend === false);
    // 第 3 段追加应被拒
    const initA3 = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'init', append: true })))).json();
    check('第 3 段追加被拒 max_attempts', !initA3.ok && initA3.error === 'max_attempts');
    // B 录一段后，B 能看到 A 的前后两段
    await record(db, 'uB', 55);
    const gb = await gate(db, 'uB');
    check('B 看到对方(=A)试音段数=2', gb.peerClips.length === 2);
    check('B 可分段拉取 A 的两段（均 ready）', gb.peerClips.every(c => !!c.id && c.ready));
  }

  console.log('\n=== 6B) 重录（retake）删除自己的全部试音段（含追加段）===');
  {
    const db = makeDb({ users, pairs: JSON.parse(JSON.stringify(pairBase)) });
    await record(db, 'uA', 55);
    const initA2 = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'init', append: true })))).json();
    for (let i = 0, seq = 0; i < 2; i++, seq++) await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'chunk', clipId: initA2.clipId, seq, data: CHUNK })));
    await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'done', clipId: initA2.clipId, dur: 55 })))).json();
    check('重录前置：A 已有 2 段试音', db._store.voice_clips.filter(c => c.owner === 'uA').length === 2);
    const rt = await (await onRequest(ctx(db, POST({ me: 'uA', pair: 'p1', action: 'retake' })))).json();
    check('retake 成功且删光 A 全部 2 段', rt.ok && db._store.voice_clips.filter(c => c.owner === 'uA').length === 0);
    check('retake 后 mineClips 长度=0，可重新首录', (await gate(db, 'uA')).mineClips.length === 0);
  }

  console.log('\n========================================');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail > 0) process.exit(1);
})().catch(e => { console.error('自测脚本异常：', e); process.exit(1); });
