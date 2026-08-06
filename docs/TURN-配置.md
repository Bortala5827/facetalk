# 开启语音中继（TURN）—— 5 分钟手动配置

> **当前状态：未启用，且暂不打算启用。**
> Cloudflare Realtime 虽然每月 1000 GB 免费，但开通要先绑银行卡，
> 不值得为一个兜底功能去绑。代码已写好并常驻线上，`/api/turn` 返回
> `configured:false`，前端自动退回纯 STUN，功能正常、不报错。
> **哪天想开，照下面填两个环境变量 + Retry 部署即可，不用改一行代码。**
>
> 不开的代价：校园网 / 公司内网 / 双方对称 NAT 这几种场景连不通，
> 页面会提示「一方切 4G/5G 重试」或「交换腾讯会议号」；
> **转录与 AI 点评不受影响**（走本地麦克风，与 P2P 无关）。

## 为什么需要

现在的实时语音走 P2P 直连，靠 STUN「打洞」。但打洞不是万能的：

| 网络环境 | 纯 STUN 能否连通 |
|---|---|
| 家宽 / 普通 WiFi 双方 | ✅ 基本能 |
| 一方 4G/5G | 🟡 多数能 |
| 校园网 / 公司内网 | ❌ 基本不行 |
| 双方都是对称 NAT | ❌ 不行 |

失败的原因是**对称 NAT**：路由器给每个目标分配不同端口，对方拿到的地址永远是过期的，洞打不通。
这时唯一的解法是 **TURN 中继**——数据绕一圈中继服务器再转发，成功率接近 100%。

配好之后，上表最后两行会变成 ✅。

## 为什么不自建

自建 coturn 需要一台有公网 IP 的 VPS，且中继流量持续吃带宽，跟零成本原则冲突。
**Cloudflare Realtime TURN 每月前 1000 GB 免费**，而且你已经在用 Cloudflare Pages + D1，不用新增任何账号。

算笔账：纯语音单向约 40 kbps，一场 60 分钟双向中继约 **36 MB**。
1000 GB ÷ 36 MB ≈ **27000 场/月**。而且只有 P2P 打不通时才会走中继，实际用量远低于此。
**这个量级下等于永久免费。**

## 配置步骤（全部在 Cloudflare 后台点，本机不需要任何凭证）

### 1. 创建 TURN Key

1. 打开 https://dash.cloudflare.com/?to=/:account/calls
2. 左侧找到 **Realtime**（旧名 Calls）→ **TURN**
3. 点 **Create TURN Key**，名字随便填，比如 `facetalk`
4. 创建后会显示两个值，**都复制下来**：
   - **Turn Token ID**（一串 ID）
   - **API Token**（只显示一次，关掉就看不到了，务必先存好）

### 2. 填进 Pages 环境变量

1. 进 Pages 项目 **mianshi-dazi** → **Settings** → **Variables and Secrets**
2. 在 **Production** 下点 **Add**，加两条（类型选 **Secret** 更安全）：

   | 变量名 | 值 |
   |---|---|
   | `TURN_KEY_ID` | 上一步的 Turn Token ID |
   | `TURN_KEY_API_TOKEN` | 上一步的 API Token |

3. 保存

### 3. 重新部署（必须做）

环境变量改完**不会自动生效**，Functions 运行时不会热加载。

进 **Deployments** → 最新那条右侧 **⋯** → **Retry deployment**。

> 这一步跟当初配 D1 绑定是一样的坑，不 Retry 会读不到变量（表现为语音仍然连不通）。

## 验证配好没

浏览器打开：

```
https://ms.955827.xyz/api/turn
```

- 配好了 → `{"configured":true,"ttl":7200,"iceServers":[...]}`，里面有一串 `turn:turn.cloudflare.com:...` 和随机的 username/credential
- 没配好 → `{"configured":false,"reason":"not_configured","iceServers":[]}`
- 填错了 → `{"configured":false,"reason":"upstream_401"}`（Token 不对）

**没配也不影响使用**：接口返回 `configured:false` 时前端自动退回纯 STUN，功能照常，只是穿透率低一些。

## 安全说明

- TURN Key 是长期密钥，**只存在服务端环境变量里，永不下发浏览器**
- 浏览器拿到的是 **TTL 2 小时后自动失效**的一次性凭证
- 上游报错时只回状态码，不透传 Cloudflare 的原始错误正文（避免泄漏账号信息）
- 接口按 IP 限流 30 次/分钟，防止被刷额度
- 中继的是 DTLS 加密后的包，**Cloudflare 也解不开语音内容**

## 用量与费用监控

Cloudflare 后台 **Realtime** → **TURN** 里能看到实时用量（按地区/国家/城市）。
超过 1000 GB 后是 $0.05/GB。以你的场景基本不可能触及，但如果担心被刷，可以随时在后台
**吊销 Key**，前端会自动退回纯 STUN，不会白屏或报错。

## 一个已知限制

Cloudflare 的中国大陆节点不参与 Realtime 服务，境内用户会连到香港/日本/新加坡的节点。
纯语音带宽很小，延迟通常仍在可接受范围，但不如境内直连稳定。
