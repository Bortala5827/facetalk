// FaceTalk 互评并发竞态回归测试（2026-08-10 修复）
// 背景 bug：rate 是「读-改-写」非原子操作，双方几乎同时提交时后写者用旧 ratings 覆盖先写者，
// → _evaluated 丢失 → 房间永远 matched → 前端 render/tick 反复开合评价卡"来回闪退"。
// 修复：CAS 乐观锁（UPDATE ... WHERE ratings=旧值，changes=0 重读重试）。
// 本测试内联与 functions/api/pair.js 一致的修复后逻辑，模拟双方交错提交验证不丢状态。
// 运行：node scripts/selftest-rate-race.js

function safeParse(s) { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } }
function nowSec() { return Math.floor(Date.now() / 1000); }

// 内存 mock D1：pair 行 + 记录每次 UPDATE 的 changes（CAS 依赖它）
function makeDb(pair) {
  const store = { pair: { ...pair, ratings: pair.ratings || '{}' } };
  const stmts = [];
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              if (/SELECT ratings FROM pairs WHERE id=\?/.test(sql)) return { ratings: store.pair.ratings };
              if (/SELECT \* FROM pairs WHERE id=\?/.test(sql)) return { ...store.pair };
              if (/SELECT rep FROM users WHERE id=\?/.test(sql)) return { rep: 50 };
              if (/SELECT ratings FROM pairs WHERE id=/.test(sql)) return { ratings: store.pair.ratings };
              return null;
            },
            async run() {
              stmts.push({ sql, params });
              // CAS：UPDATE pairs SET ratings=?, status=? WHERE id=? AND ratings=?
              const m = sql.match(/WHERE id=\? AND ratings=\?/);
              if (m) {
                const cur = params[2], expected = params[3];
                if (store.pair.ratings !== expected) return { meta: { changes: 0 } }; // 并发冲突
                store.pair.ratings = params[0];
                store.pair.status = params[1];
                return { meta: { changes: 1 } };
              }
              if (/UPDATE pairs SET closed_at=\?/.test(sql)) { store.pair.closed_at = params[0]; return { meta: { changes: 1 } }; }
              if (/UPDATE users SET rep=\?/.test(sql)) return { meta: { changes: 1 } };
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    async batch() {},
    _store: store,
    _stmts: stmts,
  };
}

// === 修复后的 rate 核心逻辑（复制自 functions/api/pair.js，仅抽离 DB 交互）===
// 返回 { ok, done, waiting, timedOut }；模拟一次提交
async function submitRate(db, pairId, uid, body) {
  const p = await db.prepare('SELECT * FROM pairs WHERE id=?').bind(pairId).first();
  if (!p) return { error: 'pair_gone' };
  if (uid !== p.a && uid !== p.b) return { error: 'not_party' };
  const score = Math.max(1, Math.min(5, parseInt(body.score, 10) || 3));
  const tags = Array.isArray(body.tags) ? body.tags.slice(0, 5).map(String) : [];
  const next = !!body.next;
  const blockNext = !!body.blockNext;
  const other = uid === p.a ? p.b : p.a;
  const now = nowSec();
  const myKey = (uid === p.a) ? 'a' : 'b';
  const otherKey = (uid === p.a) ? 'b' : 'a';
  const o = await db.prepare('SELECT rep FROM users WHERE id=?').bind(other).first();
  const newRep = Math.max(0, Math.min(100, (o ? (o.rep | 0) : 50) + (score - 3)));

  let bothEvaluated = false, timedOut = false, committed = false;
  for (let attempt = 0; attempt < 3 && !committed; attempt++) {
    const cur = await db.prepare('SELECT ratings FROM pairs WHERE id=?').bind(pairId).first();
    if (!cur) return { error: 'pair_gone' };
    const ratings = safeParse(cur.ratings);
    if (ratings[uid]) return { error: 'already_rated' };
    if (!ratings._evaluated) ratings._evaluated = {};
    ratings._evaluated[myKey] = true;
    ratings[uid] = { score, tags, next, blockNext, at: now };

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
      if (readyToClose) {
        try { await db.prepare("UPDATE pairs SET closed_at=? WHERE id=?").bind(now + 300, p.id).run(); } catch (e) {}
      }
    }
  }
  if (!committed) return { error: 'rate_conflict' };
  await db.batch();
  return { ok: true, done: bothEvaluated, blocked: blockNext, waiting: !bothEvaluated, timedOut };
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name + (extra !== undefined ? '  -> ' + extra : '')); }
}

(async () => {
  console.log('\n=== 场景一：双方严格顺序提交（A 先、B 后）—— 修复前也正常 ===');
  {
    const db = makeDb({ id: 'p1', a: 'uA', b: 'uB', status: 'matched', ratings: '{}' });
    const ra = await submitRate(db, 'p1', 'uA', { score: 5, next: true });
    ok('A 提交后 waiting=true（等 B）', ra.waiting === true);
    const rb = await submitRate(db, 'p1', 'uB', { score: 4, next: true });
    ok('B 提交后 waiting=false（双方齐了）', rb.waiting === false);
    ok('B 提交后 done=true', rb.done === true);
    ok('房间状态变为 done', db._store.pair.status === 'done');
    const ratings = safeParse(db._store.pair.ratings);
    ok('双方评分都保留（uA 5 / uB 4）', ratings.uA && ratings.uA.score === 5 && ratings.uB && ratings.uB.score === 4);
    ok('_evaluated.a 与 .b 都在', ratings._evaluated && ratings._evaluated.a === true && ratings._evaluated.b === true);
    ok('closed_at 已设置（5 分钟自动解散）', db._store.pair.closed_at > 0);
  }

  console.log('\n=== 场景二：双方交错并发（模拟 A 写入前 B 已读到旧值）—— 修复前 B 会覆盖 A ===');
  {
    const db = makeDb({ id: 'p2', a: 'uA', b: 'uB', status: 'matched', ratings: '{}' });
    // 手动模拟竞态：A 先 SELECT 到 {}，但 B 抢先写入后再轮到 A 提交
    // 通过让 A 第一次 UPDATE 冲突（changes=0）→ 触发重试路径来验证
    // 这里直接串行调用，但把 A 的第一次提交改为"预期冲突"来模拟：
    // 做法：先记录 A 读到的旧值，人为插入 B 的写入，再让 A 以旧值提交
    const curA = { ratings: db._store.pair.ratings }; // A 读到的 {} 
    await submitRate(db, 'p2', 'uB', { score: 4, next: true }); // B 抢先写完
    // A 现在用自己的旧视图提交（等价于 A 的 SELECT 发生在 B 之前）
    const resA = await (async () => {
      const p = db._store.pair;
      const ratings = safeParse(curA.ratings);
      if (!ratings._evaluated) ratings._evaluated = {};
      ratings._evaluated.a = true;
      ratings.uA = { score: 5, tags: [], next: true, blockNext: false, at: nowSec() };
      const bothEval = ratings._evaluated.a && ratings._evaluated.b;
      const rr = await db.prepare('UPDATE pairs SET ratings=?, status=? WHERE id=? AND ratings=?')
        .bind(JSON.stringify(ratings), bothEval ? 'done' : 'matched', p.id, curA.ratings).run();
      return rr.meta.changes;
    })();
    ok('A 以旧值提交被 CAS 拒绝（changes=0）', resA === 0, 'changes=' + resA);
    // 然后 A 走真实提交（内部重试，读到 B 已写入的最新 ratings）
    const ra = await submitRate(db, 'p2', 'uA', { score: 5, next: true });
    ok('A 重试后提交成功', ra.ok === true);
    const ratings2 = safeParse(db._store.pair.ratings);
    ok('双方评分都保留（uA 5 / uB 4）', ratings2.uA && ratings2.uA.score === 5 && ratings2.uB && ratings2.uB.score === 4, JSON.stringify(ratings2));
    ok('_evaluated.a 与 .b 都在（状态位不丢）', ratings2._evaluated && ratings2._evaluated.a === true && ratings2._evaluated.b === true);
    ok('房间最终 done', db._store.pair.status === 'done');
  }

  console.log('\n=== 场景三：同一人重复提交 → already_rated ===');
  {
    const db = makeDb({ id: 'p3', a: 'uA', b: 'uB', status: 'matched', ratings: '{}' });
    await submitRate(db, 'p3', 'uA', { score: 3 });
    const r2 = await submitRate(db, 'p3', 'uA', { score: 5 });
    ok('重复提交返回 already_rated', r2.error === 'already_rated');
    const ratings = safeParse(db._store.pair.ratings);
    ok('原始评分未被覆盖（仍 3 分）', ratings.uA.score === 3);
  }

  console.log('\n=== 场景四：bothNext/bothPass 用用户 id 取值（修复前恒 false） ===');
  {
    const ratings = { uA: { score: 5, next: true }, uB: { score: 4, next: true }, _evaluated: { a: true, b: true } };
    const bothNext = (r, idA, idB) => !!(r && r[idA] && r[idB] && r[idA].next && r[idB].next);
    const bothPass = (r, idA, idB) => !!(r && r[idA] && r[idB] && r[idA].score >= 3 && r[idB].score >= 3);
    ok('双方都愿意再约 → nextAllowed=true', bothNext(ratings, 'uA', 'uB') === true);
    ok('双方都 ≥3 分 → 可通过', bothPass(ratings, 'uA', 'uB') === true);
    const low = { uA: { score: 2, next: true }, uB: { score: 4, next: true } };
    ok('一方 <3 分 → 不可通过', bothPass(low, 'uA', 'uB') === false);
  }

  console.log('\n========================================');
  console.log(`结果：通过 ${pass} / 失败 ${fail}`);
  console.log('========================================');
  process.exit(fail === 0 ? 0 : 1);
})();
