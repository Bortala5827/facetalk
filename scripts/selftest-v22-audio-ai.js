// scripts/selftest-v22-audio-ai.js
// 校验 v2.2 改造：settings.js 重写 + 面试间灰化 + 闻声识搭子
// 用法：node scripts/selftest-v22-audio-ai.js
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
let pass = 0, fail = 0;
const settings = read('assets/settings.js');
const style = read('assets/style.css');
const pair = read('pair.html');

console.log('━━━ selftest v2.2-audio-ai ━━━');

// --- settings.js: UI 标题 + schema + 兼容 ---
console.log('\n[settings.js]');
ok('标题「🎙 语音 & AI 点评设置（自备 Key）」', /🎙 语音 & AI 点评设置（自备 Key）/.test(settings));
ok('STORAGE_KEY 切到 rcj_ft_asr_v1', /STORAGE_KEY\s*=\s*['"]rcj_ft_asr_v1['"]/.test(settings));
ok('OLD_KEY_V21 兼容老 schema ft_settings_v21', /OLD_KEY_V21\s*=\s*['"]ft_settings_v21['"]/.test(settings));
ok('asrEngine 字段（webspeech/cloud）', /asrEngine:\s*['"]webspeech['"]/.test(settings) && /asrEngine.*['"]cloud['"]/.test(settings));
ok('AI 点评 启用勾选', /启用 AI 点评/.test(settings));
ok('测试连接按钮', /测试连接/.test(settings));
ok('云端引擎面板（whisper baseUrl）', /set-asrBase|Whisper 兼容/.test(settings));
ok('国内大模型 API 教程链接', /国内大模型免费 API 获取教程/.test(settings));
ok('暴露 window.FTSettings', /window\.FTSettings\s*=/.test(settings));
ok('暴露 open/close', /open:\s*function|open\(/.test(settings) && /close:\s*function|close\(/.test(settings));
ok('暴露 get/hasLLM/hasSTT', /get:\s*function|get\(\)/.test(settings) && /hasLLM/.test(settings) && /hasSTT/.test(settings));
ok('暴露 sttOn/sttMode/browserSttSupported', /sttOn/.test(settings) && /sttMode/.test(settings) && /browserSttSupported/.test(settings));
ok('PRESETS 硅基流动', /硅基流动/.test(settings) && /api\.siliconflow\.cn/.test(settings));
ok('PRESETS DeepSeek', /DeepSeek/.test(settings) && /api\.deepseek\.com/.test(settings));
ok('老 schema 升级保留 llm 三件套', /old\.llmBase \|\| old\.llmKey \|\| old\.llmModel/.test(settings));
ok('老 schema 升级保留 sttMode', /old\.sttMode === ['"]browser['"]/.test(settings));
ok('清除全部按钮', /清除全部/.test(settings));

// --- pair.html: 灰化 banner + 闻声识搭子 + 标题 ---
console.log('\n[pair.html]');
ok('面试间加 🚧 功能测试中 banner', /🚧 功能测试中/.test(pair));
ok('banner 建议用腾讯会议对练', /腾讯会议对练|腾讯会议/.test(pair));
ok('30 秒试音卡存在', /30\s*秒试音|30s\s*试音|试音互评/.test(pair));
ok('闻声识搭子预告', /闻声识搭子/.test(pair));
ok('闻声识搭子含「声纹节奏特征」', /声纹节奏特征/.test(pair));
ok('设置按钮 title 改「🎙 语音 & AI 点评设置（自备 Key）」', /🎙 语音 & AI 点评设置（自备 Key）/.test(pair));
ok('iv-card 加 .iv-testing 切换', /ivc\.classList\.toggle\(['"]iv-testing['"]/.test(pair));
ok('注释 v2.2 「功能测试中」灰化', /v2\.2.*功能测试中|功能测试中.*v2\.2/.test(pair));
ok('注释 v2.2 「闻声识搭子」预告', /v2\.2.*闻声识搭子|闻声识搭子.*v2\.2/.test(pair));
ok('style.css 版本号 20260806r', /style\.css\?v=20260806r/.test(pair));
ok('settings.js 版本号 20260806r', /settings\.js\?v=20260806r/.test(pair));
ok('interview.js 版本号 20260806r', /interview\.js\?v=20260806r/.test(pair));
ok('style.css 不再带 20260806l 旧版', !/style\.css\?v=20260806l/.test(pair));
ok('settings.js 不再带 20260806h 旧版', !/settings\.js\?v=20260806h/.test(pair));
ok('interview.js 不再带 20260806n 旧版', !/interview\.js\?v=20260806n/.test(pair));

// --- style.css: 灰化样式 + 闻声识搭子样式 ---
console.log('\n[style.css]');
ok('.iv-testing-banner 样式', /\.iv-testing-banner\s*\{/.test(style));
ok('.iv-testing-banner 红色背景（fef2f2）', /\.iv-testing-banner\s*\{[^}]*background:\s*#fef2f2/.test(style));
ok('.iv-testing-mark 渐变红橙（红角标）', /\.iv-testing-mark[^}]*linear-gradient/.test(style));
ok('.iv-testing 灰化 .iv-top 按钮（opacity .55）', /\.iv-testing\s+\.iv-top\s+button[^}]*opacity:\s*\.55/.test(style));
ok('.iv-testing-hint 灰背景提示框', /\.iv-testing-hint\s*\{/.test(style));
ok('设置弹窗 set-mask 仍然存在（沿用）', /\.set-mask\s*\{/.test(style));
ok('设置弹窗 set-engine-row 选项', /\.set-engine-row/.test(style));
ok('设置弹窗 set-section-title 段落标题', /\.set-section-title/.test(style));

console.log('\n━━━ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ━━━');
process.exit(fail ? 1 : 0);
