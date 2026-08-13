// scripts/selftest-v23-incognito-me.js
// 校验 v2.3 无痕/隐私模式丢身份修复
// 根因：ft_me 只存 localStorage，无痕/Safari隐私刷新清空 → 房间绑定失效 → 看不到房间信息
// 修复：URL ?me= → Cookie → localStorage 三层兜底 + 跳转 URL 编码 me
// 用法：node scripts/selftest-v23-incognito-me.js
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

const util = read('assets/ft-util.js');
const pair = read('pair.html');
const app = read('assets/app.js');
const index = read('index.html');

console.log('━━━ selftest v2.3-incognito-me ━━━');

// --- ft-util.js ---
console.log('\n[assets/ft-util.js]');
ok('暴露 window.FTMe', /window\.FTMe\s*=/.test(util));
ok('FTMe.get', /get:\s*function|get\(/.test(util));
ok('FTMe.set', /set:\s*function|set\(/.test(util));
ok('FTMe.del', /del:\s*function|del\(/.test(util));
ok('cookieGet 实现', /document\.cookie\.match/.test(util));
ok('cookieSet 写 max-age + path=/ + SameSite=Lax', /document\.cookie\s*=\s*name\s*\+\s*'=[\s\S]*max-age[\s\S]*path=\/[\s\S]*SameSite=Lax/.test(util));
ok('get 优先 localStorage 后 cookie', /localStorage\.getItem\(KEY\)[\s\S]*cookieGet\(KEY\)/.test(util));
ok('set 双写 localStorage + Cookie', /localStorage\.setItem\(KEY[\s\S]*cookieSet\(KEY/.test(util));
ok('30 天 max-age', /COOKIE_MAX_AGE\s*=\s*60\s*\*\s*60\s*\*\s*24\s*\*\s*30/.test(util));

// --- pair.html：引 + 读 me 三层兜底 ---
console.log('\n[pair.html]');
ok('引 ft-util.js', /<script src="\/assets\/ft-util\.js\?v=20260806p"><\/script>/.test(pair));
ok('me 读取：URL ?me= 优先', /var me = params\.get\('me'\)/.test(pair));
ok('me 读取：FTMe.get 兜底', /window\.FTMe\s*\?\s*window\.FTMe\.get\(\)/.test(pair));
ok('拿到 me 后写回 FTMe.set', /window\.FTMe\.set\(me\)/.test(pair));
ok('旧逻辑已删：不再直接用 localStorage.getItem(\'ft_me\') 读 me', !/var me = localStorage\.getItem\('ft_me'\)/.test(pair));
ok('仍保留无 me 跳首页守卫', /if \(!me\) \{ location\.href = '\/'; return; \}/.test(pair));

// --- app.js：ensureToken + 跳转编码 me ---
console.log('\n[assets/app.js]');
ok('ensureToken 用 URL ?me= 兜底', /urlMe\s*=\s*new URL\(location\.href\)\.searchParams\.get\('me'\)/.test(app));
ok('ensureToken 用 FTMe.get 兜底', /window\.FTMe\s*\?\s*window\.FTMe\.get\(\)/.test(app));
ok('ensureToken 生成后 FTMe.set 写入', /window\.FTMe\) window\.FTMe\.set\(me\); else localStorage/.test(app));
ok('BAD_TOKEN 清身份用 FTMe.del', /window\.FTMe\) window\.FTMe\.del\(\)/.test(app));
ok('enterRoom 跳转带 &me=', /\/pair\.html\?pair=' \+ encodeURIComponent\(r\.data\.pair\.pairId\) \+ '&me=' \+ encodeURIComponent\(me\)/.test(app));
ok('room-enter 跳转带 &me=', /\/pair\.html\?pair=' \+ encodeURIComponent\(p\.pairId\) \+ '&me=' \+ encodeURIComponent\(me\)/.test(app));

// --- index.html：引 ft-util + bump ---
console.log('\n[index.html]');
ok('引 ft-util.js', /<script src="\/assets\/ft-util\.js\?v=20260806p"><\/script>/.test(index));
ok('app.js bump 20260806p', /<script src="\/assets\/app\.js\?v=20260806p"><\/script>/.test(index));
ok('pair.html 引用 ft-util 版本号一致 20260806p', /ft-util\.js\?v=20260806p/.test(pair));

// --- 版本号一致性 ---
console.log('\n[版本号一致性]');
// o 是当前合法版本（style/settings/interview 仍用 o），p 是 ft-util 新版本；只需确认没有更旧的 l/n/m 残留
ok('pair.html 无更旧版本号 l/n/m 残留', !/20260806l|20260806n|20260806m/.test(pair));
ok('pair.html ft-util 用新版本 p', /ft-util\.js\?v=20260806p/.test(pair));
ok('index.html 无残留 20260806l', !/app\.js\?v=20260806l/.test(index));

console.log('\n━━━ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ━━━');
process.exit(fail ? 1 : 0);
