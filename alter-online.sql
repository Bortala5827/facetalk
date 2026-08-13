-- FaceTalk 在线状态：给 users 表加 last_seen 心跳列
-- 在 Cloudflare D1 控制台（mianshi-dazi 库 → Console）粘贴执行一次即可。
-- SQLite 不支持 IF NOT EXISTS，重复执行报 "duplicate column" 属正常，可忽略。
ALTER TABLE users ADD COLUMN last_seen INTEGER DEFAULT 0;
