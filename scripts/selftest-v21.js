// FaceTalk v2.1 自测：mock Workers 环境，验证 /api/interview 与 /api/llm 逻辑
// 运行：node scripts/selftest-v21.js
import { onRequest as interviewOn } from '../functions/api/interview.js';
import { onRequest as llmOn } from '../functions/api/llm.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } }

// ── fake D1 ──
// 关键：真实 D1 的 prepare() 返回的 statement 本身就带 first/all/run，
// bind() 只是把参数挂上去再返回自己。mock 必须完全一致，否则
// interviewReady() 里的 prepare(...).first()（无 bind）会抛错走降级分支。
function makeDB() {
  const state = { lines: [], sigs: [], users: { u1: { id: 'u1', rep: 50, banned: 0 } }, pairs: { p1: { id: 'p1', a: 'u1', b: 'u2', ratings: '{}' } } };
  function prep(sql) {
    const lower = (sql || '').toLowerCase();
    const st = {
      _sql: lower,
      _args: [],
      bind(...a) { st._args = a; return st; },
      async first() {
        if (lower.includes('from users')) return state.users.u1 ? { ...state.users.u1 } : undefined;
        if (lower.includes('from pairs')) {
          const p = state.pairs[st._args[0]] || state.pairs.p1;
          return p ? { ...p } : undefined;
        }
        return undefined;   // rate_limits / SELECT 1 探活 都落这里
      },
      async all() {
        if (lower.includes('from interview_lines')) return { results: state.lines.map((x) => ({ ...x })) };
        if (lower.includes('from rtc_signals')) {
          const to = st._args[1];
          return { results: state.sigs.filter((s) => s.to_id === to).map((x) => ({ ...x })) };
        }
        return { results: [] };
      },
      async run() {
        const a = st._args;
        if (lower.includes('insert into interview_lines')) {
          state.lines.push({ id: a[0], pair_id: a[1], who: a[2], text: a[3], created: a[4] });
        }
        if (lower.includes('insert into rtc_signals')) {
          state.sigs.push({ id: a[0], pair_id: a[1], from_id: a[2], to_id: a[3], kind: a[4], data: a[5], created: a[6] });
        }
        return { meta: { changes: 1 } };
      },
    };
    return st;
  }
  return { _state: state, prepare: prep, batch: async () => ({}) };
}

function req(method, url, body) {
  return {
    method, url,
    headers: { get: () => null },
    json: async () => body,
    formData: async () => body, // body 需含 get(k)
  };
}
function fd(obj) { return { get: (k) => obj[k] }; }

async function run() {
  console.log('== /api/interview ==');
  const db = makeDB();
  const env = { DB: db };

  // GET 空
  let r = await interviewOn({ request: req('GET', 'https://x/api/interview?me=u1&pair=p1&sinceSignal=0'), env });
  let d = await r.json();
  ok('GET 返回 ok', d.ok === true);
  ok('GET 初始无转录行', Array.isArray(d.lines) && d.lines.length === 0);

  // POST line
  try {
    r = await interviewOn({ request: req('POST', 'https://x/api/interview', { me: 'u1', pair: 'p1', action: 'line', text: '我认为辅警要服务群众' }), env });
  } catch (e) { console.log('  POST line threw:', e.message); }
  d = await r.json();
  ok('POST line ok', d.ok === true && d.mine === true);
  ok('line 已写入 state', db._state.lines.length === 1 && db._state.lines[0].who === 'a');

  // POST signal
  r = await interviewOn({ request: req('POST', 'https://x/api/interview', { me: 'u1', pair: 'p1', action: 'signal', kind: 'offer', data: '{"sdp":"x"}' }), env });
  d = await r.json();
  ok('POST signal ok', d.ok === true);
  ok('signal 已写入 state（to=u2）', db._state.sigs.length === 1 && db._state.sigs[0].to_id === 'u2');

  // GET 现在能取到 line；信令是投给对方的，自己不该收到（避免回环）
  r = await interviewOn({ request: req('GET', 'https://x/api/interview?me=u1&pair=p1&sinceSignal=0'), env });
  d = await r.json();
  ok('GET 含 1 行转录', d.lines.length === 1);
  ok('转录行标记 mine=true', d.lines[0].mine === true);
  ok('发送方不会收到自己的信令', d.signals.length === 0);

  // 对方（u2）能收到这条信令，且转录行对他标记 mine=false
  r = await interviewOn({ request: req('GET', 'https://x/api/interview?me=u2&pair=p1&sinceSignal=0'), env });
  d = await r.json();
  ok('对方 GET 含 1 条信令', d.signals.length === 1 && d.signals[0].kind === 'offer');
  ok('对方看到转录行 mine=false', d.lines.length === 1 && d.lines[0].mine === false);

  // 非成员拒绝
  const db2 = makeDB(); db2._state.pairs.p1 = { id: 'p1', a: 'other', b: 'u2' };
  r = await interviewOn({ request: req('POST', 'https://x/api/interview', { me: 'u1', pair: 'p1', action: 'line', text: 'x' }), env: { DB: db2 } });
  ok('非房间成员被拒(403)', r.status === 403);

  console.log('== /api/llm ==');
  // chat 转发（mock fetch）
  global.fetch = async (u, opt) => {
    const body = JSON.parse(opt.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"summary":"不错"}' } }] }) };
  };
  r = await llmOn({ request: req('POST', 'https://x/api/llm?type=chat', { base: 'https://api.openai.com/v1', key: 'sk-x', model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }), env: {} });
  d = await r.json();
  ok('chat 转发成功', d.ok === true && d.content.includes('summary'));

  // chat 拒绝 http（明文）
  r = await llmOn({ request: req('POST', 'https://x/api/llm?type=chat', { base: 'http://evil.com/v1', key: 'k', model: 'm', messages: [] }), env: {} });
  ok('chat 拒绝非 https base', r.status === 400);

  // transcribe 转发（mock fetch）；file 必须是真实 Blob，FormData.append 才认
  global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ text: '你好世界' }) });
  const audio = new Blob([new Uint8Array(100)], { type: 'audio/webm' });
  r = await llmOn({ request: req('POST', 'https://x/api/llm?type=transcribe', fd({ base: 'https://api.openai.com/v1', key: 'sk-x', model: 'whisper-1', file: audio })), env: {} });
  d = await r.json();
  ok('transcribe 转发成功', d.ok === true && d.text === '你好世界');

  // transcribe 缺音频
  r = await llmOn({ request: req('POST', 'https://x/api/llm?type=transcribe', fd({ base: 'https://api.openai.com/v1', key: 'k', model: 'm' })), env: {} });
  ok('transcribe 缺音频报错', r.status === 400);

  // 未知 type
  r = await llmOn({ request: req('POST', 'https://x/api/llm?type=foo', {}), env: {} });
  ok('未知 type 报错', r.status === 400);

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error('SELFTEST CRASH', e); process.exit(2); });
