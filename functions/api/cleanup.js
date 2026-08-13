import { runCleanup } from '../_cleanup.js';

// 供 GitHub Actions 定时任务调用的清理接口（替代 CF 后台 Cron Triggers）
// 用法：POST /api/cleanup   头部带 x-cleanup-key: <密钥>
// 密钥：优先取环境变量 CLEANUP_KEY，否则用内置默认密钥（与 .github/workflows/kv-cleanup.yml 保持一致）
const DEFAULT_KEY = 'MAABa_kecoPJAKmqIKDwhUSC';

export async function onRequestPost(ctx) {
  const key = ctx.env.CLEANUP_KEY || DEFAULT_KEY;
  const provided = ctx.request.headers.get('x-cleanup-key') || '';
  if (provided !== key) {
    return new Response(JSON.stringify({ ok: false, error: 'forbidden' }), {
      status: 403, headers: { 'content-type': 'application/json' },
    });
  }
  const r = await runCleanup(ctx.env);
  return new Response(JSON.stringify(r), {
    status: r.ok ? 200 : 503,
    headers: { 'content-type': 'application/json' },
  });
}

// 浏览器直接访问给个说明，避免误触
export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: false, error: 'use POST with x-cleanup-key' }), {
    status: 405, headers: { 'content-type': 'application/json' },
  });
}
