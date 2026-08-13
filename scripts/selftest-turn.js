// FaceTalk v2.2 自测：/api/turn 短期 TURN 凭证签发
// 运行：node scripts/selftest-turn.js
import { onRequest as turnOn } from '../functions/api/turn.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } }

function req() {
  return { method: 'GET', url: 'https://x/api/turn', headers: { get: () => '1.2.3.4' } };
}

// 无 D1 也要能跑（限流是可选项，不能成为硬依赖）
function noDB() { return {}; }

// 会拒绝一切请求的限流器：验证 429 分支
function blockingDB() {
  const st = {
    _sql: '', _args: [],
    bind(...a) { st._args = a; return st; },
    async first() { return { count: 999, reset_at: Math.floor(Date.now() / 1000) + 60 }; },
    async all() { return { results: [] }; },
    async run() { return { meta: { changes: 1 } }; },
  };
  return { DB: { prepare: () => st, exec: async () => ({}) } };
}

const SAMPLE = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'u-abc',
      credential: 'c-abc',
    },
  ],
};

function mockFetch(impl) { global.fetch = impl; }

(async () => {
  console.log('\n[/api/turn]');
  let r, d;

  // 1. 未配置环境变量 → 静默降级
  r = await turnOn({ request: req(), env: noDB() });
  d = await r.json();
  ok('未配置 TURN Key → configured:false', d.configured === false);
  ok('未配置时 reason 为 not_configured', d.reason === 'not_configured');
  ok('未配置时仍返回 200（前端不该报错）', r.status === 200);
  ok('未配置时 iceServers 为空数组', Array.isArray(d.iceServers) && d.iceServers.length === 0);

  // 2. 正常签发
  let captured = null;
  mockFetch(async (url, opt) => {
    captured = { url, opt };
    return { ok: true, status: 200, text: async () => JSON.stringify(SAMPLE) };
  });
  r = await turnOn({ request: req(), env: { TURN_KEY_ID: 'kid', TURN_KEY_API_TOKEN: 'tok' } });
  d = await r.json();
  ok('正常签发 → configured:true', d.configured === true);
  ok('返回 2 组 iceServers', d.iceServers.length === 2);
  ok('带回 username/credential', d.iceServers[1].username === 'u-abc' && d.iceServers[1].credential === 'c-abc');
  ok('返回 ttl', d.ttl === 7200);

  // 3. 53 端口必须被过滤（浏览器会屏蔽，留着白等超时）
  const allUrls = d.iceServers.map((s) => s.urls).flat().join(' ');
  ok('已过滤 stun :53', allUrls.indexOf('stun.cloudflare.com:53') < 0);
  ok('已过滤 turn :53', allUrls.indexOf('turn.cloudflare.com:53') < 0);
  ok('保留 3478 udp', allUrls.indexOf('turn:turn.cloudflare.com:3478?transport=udp') >= 0);
  ok('保留 turns 443（最强穿透，走 TLS）', allUrls.indexOf('turns:turn.cloudflare.com:443?transport=tcp') >= 0);

  // 4. 请求本身是否正确构造
  ok('打到 Cloudflare 正确 endpoint', /rtc\.live\.cloudflare\.com\/v1\/turn\/keys\/kid\/credentials\/generate-ice-servers$/.test(captured.url));
  ok('方法为 POST', captured.opt.method === 'POST');
  ok('带 Bearer 授权头', captured.opt.headers.Authorization === 'Bearer tok');
  ok('body 含 ttl', JSON.parse(captured.opt.body).ttl === 7200);

  // 5. 上游报错 → 降级且不泄漏原始错误体
  mockFetch(async () => ({ ok: false, status: 401, text: async () => 'secret account detail leaked here' }));
  r = await turnOn({ request: req(), env: { TURN_KEY_ID: 'kid', TURN_KEY_API_TOKEN: 'bad' } });
  d = await r.json();
  ok('上游 401 → configured:false', d.configured === false);
  ok('上游错误只暴露状态码', d.reason === 'upstream_401');
  ok('不透传上游错误正文', JSON.stringify(d).indexOf('secret account') < 0);

  // 6. 上游返回非 JSON
  mockFetch(async () => ({ ok: true, status: 200, text: async () => '<html>502</html>' }));
  r = await turnOn({ request: req(), env: { TURN_KEY_ID: 'kid', TURN_KEY_API_TOKEN: 'tok' } });
  d = await r.json();
  ok('非 JSON → bad_json 降级', d.configured === false && d.reason === 'bad_json');

  // 7. 上游返回空列表
  mockFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ iceServers: [] }) }));
  r = await turnOn({ request: req(), env: { TURN_KEY_ID: 'kid', TURN_KEY_API_TOKEN: 'tok' } });
  d = await r.json();
  ok('空列表 → empty 降级', d.configured === false && d.reason === 'empty');

  // 8. 网络异常
  mockFetch(async () => { throw new Error('boom'); });
  r = await turnOn({ request: req(), env: { TURN_KEY_ID: 'kid', TURN_KEY_API_TOKEN: 'tok' } });
  d = await r.json();
  ok('fetch 抛错 → fetch_failed 降级', d.configured === false && d.reason === 'fetch_failed');
  ok('异常时不抛到 Worker 外（仍是 200）', r.status === 200);

  // 9. 限流
  mockFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(SAMPLE) }));
  const envRL = Object.assign({ TURN_KEY_ID: 'kid', TURN_KEY_API_TOKEN: 'tok' }, blockingDB());
  r = await turnOn({ request: req(), env: envRL });
  d = await r.json();
  ok('超限 → 429', r.status === 429);
  ok('超限 reason 为 rate_limited', d.reason === 'rate_limited');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
})();
