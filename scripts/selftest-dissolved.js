// 面试搭子 · 房间解散后"申请卡变灰 + 已解散 + 3天自动删 + 解锁重选" 端到端逻辑自测
// 纯内存模拟 D1（不污染线上），覆盖：
//   A) closeRoomDB：关房写 _closedAt 进 ratings JSON + 把被挤掉的 rejected 申请恢复 pending（解锁重选）
//   B) apply GET 收件箱/发件箱：用 intent_id 关联 pairs 推导 roomStatus（null/dissolving/closed）
//   C) _cleanup：closed 房间保留 <3 天、满 3 天硬删房间 + 关联申请；普通过期房间照删
// 运行：node scripts/selftest-dissolved.js

const NOW = 1_700_000_000; // 固定基准时间（秒），避免依赖真实时钟
function nowSec() { return NOW; }
function safeParse(s) { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } }

function roomStatusOf(store, intentId) {
  const ps = store.pairs.filter(p => p.intent_id === intentId && (p.status === 'dissolving' || p.status === 'closed'));
  if (!ps.length) return null;
  ps.sort((a, b) => (b.created || 0) - (a.created || 0));
  return ps[0].status;
}
function blocked(store, owner, applicant) {
  return store.blocks.some(b => b.user_id === owner && b.blocked_id === applicant);
}

// ── 极简 D1 mock：按 SQL 前缀分发到 JS 实现（与真实 SQL 语义保持一致）──
function makeDb(pairs, applications, intents, blocks) {
  const store = {
    pairs: pairs || [],
    applications: applications || [],
    intents: intents || [],
    blocks: blocks || [],
    messages: [],
  };
  function runStmt(sql, params) {
    // —— 基础清理：普通过期房间立即删 ——
    if (sql.startsWith("DELETE FROM pairs WHERE status<>'closed' AND expires < ?")) {
      const before = store.pairs.length;
      store.pairs = store.pairs.filter(p => !(p.status !== 'closed' && p.expires < params[0]));
      return { meta: { changes: before - store.pairs.length } };
    }
    // —— 基础清理：closed 房间满 3 天硬删（_closedAt 缺失退回 created）——
    if (sql.startsWith("DELETE FROM pairs WHERE status='closed' AND (json_extract")) {
      const before = store.pairs.length;
      store.pairs = store.pairs.filter(p => {
        if (p.status !== 'closed') return true;
        const rt = safeParse(p.ratings); const c = rt._closedAt;
        const old = (c != null && c < params[0]) || (c == null && p.created < params[1]);
        return !old;
      });
      return { meta: { changes: before - store.pairs.length } };
    }
    // —— 基础清理：closed 房间满 3 天的关联申请硬删 ——
    if (sql.startsWith("DELETE FROM applications WHERE intent_id IN (SELECT intent_id FROM pairs WHERE status='closed' AND (json_extract")) {
      const closed = store.pairs.filter(p => {
        if (p.status !== 'closed') return false;
        const rt = safeParse(p.ratings); const c = rt._closedAt;
        return (c != null && c < params[0]) || (c == null && p.created < params[1]);
      });
      const intents = new Set(closed.map(p => p.intent_id));
      const before = store.applications.length;
      store.applications = store.applications.filter(a => !intents.has(a.intent_id));
      return { meta: { changes: before - store.applications.length } };
    }
    // —— 基础清理：申请 7 天/过期规则 ——
    if (sql.startsWith("DELETE FROM applications WHERE (status='pending' AND expires < ?) OR (status<>'pending' AND created < ?)")) {
      const before = store.applications.length;
      store.applications = store.applications.filter(a => !((a.status === 'pending' && a.expires < params[0]) || (a.status !== 'pending' && a.created < params[1])));
      return { meta: { changes: before - store.applications.length } };
    }
    if (sql.startsWith("DELETE FROM")) return { meta: { changes: 0 } }; // intents/reports/rate_limits/wall/messages 等
    // —— 自动结算：json_set 写 _closedAt ——
    if (sql.startsWith("UPDATE pairs SET status='closed', ratings=json_set")) {
      let ch = 0;
      store.pairs.forEach(p => {
        const m = (p.status === 'dissolving' && (p.dissolve_at || 0) > 0 && p.dissolve_at <= params[1]) ||
                  (p.status === 'done' && (p.closed_at || 0) > 0 && p.closed_at <= params[2]);
        if (m) { p.status = 'closed'; const rt = safeParse(p.ratings); rt._closedAt = params[0]; p.ratings = JSON.stringify(rt); ch++; }
      });
      return { meta: { changes: ch } };
    }
    if (sql.startsWith("UPDATE pairs SET status='closed', info_a='', info_b='' WHERE (status='dissolving'")) {
      let ch = 0;
      store.pairs.forEach(p => {
        const m = (p.status === 'dissolving' && (p.dissolve_at || 0) > 0 && p.dissolve_at <= params[0]) ||
                  (p.status === 'done' && (p.closed_at || 0) > 0 && p.closed_at <= params[1]);
        if (m) { p.status = 'closed'; ch++; }
      });
      return { meta: { changes: ch } };
    }
    // —— closeRoomDB：清对话 + 置 closed + 写 _closedAt + 解锁 rejected ——
    if (sql.startsWith("UPDATE pairs SET status='closed', ratings=?")) {
      const p = store.pairs.find(x => x.id === params[1]);
      if (p) { p.status = 'closed'; p.ratings = params[0]; return { meta: { changes: 1 } }; }
      return { meta: { changes: 0 } };
    }
    if (sql.startsWith("UPDATE applications SET status='pending' WHERE intent_id=? AND status='rejected'")) {
      let ch = 0;
      store.applications.forEach(a => { if (a.intent_id === params[0] && a.status === 'rejected') { a.status = 'pending'; ch++; } });
      return { meta: { changes: ch } };
    }
    // —— apply GET 收件箱 ——
    if (sql.includes('LEFT JOIN blocks b')) {
      const owner = params[1], now = params[2];
      const rows = store.applications.filter(a => {
        const intent = store.intents.find(i => i.id === a.intent_id);
        return intent && intent.owner === owner && a.expires > now && !blocked(store, owner, a.applicant);
      }).map(a => ({
        appId: a.id, intentId: a.intent_id, status: a.status, created: a.created,
        role: 'x', city: '', mode: '', note: '', rep: 50, roomStatus: roomStatusOf(store, a.intent_id),
      }));
      return { results: rows };
    }
    // —— apply GET 发件箱 ——
    if (sql.includes('a.applicant=?')) {
      const applicant = params[0], now = params[1];
      const rows = store.applications.filter(a => a.applicant === applicant && a.expires > now)
        .map(a => ({ appId: a.id, intentId: a.intent_id, status: a.status, created: a.created, roomStatus: roomStatusOf(store, a.intent_id) }));
      return { results: rows };
    }
    return { meta: { changes: 0 } };
  }
  const db = {
    prepare(sql) { return { bind(...params) { return { run() { return runStmt(sql, params); }, first() { if (sql.includes('FROM pairs WHERE id=?')) { return store.pairs.find(p => p.id === params[0]) || null; } return null; }, all() { return runStmt(sql, params); } }; } }; },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
  db._store = store;
  return db;
}

// 复制生产 closeRoomDB 逻辑（与生产保持一致：写 _closedAt + 解锁 rejected）
async function closeRoomDB(db, id) {
  const p = await db.prepare('SELECT intent_id, ratings FROM pairs WHERE id=?').bind(id).first();
  const rt = safeParse(p && p.ratings); rt._closedAt = nowSec();
  const intentId = (p && p.intent_id) || '';
  await db.batch([
    db.prepare('DELETE FROM messages WHERE pair_id=?').bind(id),
    db.prepare("UPDATE pairs SET status='closed', ratings=?, info_a='', info_b='' WHERE id=?").bind(JSON.stringify(rt), id),
    db.prepare("UPDATE applications SET status='pending' WHERE intent_id=? AND status='rejected'").bind(intentId),
  ]);
}
// 复制生产 runCleanup 的 pairs/applications 段（去掉无关表）实现断言
async function runCleanup(db) {
  const now = nowSec();
  const weekAgo = now - 7 * 86400;
  const threeDays = now - 3 * 86400;
  await db.batch([
    db.prepare("DELETE FROM pairs WHERE status<>'closed' AND expires < ?").bind(now),
    db.prepare("DELETE FROM applications WHERE (status='pending' AND expires < ?) OR (status<>'pending' AND created < ?)").bind(now, weekAgo),
    db.prepare("DELETE FROM applications WHERE intent_id IN (SELECT intent_id FROM pairs WHERE status='closed' AND (json_extract(ratings,'$_closedAt') < ? OR (json_extract(ratings,'$_closedAt') IS NULL AND created < ?)))").bind(threeDays, threeDays),
    db.prepare("DELETE FROM pairs WHERE status='closed' AND (json_extract(ratings,'$_closedAt') < ? OR (json_extract(ratings,'$_closedAt') IS NULL AND created < ?))").bind(threeDays, threeDays),
  ]);
}
// 复制生产 apply GET（box=in / box=out）查询
async function getInbox(db, me) {
  const r = await db.prepare(`SELECT a.id AS appId, a.intent_id AS intentId, a.status, a.created,
      (SELECT p.status FROM pairs p WHERE p.intent_id = a.intent_id AND p.status IN ('dissolving','closed') ORDER BY p.created DESC LIMIT 1) AS roomStatus
    FROM applications a JOIN intents i ON i.id=a.intent_id
    LEFT JOIN blocks b ON b.user_id=? AND b.blocked_id=a.applicant
    WHERE i.owner=? AND a.expires>? AND b.user_id IS NULL`).bind(me, me, nowSec()).all();
  return r.results;
}
async function getOutbox(db, me) {
  const r = await db.prepare(`SELECT a.id AS appId, a.intent_id AS intentId, a.status, a.created,
      (SELECT p.status FROM pairs p WHERE p.intent_id = a.intent_id AND p.status IN ('dissolving','closed') ORDER BY p.created DESC LIMIT 1) AS roomStatus
    FROM applications a WHERE a.applicant=? AND a.expires>?`).bind(me, nowSec()).all();
  return r.results;
}

// ── 断言工具 ──
let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

(async function () {
  console.log('=== A) closeRoomDB：写 _closedAt + 解锁 rejected ===');
  {
    const db = makeDb(
      [{ id: 'p1', intent_id: 'i1', status: 'matched', ratings: '{}', created: NOW }],
      [
        { id: 'a_matched', intent_id: 'i1', applicant: 'uB', status: 'both_accepted', expires: NOW + 999 },
        { id: 'a_rejected', intent_id: 'i1', applicant: 'uC', status: 'rejected', expires: NOW + 999 },
        { id: 'a_pending', intent_id: 'i1', applicant: 'uD', status: 'pending', expires: NOW + 999 },
      ],
      [{ id: 'i1', owner: 'uA' }], []);
    await closeRoomDB(db, 'p1');
    const p = db._store.pairs[0];
    check('房间置 closed', p.status === 'closed');
    check('ratings 写入 _closedAt=NOW', safeParse(p.ratings)._closedAt === NOW);
    check('被挤掉的 rejected 申请恢复为 pending（解锁重选）', db._store.applications.find(a => a.id === 'a_rejected').status === 'pending');
    check('已配对的申请保持 both_accepted', db._store.applications.find(a => a.id === 'a_matched').status === 'both_accepted');
    check('原本 pending 的申请不受影响', db._store.applications.find(a => a.id === 'a_pending').status === 'pending');
  }

  console.log('\n=== B) apply GET：roomStatus 推导 ===');
  {
    const db = makeDb(
      [
        { id: 'p_closed', intent_id: 'i1', status: 'closed', ratings: '{}', created: NOW },
        { id: 'p_dis', intent_id: 'i2', status: 'dissolving', ratings: '{}', created: NOW },
        { id: 'p_live', intent_id: 'i3', status: 'matched', ratings: '{}', created: NOW },
      ],
      [
        { id: 'ap1', intent_id: 'i1', applicant: 'uB', status: 'both_accepted', expires: NOW + 999 },
        { id: 'ap2', intent_id: 'i2', applicant: 'uB', status: 'both_accepted', expires: NOW + 999 },
        { id: 'ap3', intent_id: 'i3', applicant: 'uB', status: 'both_accepted', expires: NOW + 999 },
        { id: 'ap4', intent_id: 'i4', applicant: 'uB', status: 'pending', expires: NOW + 999 },
      ],
      [
        { id: 'i1', owner: 'uA' }, { id: 'i2', owner: 'uA' }, { id: 'i3', owner: 'uA' }, { id: 'i4', owner: 'uA' },
      ], []);
    const inbox = await getInbox(db, 'uA');
    const byId = {}; inbox.forEach(a => byId[a.appId] = a);
    check('i1 申请 roomStatus=closed', byId['ap1'].roomStatus === 'closed');
    check('i2 申请 roomStatus=dissolving', byId['ap2'].roomStatus === 'dissolving');
    check('i3 申请（房间活跃）roomStatus=null', byId['ap3'].roomStatus === null);
    check('i4 申请（无房间）roomStatus=null', byId['ap4'].roomStatus === null);
    const out = await getOutbox(db, 'uB');
    const ob = {}; out.forEach(a => ob[a.appId] = a);
    check('发件箱 i1 roomStatus=closed', ob['ap1'].roomStatus === 'closed');
    check('发件箱 i3 roomStatus=null', ob['ap3'].roomStatus === null);
  }

  console.log('\n=== C) _cleanup：3 天硬删 + 普通过期即删 ===');
  {
    // 满 3 天（_closedAt 早于 threeDays）→ 应删
    const dbOld = makeDb(
      [{ id: 'p_old', intent_id: 'iOld', status: 'closed', ratings: JSON.stringify({ _closedAt: NOW - 3 * 86400 - 10 }), created: NOW }],
      [{ id: 'a_old', intent_id: 'iOld', applicant: 'uB', status: 'both_accepted', expires: NOW + 999 }],
      [{ id: 'iOld', owner: 'uA' }], []);
    await runCleanup(dbOld);
    check('满3天 closed 房间被硬删', dbOld._store.pairs.length === 0);
    check('满3天 closed 房间的关联申请被硬删', dbOld._store.applications.length === 0);

    // 未满 3 天（_closedAt 刚写）→ 保留
    const dbNew = makeDb(
      [{ id: 'p_new', intent_id: 'iNew', status: 'closed', ratings: JSON.stringify({ _closedAt: NOW }), created: NOW }],
      [{ id: 'a_new', intent_id: 'iNew', applicant: 'uB', status: 'both_accepted', expires: NOW + 999 }],
      [{ id: 'iNew', owner: 'uA' }], []);
    await runCleanup(dbNew);
    check('未满3天 closed 房间保留', dbNew._store.pairs.length === 1);
    check('未满3天 关联申请保留', dbNew._store.applications.length === 1);

    // 普通过期房间（status=matched, expires 已过）→ 立即删
    const dbExp = makeDb(
      [{ id: 'p_exp', intent_id: 'iExp', status: 'matched', ratings: '{}', expires: NOW - 100 }],
      [], [{ id: 'iExp', owner: 'uA' }], []);
    await runCleanup(dbExp);
    check('普通过期房间立即删', dbExp._store.pairs.length === 0);

    // _closedAt 缺失但 created 满 3 天（退回 created 判断）→ 删
    const dbNoTs = makeDb(
      [{ id: 'p_nt', intent_id: 'iNt', status: 'closed', ratings: '{}', created: NOW - 3 * 86400 - 10 }],
      [{ id: 'a_nt', intent_id: 'iNt', applicant: 'uB', status: 'both_accepted', expires: NOW + 999 }],
      [{ id: 'iNt', owner: 'uA' }], []);
    await runCleanup(dbNoTs);
    check('_closedAt缺失但created满3天 → 房间删', dbNoTs._store.pairs.length === 0);
    check('_closedAt缺失但created满3天 → 申请删', dbNoTs._store.applications.length === 0);
  }

  console.log('\n========================================');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail > 0) process.exit(1);
})();
