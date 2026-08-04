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
//   6) wall:   公开留言墙，超过 7 天自动清理

export async function runCleanup(env) {
  const db = getDB(env);
  if (!db) return { ok: false, error: 'DB_NOT_BOUND' };

  const now = nowSec();
  const weekAgo = now - 7 * 86400;
  const threeDays = now - 3 * 86400;

  const ops = [
    db.prepare("DELETE FROM intents WHERE status<>'open' OR expires < ?").bind(now),
    // applications：只清过期或非 pending 老于 7 天的；a_accepted/both_accepted 是「正在进行的双向匹配」，绝不能清
    db.prepare("DELETE FROM applications WHERE (status='pending' AND expires < ?) OR (status<>'pending' AND created < ?)").bind(now, weekAgo),
    // pairs：普通过期房间（>30min）立即删；closed 房间保留 3 天用于「房间已解散」展示 + 3天自动删
    db.prepare("DELETE FROM pairs WHERE status<>'closed' AND expires < ?").bind(now),
    db.prepare("DELETE FROM reports WHERE created < ?").bind(weekAgo),
    db.prepare("DELETE FROM rate_limits WHERE reset_at < ?").bind(now),
    // wall：公开留言墙，7 天前的老旧留言清理掉
    db.prepare("DELETE FROM wall WHERE created_at < ?").bind(weekAgo),
    // 先删「关闭满 3 天的房间」其关联申请（此时子查询还能看到 closed 房间，避免删完房间后子查询落空）
    db.prepare("DELETE FROM applications WHERE intent_id IN (SELECT intent_id FROM pairs WHERE status='closed' AND (json_extract(ratings,'$_closedAt') < ? OR (json_extract(ratings,'$_closedAt') IS NULL AND created < ?)))").bind(threeDays, threeDays),
    // 再删 closed 房间满 3 天 → 硬删（本地不留）。_closedAt 缺失时退回到 created 时间判断，避免永久留存
    db.prepare("DELETE FROM pairs WHERE status='closed' AND (json_extract(ratings,'$_closedAt') < ? OR (json_extract(ratings,'$_closedAt') IS NULL AND created < ?))").bind(threeDays, threeDays),
  ];
  const res = await db.batch(ops);
  const deleted = res.reduce((s, r) => s + ((r && r.meta && r.meta.changes) || 0), 0);
  // 主动结算：到期仍未关的房间（退出 60s / 双方互评完 5 分钟）直接关房并清对话。
  // 兜底用——即便没人开着页面轮询，每日定时清理也会把过期房间结清，不留残留对话。
  // dissolve_at/closed_at 列可能未 ALTER：先尝试用 json_set 写 _closedAt（保留其它字段），失败则退化仅关房
  try {
    await db.batch([
      db.prepare("UPDATE pairs SET status='closed', ratings=json_set(COALESCE(ratings,'{}'),'$._closedAt',?), info_a='', info_b='' WHERE (status='dissolving' AND dissolve_at>0 AND dissolve_at<=?) OR (status='done' AND closed_at>0 AND closed_at<=?)").bind(now, now, now),
      db.prepare("DELETE FROM messages WHERE pair_id IN (SELECT id FROM pairs WHERE status='closed')"),
    ]);
  } catch (e) {
    try {
      await db.batch([
        db.prepare("UPDATE pairs SET status='closed', info_a='', info_b='' WHERE (status='dissolving' AND dissolve_at>0 AND dissolve_at<=?) OR (status='done' AND closed_at>0 AND closed_at<=?)").bind(now, now),
        db.prepare("DELETE FROM messages WHERE pair_id IN (SELECT id FROM pairs WHERE status='closed')"),
      ]);
    } catch (e2) { /* 列未 ALTER：运行时已由 ratings.at 兜底自动结算，忽略 */ }
  }
  return { ok: true, deleted, at: Date.now() };
}
