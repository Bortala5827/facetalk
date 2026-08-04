import { getDB, nowSec } from './_shared.js';

// FaceTalk D1 定时清理（共享逻辑）
// 两处调用：① Pages Cron(__scheduled.js) ② GitHub Actions 定时调用 /api/cleanup
//
// D1 不会自动过期行，这里主动清理已结束/过期的记录，避免无限堆积：
//   1) intents: 已关闭/已匹配，或已过期
//   2) applications: 已接受/已拒绝，或已过期
//   3) pairs:   已过期（>30min）
//   4) reports: 超过 7 天（封禁状态已持久化到 users.banned，report 行可清）
//   5) rate_limits: 窗口已过的计数

export async function runCleanup(env) {
  const db = getDB(env);
  if (!db) return { ok: false, error: 'DB_NOT_BOUND' };

  const now = nowSec();
  const weekAgo = now - 7 * 86400;

  const ops = [
    db.prepare("DELETE FROM intents WHERE status<>'open' OR expires < ?").bind(now),
    // applications：只清过期或非 pending 老于 7 天的；a_accepted/both_accepted 是「正在进行的双向匹配」，绝不能清
    db.prepare("DELETE FROM applications WHERE (status='pending' AND expires < ?) OR (status<>'pending' AND created < ?)").bind(now, weekAgo),
    db.prepare("DELETE FROM pairs WHERE expires < ?").bind(now),
    db.prepare("DELETE FROM reports WHERE created < ?").bind(weekAgo),
    db.prepare("DELETE FROM rate_limits WHERE reset_at < ?").bind(now),
  ];
  const res = await db.batch(ops);
  const deleted = res.reduce((s, r) => s + ((r && r.meta && r.meta.changes) || 0), 0);
  return { ok: true, deleted, at: Date.now() };
}
