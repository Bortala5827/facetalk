// 留言墙删除管理密码校验单测（覆盖：MS_ADMIN_KEY / WALL_ADMIN / 默认 rcj9527 / 错误密码 / trim）
// 复制自 functions/api/wall.js 的 adminPassOk，不连真实 D1。

function adminPassOk(env, admin) {
  const a = String(admin || '').trim();
  if (!a) return false;
  const list = [env && env.MS_ADMIN_KEY, env && env.WALL_ADMIN, 'rcj9527']
    .map(s => s && String(s)).filter(Boolean);
  return list.includes(a);
}

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } }

// 场景：用户实际配置（设了 MS_ADMIN_KEY，没设 WALL_ADMIN）
const envUser = { MS_ADMIN_KEY: 'mySecret123' };

console.log('\n[1] 用户设了 MS_ADMIN_KEY（你当前的真实情况）');
check('输入 MS_ADMIN_KEY 的值 → pass', adminPassOk(envUser, 'mySecret123'));
check('输入默认 rcj9527 → 也 pass（向后兼容）', adminPassOk(envUser, 'rcj9527'));
check('输入错误密码 → reject', !adminPassOk(envUser, 'wrong'));
check('输入带空格 MS_ADMIN_KEY → pass（trim）', adminPassOk(envUser, '  mySecret123  '));
check('空字符串 → reject', !adminPassOk(envUser, ''));
check('null → reject', !adminPassOk(envUser, null));

console.log('\n[2] 旧配置（只设了 WALL_ADMIN）——向后兼容');
const envOld = { WALL_ADMIN: 'oldKey' };
check('输入旧 WALL_ADMIN 的值 → pass', adminPassOk(envOld, 'oldKey'));
check('输入默认 rcj9527 → 也 pass', adminPassOk(envOld, 'rcj9527'));
check('输入 MS_ADMIN_KEY 值 → reject（没设）', !adminPassOk(envOld, 'mySecret123'));

console.log('\n[3] 双变量都设（不冲突，取任一）');
const envBoth = { MS_ADMIN_KEY: 'newKey', WALL_ADMIN: 'oldKey' };
check('newKey → pass', adminPassOk(envBoth, 'newKey'));
check('oldKey → pass', adminPassOk(envBoth, 'oldKey'));
check('rcj9527 → 也 pass（默认兜底）', adminPassOk(envBoth, 'rcj9527'));

console.log('\n[4] 啥都没设（最简环境）');
check('输入 rcj9527 → pass（兜底默认）', adminPassOk({}, 'rcj9527'));
check('输入其他 → reject', !adminPassOk({}, 'anything'));

console.log('\n========================================');
console.log(`结果：通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);