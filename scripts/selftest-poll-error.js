// 自测：面试间 GET 轮询失败现在不再静默吞，3 次失败有 toast；onUnlock 立即拉一次
// 用户报"面试间发的信息彼此看不见"，怀疑 GET 失败被 .catch(function(){}) 静默吞，
// 修复后：连 3 次失败 toast 提示；onUnlock 后立即 ivGet 一次打 console.log，
// 用户在 DevTools Console 能直接看到 lines 实际内容
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'assets/interview.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'pair.html'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, hint) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (hint ? ' — ' + hint : '')); }
}

console.log('=== 面试间 GET 静默失败提示 + 立即拉取 自测 ===');

// 1) pollFailCount 计数
check('pollFailCount 变量定义', /var pollFailCount\s*=\s*0/.test(src),
  'pollFailCount 计数变量丢了');
check('pollFailCount 成功路径重置', /pollFailCount\s*=\s*0/.test(src),
  '成功路径没重置计数');

// 2) catch 路径不再静默
check('catch 内调 toast', /catch[^{]*\{[\s\S]{0,200}pollFailCount\+\+[\s\S]{0,300}toast\(/.test(src),
  'catch 块里没 toast');
check('3 次失败触发', /pollFailCount\s*===\s*3/.test(src),
  '3 次失败阈值没了');

// 3) onUnlock 立即拉一次
check('onUnlock 内调 ivGet 立即拉', /onUnlock[\s\S]{0,1500}ivGet\(\)/.test(src),
  'onUnlock 没立即拉一次');
check('onUnlock 打印 first poll', /first poll ok=/.test(src),
  'first poll 日志丢了');
check('onUnlock 打印每条 line', /forEach[\s\S]{0,400}ln\.id[\s\S]{0,200}ln\.who[\s\S]{0,200}ln\.text/.test(src),
  'line 逐条日志丢了');
check('onUnlock 打印 polling started', /polling started/.test(src),
  'polling started 日志丢了');

// 4) 版本号 bump
check('interview.js 版本号 20260806n', /interview\.js\?v=20260806n/.test(html),
  'pair.html 没 bump 到 20260806n');

console.log('\n=== 回归自测 ===');
// 已有 selftest 也要过
const prior = ['selftest-fallback.js', 'selftest-bubble.js', 'selftest-collapse-fallback.js',
  'selftest-msg-send.js', 'selftest-inactive.js', 'selftest-unify-timer.js'];
const cp = require('child_process');
let priorPass = 0, priorFail = 0;
for (const f of prior) {
  const fp = path.join(root, 'scripts', f);
  if (!fs.existsSync(fp)) { console.log('  -- ' + f + ' (skip, not found)'); continue; }
  const out = cp.execSync('node "' + fp + '"', { cwd: root, encoding: 'utf8' });
  // 抓 "X passed" / "X 通过" / "X/X" / "X/Y 全绿" 之类
  const m = out.match(/(\d+)\s*passed/) || out.match(/(\d+)\s*通过/) || out.match(/\((\d+)\/(\d+)\)/) || out.match(/(\d+)\/(\d+)\s*全绿/);
  if (m) {
    const cnt = m[1] ? parseInt(m[1]) : (m[2] ? parseInt(m[2]) : 0);
    priorPass += cnt;
    console.log('  ✓ ' + f + ' ' + m[0]);
  }
  else { priorFail++; console.log('  ✗ ' + f + ' — 没找到通过行'); console.log(out.slice(-300)); }
}

console.log('\n=== 结果 ===');
console.log('本轮: ' + pass + '/' + (pass + fail) + (fail ? (' ❌ 失败 ' + fail) : ' ✅'));
console.log('回归: ' + priorPass + ' 项通过' + (priorFail ? '（' + priorFail + ' 个脚本异常）' : ''));
process.exit(fail || priorFail ? 1 : 0);
