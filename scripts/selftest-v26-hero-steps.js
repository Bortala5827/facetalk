// v2.6 self-test: 首页顶栏 brand-tag 删 + hero 改 4 步式 + 移动端响应式
// 用户反馈：「电脑版这里是不是没适配，顶部的双向互选 · 面试搭子 删掉，有些重复」
//          + DeepSeek 建议 hero 改 4 步式表达
// 验证：index.html / pair.html / style.css 三者一致

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const pairHtml = fs.readFileSync(path.join(ROOT, 'pair.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(ROOT, 'assets', 'style.css'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, hint) {
  if (cond) { pass++; console.log('✅', name); }
  else { fail++; console.log('❌', name + (hint ? ' — ' + hint : '')); }
}

// 1. 顶栏 brand-tag 双向互选·面试搭子 必须从 index.html 删
ok('index.html 顶栏「双向互选 · 面试搭子」brand-tag 已删',
  !/class=["']brand-tag["'][^>]*>双向互选 · 面试搭子</.test(indexHtml),
  'index.html 顶栏仍含「双向互选 · 面试搭子」brand-tag');
ok('index.html 顶栏「搭子房间 · 1:1」brand-tag 不出现（这是 pair.html 用的）',
  !/搭子房间 · 1:1/.test(indexHtml));

// 2. pair.html 顶部 brand-tag「搭子房间 · 1:1」必须保留
ok('pair.html「搭子房间 · 1:1」brand-tag 保留',
  /class=["']brand-tag["'][^>]*>搭子房间 · 1:1</.test(pairHtml));

// 3. hero 区 4 步式 ol.hero-steps + 4 个 li
ok('index.html hero 区有 <ol class="hero-steps">',
  /<ol\s+class=["']hero-steps["']>/.test(indexHtml));
ok('hero-steps 包含 4 个 <li>',
  (indexHtml.match(/<li>[\s\S]*?<\/li>/g) || []).length >= 4);
ok('hero-steps 第 1 步含「发个意图」',
  /<li>[\s\S]*?<b>发个意图<\/b>[\s\S]*?<\/li>/.test(indexHtml));
ok('hero-steps 第 2 步含「双方都同意」',
  /<li>[\s\S]*?<b>双方都同意<\/b>[\s\S]*?<\/li>/.test(indexHtml));
ok('hero-steps 第 3 步含「听声识搭子」',
  /<li>[\s\S]*?<b>听声识搭子<\/b>[\s\S]*?<\/li>/.test(indexHtml));
ok('hero-steps 第 4 步含「都通过」',
  /<li>[\s\S]*?<b>都通过<\/b>[\s\S]*?<\/li>/.test(indexHtml));

// 4. hero-foot 末尾保留「适用于」
ok('hero-foot 末段含「适用于」+ 「辅警 / 消防 / 书记员 / 社区 / 三支一扶」',
  /<p\s+class=["']hero-foot["']>[\s\S]*?适用于[\s\S]*?辅警\s*\/\s*消防\s*\/\s*书记员\s*\/\s*社区\s*\/\s*三支一扶[\s\S]*?<\/p>/.test(indexHtml));

// 5. lede 旧长段落必须从 index.html 删（避免视觉重复）
ok('index.html 不再含旧 lede 长段落（class=lede）',
  !/class=["']lede["']/.test(indexHtml),
  'index.html 还有 <p class="lede">');

// 6. style.css 必须含 .hero-steps 样式块
ok('style.css 含 .hero-steps 列表样式',
  /\.hero-steps\s*\{/.test(styleCss));
ok('style.css 含 .hero-steps li::before（编号圆点）',
  /\.hero-steps\s+li::before\s*\{/.test(styleCss));
ok('style.css 含 .hero-foot 样式',
  /\.hero-foot\s*\{/.test(styleCss));

// 7. 移动端 ≤520px 媒体查询：.hero-steps 字号缩小
ok('style.css @media ≤520px 内 .hero-steps 字号缩到 14.5 或更小',
  /@media\s*\([^)]*max-width:\s*520px[^)]*\)\s*\{[\s\S]*?\.hero-steps\s+li\s*\{[\s\S]*?font-size:\s*1[34]\.?\d*px/.test(styleCss));

// 8. style.css 里 .brand-tag 样式保留（pair.html 还要用）
ok('style.css .brand-tag 样式保留（pair.html 顶部搭子房间·1:1 仍需要）',
  /\.brand-tag\s*\{/.test(styleCss));

// 9. 版本号统一
ok('index.html style.css 版本号 20260806r',
  /\/assets\/style\.css\?v=20260806r/.test(indexHtml));
ok('pair.html style.css 版本号 20260806r（与 v2.5 一致）',
  /\/assets\/style\.css\?v=20260806r/.test(pairHtml));

console.log('');
console.log('━━━ v2.6 selftest ━━━');
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
