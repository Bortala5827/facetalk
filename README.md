# FaceTalk · 面试筛选器

面试筛选器：60 秒试音，双向选择，合适了再去腾讯会议深聊。免费、匿名、免登录，数据存 Cloudflare D1。

- **演示**：https://facetalk.955827.xyz
- **仓库**：`github.com/Bortala5827/facetalk`

## 交互闭环

发匿名意图 → 浏览 / 申请 → **双向互选**（都愿意才组队）→ 限时互练（语音优先，走腾讯会议深链）→ 互评 + 再约门槛。3 人举报自动封禁，信誉跨会话累积。

## 技术

Cloudflare Pages Functions + D1。PWA + 极薄 WebView APK（GitHub Actions 自动打包发布到 Releases，避开 `.xyz` 在微信 / QQ 被拦）。

## 部署

CF 建 D1 库，Console 执行 `schema.sql` 建表 → 绑定到 Pages 项目（变量名 `DB`，**Deployments Retry**）→（可选）环境变量 `ADMIN_KEY` → 启用 `.github/workflows/d1-cleanup.yml` 定时清理。

---

RCJ 产品生态之一 · 总站 [RCJ Hub](https://955827.xyz)
