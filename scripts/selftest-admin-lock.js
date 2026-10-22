// /api/admin 登录失败锁定单测（不连真实 D1，fake DB；data-URL 加载 functions/_shared.js 真实辅助函数）
// 运行：node scripts/selftest-admin-lock.js
// 覆盖：4 次失败不锁；第 5 次起锁定 15 分钟；成功清零；表故障放行。
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'functions', '_shared.js'), 'utf8');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'));
  const { checkLoginLock, recordLoginFail, clearLoginFails } = mod;

  const MAX = 5, LOCK = 15 * 60;
  const FAIL_KEY = 'admin:fail:1.2.3.4';

  // 内存 fake DB：只模拟 rate_limits 的 INSERT OR REPLACE / UPDATE count+1 / DELETE
  function makeFakeDb() {
    const rows = new Map();
    const api = {
      rows,
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => rows.get(args[0]) || null,
              run: async () => {
                if (/INSERT OR REPLACE INTO rate_limits/.test(sql)) rows.set(args[0], { count: 1, reset_at: args[1] });
                else if (/UPDATE rate_limits SET count=count\+1/.test(sql)) { const r = rows.get(args[1]); if (r) { r.count++; r.reset_at = args[0]; } }
                else if (/DELETE FROM rate_limits/.test(sql)) rows.delete(args[0]);
              },
            };
          },
        };
      },
    };
    return api;
  }

  let pass = 0, fail = 0;
  const check = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };

  console.log('\n[1] 连续失败：4 次不锁，第 5 次后锁定');
  let db = makeFakeDb();
  for (let i = 1; i <= 4; i++) {
    await recordLoginFail(db, FAIL_KEY, LOCK);
    const s = await checkLoginLock(db, FAIL_KEY, MAX, LOCK);
    check(`第 ${i} 次失败后未锁`, !s.locked);
  }
  await recordLoginFail(db, FAIL_KEY, LOCK); // 第 5 次
  let s = await checkLoginLock(db, FAIL_KEY, MAX, LOCK);
  check('第 5 次失败后 locked=true', s.locked === true && s.leftSec > 0);

  console.log('\n[2] 锁定窗内继续尝试 → 仍 locked（模拟第 6 次被 429）');
  s = await checkLoginLock(db, FAIL_KEY, MAX, LOCK);
  check('仍 locked', s.locked === true);

  console.log('\n[3] 成功登录清零 → 立即解锁');
  await clearLoginFails(db, FAIL_KEY);
  s = await checkLoginLock(db, FAIL_KEY, MAX, LOCK);
  check('清零后未锁', !s.locked);

  console.log('\n[4] 表故障（prepare 抛错）→ checkLoginLock 放行，recordLoginFail 不炸');
  const brokenDb = { prepare() { throw new Error('no table'); } };
  s = await checkLoginLock(brokenDb, FAIL_KEY, MAX, LOCK);
  check('表故障视为未锁定（放行）', !s.locked);
  let threw = false;
  try { await recordLoginFail(brokenDb, FAIL_KEY, LOCK); await clearLoginFails(brokenDb, FAIL_KEY); } catch (e) { threw = true; }
  check('表故障时记录/清零静默不抛', !threw);

  console.log('\n[5] 新窗口（reset_at 已过）：旧计数失效，不锁');
  db = makeFakeDb();
  db.rows.set(FAIL_KEY, { count: 9, reset_at: 1 }); // 很久以前的过期记录，count 很高也不锁
  s = await checkLoginLock(db, FAIL_KEY, MAX, LOCK);
  check('过期记录不锁', !s.locked);

  console.log('\n========================================');
  console.log(`结果：通过 ${pass} / 失败 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常', e); process.exit(1); });
