'use strict';
// glare 决策纯函数单测（双方同时发起 offer 时谁 roll back）
// 决策见 assets/glare.js
// 运行：node scripts/selftest-glare.js

const path = require('path');
const { decideGlare } = require(path.join(__dirname, '..', 'assets/glare.js'));

let pass = 0, fail = 0;
function ok(cond, label) { console.log((cond ? '✓ ' : '✗ ') + label); if (cond) pass++; else fail++; }

// 标准场景：双方身份字典序 A < B
ok(decideGlare('A', 'B') === 'roll-back-self', 'A 字典序小 → A roll back 改应答');
ok(decideGlare('B', 'A') === 'ignore-self', 'B 字典序大 → B 保持发起方忽略 A');

// 相同 ID（同身份多端登录）→ 必须有一方 roll back
ok(decideGlare('X', 'X') === 'roll-back-self', '双方 ID 相同 → 默认 roll back 改应答');

// 真实 ft_me 是 25 位随机串，测一下长字符串字典序
ok(decideGlare('usr_aaaaaaaaaaaaaaaaaaaaa', 'usr_bbbbbbbbbbbbbbbbbbbbb') === 'roll-back-self', '长 ID 字典序小 → roll back');
ok(decideGlare('usr_bbbbbbbbbbbbbbbbbbbbb', 'usr_aaaaaaaaaaaaaaaaaaaaa') === 'ignore-self', '长 ID 字典序大 → 保持发起');

// 缺身份（极端情况：me 或 from 为空）→ 默认 roll back（更稳）
ok(decideGlare('', 'B') === 'roll-back-self', 'me 缺失 → roll back 改应答');
ok(decideGlare('A', '') === 'roll-back-self', 'from 缺失 → roll back 改应答');
ok(decideGlare(null, 'B') === 'roll-back-self', 'me=null → roll back');
ok(decideGlare('A', undefined) === 'roll-back-self', 'from=undefined → roll back');

// 真实 ft_me 形态：25 字符，类似 'u_xxxxxxxxxxxxxxxxxxxxxxx'
const me = 'u_aaaaaaaaaaaaaaaaaaaaaaa';
const peer = 'u_bbbbbbbbbbbbbbbbbbbbbbb';
ok(me.length === 25 && peer.length === 25, '典型身份 ID 长度 25');
ok(decideGlare(me, peer) === 'roll-back-self', '真实 25 字符 ID：A 字典序小 → roll back');

console.log('---');
console.log('结果：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail > 0 ? 1 : 0);
