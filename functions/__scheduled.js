import { runCleanup } from './_cleanup.js';

// FaceTalk 定时清理（Cloudflare Pages Cron Trigger 入口）
// 若能在 CF 后台配置 Cron（项目 → Settings → Functions → Cron Triggers → "23 4 * * *"），
// 本函数会被自动调用。若后台找不到 Cron 入口（Git 部署的 Pages 常不显示），
// 改用 .github/workflows/kv-cleanup.yml 的 GitHub Actions 定时调用 /api/cleanup，效果相同。

export async function scheduled(event, env) {
  const r = await runCleanup(env);
  return new Response(JSON.stringify(r), {
    status: r.ok ? 200 : 503,
    headers: { 'content-type': 'application/json' },
  });
}
