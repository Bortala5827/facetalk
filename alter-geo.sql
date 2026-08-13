-- FaceTalk 匹配彩蛋：users 表新增 IP 地理列（城市级）
-- 在 Cloudflare D1 控制台执行本文件一次即可（或 wrangler d1 execute）。
-- SQLite 不支持 ADD COLUMN IF NOT EXISTS，重复执行会报 "duplicate column" 属正常，忽略即可。
ALTER TABLE users ADD COLUMN geo_city   TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN geo_region TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN geo_lat    REAL DEFAULT NULL;
ALTER TABLE users ADD COLUMN geo_lng    REAL DEFAULT NULL;
ALTER TABLE users ADD COLUMN geo_at     INTEGER DEFAULT 0;
