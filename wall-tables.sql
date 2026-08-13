CREATE TABLE IF NOT EXISTS wall (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  text        TEXT,
  created_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wall_created ON wall(created_at DESC);
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
