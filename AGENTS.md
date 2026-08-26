# FaceTalk · 仓库规则

面试匹配产品，60秒试音 + 双向互选 + 阅后即焚。D1 数据库 + PWA。

## 不要做

- 不把语音文件存 D1（阅后即焚，会话结束删除）
- 不加社交关系链
- 不在首页放超过 6 个链接

## 关键路径

- `index.html` — 落地页
- `match.html` — 匹配大厅
- `pair.html` — 双人对练
- `solo.html` — 单人练习
- `functions/api/` — 12 个 API（voice/pair/messages/wall/intents/apply/interview/turn/heartbeat/admin/llm/cleanup）
- `schema.sql` + `alter-*.sql` — D1 表结构
- `sw.js` — Service Worker（PWA）

## 数据约定

- 语音阅后即焚，会话结束后声纹消散
- D1 存匹配状态、留言墙、信誉，不存语音字节
- 3 人举报自动封禁

## 推送前

1. 本机 Chrome 验证匹配流程核心路径
2. 确认 D1 迁移脚本（alter-*.sql）已执行
3. 按 `../../RCJ-网站上线检查清单.md` 过一遍
