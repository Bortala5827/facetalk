// selftest-unify-timer.js — 验证 v2.3「搭子房间与面试间共用 30 分钟」改造
//   1. pair.html 删了 iv-dur-field 单场时长下拉（含 30/45/60 三个 option）
//   2. pair.html 删了 iv-setup 与 iv-start 元素
//   3. pair.html 的 window.FT 暴露 setRemain / get remain / resetRemainZero
//   4. pair.html 的 tick() 在归零时 fireRemainZero()，每 tick 调 fireRemain(n)
//   5. interview.js 删了 durSel/iv-dur/tickTimer/renderTick/iv-setup 引用
//   6. interview.js 用 startSharedTimer 订阅搭子房间倒计时
//   7. interview.js 的 onRemainZero 跑 AI 评价（stopStt + runEval）

const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/小样儿/Desktop/产品交付/mianshi-dazi';

let pass = 0, fail = 0;
function check(name, cond, hint) {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name + (hint ? ' — ' + hint : '')); }
}
function section(title) { console.log('\n# ' + title); }

const pairHtml = fs.readFileSync(path.join(ROOT, 'pair.html'), 'utf8');
const interviewJs = fs.readFileSync(path.join(ROOT, 'assets/interview.js'), 'utf8');

// 1. pair.html 删单场时长下拉
section('1) pair.html 删除单场时长下拉');
check('不含 iv-dur-field 整块', !pairHtml.includes('iv-dur-field'),
  '还残留 .iv-dur-field 容器');
check('不含 <option value="30"> 30 分钟', !/option value="30"[^<]*30 分钟/.test(pairHtml),
  '下拉里还有 30 分钟选项');
check('不含 <option value="45" selected>', !pairHtml.includes('option value="45" selected'),
  '下拉里还有 45 分钟选项');
check('不含 <option value="60"> 60 分钟', !pairHtml.includes('option value="60">'),
  '下拉里还有 60 分钟选项');
check('不含 id="iv-dur" 元素', !pairHtml.includes('id="iv-dur"'),
  'iv-dur select 还在');

// 2. pair.html 删 iv-setup + iv-start
section('2) pair.html 删除 iv-setup / iv-start 元素');
check('不含 id="iv-setup"', !pairHtml.includes('id="iv-setup"'),
  'iv-setup 容器还在');
check('不含 id="iv-start"', !pairHtml.includes('id="iv-start"'),
  'iv-start 按钮还在');
check('不含 ▶ 开始面试 文案', !pairHtml.includes('▶ 开始面试'),
  '"开始面试" 文案还在');

// 3. pair.html 的 window.FT 暴露新接口
section('3) pair.html 的 window.FT 暴露 setRemain / remain / resetRemainZero');
check('含 get remain()', /get remain\(\)\s*\{\s*return remain;/.test(pairHtml),
  'FT.remain 读搭子房间剩余秒未接好');
check('含 setRemain: function', /setRemain:\s*function/.test(pairHtml),
  'FT.setRemain 未暴露');
check('含 resetRemainZero: function', /resetRemainZero:\s*function/.test(pairHtml),
  'FT.resetRemainZero 未暴露');

// 4. pair.html 的 tick() 调 fireRemain / fireRemainZero
section('4) pair.html tick() 触发订阅');
check('tick() 调 fireRemain(n)', /function tick\(\)[\s\S]{0,800}fireRemain\(/.test(pairHtml),
  'tick 里没调 fireRemain');
check('tick() 归零分支调 fireRemainZero()', /function tick\(\)[\s\S]{0,800}fireRemainZero\(\)/.test(pairHtml),
  'tick 归零时没触发 onZero');
check('render(p) 在 next>0 && remain===0 时重置 remainZeroFired',
  /if \(next > 0 && remain === 0\) remainZeroFired = false/.test(pairHtml),
  '重新激活时未解锁 onZero');

// 5. interview.js 删旧引用
section('5) interview.js 删除旧引用');
check('不含 durSel', !interviewJs.includes('durSel'),
  'durSel 还在');
check('不含 var tickTimer', !interviewJs.includes('var tickTimer'),
  'tickTimer 还在');
check('不含 function renderTick', !interviewJs.includes('function renderTick'),
  'renderTick 还在');
check('不含 $("iv-setup")', !interviewJs.includes('$("iv-setup")') && !interviewJs.includes("$('iv-setup')"),
  'iv-setup 引用还在');
check('不含 $("iv-start")', !interviewJs.includes('$("iv-start")') && !interviewJs.includes("$('iv-start')"),
  'iv-start 引用还在');

// 6. interview.js 用 setRemain 订阅
section('6) interview.js 订阅搭子房间倒计时');
check('含 function startSharedTimer', /function startSharedTimer/.test(interviewJs),
  'startSharedTimer 未定义');
check('startSharedTimer 调 window.FT.setRemain',
  /startSharedTimer[\s\S]{0,300}window\.FT\.setRemain/.test(interviewJs),
  'startSharedTimer 没调 FT.setRemain');
check('remainListener.onZero = onRemainZero',
  /remainListener\.onZero\s*=\s*function \(\)\s*\{\s*onRemainZero\(\)/.test(interviewJs),
  'onZero 钩子未接');
check('onRemainZero 调 stopStt', /function onRemainZero[\s\S]{0,200}stopStt\(\)/.test(interviewJs),
  '归零时未停录音');
check('onRemainZero 调 runEval', /function onRemainZero[\s\S]{0,300}runEval\(\)/.test(interviewJs),
  '归零时未跑 AI 评价');

// 7. onUnlock 立即激活
section('7) onUnlock 立即激活 + 启动轮询 + 订阅计时');
check('onUnlock 调 startSharedTimer',
  /onUnlock:\s*function[\s\S]{0,500}startSharedTimer\(\)/.test(interviewJs),
  'onUnlock 没订阅计时');
check('onUnlock 调 startPolling',
  /onUnlock:\s*function[\s\S]{0,500}startPolling\(\)/.test(interviewJs),
  'onUnlock 没启动转录轮询');
check('onUnlock 设 active = true',
  /onUnlock:\s*function[\s\S]{0,500}active\s*=\s*true/.test(interviewJs),
  'onUnlock 没标 active');

// 8. teardown 解绑
section('8) teardown 解绑计时订阅');
check('teardown 调 unsubRemain()',
  /teardown:\s*function[\s\S]{0,400}unsubRemain\(\)/.test(interviewJs),
  'teardown 未解绑计时订阅');

// 9. 倒计时文案调整
section('9) 用户可见文案');
check('pair.html 倒计时说明改为「跟随搭子房间总时长（30 分钟）」',
  pairHtml.includes('跟随搭子房间总时长'),
  '没改成「跟随搭子房间总时长」');
check('pair.html 倒计时说明含「时间到自动 AI 评价」',
  pairHtml.includes('时间到自动 AI 评价'),
  '没提示时间到自动 AI 评价');

// 10. 版本号 bump
section('10) 版本号 bump');
check('interview.js?v=20260806n 已生效',
  pairHtml.includes('interview.js?v=20260806n'),
  'pair.html 没 bump interview.js 版本号');

console.log('\n=== ' + pass + ' / ' + (pass + fail) + ' 通过 ===');
process.exit(fail > 0 ? 1 : 0);
