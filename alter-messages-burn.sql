-- 阅后即焚功能需要的两列（messages 表已存在，CREATE TABLE IF NOT EXISTS 不会加列，需手动在 D1 控制台执行一次）
-- 注意：SQLite 不支持 ADD COLUMN IF NOT EXISTS，重复执行会报错，只需执行一次。
-- 若已执行过（报错 "duplicate column"），忽略即可。
ALTER TABLE messages ADD COLUMN burn INTEGER DEFAULT 0;
ALTER TABLE messages ADD COLUMN read INTEGER DEFAULT 0;
