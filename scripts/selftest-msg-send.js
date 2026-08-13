// 面试间消息发送「卡在发送中」bug 修复自测
// 关键：发消息的成功/失败路径都必须真正移除气泡内的 ... span，不能只摘 class
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const ivJs = read('assets/interview.js');
const css = read('assets/style.css');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  →  ' + e.message); }
}

console.log('— 修复：成功路径移除 pending span（不是只摘 class） —');
t('clearPending 移除 iv-pending-dot 子节点', () => {
  assert.ok(/function clearPending[\s\S]*?\.iv-pending-dot[\s\S]*?\.remove\(\)/.test(ivJs),
    'clearPending 没移除 dot 节点');
});
t('成功路径调用 clearPending 而非直接 classList.remove', () => {
  // 锁定 sendNote 里的 if (d && d.ok) —— 后面紧跟 fbToast 是错的（fbToast 在 fallback 里）
  const m = ivJs.match(/function sendNote[\s\S]*?if \(d && d\.ok\) \{([\s\S]*?)\}\s*\}\)/);
  assert.ok(m, '找不到 sendNote 的 success 分支');
  assert.ok(/clearPending\(el\)/.test(m[1]),
    'success 分支未用 clearPending：' + m[1].slice(0, 200));
});

console.log('— 修复：失败路径也移除 pending span + 加失败标签 + 重发按钮 —');
t('markFailed 移除 pending + 加 iv-fail + iv-fail-tag + iv-retry', () => {
  // 用最小/最大行号锁定 markFailed 整个函数体
  const start = ivJs.indexOf('function markFailed');
  assert.ok(start >= 0, '找不到 markFailed');
  // markFailed 内部的 'iv-retry' 必出现在 start 之后、sendNote 之前
  const sendNoteStart = ivJs.indexOf('function sendNote', start);
  assert.ok(sendNoteStart > start, 'markFailed 边界异常');
  const body = ivJs.slice(start, sendNoteStart);
  assert.ok(/classList\.add\('iv-fail'\)/.test(body), 'markFailed 缺 iv-fail');
  assert.ok(/iv-fail-tag/.test(body), 'markFailed 缺 iv-fail-tag');
  assert.ok(/重发/.test(body), 'markFailed 缺重发按钮');
  assert.ok(/className\s*=\s*'iv-retry'/.test(body), 'markFailed 未创建 .iv-retry');
});
t('失败路径（catch / ok:false）都走 markFailed', () => {
  assert.ok(/} else \{[\s\S]*?markFailed\(el/.test(ivJs), '服务端 ok:false 未走 markFailed');
  assert.ok(/\.catch\(function[\s\S]*?markFailed\(el/.test(ivJs), 'catch 未走 markFailed');
});
t('重发按钮可点击触发重发', () => {
  assert.ok(/iv-retry[\s\S]*?addEventListener\('click'[\s\S]*?sendNote\(\)/.test(ivJs),
    'iv-retry 没接 sendNote 重发');
});

console.log('— 加固：10 秒超时（避免永久卡在 pending） —');
t('sendNote 用 AbortController + 10s 超时', () => {
  assert.ok(/AbortController/.test(ivJs), '缺 AbortController');
  // 锁定 sendNote 函数体内
  const m = ivJs.match(/function sendNote[\s\S]*?\n  \}/);
  assert.ok(m, '找不到 sendNote');
  const body = m[0];
  assert.ok(/ctrl\.abort\(\)/.test(body), '缺 ctrl.abort()');
  assert.ok(/10000/.test(body), '缺 10s 超时');
  assert.ok(/signal:\s*ctrl\s*\?\s*ctrl\.signal/.test(body), 'fetch 未传 signal');
});
t('超时抛 AbortError 时给清晰提示', () => {
  assert.ok(/AbortError[\s\S]*?10 秒没回应/.test(ivJs),
    'AbortError 未给清晰文案');
});

console.log('— CSS 配套 —');
t('.iv-retry 按钮样式已定义', () => {
  assert.ok(/\.iv-retry\s*\{[^}]*cursor:\s*pointer/.test(css), '缺 .iv-retry 样式');
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);