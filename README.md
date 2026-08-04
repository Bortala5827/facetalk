# FaceTalk · 双向互选面试搭子

双向互选的面试搭子匹配系统：**只有双方都同意，才成为搭子**。发布意图 → 别人申请 → 你同意 → 语音优先限时互练 → 结束互评。信誉风控防机构割韭菜，举报自动封禁防瞎搞。免费、匿名、免登录，数据存于 Cloudflare D1（SQLite，免费额度内）。

## 交互闭环（核心）

1. **发匿名身份**：首次打开自动领取一次性匿名 token（存 D1，信誉跨会话累积），本地也存一份，无需注册。
2. **发布意图**：选岗位 / 城市 / 模式（默认🎙语音优先）/ 选填会议链接。每人同时只有一个开放意图。
3. **浏览 + 申请**：看他人开放意图（已随机打散、不含身份 ID），点「申请组队」。
4. **双向互选**：意图 owner 收到申请 → **同意 / 拒绝**；只有**同意**才会生成 1:1 搭子房间。
5. **限时互练**：房间带 30 分钟软上限（D1 过期行）。语音优先，熟了再开摄像头；实际连麦走腾讯会议深链。
6. **互评 + 再约门槛**：结束双方互评（1–5 分 + 标签）。信誉分据此增减；**双方都打分 ≥3 且都勾选「再约」**，才解锁下一轮。单向拒绝/不评即断开。
7. **风控**：每操作过 D1 频率限制（IP + 用户维度）；被 3 人举报自动封禁；管理员可手动封禁。

## 后端（Cloudflare Pages Functions + D1）

| 接口 | 方法 | 作用 |
| --- | --- | --- |
| `/api/identity` | POST / GET | 发匿名 token / 查信誉·封禁状态 |
| `/api/intents` | POST / GET | 发布意图（语音优先）/ 浏览他人开放意图（token 门禁、随机打散） |
| `/api/apply` | POST / GET | 申请组队 / 收件箱（收到 `in`、发出 `out`） |
| `/api/pair` | POST / GET | 决定（同意→房间/拒绝）、配对状态、互评、举报 |
| `/api/admin` | POST | 手动封禁（需 `ADMIN_KEY`） |

数据表（Cloudflare D1）：`users`(身份/信誉/封禁)、`intents`(意图)、`applications`(申请)、`pairs`(配对房间+互评 JSON)、`reports`(举报)、`ratings`(互评明细)、`rate_limits`(频率限制)。

## 版本记录（v1.0 / v2.0）

### v1.0 · 双向匹配基础版（已定型）
- 发布匿名意图 → 浏览/申请 → **双向互选**（双方都同意才成搭子）；
- 房间内：文字留言板（含🔥阅后即焚）、联机信息（腾讯会议号/联系方式）、互评（1–5 分 + 标签 + 再约门槛）、举报风控、退出/互评完自动解散、搭子屏蔽；
- 信誉分跨会话累积、3 人举报自动封禁。

### v2.0 · 30 秒试音互评（代码已完成，待部署上线）
匹配成功后、决定组队**前**，先各录一段 **30–60 秒**答同一道题，互听互评：
- **强制前置**：试音没通过之前，留言板 / 联机信息一律不开放；
- **系统随机出题**：同一房间双方抽到同一道题（按 `pairId` 哈希确定性选题，零存储）；
- **双方都点「愿意组队」才解锁房间**；任一方婉拒 → 房间 60 秒后自动解散，各自去找新搭子，互不耽误；
- **阅后即焚 · 云端+本地均不留存**：录音以 base64 分片存 D1，对方一提交评价立刻物理删除；兜底 2 小时过期由每日 cleanup 强删；浏览器侧只用内存 Blob 播放，听完即 `revokeObjectURL`，不写 localStorage/IndexedDB；
- **存储友好**：单片 ≤ 48KB 避开 D1 单值上限，单段录音 ≤ ~900KB，对方最多回听 2 次；
- **降级兼容**：`voice_*` 三张表未建时，所有试音接口返回 `ready:false`，前端自动跳过整段环节，v1.0 老房间与留言板零影响（不会 500）；
- 接口：`/api/voice`（GET 状态/拉取对方录音、POST init/chunk/done/retake/review）。

## ⚠️ 部署必做：绑定 D1 + 环境变量

本机无 Cloudflare 凭证，无法用 API 建绑定。代码引用变量名 `DB`，需你在 CF 控制台手动加：

1. **建 D1 数据库并建表**：Cloudflare → **Workers & Pages** → 左侧 **D1** → **Create database**（名字随意，如 `mianshi-dazi`）。建好后进入该库 → **Console** 标签，把仓库里的 `schema.sql` 全文粘贴执行一次（建表 + 索引）。
2. **绑定到 Pages 项目**：`mianshi-dazi` → **Settings → Functions → D1 database bindings** → **Add binding**，**变量名填 `DB`**（代码优先识别 `DB`，也会自动识别项目里实际绑定的任意 D1 库）。未绑定时 API 返回 `DB_NOT_BOUND`，前端提示「后端存储正在初始化」。绑定后**必须去 Deployments 点 Retry 最新部署**（否则首次访问报 1101）。
3. **管理员密钥**（可选，用于手动封禁）：**Settings → Environment variables** 加 `ADMIN_KEY`（任意强随机串）。然后 `POST /api/admin` 带 `{admin, target, action:'ban'|'unban'}` 即可封禁某身份。

> 也可走 `wrangler d1 execute mianshi-dazi --file=schema.sql` 本地执行建表，但本机无 CF 凭证，建议直接在后台 Console 粘贴 `schema.sql` 最省事。

## 防爬 / 安全说明

- 所有写接口必须带有效 token；列表接口也需 token（爬虫需先领 token，受 IP 频率限制）。
- 列表随机打散、不暴露用户 ID，仅展示信誉分。
- **建议开启 Cloudflare 免费版 Bot Fight Mode**（控制台 → 站点 → Security → Bots），在边缘拦爬虫，零代码。配合 WAF 可封异常 IP。
- 频率限制为 D1 计数器（小流量够用，非强一致）；量大可升级 Durable Objects。

## 定时清理（防堆积）

D1 不会自动过期行，靠两层机制收敛：
- **查询即过滤**：浏览意图 / 收件箱 / 搭子房都只取 `expires > now` 的行，过期的自然看不到。
- **每日定时清理**（`functions/__scheduled.js` 导出 `scheduled`，逻辑共用 `functions/_cleanup.js`）：主动 `DELETE` 掉「已关闭/已匹配的意图」「已接受/已拒绝/过期的申请」「过期的搭子房」「7 天前的举报」「过期的频率计数」。

**启用定时任务（推荐：GitHub Actions 方式，无需碰 CF 后台）**：Git 部署的 Pages 项目在 CF 仪表盘常不显示 Cron Triggers 入口，故改用仓库自带的定时工作流——`.github/workflows/d1-cleanup.yml` 每天 UTC `04:23` 自动 `POST https://ms.955827.xyz/api/cleanup`（带 `x-cleanup-key` 校验），触发与 CF Cron 完全等效的清理。密钥写在接口与 workflow 里（`CLEANUP_KEY` 环境变量可覆盖）。你也可以在 Actions 页面手动点 `Run workflow` 立即测试。

**备用：CF 后台 Cron（若你的项目能看到入口）**：`mianshi-dazi` → **Settings → Functions → Cron Triggers → Add** → 填 `23 4 * * *`，保存后会自动调用 `functions/__scheduled.js`。两种方式二选一即可。

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
