-- ============================================================
-- FaceTalk 2.0 「30 秒试音互评」建表脚本
-- 在 Cloudflare → D1 → mianshi-dazi-d1 → 控制台，整段粘贴执行一次即可。
-- 全部是新表（CREATE TABLE IF NOT EXISTS），不改动任何老表，重复执行也安全。
--
-- 设计要点：
--   * 录音以 base64 分片存 voice_chunks，单片 ≤ 48KB，避开 D1 单值上限；
--   * 对方一提交评价 → 立即物理 DELETE 录音行（阅后即焚）；
--   * 兜底：2 小时无人评价，每日 cleanup 强删，绝不长期占用空间；
--   * 本地零留存：浏览器只用内存 Blob，播完 revokeObjectURL，不写 localStorage。
-- ============================================================

-- 录音主表（一条 = 一个人在一个房间里的一段试音）
CREATE TABLE IF NOT EXISTS voice_clips (
  id       TEXT PRIMARY KEY,                    -- vc_xxxxxxxx
  pair_id  TEXT NOT NULL,                       -- 所属房间
  owner    TEXT NOT NULL,                       -- 录音者 user id
  mime     TEXT NOT NULL DEFAULT 'audio/webm',  -- audio/webm(opus) 或 audio/mp4(iOS)
  dur      INTEGER NOT NULL DEFAULT 0,          -- 时长（秒，30–60）
  bytes    INTEGER NOT NULL DEFAULT 0,          -- base64 字符数（体积监控）
  chunks   INTEGER NOT NULL DEFAULT 0,          -- 分片总数
  plays    INTEGER NOT NULL DEFAULT 0,          -- 对方已播放次数（上限 2）
  ready    INTEGER NOT NULL DEFAULT 0,          -- 1=分片传完可播放
  created  INTEGER NOT NULL,
  expires  INTEGER NOT NULL                     -- 2 小时兜底强删时间点
);
CREATE INDEX IF NOT EXISTS idx_vclips_pair ON voice_clips(pair_id);
CREATE INDEX IF NOT EXISTS idx_vclips_expires ON voice_clips(expires);

-- 录音分片（base64 文本，按 seq 顺序拼回完整音频）
CREATE TABLE IF NOT EXISTS voice_chunks (
  clip_id TEXT NOT NULL,
  seq     INTEGER NOT NULL,
  data    TEXT NOT NULL,
  PRIMARY KEY (clip_id, seq)
);

-- 试音互评（每人每房间一条；双方都提交后决定组队还是解散）
CREATE TABLE IF NOT EXISTS voice_reviews (
  pair_id  TEXT NOT NULL,
  reviewer TEXT NOT NULL,                       -- 评价人
  target   TEXT NOT NULL,                       -- 被评价人
  clarity  INTEGER NOT NULL DEFAULT 3,          -- 表达清晰 1–5
  logic    INTEGER NOT NULL DEFAULT 3,          -- 逻辑结构 1–5
  pace     INTEGER NOT NULL DEFAULT 3,          -- 语速节奏 1–5
  comment  TEXT DEFAULT '',                     -- 一句话点评（≤100 字）
  willing  INTEGER NOT NULL DEFAULT 0,          -- 1=愿意组队 0=婉拒
  created  INTEGER NOT NULL,
  PRIMARY KEY (pair_id, reviewer)
);
CREATE INDEX IF NOT EXISTS idx_vreviews_pair ON voice_reviews(pair_id);
