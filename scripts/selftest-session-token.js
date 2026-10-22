// 签名会话 token 单测（不连真实 D1，fake DB；通过 data-URL 加载 functions/_shared.js 真实源码）
// 运行：node scripts/selftest-session-token.js
// 覆盖：①有效新 token 通过 ②篡改 id 失败 ③过期失败 ④secret 未配置旧 token 通过 ⑤secret 配置时旧 token 被拒
const fs = require('fs');
const path = require('path');

(async () => {
  // 读取真实 _shared.js，原样以 ESM data-URL 加载（data URL 即 ESM，export 保留；仓库无 package.json 不影响）
  const src = fs.readFileSync(path.join(__dirname, '..', 'functions', '_shared.js'), 'utf8');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'));
  const { issueSessionToken, requireToken } = mod;

  // fake DB：按 id 返回一个正常用户
  const fakeDb = {
    prepare() {
      return {
        bind() {
          return { first: async () => ({ id: 'u_abc123', rep: 50, banned: 0 }) };
        },
      };
    },
  };

  // 测试侧自行用同一 secret 签一个 token（用于构造过期/篡改样本）
  async function signRaw(secret, data) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    const bytes = new Uint8Array(sig);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  const SECRET = 'test-secret-xyz-2026';
  const envSec = { FACETALK_SESSION_SECRET: SECRET, DB: fakeDb };
  const envNoSec = { DB: fakeDb };

  let pass = 0, fail = 0;
  const check = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };

  console.log('\n[1] secret 已配置：有效新 token 通过，且返回纯用户 id');
  const good = await issueSessionToken(envSec, 'u_abc123');
  check('issueSessionToken 返回三段式 id.exp.sig', typeof good === 'string' && good.split('.').length === 3);
  const ok1 = await requireToken(envSec, good);
  check('requireToken 无 error', !ok1.error);
  check('返回的 id 是纯用户 id（不含 .exp.sig）', ok1.id === 'u_abc123');
  check('带回 rep', ok1.user && ok1.user.rep === 50);

  console.log('\n[2] 篡改 id（改 id 段，签名不变）→ 失败');
  const tampered = good.replace('u_abc123', 'u_victim999');
  const r2 = await requireToken(envSec, tampered);
  check('篡改后返回 BAD_TOKEN', r2.error === 'BAD_TOKEN' && r2.status === 401);

  console.log('\n[3] 过期 token（exp 为过去时间，签名正确）→ TOKEN_EXPIRED');
  const pastExp = Math.floor(Date.now() / 1000) - 3600;
  const expiredSig = await signRaw(SECRET, 'u_abc123.' + pastExp);
  const expired = 'u_abc123.' + pastExp + '.' + expiredSig;
  const r3 = await requireToken(envSec, expired);
  check('返回 TOKEN_EXPIRED', r3.error === 'TOKEN_EXPIRED' && r3.status === 401);

  console.log('\n[4] secret 未配置：旧格式裸 id 走旧逻辑通过（现状兼容）');
  const r4 = await requireToken(envNoSec, 'u_abc123');
  check('无 error，按裸 id 查库通过', !r4.error && r4.id === 'u_abc123');

  console.log('\n[5] secret 已配置：旧格式裸 id 被拒（强制重新获取身份）');
  const r5 = await requireToken(envSec, 'u_abc123');
  check('返回 BAD_TOKEN', r5.error === 'BAD_TOKEN' && r5.status === 401);

  console.log('\n[6] 补充：签名被篡改（改 sig 段）→ BAD_TOKEN；空 token → NO_TOKEN');
  const badSig = good.slice(0, good.lastIndexOf('.') + 1) + 'fakesig';
  const r6a = await requireToken(envSec, badSig);
  check('错误签名 BAD_TOKEN', r6a.error === 'BAD_TOKEN');
  const r6b = await requireToken(envSec, '');
  check('空 token NO_TOKEN', r6b.error === 'NO_TOKEN' && r6b.status === 401);

  console.log('\n========================================');
  console.log(`结果：通过 ${pass} / 失败 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常', e); process.exit(1); });
