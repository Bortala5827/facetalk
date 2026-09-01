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

- Cloudflare Pages Functions + D1 (SQLite)
- PWA (service worker, installable)
- Vanilla JS `i18n` dictionary

## Deploy

Create a D1 database, run `schema.sql` in the Cloudflare console, bind it to the
Pages project as `DB` (enable **Deployments Retry**). Optionally set `ADMIN_KEY`.
Enable `.github/workflows/d1-cleanup.yml` for scheduled cleanup.

---

Part of the [RCJ ecosystem](https://955827.xyz).
