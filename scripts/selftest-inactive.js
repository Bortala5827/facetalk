// FaceTalk 收件箱/发件箱「已失效」卡片灰化策略
// 需求：已配对（both_accepted）+ 已拒（rejected）+ 已撤（cancelled）+ 房间已解散
// 这些用户不再需要决策的卡片，淡化视觉权重，但保留可点击（重进房间/查记录）
const fs = require('fs');
const assert = require('assert');

const appJs = fs.readFileSync('assets/app.js', 'utf8');
const css = fs.readFileSync('assets/style.css', 'utf8');

console.log('— 辅助函数 —');
const helperM = appJs.match(/function isInactive\([\s\S]*?\n  \}/);
assert.ok(helperM, '找不到 isInactive helper');
const h = helperM[0];
assert.ok(/roomStatus === 'closed'/.test(h) && /roomStatus === 'dissolving'/.test(h),
  'isInactive 应识别 roomStatus=closed/dissolving');
assert.ok(/'both_accepted'/.test(h) && /'rejected'/.test(h) && /'cancelled'/.test(h),
  'isInactive 应识别 both_accepted/rejected/cancelled 终态');
// pending/a_accepted 的语义约束由下方 cases 行为测试覆盖（isInactive 都不应返回 true）
// 这里跳过过度严格的源码文本检查

console.log('— loadInbox 接线 —');
const inboxM = appJs.match(/async function loadInbox\([\s\S]*?\n  \}/);
assert.ok(inboxM, '找不到 loadInbox');
const inbox = inboxM[0];
assert.ok(/inactive\s*=\s*isInactive\(a\)/.test(inbox), 'loadInbox 未调用 isInactive');
assert.ok(/classList\.contains\('dissolved'\)/.test(inbox), '未处理 dissolved + inactive 共存');
assert.ok(/'li inactive'/.test(inbox) || /'inactive'/.test(inbox), 'inactive class 未应用');

console.log('— loadOut 接线 —');
const outM = appJs.match(/async function loadOut\([\s\S]*?\n  \}/);
assert.ok(outM, '找不到 loadOut');
const out = outM[0];
assert.ok(/isInactive\(o\)/.test(out), 'loadOut 未调用 isInactive');
assert.ok(/'inactive'/.test(out), 'loadOut 未应用 inactive class');
assert.ok(/o\.status !== 'pending'/.test(out), 'loadOut 没排除 pending（待处理的不应灰）');

console.log('— CSS 样式 —');
assert.ok(/\.li\.inactive[^:{}]*\{\s*opacity/.test(css) || /\.li\.inactive\s*:\s*not\(\.dissolved\)\s*\{\s*opacity/.test(css),
  '缺 .li.inactive 灰化样式');
assert.ok(/filter\s*:\s*grayscale/.test(css), '缺灰阶滤镜');

// 双重灰不冲突：dissolved + inactive 同时存在时样式可叠加
assert.ok(/\.li\.inactive[^{]*\{\s*opacity/.test(css), '.li.inactive 块语法错（CSS 没法 grep）');

console.log('— 行为约束：pending / a_accepted 不应被灰化 —');
// 用反证：isInactive 返回 false
const cases = [
  { a: { status: 'pending' }, expect: false, why: '待处理，用户必须决策' },
  { a: { status: 'a_accepted' }, expect: false, why: '等我自己撤回或等对方' },
  { a: { status: 'both_accepted', roomStatus: null }, expect: true, why: '已配对 - 老申请' },
  { a: { status: 'rejected' }, expect: true, why: '已拒绝' },
  { a: { status: 'cancelled' }, expect: true, why: '已撤回' },
  { a: { status: 'both_accepted', roomStatus: 'closed' }, expect: true, why: '已配对 + 房间已解散' },
];
// 直接eval helper 跑回归
const sandbox = { result: null };
const isInactiveSrc = h.replace(/^function isInactive\(a\)\s*\{([\s\S]*?)\}$/, 'return (function(a){$1}(arguments[0]));');
// 上面写法不稳，直接 eval 抽出来的 helper
const fn = new Function('a', h.replace(/^function isInactive\(a\)\s*\{/, '').replace(/\n  \}$/, ''));
cases.forEach(function (c) {
  const got = fn(c.a);
  assert.strictEqual(got, c.expect,
    'isInactive(' + JSON.stringify(c.a) + ') = ' + got + '，期望 ' + c.expect + ' — ' + c.why);
});

console.log('\n所有 selftest-inactive 测试通过 (' + (cases.length + 12) + '/' + (cases.length + 12) + ')');
