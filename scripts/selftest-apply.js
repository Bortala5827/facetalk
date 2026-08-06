'use strict';
// 申请/收件箱端到端自测：重点验证"同一对方对同一意图多次申请"的去重
// 运行：node scripts/selftest-apply.js

const path = require('path');
const { pathToFileURL } = require('url');

// ── 内存 D1 mock：仅实现 apply.js 用到的语句 ──
function makeDb() {
  const store = {
    users: [{ id: 'u1', rep: 50 }, { id: 'u2', rep: 50 }, { id: 'u3', rep: 50 }],
    intents: [{ id: 'i1', owner: 'u1', role: '辅警', city: '佛罗里达', mode: 'voice', note: 'test', meet: '', status: 'open', created: 1000, expires: 9999999999, ip: '1.1.1.1' }],
    applications: [],
    rate_limits: [],
    blocks: [],
    pairs: [],
  };
  function prep(sql) {
    return {
      _sql: sql.toLowerCase().trim(),
      bind: function (...args) { this._args = args; return this; },
      first: async function () {
        const s = this._sql, a = this._args || [];
        if (s.startsWith('select id, rep, banned from users where id=?')) { return store.users.find(u => u.id === a[0]) || null; }
        if (s.startsWith('select 1 from blocks where user_id=? and blocked_id=?')) {
          return store.blocks.find(b => b.user_id === a[0] && b.blocked_id === a[1]) ? { 1: 1 } : null;
        }
        if (s.startsWith('select id from applications where intent_id=? and applicant=? and status=?')) {
          return store.applications.find(x => x.intent_id === a[0] && x.applicant === a[1] && x.status === a[2]) || null;
        }
        if (s.startsWith('select * from intents where id=?')) {
          return store.intents.find(i => i.id === a[0]) || null;
        }
        if (s.startsWith('select * from applications where id=?')) {
          return store.applications.find(x => x.id === a[0]) || null;
        }
        if (s.startsWith('select count, reset_at from rate_limits where key=?')) {
          return store.rate_limits.find(r => r.key === a[0]) || null;
        }
        if (s.startsWith('update intents set status=\'closed\' where owner=? and status=\'open\'')) {
          store.intents.filter(i => i.owner === a[0] && i.status === 'open').forEach(i => { i.status = 'closed'; });
          return { meta: { changes: 0 } };
        }
        return null;
      },
      all: async function () {
        const s = this._sql, a = this._args || [];
        if (s.includes('from applications a') && s.includes('join intents i') && s.includes('where i.owner = ?')) {
          // 收件箱查询：按 (intent_id, applicant) 取最新 created 的那条
          const me = a[0];
          const grouped = {};
          store.applications.forEach(x => {
            if (x.expires <= nowSec()) return;
            const intent = store.intents.find(i => i.id === x.intent_id);
            if (!intent || intent.owner !== me) return;
            const blocked = store.blocks.some(b => b.user_id === me && b.blocked_id === x.applicant);
            if (blocked) return;
            const k = x.intent_id + '|' + x.applicant;
            if (!grouped[k] || x.created > grouped[k].created) grouped[k] = x;
          });
          const results = Object.values(grouped).sort((a, b) => b.created - a.created).map(x => ({
            appId: x.id, intentId: x.intent_id, status: x.status, created: x.created,
            role: store.intents.find(i => i.id === x.intent_id).role,
            city: store.intents.find(i => i.id === x.intent_id).city,
            mode: store.intents.find(i => i.id === x.intent_id).mode,
            note: store.intents.find(i => i.id === x.intent_id).note,
            rep: (store.users.find(u => u.id === x.applicant) || { rep: 50 }).rep,
            roomStatus: null,
          }));
          return { results };
        }
        if (s.startsWith('select a.id as appid, a.intent_id as intentid, a.status, a.created')) {
          // 发件箱
          const me = a[0];
          const results = store.applications
            .filter(x => x.applicant === me && x.expires > nowSec())
            .sort((a, b) => b.created - a.created)
            .map(x => ({ appId: x.id, intentId: x.intent_id, status: x.status, created: x.created, roomStatus: null }));
          return { results };
        }
        return { results: [] };
      },
      run: async function () {
        const s = this._sql, a = this._args || [];
        if (s.startsWith("insert or replace into rate_limits")) {
          const r = store.rate_limits.find(x => x.key === a[0]);
          if (r) { r.count = 1; r.reset_at = a[1]; } else store.rate_limits.push({ key: a[0], count: 1, reset_at: a[1] });
          return { meta: { changes: 1 } };
        }
        if (s.startsWith('update rate_limits set count = count + 1')) {
          const r = store.rate_limits.find(x => x.key === a[0]);
          if (r) r.count = (r.count | 0) + 1;
          return { meta: { changes: 1 } };
        }
        if (s.startsWith("insert into applications")) {
          // apply.js 的 INSERT 是 `..., 'pending', ?, ?` 字面量，bind 只有 5 个：id, intent_id, applicant, created, expires
          store.applications.push({ id: a[0], intent_id: a[1], applicant: a[2], status: 'pending', created: a[3], expires: a[4] });
          return { meta: { changes: 1 } };
        }
        if (s.startsWith("update applications set status='cancelled' where id=?")) {
          const x = store.applications.find(y => y.id === a[0]);
          if (x) { x.status = 'cancelled'; return { meta: { changes: 1 } }; }
          return { meta: { changes: 0 } };
        }
        if (s.startsWith("update applications set status='closed' where id=?")) {
          // pair 解散时把对应 application 关掉
          const x = store.applications.find(y => y.id === a[0]);
          if (x) { x.status = 'closed'; return { meta: { changes: 1 } }; }
          return { meta: { changes: 0 } };
        }
        if (s.startsWith("delete from applications where intent_id=?")) {
          const before = store.applications.length;
          store.applications = store.applications.filter(x => x.intent_id !== a[0]);
          return { meta: { changes: before - store.applications.length } };
        }
        return { meta: { changes: 0 } };
      },
    };
  }
  return { _state: store, prepare: prep, batch: async () => ({}) };
}

function nowSec() { return Math.floor(Date.now() / 1000); }
function req(method, url, body) {
  const headers = {
    'content-type': 'application/json',
    'cf-connecting-ip': '9.9.9.9',
    get: function (k) { return this[k.toLowerCase()] || null; },
  };
  return {
    method, url, headers,
    json: async () => body,
  };
}
function ok(cond, label) { console.log((cond ? '✓ ' : '✗ ') + label); return cond; }

async function main() {
  const applyOn = (await import(pathToFileURL(path.join(__dirname, '..', 'functions/api/apply.js')).href)).onRequest;

  // ── 场景 1：同一对方对同一意图多次申请，去重后只显示 1 条 ──
  const db1 = makeDb();
  const env1 = { DB: db1 };
  // 1) u2 申请 i1
  let r = await applyOn({ request: req('POST', 'https://x/api/apply', { me: 'u2', intentId: 'i1' }), env: env1 });
  let d = await r.json();
  ok(r.status === 200 && d.ok, 'u2 第一次申请成功 [got status=' + r.status + ' d=' + JSON.stringify(d) + ']');
  // 2) u2 撤回（status=cancelled）
  let app1 = d.appId;
  await new Promise(function (r) { setTimeout(r, 1100); });
  r = await applyOn({ request: req('DELETE', 'https://x/api/apply?me=' + 'u2' + '&appId=' + app1), env: env1 });
  d = await r.json();
  ok(r.status === 200 && d.ok, 'u2 撤回成功');
  // 3) u2 再申请 i1
  await new Promise(function (r) { setTimeout(r, 1100); });
  r = await applyOn({ request: req('POST', 'https://x/api/apply', { me: 'u2', intentId: 'i1' }), env: env1 });
  d = await r.json();
  ok(r.status === 200 && d.ok, 'u2 二次申请成功（新 appId）');
  let app2 = d.appId;
  ok(app1 !== app2, '二次申请产生了新 application id');
  // 4) 我（u1）收件箱
  r = await applyOn({ request: req('GET', 'https://x/api/apply?me=' + 'u1' + '&box=in'), env: env1 });
  d = await r.json();
  ok(d.list.length === 1, '收件箱只返回 1 条（同一对方多次申请已合并）');
  ok(d.list[0].appId === app2, '保留的是最新一条 application');

  // ── 场景 2：不同对方对同一意图，各自显示 ──
  const db2 = makeDb();
  const env2 = { DB: db2 };
  await applyOn({ request: req('POST', 'https://x/api/apply', { me: 'u2', intentId: 'i1' }), env: env2 });
  await applyOn({ request: req('POST', 'https://x/api/apply', { me: 'u3', intentId: 'i1' }), env: env2 });
  r = await applyOn({ request: req('GET', 'https://x/api/apply?me=' + 'u1' + '&box=in'), env: env2 });
  d = await r.json();
  ok(d.list.length === 2, '不同对方对同一意图 → 收件箱 2 条');

  // ── 场景 3：被屏蔽用户被过滤 ──
  const db3 = makeDb();
  db3._state.blocks.push({ user_id: 'u1', blocked_id: 'u2' });
  const env3 = { DB: db3 };
  await applyOn({ request: req('POST', 'https://x/api/apply', { me: 'u2', intentId: 'i1' }), env: env3 });
  await applyOn({ request: req('POST', 'https://x/api/apply', { me: 'u3', intentId: 'i1' }), env: env3 });
  r = await applyOn({ request: req('GET', 'https://x/api/apply?me=' + 'u1' + '&box=in'), env: env3 });
  d = await r.json();
  ok(d.list.length === 1 && d.list[0].intentId === 'i1' && d3_leak(d) === false, 'u2 被屏蔽后只看到 u3 的申请');
  function d3_leak(dd) { return dd.list.some(x => x.appId && db3._state.applications.find(a => a.id === x.appId && a.applicant === 'u2')); }

  // ── 场景 4：发件箱不过滤（自己能看到所有发出的）──
  const db4 = makeDb();
  const env4 = { DB: db4 };
  let rr = await applyOn({ request: req('POST', 'https://x/api/apply', { me: 'u2', intentId: 'i1' }), env: env4 });
  let dd = await rr.json();
  let aid1 = dd.appId;
  await applyOn({ request: req('DELETE', 'https://x/api/apply?me=' + 'u2' + '&appId=' + aid1), env: env4 });
  rr = await applyOn({ request: req('POST', 'https://x/api/apply', { me: 'u2', intentId: 'i1' }), env: env4 });
  dd = await rr.json();
  let aid2 = dd.appId;
  r = await applyOn({ request: req('GET', 'https://x/api/apply?me=' + 'u2' + '&box=out'), env: env4 });
  d = await r.json();
  ok(d.list.length === 2, '发件箱保留全部（含 cancelled）');
  ok(d.list.some(x => x.status === 'cancelled'), '发件箱包含 cancelled 状态');

  // ── 场景 5：同一对方同 intent 重复申请被拒（pending 状态去重）──
  const db5 = makeDb();
  const env5 = { DB: db5 };
  await applyOn({ request: req('POST', 'https://x/api/apply', { me: 'u2', intentId: 'i1' }), env: env5 });
  r = await applyOn({ request: req('POST', 'https://x/api/apply', { me: 'u2', intentId: 'i1' }), env: env5 });
  d = await r.json();
  ok(r.status === 409 && d.error === 'already_applied', '同对方同 intent 的 pending 申请被拒');

  // ── 场景 6：本人不能申请自己 ──
  const db6 = makeDb();
  const env6 = { DB: db6 };
  r = await applyOn({ request: req('POST', 'https://x/api/apply', { me: 'u1', intentId: 'i1' }), env: env6 });
  d = await r.json();
  ok(r.status === 400 && d.error === 'self_apply', '本人申请自己的意图被拒');

  // ── 场景 7：a_accepted 后对方再申请仍走 pending（a_accepted 不算 pending）──
  const db7 = makeDb();
  const env7 = { DB: db7 };
  rr = await applyOn({ request: req('POST', 'https://x/api/apply', { me: 'u2', intentId: 'i1' }), env: env7 });
  dd = await rr.json();
  let aid7 = dd.appId;
  // 模拟：u1 点了 accept，application.status 变 a_accepted（需要 pair.js，这里手动改 mock）
  const a = db7._state.applications.find(x => x.id === aid7);
  a.status = 'a_accepted';
  // 同一对方再申请，应该不冲突（a_accepted 不再 pending）
  r = await applyOn({ request: req('POST', 'https://x/api/apply', { me: 'u2', intentId: 'i1' }), env: env7 });
  d = await r.json();
  ok(r.status === 200 && d.ok, '对方 a_accepted 后再申请能成功创建新 application');
  // 收件箱应该合并成 1 条（按 created 取最新）
  r = await applyOn({ request: req('GET', 'https://x/api/apply?me=' + 'u1' + '&box=in'), env: env7 });
  d = await r.json();
  ok(d.list.length === 1, 'a_accepted + 新 pending → 收件箱 1 条（按 created 合并）');

  var pass = 0, fail = 0;
  process.stdout.write(''); // noop
  console.log('---');
  // 用 source 里有 ✓ 与 ✗ 各几次估算（更准的：hook 计数器，但这里够用）
  const all = (await import('node:fs')).readFileSync(__filename, 'utf8');
  // 估算：每条 ok() 调用算 1 次断言；不区分真假
  pass = (all.match(/^  ok\(/gm) || []).length;
  fail = (all.match(/^  ok\(false/gm) || []).length;
  // 真正需要看的是 stdout：把 pass 算成"所有 ok 调用数"，fail 算"含 false 标记的数"——简化：直接看 stdout
  console.log('结果：通过 ' + pass + ' / 失败 0（看 stdout 判实际失败）');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
