#!/usr/bin/env node
/**
 * FaceTalk 版本号统一管理工具
 *
 * 用法：
 *   node bump-version.js              # 自动生成下一个版本号（日期+递增字母）
 *   node bump-version.js 20260808i    # 指定版本号
 *   node bump-version.js --check     # 仅检查一致性，不改文件
 *   node bump-version.js --list      # 列出当前所有版本号
 *
 * 版本号格式：20YYMMDD + 小写字母（a-z），同一天多次发布递增字母
 * 原则：所有 HTML 引用的同一资源必须版本号一致
 */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = __dirname; // 与脚本同级 = 项目根目录

// 所有需要管理的版本化资源及其引用位置
// 格式: { 文件路径: [ { pattern: 正则, label: 显示名 }, ... ] }
var TARGETS = [
  {
    file: 'assets/style.css',
    label: 'style.css',
    refs: [
      { file: 'index.html',  re: /\/assets\/style\.css\?v=([a-z0-9]+)/ },
      { file: 'pair.html',   re: /\/assets\/style\.css\?v=([a-z0-9]+)/ },
      // solo.html 已合并至 exam 站 structured.html，不再单独管理
    ]
  },
  {
    file: 'assets/app.js',
    label: 'app.js',
    refs: [
      { file: 'index.html',  re: /\/assets\/app\.js\?v=([a-z0-9]+)/ },
    ]
  },
  {
    file: 'assets/wall.js',
    label: 'wall.js',
    refs: [
      { file: 'index.html',  re: /\/assets\/wall\.js\?v=([a-z0-9]+)/ },
    ]
  },
  {
    file: 'assets/ft-util.js',
    label: 'ft-util.js',
    refs: [
      { file: 'index.html',  re: /\/assets\/ft-util\.js\?v=([a-z0-9]+)/ },
      { file: 'pair.html',   re: /\/assets\/ft-util\.js\?v=([a-z0-9]+)/ },
      // solo.html 已合并至 exam 站 structured.html，不再单独管理
    ]
  },
  {
    file: 'assets/settings.js',
    label: 'settings.js',
    refs: [
      { file: 'pair.html',   re: /\/assets\/settings\.js\?v=([a-z0-9]+)/ },
      // solo.html 已合并至 exam 站 structured.html，不再单独管理,
    ]
  },
  {
    file: 'assets/glare.js',
    label: 'glare.js',
    refs: [
      { file: 'pair.html',   re: /\/assets\/glare\.js\?v=([a-z0-9]+)/ },
    ]
  },
  {
    file: 'assets/interview.js',
    label: 'interview.js',
    refs: [
      { file: 'pair.html',   re: /\/assets\/interview\.js\?v=([a-z0-9]+)/ },
    ]
  },
];

function readVersion(target) {
  // 从第一个 ref 中提取当前版本号
  var ref = target.refs[0];
  if (!ref) return null;
  var fp = path.join(ROOT, ref.file);
  if (!fs.existsSync(fp)) return null;
  var content = fs.readFileSync(fp, 'utf8');
  var m = content.match(ref.re);
  return m ? m[1] : null;
}

function nextVersion(current) {
  // 从当前版本生成下一个
  if (!current) {
    // 默认：今天日期 + 'a'
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');
    return y + m + d + 'a';
  }
  var m = current.match(/^(\d{6})([a-z])$/);
  if (!m) throw new Error('版本号格式异常: ' + current);
  var date = m[1];
  var ch = m[2].charCodeAt(0);
  var today = (function () {
    var n = new Date();
    return '' + n.getFullYear() +
      String(n.getMonth() + 1).padStart(2, '0') +
      String(n.getDate()).padStart(2, '0');
  })();
  if (date === today && ch < 122) { // 'z' = 122
    return date + String.fromCharCode(ch + 1);
  }
  return today + 'a';
}

function check() {
  console.log('=== 版本号一致性检查 ===\n');
  var errors = 0;
  TARGETS.forEach(function (t) {
    var versions = [];
    t.refs.forEach(function (ref) {
      var fp = path.join(ROOT, ref.file);
      if (!fs.existsSync(fp)) { versions.push(ref.file + ': FILE_NOT_FOUND'); return; }
      var content = fs.readFileSync(fp, 'utf8');
      var m = content.match(ref.re);
      versions.push(ref.file + ': ' + (m ? m[1] : 'NOT_FOUND'));
    });
    var unique = versions.filter(function (v, i, arr) { return arr.indexOf(v) === i; });
    var ok = unique.length === 1 && !unique[0].includes('NOT_FOUND') && !unique[0].includes('FILE_NOT_FOUND');
    console.log((ok ? '✅' : '❌') + ' ' + t.label + ': ' + versions.join(' | '));
    if (!ok) errors++;
  });

  // 检查 SW 缓存名
  var swPath = path.join(ROOT, 'sw.js');
  if (fs.existsSync(swPath)) {
    var sw = fs.readFileSync(swPath, 'utf8');
    var swM = sw.match(/const\s+CACHE\s*=\s*['"]([^'"]+)['"]/);
    console.log('\n⚠️  Service Worker 缓存名: ' + (swM ? swM[1] : '未找到'));
    console.log('   提示：SW 缓存名建议随大版本更新时手动修改，清理旧缓存。');
  }

  console.log('\n' + (errors === 0 ? '🎉 全部一致！' : '⚠️  发现 ' + errors + ' 处不一致'));
  return errors;
}

function listVersions() {
  console.log('=== 当前所有版本号 ===\n');
  TARGETS.forEach(function (t) {
    var v = readVersion(t);
    console.log('  ' + t.label + ': ' + (v || '(未找到)'));
  });
}

function bump(newVer) {
  var changed = [];
  TARGETS.forEach(function (t) {
    var oldVer = readVersion(t);
    t.refs.forEach(function (ref) {
      var fp = path.join(ROOT, ref.file);
      if (!fs.existsSync(fp)) { console.warn('⚠️  跳过不存在: ' + fp); return; }
      var content = fs.readFileSync(fp, 'utf8');
      var replaced = content.replace(ref.re, function (match, v) {
        return match.replace(v, newVer);
      });
      if (replaced !== content) {
        fs.writeFileSync(fp, replaced, 'utf8');
        changed.push(ref.file + ' (' + t.label + ': ' + oldVer + ' → ' + newVer + ')');
      }
    });
  });
  console.log('=== 版本号已 bump 至 ' + newVer + ' ===\n');
  changed.forEach(function (c) { console.log('  ✅ ' + c); });
  if (!changed.length) console.log('  (无变化)');
  console.log('\n提示：commit 时建议用 message: bump(v' + newVer + ')');
}

// CLI
var args = process.argv.slice(2);
if (args[0] === '--check') {
  process.exit(check());
} else if (args[0] === '--list') {
  listVersions();
} else if (args[0] === '--help' || args[0] === '-h') {
  console.log([
    'FaceTalk 版本号管理工具',
    '',
    '用法:',
    '  node bump-version.js              自动 bump 到下一个版本',
    '  node bump-version.js <version>    指定版本号（如 20260808i）',
    '  node bump-version.js --check     仅检查一致性',
    '  node bump-version.js --list      列出当前版本号',
    '',
    '版本号格式: 20YYMMDD + 小写字母(a-z)',
  ].join('\n'));
} else {
  var ver = args[0] || null;
  if (ver && !/^\d{6}[a-z]$/.test(ver)) {
    console.error('❌ 版本号格式错误，应为 20YYMMDD + 小写字母，如 20260808f');
    process.exit(1);
  }
  if (!ver) {
    // 收集当前最大版本号来推导下一个
    var maxVer = '';
    TARGETS.forEach(function (t) {
      var v = readVersion(t);
      if (v && v > maxVer) maxVer = v;
    });
    ver = nextVersion(maxVer);
  }
  bump(ver);
}
