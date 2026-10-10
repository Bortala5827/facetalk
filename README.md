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

---

Part of the [RCJ ecosystem](https://955827.xyz).
