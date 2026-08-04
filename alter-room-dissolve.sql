-- FaceTalk 房间自动解散 + 在线人数统计：新增列（Cloudflare D1 控制台执行一次）
-- 注：SQLite 不支持 ADD COLUMN IF NOT EXISTS，重复执行会报「duplicate column」属正常，可忽略。

-- 一方退出后 60s / 双方互评完 5 分钟 自动解散房间用
ALTER TABLE pairs ADD COLUMN dissolve_at INTEGER DEFAULT 0;
ALTER TABLE pairs ADD COLUMN closed_at   INTEGER DEFAULT 0;

-- 「当前在线发需求人数」统计用（按去重 IP 计数）
ALTER TABLE intents ADD COLUMN ip TEXT DEFAULT '';
