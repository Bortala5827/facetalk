// 留言墙删除管理密码校验单测（覆盖：MS_ADMIN_KEY / ADMIN_KEY / WALL_ADMIN / 无硬编码默认后门 / 错误密码 / trim）
// 复制自 functions/api/wall.js 的 adminPassOk，不连真实 D1。
// 2026-10-22：已移除硬编码默认 rcj9527，未配置任何 env 口令时一律拒绝。

function adminPassOk(env, admin) {
  const a = String(admin || '').trim();
  if (!a) return false;
  const list = [env && env.MS_ADMIN_KEY, env && env.ADMIN_KEY, env && env.WALL_ADMIN]
    .map(s => s && String(s)).filter(Boolean);
  return list.includes(a);
}

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } }

// 场景：用户实际配置（设了 MS_ADMIN_KEY，没设 WALL_ADMIN）
const envUser = { MS_ADMIN_KEY: 'mySecret123' };

console.log('\n[1] 用户设了 MS_ADMIN_KEY（你当前的真实情况）');
check('输入 MS_ADMIN_KEY 的值 → pass', adminPassOk(envUser, 'mySecret123'));
check('旧默认 rcj9527 → 拒绝（硬编码后门已移除）', !adminPassOk(envUser, 'rcj9527'));
check('输入错误密码 → reject', !adminPassOk(envUser, 'wrong'));
check('输入带空格 MS_ADMIN_KEY → pass（trim）', adminPassOk(envUser, '  mySecret123  '));
check('空字符串 → reject', !adminPassOk(envUser, ''));
check('null → reject', !adminPassOk(envUser, null));

console.log('\n[2] 只设 ADMIN_KEY（管理后台 admin.html 同款）');
const envAdmin = { ADMIN_KEY: 'adminPass' };
check('输入 ADMIN_KEY 的值 → pass', adminPassOk(envAdmin, 'adminPass'));
check('旧默认 rcj9527 → 拒绝', !adminPassOk(envAdmin, 'rcj9527'));
check('输入其他 → reject', !adminPassOk(envAdmin, 'whatever'));

console.log('\n[3] 旧配置（只设了 WALL_ADMIN）——向后兼容');
const envOld = { WALL_ADMIN: 'oldKey' };
check('输入旧 WALL_ADMIN 的值 → pass', adminPassOk(envOld, 'oldKey'));
check('旧默认 rcj9527 → 拒绝', !adminPassOk(envOld, 'rcj9527'));
check('输入 MS_ADMIN_KEY 值 → reject（没设）', !adminPassOk(envOld, 'mySecret123'));

console.log('\n[4] 双变量都设（不冲突，取任一）');
const envBoth = { MS_ADMIN_KEY: 'newKey', WALL_ADMIN: 'oldKey' };
check('newKey → pass', adminPassOk(envBoth, 'newKey'));
check('oldKey → pass', adminPassOk(envBoth, 'oldKey'));
check('rcj9527 → 拒绝（无兜底默认）', !adminPassOk(envBoth, 'rcj9527'));

console.log('\n[5] 啥都没设（最简环境）→ 全部拒绝');
check('输入 rcj9527 → reject（无默认后门）', !adminPassOk({}, 'rcj9527'));
check('输入其他 → reject', !adminPassOk({}, 'anything'));

console.log('\n========================================');
console.log(`结果：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
