# FaceTalk · 双向互选面试搭子

双向互选的面试搭子匹配：**只有双方都同意，才成为搭子**。免费、匿名、免登录，数据存 Cloudflare D1。

- **演示**：https://ms.955827.xyz
- **仓库**：`github.com/Bortala5827/facetalk`

## 交互闭环

发匿名意图 → 浏览 / 申请 → **双向互选**（同意才成搭子）→ 限时互练（语音优先，走腾讯会议深链）→ 互评 + 再约门槛。3 人举报自动封禁，信誉跨会话累积。

## 技术

Cloudflare Pages Functions + D1。接口：`/api/identity` `/api/intents` `/api/apply` `/api/pair` `/api/admin`。PWA + 极薄 WebView APK（GitHub Actions 自动打包发布到 Releases，避开 `.xyz` 在微信 / QQ 被拦）。

## 部署必做

1. CF 建 D1 库，Console 粘贴执行 `schema.sql` 建表。
2. 绑定到 Pages 项目，变量名 `DB`；**Deployments 点 Retry**。
3. （可选）环境变量 `ADMIN_KEY`。
4. 定时清理：启用 `.github/workflows/d1-cleanup.yml`（每天 UTC 04:23 `POST /api/cleanup`）。

## 🌐 RCJ 产品矩阵

| 产品 | 站点 | 仓库 |
| --- | --- | --- |
| RCJ Hub · 品牌枢纽 / 个人主页 | https://955827.xyz | rcj-hub |
| RCJ Exam Hub · 综合公职真题 | https://exam.955827.xyz | rcj-exam-bank |
| FaceTalk · 面试搭子 | https://ms.955827.xyz | facetalk |
| SoloSpeak · 独声 | https://955827.xyz/solospeak | solospeak |
| LetOut · 大声说 | https://955827.xyz/letout | letout |
| 辅警题库 · 多城市刷题 | https://fj.955827.xyz | aux-police-exam |
| 消防员题库 | https://xf.955827.xyz | xf-firefighter-exam |

> 备用域名：各站 `*.rcj9527.dpdns.org`（`.xyz` 不可达时回退）。
