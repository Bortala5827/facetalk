# FaceTalk · 双向互选面试搭子

双向互选的面试搭子匹配系统：**只有双方都同意，才成为搭子**。发布意图 → 别人申请 → 你同意 → 语音优先限时互练 → 结束互评。信誉风控防机构割韭菜，举报自动封禁防瞎搞。免费、匿名、免登录，数据用 Cloudflare KV 暂存。

## 交互闭环（核心）

1. **发匿名身份**：首次打开自动领取一次性匿名 token（存 KV 24h），本地也存一份，无需注册。
2. **发布意图**：选岗位 / 城市 / 模式（默认🎙语音优先）/ 选填会议链接。每人同时只有一个开放意图。
3. **浏览 + 申请**：看他人开放意图（已随机打散、不含身份 ID），点「申请组队」。
4. **双向互选**：意图 owner 收到申请 → **同意 / 拒绝**；只有**同意**才会生成 1:1 搭子房间。
5. **限时互练**：房间带 30 分钟软上限（KV TTL）。语音优先，熟了再开摄像头；实际连麦走腾讯会议深链。
6. **互评 + 再约门槛**：结束双方互评（1–5 分 + 标签）。信誉分据此增减；**双方都打分 ≥3 且都勾选「再约」**，才解锁下一轮。单向拒绝/不评即断开。
7. **风控**：每操作过 KV 频率限制（IP + 用户维度）；被 3 人举报自动封禁；管理员可手动封禁。

## 后端（Cloudflare Pages Functions + KV）

| 接口 | 方法 | 作用 |
| --- | --- | --- |
| `/api/identity` | POST / GET | 发匿名 token / 查信誉·封禁状态 |
| `/api/intents` | POST / GET | 发布意图（语音优先）/ 浏览他人开放意图（token 门禁、随机打散） |
| `/api/apply` | POST / GET | 申请组队 / 收件箱（收到 `in`、发出 `out`） |
| `/api/pair` | POST / GET | 决定（同意→房间/拒绝）、配对状态、互评、举报 |
| `/api/admin` | POST | 手动封禁（需 `ADMIN_KEY`） |

数据键：`u:<id>`(身份/信誉/封禁)、`intent:<id>`(意图)、`app:<id>`(申请)、`pair:<id>`(配对房间)、`inbox:<uid>`/`out:<uid>`(收件箱)、`mypair:<uid>`(我的当前房间)、`report:<uid>`(举报计数)、`rl:*`(频率限制)。

## ⚠️ 部署必做：绑定 KV + 环境变量

本机无 Cloudflare 凭证，无法用 API 建绑定。代码引用以下变量名，需你在 CF 控制台手动加：

1. **KV 命名空间**（必需）：Cloudflare → **Workers & Pages** → `mianshi-dazi` → **Settings → Functions → KV namespace bindings** → **Add binding**。**变量名不强制**：优先识别 `DAZI_KV`；若后台已有其它名字的 KV 空间、填了 `DAZI_KV` 却落回旧空间，代码会自动识别当前项目里实际绑定的任意 KV 命名空间（也可在 Environment variables 里加 `KV_BINDING_NAME` 强制指定）。只要有一个 KV 绑定存在即可用，无需叫特定名字。未绑定时 API 返回 `KV_NOT_BOUND`，前端提示「后端存储正在初始化」。
2. **管理员密钥**（可选，用于手动封禁）：**Settings → Environment variables** 加 `ADMIN_KEY`（任意强随机串）。然后 `POST /api/admin` 带 `{admin, target, action:'ban'|'unban'}` 即可封禁某身份。

## 防爬 / 安全说明

- 所有写接口必须带有效 token；列表接口也需 token（爬虫需先领 token，受 IP 频率限制）。
- 列表随机打散、不暴露用户 ID，仅展示信誉分。
- **建议开启 Cloudflare 免费版 Bot Fight Mode**（控制台 → 站点 → Security → Bots），在边缘拦爬虫，零代码。配合 WAF 可封异常 IP。
- 频率限制为 KV 计数器（小流量够用，非强一致）；量大可升级 Durable Objects。

## 定时清理 KV（防堆积）

所有会话级 key 都已设 `expirationTtl` 自动过期：用户 `u:` 24h、意图 `intent:` 24h、申请/收件箱 24h、搭子房间 `pair:`/`mypair:` 30min、举报 `report:` 7天。不会无限堆积。

额外两层兜底：
- **惰性清理**：每次 GET 意图列表时，顺手 `delete` 掉 `status !== 'open'` 的意图（已匹配/已关闭），不依赖定时任务也能逐步收敛。
- **每日定时清理**（`functions/__scheduled.js` 导出 `scheduled`）：主动删「已关闭/已匹配的意图」「已拒绝/已接受的申请」+ TTL 到期边缘残留的空 key。

**启用定时任务（推荐：GitHub Actions 方式，无需碰 CF 后台）**：Git 部署的 Pages 项目在 CF 仪表盘常不显示 Cron Triggers 入口，故改用仓库自带的定时工作流——`.github/workflows/kv-cleanup.yml` 每天 UTC `04:23` 自动 `POST https://ms.955827.xyz/api/cleanup`（带 `x-cleanup-key` 校验），触发与 CF Cron 完全等效的清理。密钥写在接口与 workflow 里（`CLEANUP_KEY` 环境变量可覆盖）。你也可以在 Actions 页面手动点 `Run workflow` 立即测试。

**备用：CF 后台 Cron（若你的项目能看到入口）**：`mianshi-dazi` → **Settings → Functions → Cron Triggers → Add** → 填 `23 4 * * *`，保存后会自动调用 `functions/__scheduled.js`。两种方式二选一即可，逻辑共用 `functions/_cleanup.js`。

无论哪种方式，惰性清理 + TTL 已能维持不堆积，定时任务只是让已结束的会话更早消失。

## PWA / APK

- `manifest.webmanifest` + `sw.js`：手机浏览器「添加到主屏幕」即成 App。
- `android/` 为极薄 WebView 外壳；`.github/workflows/build-apk.yml` 在 push 时自动用 GitHub Actions 编译 `app-debug.apk` 并发布到仓库 Releases（APK 分发走 GitHub Releases，避开 `.xyz` 在微信/QQ 被拦）。

## 目录结构

```
index.html            v2 互选看板（发布/浏览/邀约/房间入口/互评）
pair.html             1:1 搭子房间页（token 门禁、倒计时、举报、互评）
assets/app.js         前端逻辑
assets/style.css      样式
assets/icon-*.png     PWA / App 图标
functions/_shared.js  后端共享助手（token/限流/封禁）
functions/api/*.js    身份/意图/申请/配对/管理员 接口
manifest.webmanifest  PWA 清单
sw.js                 Service Worker（仅缓存静态壳，/api/* 走网络）
_headers              根与静态资源不缓存 + MIME
android/              WebView APK 工程
.github/workflows/    APK 自动打包
```

> 早期 `meetings`/`messages` 接口已不再被前端使用，保留为可复用的自由发布能力，新版以 `intents`/`apply`/`pair` 互选闭环为主。
