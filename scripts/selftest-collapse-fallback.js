// 面试题 2.1 收尾自测：试音卡折叠提示 + 实时语音失败 30s 跳转提醒
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const pairHtml = read('pair.html');
const ivJs = read('assets/interview.js');
const css = read('assets/style.css');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  →  ' + e.message); }
}

console.log('— 试音卡折叠标注「点击展开」 —');
t('pair.html 有 v-collapse-hint 元素', () => {
  assert.ok(/id="v-collapse-hint"/.test(pairHtml), '缺少 #v-collapse-hint');
});
t('v-collapse-hint 默认 hidden（仅折叠时显示）', () => {
  assert.ok(/id="v-collapse-hint"[^>]*\shidden/.test(pairHtml), 'hint 未默认 hidden');
});
t('hint 文案为「点击展开 ▾」', () => {
  assert.ok(/v-collapse-hint[^>]*>点击展开/.test(pairHtml), '文案不是「点击展开」');
});
t('setVoiceCollapsed 折叠时显示 hint', () => {
  assert.ok(/hint\.hidden = !collapsed/.test(pairHtml), 'setVoiceCollapsed 未管 hint');
});
t('CSS .v-collapse-hint 已定义（蓝底胶囊）', () => {
  assert.ok(/\.v-collapse-hint\s*\{[^}]*color:\s*#1e88e5/.test(css), '缺 .v-collapse-hint 样式');
});

console.log('— 实时语音失败 30s 跳转备选会议号卡 —');
t('interview.js 有 fbEscalateAfter30s 函数', () => {
  assert.ok(/function fbEscalateAfter30s\(/.test(ivJs), '缺 fbEscalateAfter30s');
});
t('startCall 30s 计时器调用 fbEscalateAfter30s', () => {
  assert.ok(/setTimeout\(function \(\)[\s\S]*?fbEscalateAfter30s\(\)[\s\S]*?\}, 30000\)/.test(ivJs),
    'startCall 30s 未接 fbEscalateAfter30s');
});
t('failCall 也触发 fbEscalateAfter30s', () => {
  assert.ok(/function failCall\([\s\S]*?fbEscalateAfter30s\(\)/.test(ivJs), 'failCall 未接 fbEscalateAfter30s');
});
t('fbEscalateAfter30s 自动展开 + 滚动 + 提醒', () => {
  assert.ok(/fbAutoExpand\(\)[\s\S]*?scrollIntoView[\s\S]*?showFbReminder\(\)/.test(ivJs),
    '三者未齐：fbAutoExpand / scrollIntoView / showFbReminder');
});
t('showFbReminder 显示 iv-fb-reminder 并加 flash 高亮', () => {
  assert.ok(/function showFbReminder\(\)[\s\S]*?iv-fb-reminder[\s\S]*?iv-fb-flash/.test(ivJs),
    'showFbReminder 未显示提醒条或高亮');
});
t('clearFbEscalation 在连通与结束时被调用', () => {
  assert.ok(/clearFbEscalation\(\)/.test(ivJs), '缺 clearFbEscalation 调用');
  const n = (ivJs.match(/clearFbEscalation\(\)/g) || []).length;
  assert.ok(n >= 2, 'clearFbEscalation 调用次数应≥2（连通 + 停止），实际 ' + n);
});
t('pair.html 有 iv-fb-reminder 提醒条（默认 hidden）', () => {
  assert.ok(/id="iv-fb-reminder"[^>]*\shidden/.test(pairHtml), '缺 #iv-fb-reminder 或默认未 hidden');
});
t('CSS .iv-fb-reminder 已定义', () => {
  assert.ok(/\.iv-fb-reminder\s*\{[^}]*#fff7ed/.test(css), '缺 .iv-fb-reminder 样式');
});
t('CSS .iv-fb-flash 高亮动画已定义', () => {
  assert.ok(/\.iv-fb-flash\s*\{[^}]*animation:\s*ivFbFlash/.test(css), '缺 .iv-fb-flash 动画');
  assert.ok(/@keyframes ivFbFlash/.test(css), '缺 @keyframes ivFbFlash');
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
