// FaceTalk v2.5 自测：面试间整体灰度（功能未开放不误导）+ 面试间内 AI 设置入口 + 版本号 r
// 校验点：灰度只作用于标题行/展开体、AI 设置入口常驻彩色可点、JS 接线、field-hint 文案、版本号统一
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const pairHtml = fs.readFileSync(path.join(ROOT, 'pair.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(ROOT, 'assets/style.css'), 'utf8');
const settingsJs = fs.readFileSync(path.join(ROOT, 'assets/settings.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, hint) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('❌', name, hint ? '— ' + hint : ''); }
}

console.log('━━ v2.5 面试间整体灰度 + AI 设置入口 ━━');

// 1. 面试间内 AI 设置入口（常驻可见，折叠/展开态都在，不是嵌套在 toggle 按钮里）
ok('AI 设置入口按钮 #iv-open-settings 存在',
  /id=["']iv-open-settings["']/.test(pairHtml),
  'pair.html 缺 #iv-open-settings 按钮');
ok('AI 设置入口文案含「打开 AI 设置（自备 Key）」',
  /打开\s*AI\s*设置（自备\s*Key）/.test(pairHtml),
  'iv-open-settings 文案不对');
ok('AI 设置入口在折叠标题按钮之后、展开体之前（常驻可见）',
  /iv-collapse-toggle[\s\S]*?id=["']iv-open-settings["'][\s\S]*?iv-collapse-body/.test(pairHtml),
  'iv-open-settings 没放在 toggle 与 body 之间');
ok('iv-open-settings 不嵌套在 toggle <button> 内（合法 HTML）',
  /<\/button>\s*<div class=["']iv-set-row["'][\s\S]*?id=["']iv-open-settings["']/.test(pairHtml),
  'iv-open-settings 没以 iv-set-row 兄弟节点形式出现在 toggle 之后');

// 2. 整体灰度：.iv-testing 下标题行 + 展开体变灰，AI 入口不被灰
ok('CSS：.iv-testing .iv-collapse-toggle 灰度',
  /\.iv-testing\s+\.iv-collapse-toggle\s*[,{][\s\S]{0,80}filter:\s*grayscale\(1\)/.test(styleCss),
  'style.css 没有给 .iv-testing .iv-collapse-toggle 加 grayscale');
ok('CSS：.iv-testing .iv-collapse-body 灰度',
  /\.iv-testing\s+\.iv-collapse-body\s*[,{][\s\S]{0,80}filter:\s*grayscale\(1\)/.test(styleCss),
  'style.css 没有给 .iv-testing .iv-collapse-body 加 grayscale');
ok('CSS：灰度带 opacity 降低（视觉上「禁用」）',
  /\.iv-testing\s+\.iv-collapse-(toggle|body)\s*[,{][\s\S]{0,90}opacity:\s*\.?\d+/.test(styleCss),
  '灰度缺少 opacity 降低');
ok('CSS：.iv-set-entry 有彩色渐变背景（入口保持可点醒目）',
  /\.iv-set-entry\s*\{[\s\S]{0,200}background:\s*linear-gradient/.test(styleCss),
  'style.css 缺 .iv-set-entry 彩色样式');
ok('CSS：.iv-set-entry 不被灰度（无 grayscale 作用于它）',
  !/\.iv-testing\s+\.iv-set-entry/.test(styleCss),
  'AI 设置入口被灰度了，应保持彩色');

// 3. JS 接线：#iv-open-settings 点击 → FTSettings.open()
ok('JS：iv-open-settings 监听并调用 FTSettings.open',
  /iv-open-settings[\s\S]{0,160}FTSettings\.open\(\)/.test(pairHtml),
  'pair.html 没给 iv-open-settings 接线 FTSettings.open');

// 4. field-hint 文案更新（不再指右上角 ⚙）
ok('正文提示改为「点本栏「🎙 打开 AI 设置（自备 Key）」」',
  /点本栏「🎙 打开 AI 设置（自备 Key）」/.test(pairHtml),
  'field-hint 仍写「右上角 ⚙」未更新');
ok('不再出现「点右上角 ⚙ 设置」误导文案',
  !/点右上角\s*⚙\s*设置/.test(pairHtml),
  '仍残留「点右上角 ⚙ 设置」');

// 5. 版本号统一（style / settings / interview 同源；随部署一起 bump，不再写死 r）
const v25v = {
  style: (pairHtml.match(/style\.css\?v=([^"']+)/) || [])[1],
  settings: (pairHtml.match(/settings\.js\?v=([^"']+)/) || [])[1],
  interview: (pairHtml.match(/interview\.js\?v=([^"']+)/) || [])[1],
};
const v25same = v25v.style && v25v.style === v25v.settings && v25v.style === v25v.interview;
ok('style / settings / interview 同源统一版本', v25same, `style=${v25v.style} settings=${v25v.settings} interview=${v25v.interview}`);
ok('统一版本格式合法（20YYMMDD+小写后缀）', /20\d{6}[a-z]/.test(v25v.style || ''), `v=${v25v.style}`);
ok('不允许残留中间版本 20260806q/o', !/20260806[ohqr]/.test(pairHtml), 'pair.html 残留旧版本号');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
