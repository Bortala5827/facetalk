-- FaceTalk / 面试搭子 D1 schema
-- 在 Cloudflare 后台 D1 控制台（或 wrangler d1 execute）执行本文件一次即可。
-- 时间字段统一用「秒」时间戳。

-- 用户（匿名身份，持久化以累积信誉；封禁状态跨会话保留）
CREATE TABLE IF NOT EXISTS users (
  id      TEXT PRIMARY KEY,
  rep     INTEGER NOT NULL DEFAULT 50,
  banned  INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  geo_city   TEXT DEFAULT '',        -- IP 地理：城市（Cloudflare cf.city，常为中文/拼音）
  geo_region TEXT DEFAULT '',        -- IP 地理：省/州（cf.region，英文名）
  geo_lat    REAL DEFAULT NULL,      -- IP 地理：纬度（cf.latitude）
  geo_lng    REAL DEFAULT NULL,      -- IP 地理：经度（cf.longitude）
  geo_at     INTEGER DEFAULT 0,      -- 上次抓地理的时间（秒），节流 15 分钟
  last_seen  INTEGER DEFAULT 0       -- 最近一次心跳（/api/pair GET）时间（秒），用于「对方是否在线」
);
CREATE INDEX IF NOT EXISTS idx_users_banned ON users(banned);

-- 意图（找搭子）
CREATE TABLE IF NOT EXISTS intents (
  id      TEXT PRIMARY KEY,
  owner   TEXT NOT NULL,
  role    TEXT NOT NULL,
  city    TEXT NOT NULL DEFAULT '',
  mode    TEXT NOT NULL DEFAULT 'voice',
  note    TEXT NOT NULL DEFAULT '',
  meet    TEXT NOT NULL DEFAULT '',
  status  TEXT NOT NULL DEFAULT 'open',   -- open | matched | closed
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  ip      TEXT DEFAULT ''                 -- 在线发需求人数统计（已存在库需 ALTER 加列）
);
CREATE INDEX IF NOT EXISTS idx_intents_status_created ON intents(status, created);
CREATE INDEX IF NOT EXISTS idx_intents_owner ON intents(owner);

-- 申请
CREATE TABLE IF NOT EXISTS applications (
  id        TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL,
  applicant TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | rejected
  created   INTEGER NOT NULL,
  expires   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_intent ON applications(intent_id);
CREATE INDEX IF NOT EXISTS idx_app_applicant ON applications(applicant);

-- 搭子房（单次互练，软上限 30 分钟）
CREATE TABLE IF NOT EXISTS pairs (
  id       TEXT PRIMARY KEY,
  a        TEXT NOT NULL,
  b        TEXT NOT NULL,
  intent_id TEXT,
  mode     TEXT,
  meet     TEXT,
  status   TEXT NOT NULL DEFAULT 'matched',   -- matched | done | dissolving | closed
  ratings  TEXT NOT NULL DEFAULT '{}',        -- JSON: {"userId": {score,tags,next,left,at}}
  created  INTEGER NOT NULL,
  expires  INTEGER NOT NULL,
  dissolve_at INTEGER DEFAULT 0,              -- 一方退出后 60s 自动解散的时间点
  closed_at   INTEGER DEFAULT 0               -- 双方互评完成后 5 分钟自动解散的时间点
);
CREATE INDEX IF NOT EXISTS idx_pairs_a ON pairs(a);
CREATE INDEX IF NOT EXISTS idx_pairs_b ON pairs(b);

-- 举报
CREATE TABLE IF NOT EXISTS reports (
  id      TEXT PRIMARY KEY,
  target  TEXT NOT NULL,
  by      TEXT NOT NULL,
  reason  TEXT,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target);
-- 同一举报者对同一目标只算 1 次（防恶意举报凑数；应用层 INSERT OR IGNORE 兜底）
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_by_target ON reports(by, target);

-- 互评明细（pairs.ratings 里也有，这里单独建表便于统计/查询）
CREATE TABLE IF NOT EXISTS ratings (
  id       TEXT PRIMARY KEY,
  pair_id  TEXT NOT NULL,
  from_user TEXT NOT NULL,
  to_user  TEXT NOT NULL,
  score    INTEGER NOT NULL,
  tags     TEXT,
  next     INTEGER NOT NULL DEFAULT 0,
  created  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ratings_to ON ratings(to_user);
CREATE INDEX IF NOT EXISTS idx_ratings_pair ON ratings(pair_id);

-- 频率限制计数器
CREATE TABLE IF NOT EXISTS rate_limits (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);

-- 搭子房间留言板（自删除：仅发送者可删）
CREATE TABLE IF NOT EXISTS messages (
  id      TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL,
  sender  TEXT NOT NULL,
  text    TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(pair_id);
-- 阅后即焚（2026-08-04 新增）：burn=是否焚消息、read=接收方是否已读（读后即删）。
-- messages 表已存在时 CREATE TABLE IF NOT EXISTS 不会加列，需在 D1 控制台执行 alter-messages-burn.sql 一次性加列：
--   ALTER TABLE messages ADD COLUMN burn INTEGER DEFAULT 0;
--   ALTER TABLE messages ADD COLUMN read INTEGER DEFAULT 0;
-- 注：搭子「退出组队」不新增表字段，复用 pairs.ratings 的 JSON（标记 left:true），无需 ALTER。
--
-- 房间自动解散（2026-08-04 新增）：一方退出 → 1 分钟后双方房间关闭；双方互评完 → 5 分钟后自动清空。
-- 依赖 pairs 表 dissolve_at / closed_at 两列。已存在库需在 D1 控制台执行 alter-room-dissolve.sql 一次性加列：
--   ALTER TABLE pairs ADD COLUMN dissolve_at INTEGER DEFAULT 0;
--   ALTER TABLE pairs ADD COLUMN closed_at INTEGER DEFAULT 0;
-- 另需 intents.ip 列统计在线发需求人数：
--   ALTER TABLE intents ADD COLUMN ip TEXT DEFAULT '';
-- （SQLite 不支持 ADD COLUMN IF NOT EXISTS，重复执行会报「duplicate column」属正常，忽略即可。）

-- 联机信息列（2026-08-04 新增）：pairs 表扩展 info_a / info_b，存双方各自填写的
-- 腾讯会议 / 联系方式，置顶常驻、实时互看。因 pairs 表已存在，CREATE TABLE IF NOT EXISTS
-- 不会自动加列，需单独在 D1 控制台执行 alter-pairs-info.sql（见本目录）一次性加列：
--   ALTER TABLE pairs ADD COLUMN info_a TEXT DEFAULT '';
--   ALTER TABLE pairs ADD COLUMN info_b TEXT DEFAULT '';
-- 注意：SQLite 不支持 ADD COLUMN IF NOT EXISTS，重复执行会报错，只需执行一次。

-- 全站公开留言墙（2026-08-04 新增）：首页可见，任何人可留，7 天自动清理（见 _cleanup.js）。
-- created_at 用「秒」时间戳，与全站一致。
CREATE TABLE IF NOT EXISTS wall (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  text        TEXT,
  created_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wall_created ON wall(created_at DESC);

-- 发帖频率限制（按 IP，秒级）：wall_rl = 60s 内不可重复发；wall_day = 单 IP 单日上限
CREATE TABLE IF NOT EXISTS wall_rl (
  ip      TEXT PRIMARY KEY,
  last_ts INTEGER
);
CREATE TABLE IF NOT EXISTS wall_day (
  ip  TEXT NOT NULL,
  day TEXT NOT NULL,
  n   INTEGER DEFAULT 0,
  PRIMARY KEY (ip, day)
);

-- 用户主动屏蔽搭子（2026-08-04 新增）：评价时勾「不再匹配此搭子」即写入本表。
-- 后续 browse 列表 / 收件箱会过滤掉被自己屏蔽的人，避免再被同一人骚扰。
-- （不按 IP 屏蔽：IP 会变；user_id 是稳定的匿名身份，更可靠。）
CREATE TABLE IF NOT EXISTS blocks (
  user_id     TEXT NOT NULL,
  blocked_id  TEXT NOT NULL,
  created     INTEGER NOT NULL,
  PRIMARY KEY (user_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_user ON blocks(user_id);

-- ===== FaceTalk v2.1 面试间（运行时已自动建表，这里仅供手动 D1 执行参考）=====
-- 实时转录行：面试间双方各自的文字流（我方 STT 产出 + 手动补充），前端轮询同步
CREATE TABLE IF NOT EXISTS interview_lines (
  id TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL,
  who TEXT NOT NULL,          -- 'a' | 'b'（按 pairs.a/b 判定）
  text TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_il_pair ON interview_lines(pair_id);

-- WebRTC 原生 P2P 语音的信令中转（offer/answer/ice），无 TURN 时自动回落腾讯会议
CREATE TABLE IF NOT EXISTS rtc_signals (
  id TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- offer | answer | ice
  data TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sg_pair_to ON rtc_signals(pair_id, to_id);
