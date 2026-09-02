const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const base = 'C:/Users/小样儿/Desktop/products/_repos/facetalk/';
// ftwave.js 已随波形功能删除（v2.10 purge），勿再加回列表
const files = ['assets/i18n.js', 'assets/app.js', 'assets/wall.js', 'assets/ft-util.js', 'assets/settings.js', 'assets/glare.js', 'sw.js'];
let allOk = true;
files.forEach(f => {
  const p = base + f;
  if (!fs.existsSync(p)) { console.log(f + ': MISSING'); return; }
  try {
    execFileSync('node', ['--check', p], { stdio: 'pipe' });
    console.log(f + ': OK');
  } catch (e) {
    allOk = false;
    console.log(f + ': FAIL\n' + String(e.stderr || e.message).split('\n').slice(0, 8).join('\n'));
  }
});

// residual reference scan in runtime files
const runtime = ['index.html', 'pair.html', 'assets/app.js', 'assets/wall.js', 'assets/ft-util.js', 'assets/settings.js', 'sw.js'];
const needles = ['vwarm', 'warmup', 'structPractice', 'settingsMenu', 'interview.js', 'FTInterview', 'iv-open-settings', 'iv-card', 'bar-gear', 'FTSettings.get', 'FTSettings.hasLLM', 'FTSettings.unconfigured', '/api/interview'];
console.log('\n--- residual scan ---');
let residual = 0;
runtime.forEach(f => {
  const s = fs.readFileSync(base + f, 'utf8');
  needles.forEach(n => {
    const c = s.split(n).length - 1;
    if (c > 0) { console.log(f + ' contains ' + n + ' x' + c); residual++; }
  });
});
console.log(residual === 0 ? 'no residuals' : residual + ' residual hits');
process.exit(allOk && residual === 0 ? 0 : 1);
