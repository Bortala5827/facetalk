# FaceTalk · Anonymous Interview Screener with Voice Matching

> English · 日本語 · 中文 — a 60-second voice tryout and two-way matching screener.
> Free, anonymous, no login. Built on Cloudflare Pages + D1; ships as a PWA
> and a thin WebView APK.

**Live site:** https://facetalk.955827.xyz

FaceTalk helps two people decide whether to invest time in a real conversation.
Post an anonymous intent, browse or apply, and only when **both sides agree** do
you pair up — then do a short voice-first practice (deep-link to a meeting app),
rate each other, and unlock a rematch. Three reports auto-ban; reputation carries
across sessions.

## Core mechanics (核心原理)

- **双向互选 = 信任门槛**：post 匿名意向 → 浏览 / 申请 → **双方都同意才配对**（避免单方骚扰），配对后才是限时语音练习（会议 App 深链）。配对即付费/声誉的锚点。
- **匿名 + 声誉制**：默认不登录、不暴露身份；声誉跨会话累积，**3 次举报自动禁言**——匿名不是免责，声誉就是信用。
- **语音即资产，阅后即焚**：60s 试音存 R2 桶 `facetalk-voice`，**1 天生命周期规则自动销毁**（prefix `clips/`），D1 只存元数据，控制成本与隐私。
- **零服务器**：Pages Functions + D1 + R2，全部 Cloudflare 边缘；PWA + WebView APK（GitHub Actions 构建发布到 Releases）绕过微信 / QQ 内的 `.xyz` 拦截。
- **三语一源**：EN / 日本語 / 中文由前端 i18n 字典驱动，单文件切换。

## Interaction loop

post anonymous intent → browse / apply → **two-way mutual selection**
(both must agree to pair) → timed voice practice (meeting-app deep-link)
→ mutual rating + rematch gate. 3 reports → auto-ban; reputation persists.

## Highlights

- 🌐 Trilingual UI (English / 日本語 / 中文), single-click switch
- 🎙️ **60-second voice tryout** before committing to a full call
- 🤝 **Two-way matching** — pair only when both agree
- 🕶️ Anonymous & no-login by default; reputation-based trust
- 📱 PWA + thin WebView APK (GitHub Actions builds & publishes to Releases,
  bypassing `.xyz` blocks inside WeChat / QQ)

## Tech stack

- Cloudflare Pages Functions + D1 (SQLite) + R2 (object storage for voice clips)
- PWA (service worker, installable)
- Vanilla JS `i18n` dictionary

## Deploy

Create a D1 database, run `schema.sql` in the Cloudflare console, bind it to the
Pages project as `DB` (enable **Deployments Retry**). Optionally set `ADMIN_KEY`.

Voice clips (60s tryout recordings) are stored in R2, not D1: create an R2 bucket
`facetalk-voice` with a 1-day lifecycle rule (prefix `clips/` auto-burns), bind it
to the Pages project as `VOICE` (or via `[[r2_buckets]]` in `wrangler.toml`).
If the bucket is missing, the voice tryout auto-skips without breaking v1.0.

Enable `.github/workflows/d1-cleanup.yml` for scheduled cleanup.

### 定时清理密钥 CLEANUP_KEY（fail-closed，两处必须一致）

`POST /api/cleanup` 不再内置默认密钥：仅认环境变量 `CLEANUP_KEY`，未配置或不符
一律 403。定时任务要跑通需同时配置两处（建议同一随机值）：

1. **CF Pages 环境变量**：控制台 Settings → Environment variables（Production）加 `CLEANUP_KEY`，
   或 `npx wrangler pages secret put CLEANUP_KEY --project-name=facetalk`；
2. **GitHub Secret**：仓库 Settings → Secrets and variables → Actions 加 `CLEANUP_KEY`
   （`.github/workflows/d1-cleanup.yml` 通过 `secrets.CLEANUP_KEY` 读取）。

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

> 未配置前定时清理会 403 停摆（fail-closed，比内置默认密钥更安全）；/api/admin 后台
> 同 IP 连续错 5 次锁 15 分钟，成功登录清零（rate_limits 表，表故障放行）。

### 强会话 token（可选加固，过渡式）

默认（未配置）：身份 token 就是裸用户 id，行为与现状完全一致。
配置环境变量 `FACETALK_SESSION_SECRET`（≥32 字节随机串）后，`POST /api/identity`
改为签发 `id.exp.sig` 三段式签名 token（HMAC-SHA256，7 天过期），`requireToken`
先验签再查库；此时旧的裸 id token 会被 401 拒绝，前端无感重新获取身份即可。
前端把 token 当不透明字符串存取，格式变化对页面透明。

```bash
# 1) 生成随机密钥
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 2) 写入 Pages 生产环境（wrangler；或在控制台 Settings → Environment variables 手动加）
npx wrangler pages secret put FACETALK_SESSION_SECRET --project-name=facetalk
# 粘贴上一步生成的值，部署后生效
```

> 未配置 `FACETALK_SESSION_SECRET` 时签名逻辑整体旁路，不会影响现有用户；
> 已配置后如需回退，删除该环境变量即回到旧模式（已签发的签名 token 在无 secret 时按裸 id 兼容查库）。

---

Part of the [RCJ ecosystem](https://955827.xyz).
