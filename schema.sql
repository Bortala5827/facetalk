-- FaceTalk / 面试搭子 D1 schema
-- 在 Cloudflare 后台 D1 控制台（或 wrangler d1 execute）执行本文件一次即可。
-- 时间字段统一用「秒」时间戳。

-- 用户（匿名身份，持久化以累积信誉；封禁状态跨会话保留）
CREATE TABLE IF NOT EXISTS users (
  id      TEXT PRIMARY KEY,
  rep     INTEGER NOT NULL DEFAULT 50,
  banned  INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
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
  expires INTEGER NOT NULL
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
  status   TEXT NOT NULL DEFAULT 'matched',   -- matched | done
  ratings  TEXT NOT NULL DEFAULT '{}',        -- JSON: {"userId": {score,tags,next,at}}
  created  INTEGER NOT NULL,
  expires  INTEGER NOT NULL
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
