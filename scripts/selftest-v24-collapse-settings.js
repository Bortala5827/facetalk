// FaceTalk v2.4 自测：面试间折叠 + 强化设置入口 + 联机/留言板引导留会议号
// 12 项必过：折叠结构 / 默认收起 / 标题栏可点 / 设 badge / 联机引导 / 留言引导 / 版本号统一
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const pairHtml = fs.readFileSync(path.join(ROOT, 'pair.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(ROOT, 'assets/style.css'), 'utf8');
const settingsJs = fs.readFileSync(path.join(ROOT, 'assets/settings.js'), 'utf8');
const wallJs = fs.readFileSync(path.join(ROOT, 'assets/wall.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, hint) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('❌', name, hint ? '— ' + hint : ''); }
}

console.log('━━ v2.4 面试间折叠 + 设置入口强化 + 联机/留言板引导 ━━');

// 1. iv-card 改成 .iv-collapsed 默认结构
ok('iv-card 默认带 .iv-collapsed class',
  pairHtml.includes('<section class="card iv-collapsed" id="iv-card"'),
  'pair.html <section id="iv-card"> 没加 .iv-collapsed 默认类');

// 2. 标题栏改成 <button class="iv-collapse-toggle" id="iv-collapse-toggle">
ok('iv-collapse-toggle 按钮存在',
  /<button[^>]*id=["']iv-collapse-toggle["'][^>]*aria-expanded=["']false["']/.test(pairHtml),
  'iv-collapse-toggle 按钮缺失或 aria-expanded 初值不对');
ok('iv-collapse-toggle 内部有 <h2 class="sec-title">🎤 面试间 2.1</h2>',
  /iv-collapse-toggle[\s\S]{0,300}<h2 class=["']sec-title["']>[\s\S]*?🎤\s*面试间/.test(pairHtml));
ok('折叠副标题提示「🚧 功能测试中」',
  pairHtml.includes('🚧 功能测试中'));
ok('折叠展开提示存在',
  /点击展开\s*▸|点击折叠\s*▾/.test(pairHtml));

// 3. body 默认 hidden
ok('iv-collapse-body 默认 hidden',
  /id=["']iv-collapse-body["'][^>]*\bhidden\b/.test(pairHtml) ||
  /id=["']iv-collapse-body["']\s+hidden/.test(pairHtml));

// 4. iv-collapse-toggle 点击 JS 存在
ok('折叠 JS 存在：aria-expanded 切换 + localStorage 记忆',
  pairHtml.includes('setAttribute(\'aria-expanded\''));
ok('localStorage 记忆 key rcj_ft_iv_collapsed_v1',
  /rcj_ft_iv_collapsed_v1/.test(pairHtml));
ok('点击 toggle 反转 body.hidden',
  /set\(body\.hidden\)/.test(pairHtml));

// 5. 顶栏「接口设置」齿轮已按需求移除（避免与面试间内 AI 设置入口重复，#8）
ok('顶栏 #open-settings 齿轮已移除',
  !/id=["']open-settings["']/.test(pairHtml));
ok('顶栏 bar-gear-text「接口」已移除',
  !/class=["']bar-gear-text["']/.test(pairHtml));
ok('顶栏 #bar-gear-badge 角标已移除',
  !/id=["']bar-gear-badge["']/.test(pairHtml));
ok('顶栏保留 面试间内 AI 设置入口（iv-open-settings）',
  /id=["']iv-open-settings["']/.test(pairHtml));

// 6. FTSettings.unconfigured() 暴露
ok('settings.js 暴露 FTSettings.unconfigured',
  /window\.FTSettings\s*=\s*\{[\s\S]*?unconfigured\s*:\s*unconfigured/.test(settingsJs));
ok('unconfigured() 实现：hasLLM/webspeech/cloud 都 OK',
  /function\s+unconfigured\(\)[\s\S]*?hasLLM\(\)[\s\S]*?return\s+false[\s\S]*?return\s+true/.test(settingsJs));

// 7. 联机信息卡新增「备选会议号」标签 + 强化提示
ok('联机信息标题加「/ 📡 备选会议号」标注',
  /联机信息\s*\/\s*📡\s*备选会议号/.test(pairHtml));
ok('联机信息描述含「实时语音暂时不稳定」',
  pairHtml.includes('实时语音暂时不稳定') && pairHtml.includes('腾讯会议号'));
ok('联机信息 placeholder 强化「腾讯会议 123-456-789 或飞书会议链接」',
  /id=["']info-mine["'][^>]*placeholder=["'][^"']*腾讯会议\s*123-456-789/.test(pairHtml));

// 8. 留言板引导条 + placeholder
ok('留言板 .msg-tip-meeting 引导条存在',
  /class=["']msg-tip-meeting["']/.test(pairHtml) &&
  /在这里直接贴上你的腾讯会议号/.test(pairHtml));
ok('留言板 input placeholder 提到会议号',
  /id=["']msg-text["'][^>]*placeholder=["'][^"']*腾讯会议号直接约时间/.test(pairHtml));

// 9. CSS 折叠/角标/引导条样式
ok('CSS .iv-collapse-toggle 样式',
  /\.iv-collapse-toggle\s*\{/.test(styleCss) &&
  /display\s*:\s*flex/.test(styleCss.match(/\.iv-collapse-toggle\s*\{[^}]*\}/)?.[0] || ''));
ok('CSS .iv-collapse-sub 红底标签',
  /\.iv-collapse-sub\s*\{[^}]*background\s*:\s*#fff1f2/.test(styleCss));
ok('CSS .bar-gear-badge 红点 pulse',
  /@keyframes\s+pulseBadge/.test(styleCss) &&
  /\.bar-gear-badge\s*\{[^}]*animation\s*:\s*pulseBadge/.test(styleCss));
ok('CSS 移动端 ≤520px 隐藏 bar-gear-text',
  /@media\s*\(max-width\s*:\s*520px\)[\s\S]*?\.bar-gear-text\s*\{\s*display\s*:\s*none/.test(styleCss));
ok('CSS .msg-tip-meeting 引导条样式',
  /\.msg-tip-meeting\s*\{/.test(styleCss) &&
  /background\s*:\s*linear-gradient/.test(styleCss.match(/\.msg-tip-meeting\s*\{[^}]*\}/)?.[0] || ''));

// 10. 版本号统一：ft-util.js 固定保持 v=20260806p；其余资源同源统一（随部署一起 bump）
const vAssets = {
  'style.css': (pairHtml.match(/style\.css\?v=([^"']+)/) || [])[1],
  'settings.js': (pairHtml.match(/settings\.js\?v=([^"']+)/) || [])[1],
  'interview.js': (pairHtml.match(/interview\.js\?v=([^"']+)/) || [])[1],
};
const vFtUtil = (pairHtml.match(/ft-util\.js\?v=([^"']+)/) || [])[1];
const vSame = vAssets['style.css'] && vAssets['style.css'] === vAssets['settings.js'] && vAssets['style.css'] === vAssets['interview.js'];
ok('ft-util.js 固定 v=20260806p', vFtUtil === '20260806p', `ft-util.js=${vFtUtil}`);
ok('style / settings / interview 同源统一版本', vSame, `style=${vAssets['style.css']} settings=${vAssets['settings.js']} interview=${vAssets['interview.js']}`);
ok('统一版本格式合法（20YYMMDD+小写后缀）', /20\d{6}[a-z]/.test(vAssets['style.css'] || ''), `v=${vAssets['style.css']}`);
ok('不允许残留旧中间版本（o/q/h/r 等）', !/20260806[ohqr]/.test(pairHtml), 'pair.html 残留旧版本号');

// 11. 留言板本身没被破（wall.js 接口保留）
ok('wall.js #wall 加载函数保留', /loadWall\b/.test(wallJs));
ok('wall.js #wallPost 发帖保留', /postWall\b/.test(wallJs));

// 12. iv-card 在 pair.html 内部结构正确（不影响 voice-card / msg-card）
// 简单 grep：折叠 banner 应在 iv-card 内（被 toggle 包了一层）
ok('iv-card 上下结构仍在 pair.html',
  /id=["']voice-card["']/.test(pairHtml) &&
  /id=["']iv-card["']/.test(pairHtml) &&
  /id=["']msg-card["']/.test(pairHtml));

console.log(`\n━━ ${pass}/${pass + fail} 通过 ━━`);
process.exit(fail === 0 ? 0 : 1);
