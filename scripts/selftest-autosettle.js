// 端到端逻辑验证：房间自动结算（退出60s / 互评完5分钟）
// 不连真实 D1、不污染线上。模拟"列缺失(没跑ALTER)"与"列存在(跑了ALTER)"两种场景。
// 核心推算逻辑复制自 functions/api/pair.js (GET 行 20-45 + closeRoomDB 行 266-272 + leave 行 220-243)。

const now = Math.floor(Date.now() / 1000);

// ── 内存 mock D1 ──
function makeDb(pair, messages, simulateMissing) {
  const store = { pair: pair ? { ...pair } : null, messages: messages.slice() };
  function strip(obj) {
    if (!obj) return obj;
    const o = { ...obj };
    if (simulateMissing) { delete o.dissolve_at; delete o.closed_at; }
    return o;
  }
  function applySql(sql, params) {
    const p = store.pair;
    if (/UPDATE pairs SET ratings=\?, status='dissolving', dissolve_at=\? WHERE id=\?/.test(sql)) {
      p.ratings = params[0]; p.status = 'dissolving'; p.dissolve_at = params[1];
    } else if (/UPDATE pairs SET ratings=\?, status='dissolving' WHERE id=\?/.test(sql)) {
      p.ratings = params[0]; p.status = 'dissolving';
    } else if (/UPDATE pairs SET closed_at=\? WHERE id=\?/.test(sql)) {
      p.closed_at = params[0];
    } else if (/DELETE FROM messages WHERE pair_id=\?/.test(sql)) {
      store.messages = store.messages.filter(m => m.pair_id !== params[0]);
    } else if (/UPDATE pairs SET status='closed', ratings='\{\}', info_a='', info_b='' WHERE id=\?/.test(sql)) {
      p.status = 'closed'; p.ratings = '{}'; p.info_a = ''; p.info_b = '';
    }
  }
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              if (/SELECT \* FROM pairs WHERE \(a=\? OR b=\?\) AND expires > \?/.test(sql)) {
                const [a, b, exp] = params;
                if (store.pair && (store.pair.a === a || store.pair.b === b) && store.pair.expires > exp) return strip(store.pair);
                return null;
              }
              if (/SELECT \* FROM pairs WHERE id=\?/.test(sql)) {
                if (store.pair && store.pair.id === params[0]) return strip(store.pair);
                return null;
              }
              if (/SELECT rep FROM users WHERE id=\?/.test(sql)) return { rep: 50 };
              return null;
            },
            async run() {
              if (simulateMissing && /dissolve_at|closed_at/.test(sql)) {
                throw new Error('no such column (simulated ALTER not run)');
              }
              applySql(sql, params);
              return { meta: { changes: 1 } };
            },
          };
        },
        async batch(stmts) { for (const s of stmts) await s.run(); return []; },
      };
    },
    async batch(stmts) { for (const s of stmts) await s.run(); return []; },
    _store: store,
  };
}

// ── 复制自 pair.js 的核心推算 + closeRoomDB ──
function safeParse(s) { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } }
async function closeRoomDB(db, id) {
  await db.batch([
    db.prepare('DELETE FROM messages WHERE pair_id=?').bind(id),
    db.prepare("UPDATE pairs SET status='closed', ratings='{}', info_a='', info_b='' WHERE id=?").bind(id),
  ]);
}
// 模拟一次 GET /api/pair 轮询（含服务端兜底关房）
async function poll(db, me) {
  const r = { id: me };
  const p0 = await db.prepare('SELECT * FROM pairs WHERE (a=? OR b=?) AND expires > ? ORDER BY created DESC LIMIT 1').bind(r.id, r.id, now).first();
  if (!p0) return { pair: null };
  const p = { ...p0 };
  const ratings = safeParse(p.ratings);
  const leftAt = (ratings[p.a] && ratings[p.a].left ? (ratings[p.a].at || 0) : 0) || (ratings[p.b] && ratings[p.b].left ? (ratings[p.b].at || 0) : 0);
  const ratedAt = (ratings[p.a] && ratings[p.a].at && ratings[p.b] && ratings[p.b].at) ? Math.max(ratings[p.a].at, ratings[p.b].at) : 0;
  const exitDue = p.status === 'dissolving' && ((p.dissolve_at || 0) > 0 ? now >= p.dissolve_at : leftAt > 0 && now >= leftAt + 60);
  const settleDue = p.status === 'done' && ((p.closed_at || 0) > 0 ? now >= p.closed_at : ratedAt > 0 && now >= ratedAt + 300);
  let closedNow = false;
  if (exitDue || settleDue) { await closeRoomDB(db, p.id); closedNow = true; p.status = 'closed'; }
  let dissolveIn = p.status === 'dissolving' ? Math.max(0, (p.dissolve_at || 0) - now) : 0;
  if (p.status === 'dissolving' && dissolveIn === 0 && leftAt > 0) dissolveIn = Math.max(0, leftAt + 60 - now);
  let autoCloseIn = (p.status === 'done') ? Math.max(0, (p.closed_at || 0) - now) : 0;
  if (p.status === 'done' && autoCloseIn === 0 && ratedAt > 0) autoCloseIn = Math.max(0, ratedAt + 300 - now);
  return { pair: { status: p.status, dissolveIn, autoCloseIn, closedNow }, _ratings: ratings };
}
// 模拟 leave 动作（列缺失时走 catch 仍置 dissolving + ratings.at）
async function leave(db, me, pairId) {
  const p = await db.prepare('SELECT * FROM pairs WHERE id=?').bind(pairId).first();
  const ratings = safeParse(p.ratings);
  ratings[me] = { left: true, at: now };
  try {
    await db.prepare("UPDATE pairs SET ratings=?, status='dissolving', dissolve_at=? WHERE id=?").bind(JSON.stringify(ratings), now + 60, p.id).run();
  } catch (e) {
    await db.prepare("UPDATE pairs SET ratings=?, status='dissolving' WHERE id=?").bind(JSON.stringify(ratings), p.id).run();
  }
}

// ── 用例 ──
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  -> ' + extra : '')); }
}

async function run() {
  console.log('\n=== 场景一：未跑 alter-room-dissolve.sql（dissolve_at/closed_at 列缺失）===');

  // 用例 A：一方退出，已过去 61s → 应自动结算关闭
  console.log('\n[A] 退出 61s 后轮询 → 期望：房间 closed、对话清空');
  {
    const db = makeDb({ id: 'p1', a: 'u1', b: 'u2', status: 'dissolving', ratings: JSON.stringify({ u1: { left: true, at: now - 61 } }), expires: now + 999, info_a: 'x', info_b: 'y' }, [{ pair_id: 'p1', text: 'hi' }], true);
    const res = await poll(db, 'u2');
    check('房间被服务端关闭', res.pair.status === 'closed');
    check('对话被清空', db._store.messages.length === 0, '剩余=' + db._store.messages.length);
  }

  // 用例 B：双方互评完 301s → 应自动结算关闭
  console.log('\n[B] 互评完 301s 后轮询 → 期望：房间 closed');
  {
    const db = makeDb({ id: 'p2', a: 'u1', b: 'u2', status: 'done', ratings: JSON.stringify({ u1: { at: now - 301, score: 3 }, u2: { at: now - 301, score: 4 } }), expires: now + 999 }, [{ pair_id: 'p2', text: 'bye' }], true);
    const res = await poll(db, 'u1');
    check('房间被服务端关闭', res.pair.status === 'closed');
  }

  // 用例 C：退出仅 30s（未到期）→ 不关闭，倒计时 ~30s
  console.log('\n[C] 退出仅 30s（未到期）→ 期望：不关闭，dissolveIn≈30');
  {
    const db = makeDb({ id: 'p3', a: 'u1', b: 'u2', status: 'dissolving', ratings: JSON.stringify({ u1: { left: true, at: now - 30 } }), expires: now + 999 }, [], true);
    const res = await poll(db, 'u2');
    check('未关闭', res.pair.status === 'dissolving');
    check('倒计时≈30s', res.pair.dissolveIn >= 28 && res.pair.dissolveIn <= 31, 'dissolveIn=' + res.pair.dissolveIn);
  }

  // 用例 F：leave 在列缺失时仍能置 dissolving，随后过期轮询关闭（整条链路闭环）
  console.log('\n[F] leave(列缺失) → 等待 61s 后轮询 → 期望：closed（端到端闭环）');
  {
    const db = makeDb({ id: 'pF', a: 'u1', b: 'u2', status: 'matched', ratings: '{}', expires: now + 999 }, [{ pair_id: 'pF', text: 't' }], true);
    await leave(db, 'u1', 'pF');
    check('leave 后仍 dissolving（降级不丢状态）', db._store.pair.status === 'dissolving');
    // 把 at 往前挪 61s 模拟等待
    const rt = safeParse(db._store.pair.ratings); rt.u1.at = now - 61; db._store.pair.ratings = JSON.stringify(rt);
    const res = await poll(db, 'u2');
    check('过期后自动关闭', res.pair.status === 'closed');
    check('对话清空', db._store.messages.length === 0);
  }

  // 用例 G（用户实际场景）：列缺失时一方刚退出 → 对方轮询必须立刻拿到 dissolving:true 且 dissolveIn>0，
  // 否则前端"对方已退出"提示不会显示（这就是"没反应"的根因回归点）。
  console.log('\n[G] leave(列缺失) 立即轮询 → 期望：dissolving:true 且 dissolveIn>0（前端才弹提示）');
  {
    const db = makeDb({ id: 'pG', a: 'u1', b: 'u2', status: 'matched', ratings: '{}', expires: now + 999 }, [], true);
    await leave(db, 'u1', 'pG');
    const res = await poll(db, 'u2');
    check('对方轮询到 dissolving:true', res.pair.status === 'dissolving');
    check('dissolveIn>0（前端弹出"对方已退出"）', res.pair.dissolveIn > 0, 'dissolveIn=' + res.pair.dissolveIn);
    check('倒计时在 55~60s 区间', res.pair.dissolveIn >= 55 && res.pair.dissolveIn <= 60, 'dissolveIn=' + res.pair.dissolveIn);
  }

  console.log('\n=== 场景二：已跑 alter-room-dissolve.sql（列存在）===');

  // 用例 D：退出 dissolve_at 已过期 → 关闭
  console.log('\n[D] dissolve_at=now-1 轮询 → 期望：closed');
  {
    const db = makeDb({ id: 'p4', a: 'u1', b: 'u2', status: 'dissolving', ratings: '{}', dissolve_at: now - 1, expires: now + 999 }, [], false);
    const res = await poll(db, 'u1');
    check('房间被关闭', res.pair.status === 'closed');
  }

  // 用例 E：未到期 dissolve_at=now+30 → 不关闭，倒计时 30
  console.log('\n[E] dissolve_at=now+30 轮询 → 期望：不关闭，dissolveIn≈30');
  {
    const db = makeDb({ id: 'p5', a: 'u1', b: 'u2', status: 'dissolving', ratings: '{}', dissolve_at: now + 30, expires: now + 999 }, [], false);
    const res = await poll(db, 'u2');
    check('未关闭', res.pair.status === 'dissolving');
    check('倒计时≈30s', res.pair.dissolveIn >= 28 && res.pair.dissolveIn <= 31, 'dissolveIn=' + res.pair.dissolveIn);
  }

  console.log('\n========================================');
  console.log(`结果：通过 ${pass} / 失败 ${fail}`);
  console.log('========================================');
  process.exit(fail === 0 ? 0 : 1);
}
run();
