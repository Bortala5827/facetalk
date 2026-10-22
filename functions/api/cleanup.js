import { runCleanup } from '../_cleanup.js';

// 供 GitHub Actions 定时任务调用的清理接口（替代 CF 后台 Cron Triggers）
// 用法：POST /api/cleanup   头部带 x-cleanup-key: <密钥>
// 密钥仅取环境变量 CLEANUP_KEY（fail-closed）：未配置或密钥不符一律 403，不再内置默认密钥。
export async function onRequestPost(ctx) {
  const key = ctx.env.CLEANUP_KEY || '';
  if (!key) {
    return new Response(JSON.stringify({ ok: false, error: 'cleanup_key_not_configured' }), {
      status: 403, headers: { 'content-type': 'application/json' },
    });
  }
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
