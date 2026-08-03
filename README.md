# 面试搭子 · 面试匹配系统

发一间**腾讯会议室**，或留句话找同伴。按岗位 / 城市匹配，点开就能一键跳到腾讯会议 App 连麦互练。免费、免登录、匿名发布，数据用 Cloudflare KV 暂存。

## 当前形态（v2 · KV 后端）

- **共享看板**（不再是每人一条私密链接）：所有人发布的腾讯会议室 + 留言实时可见
- 后端：**Cloudflare Pages Functions + KV**，零服务器、免费额度够用
  - `POST /api/meetings` 发布腾讯会议室（链接或 9–11 位会议号）→ 自动归一化为 `https://meeting.tencent.com/p/<id>` 深链，手机点击直接拉起腾讯会议 App
  - `POST /api/messages` 发布留言（自由文本，可说明飞书等其它组队方式），**保留 3 天**
  - `GET /api/meetings`、`GET /api/messages` 取列表，前端每 20 秒自动刷新
  - 会议室 24 小时自动过期；留言 3 天自动过期（KV `expirationTtl`）
- 仅支持**腾讯会议**作为结构化入会入口；飞书 / Zoom 等在留言板自由说明
- 防刷：每 IP 每分钟最多 10 次提交；输入做了长度上限与 HTML 转义
- `?role=` / `?from=` 模块化深链参数保留（辅警 / 消防 / Hub 站可直接调起）

## ⚠️ 部署必做：绑定 KV 命名空间

本机无 Cloudflare 凭证，无法用 API 建绑定。代码里引用的是变量名 **`DAZI_KV`**，需你在 CF 控制台手动加一次：

1. 登录 Cloudflare → 左侧 **Workers & Pages** → 选 `mianshi-dazi` 项目 → **Settings → Functions → KV namespace bindings**
2. 点 **Add binding**，Variable name 填 `DAZI_KV`，再 **Create namespace**（随便起名，如 `mianshi-dazi`）
3. 保存。Functions 在下次请求时即生效（API 未绑定时会返回 `KV_NOT_BOUND`，前端提示「后端存储正在初始化」）

> 自定义域可选：`ms.955827.xyz` 已在用；也可绑 `mianshi.955827.xyz`（Settings → Custom domains）。

## 目录结构

```
index.html            面试搭子看板（发布 + 列表）
match.html            历史链接重定向到 /
assets/app.js         前端逻辑（提交 / 渲染 / 自动刷新 / 复制）
assets/style.css      样式
functions/api/meetings.js  会议室接口（GET/POST）
functions/api/messages.js  留言接口（GET/POST）
_headers             根与静态资源不缓存
```

## 模块化调用（深链参数）

| 参数 | 取值 | 作用 |
| --- | --- | --- |
| `?role=` | `辅警` / `消防员` / `公务员` / `教师` / `其他` | 预选岗位下拉框（`消防`→`消防员`、`警察`/`公安`→`辅警` 自动归一） |
| `?from=` | `hub` / `fj` / `xf` | 顶栏显示「返回 RCJ Hub / 辅警站 / 消防站」 |

示例：
- 辅警站入口：`https://ms.955827.xyz/?role=辅警&from=fj`
- 消防站入口：`https://ms.955827.xyz/?role=消防员&from=xf`

## 相关站点矩阵（RCJ 模块化架构）

- `rcj-hub`（`955827.xyz`）—— RCJ 品牌枢纽，展示并跳转本模块
- `rcj-exam-bank`（`exam.955827.xyz`）—— 综合公职真题库
- `aux-police-exam`（`fj.rcj9527.dpdns.org`）—— 辅警刷题站
- `xf-firefighter-exam`（`xf.955827.xyz`）—— 消防员题库

> 本仓库是「面试搭子」独立模块：辅警 / 消防 / 公考的面试对练统一调它，各站无需重复造轮子。
