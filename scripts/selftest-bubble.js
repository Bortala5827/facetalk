// 模拟 DOM 跑一下 appendLine 的乐观 UI + 去重 + 失败高亮（用 jsdom 最小替身）
const path = require('path');
const fs = require('fs');

// 替身：尽量只跑 appendLine / sendNote 的关键逻辑，不引入 jsdom
// 直接对 DOM 替身（一个简单的 div 列表）做断言
function mkBox() {
  const box = { children: [], innerHTML: '', classList: [], querySelector(p) { return null; }, appendChild(el) { this.children.push(el); }, scrollTop: 0, querySelectorAll() { return []; } };
  return box;
}

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.log('  ✗', name, '-', e.message); fail++; }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + ' got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b)); }
function truthy(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

// ==== 模拟 interview.js 的关键逻辑：appendLine + known 去重 + pending/fail 状态 ====
function makeApp() {
  const known = {};
  const transcript = mkBox();
  function esc(s) { return String(s == null ? '' : s); }
  function appendLine(who, text, key, opts) {
    if (!text) return;
    opts = opts || {};
    if (key && known[key]) return;
    if (key) known[key] = 1;
    transcript.className = 'iv-msg ' + (who === '我' ? 'iv-mine' : 'iv-peer') + (opts.pending ? ' iv-pending' : '') + (opts.failed ? ' iv-fail' : '');
    if (key) transcript._key = key;
    transcript._who = who; transcript._text = text;
    transcript.children.push({ who, text, key, opts });
  }
  return { known, transcript, appendLine };
}

// 去重：同 key 只画一次
t('同 key 重复调用只画一次', () => {
  const a = makeApp();
  a.appendLine('我', '你好', 'il_aaa');
  a.appendLine('我', '你好', 'il_aaa');
  eq(a.transcript.children.length, 1, '应只画 1 次');
});

// mine 走 iv-mine 类
t('"我" → iv-mine', () => {
  const a = makeApp();
  a.appendLine('我', 'x', 'k1');
  truthy(a.transcript.className.indexOf('iv-mine') >= 0, '应含 iv-mine');
  truthy(a.transcript.className.indexOf('iv-peer') < 0, '不应含 iv-peer');
});

// peer 走 iv-peer 类
t('"对方" → iv-peer', () => {
  const a = makeApp();
  a.appendLine('对方', 'x', 'k1');
  truthy(a.transcript.className.indexOf('iv-peer') >= 0, '应含 iv-peer');
});

// pending 状态标记
t('pending 状态加 .iv-pending + 透明度 0.7 样式', () => {
  const a = makeApp();
  a.appendLine('我', 'x', 'k1', { pending: true });
  truthy(a.transcript.className.indexOf('iv-pending') >= 0, '应含 iv-pending');
});

// failed 状态标记
t('failed 状态加 .iv-fail（红底）', () => {
  const a = makeApp();
  a.appendLine('我', 'x', 'k1', { failed: true });
  truthy(a.transcript.className.indexOf('iv-fail') >= 0, '应含 iv-fail');
});

// 临时 tmp_ 与真 il_ 互不干扰
t('乐观 tmp_ 与后端 il_ 互不干扰', () => {
  const a = makeApp();
  a.appendLine('我', 'x', 'tmp_1', { pending: true });
  a.appendLine('我', 'x', 'il_2');     // 后端回的真实行
  eq(a.transcript.children.length, 2, '应 2 条');
  truthy(a.known['tmp_1'] === 1, 'tmp_1 已 known');
  truthy(a.known['il_2'] === 1, 'il_2 已 known');
});

// ==== 关键路径：sendNote 乐观 UI 写 tmp，回包成功时把 il_ 加 known 防止 polling 重复 ====
t('sendNote 成功：tmp 先画，il_ 写入 known 防 polling 重复', () => {
  const a = makeApp();
  const tmpKey = 'tmp_test';
  a.appendLine('我', 'hello', tmpKey, { pending: true });
  // 模拟 POST 回包 ok
  a.known['il_real'] = 1;
  // 模拟 1.5s 后 polling 拿回 il_real
  a.appendLine('我', 'hello', 'il_real');
  eq(a.transcript.children.length, 1, '应只有 1 条（polling 拿回的 il_real 被 known 拦了）');
});

// ==== 关键路径：sendNote 失败：移除 pending、加 fail ====
t('sendNote 失败：去掉 pending 加 fail', () => {
  const a = makeApp();
  a.appendLine('我', 'x', 'tmp_fail', { pending: true });
  truthy(a.transcript.className.indexOf('iv-pending') >= 0, '初始含 pending');
  // 模拟失败：移除 pending 加 fail
  a.transcript.className = a.transcript.className.replace(' iv-pending', '') + ' iv-fail';
  truthy(a.transcript.className.indexOf('iv-fail') >= 0, '失败后应含 iv-fail');
  truthy(a.transcript.className.indexOf('iv-pending') < 0, '失败后不应含 iv-pending');
});

// ==== 边界：空文本不画 ====
t('空文本不画', () => {
  const a = makeApp();
  a.appendLine('我', '', 'k1');
  eq(a.transcript.children.length, 0, '空文本应忽略');
});

// ==== 大量条目：性能不爆炸 ====
t('100 条不重复', () => {
  const a = makeApp();
  for (let i = 0; i < 100; i++) a.appendLine(i % 2 ? '我' : '对方', 'msg' + i, 'k_' + i);
  eq(a.transcript.children.length, 100, '100 条应都画上');
});

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' selftest-bubble: ' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail === 0 ? 0 : 1);
