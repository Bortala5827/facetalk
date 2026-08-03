import { getKV } from './_shared.js';

// FaceTalk KV 定时清理（共享逻辑）
// 两处调用：① Pages Cron(__scheduled.js) ② GitHub Actions 定时调用 /api/cleanup
//
// KV 自带 TTL 已覆盖绝大多数 key 的自动过期（见各 onRequest 里的 expirationTtl）。
// 本脚本额外主动清理，避免 TTL 边缘 GC 残留 + 让已结束的会话提前消失：
//   1) intent: 已关闭/已匹配的意图
//   2) app:    已拒绝/已接受的申请
//   3) 读取为空的 key（TTL 到期后边缘残留）
// 不处理：u:（用户信誉靠 24h TTL）、pair:/mypair:（30min TTL）、report:（7天 TTL 由 GC 兜底）

const TARGETS = [
  { prefix: 'intent:', drop: (o) => o && o.status && o.status !== 'open' },
  { prefix: 'app:',    drop: (o) => o && o.status && (o.status === 'rejected' || o.status === 'accepted') },
];
const MAX_SCAN = 5000; // 单次扫描上限，防止函数超时

export async function runCleanup(env) {
  const kv = getKV(env);
  if (!kv) return { ok: false, error: 'KV_NOT_BOUND' };

  let deleted = 0;
  let scanned = 0;
  for (const t of TARGETS) {
    let cursor;
    do {
      const opts = { prefix: t.prefix };
      if (cursor) opts.cursor = cursor;
      const page = await kv.list(opts);
      for (const k of page.keys) {
        if (++scanned > MAX_SCAN) break;
        const raw = await kv.get(k.name);
        if (!raw) { await kv.delete(k.name).catch(() => {}); deleted++; continue; }
        try {
          const o = JSON.parse(raw);
          if (t.drop(o)) { await kv.delete(k.name).catch(() => {}); deleted++; }
        } catch (e) {
          // 非 JSON 值（如计数类 key）——保留，交给 TTL
        }
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor && scanned <= MAX_SCAN);
  }

  return { ok: true, deleted, scanned, at: Date.now() };
}
