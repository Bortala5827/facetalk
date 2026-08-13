// FaceTalk v2.2 —— Cloudflare Realtime TURN 短期凭证签发
//
// 为什么要这个：
//   STUN 只能"打洞"，遇到对称 NAT（校园网 / 公司网 / 部分 4G）双方都拿不到可直连的地址，
//   P2P 必然失败。TURN 是中继兜底：数据绕一圈中继服务器，几乎 100% 能连通。
//   自建 coturn 要买有公网 IP 的 VPS 且持续吃带宽；Cloudflare Realtime TURN 每月
//   前 1000 GB 免费，纯语音一场 60 分钟双向约 36 MB，够跑两万多场，等于白嫖。
//
// 安全模型：
//   TURN Key（长期密钥）只存在 Cloudflare 环境变量里，永不下发浏览器。
//   浏览器拿到的是 TTL 到期即失效的一次性 username/credential。
//
// 部署前置（在 Cloudflare 后台做，两个环境变量）：
//   TURN_KEY_ID         —— Realtime → TURN 里创建 Key 后得到的 Key ID
//   TURN_KEY_API_TOKEN  —— 同一处得到的 API Token
//   两个变量任缺其一 → 本接口返回 configured:false，前端自动退回纯 STUN，不报错、不影响老功能。

import { json, getIp, getDB, rateLimit } from '../_shared.js';

const CF_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';

// 凭证有效期：最长一场面试 60 分钟，留足余量给续期与网络抖动
const TTL = 7200;

// 浏览器会屏蔽 53 端口，留着只会让 ICE 白等一次超时，直接滤掉
function stripPort53(iceServers) {
  return (iceServers || []).map((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    const kept = urls.filter((u) => typeof u === 'string' && u.indexOf(':53') < 0);
    return Object.assign({}, s, { urls: kept.length ? kept : urls });
  }).filter((s) => s.urls && s.urls.length);
}

export async function onRequest({ request, env }) {
  const keyId = env && env.TURN_KEY_ID;
  const token = env && env.TURN_KEY_API_TOKEN;

  // 未配置：静默降级，前端继续用内置 STUN 列表
  if (!keyId || !token) {
    return json({ configured: false, reason: 'not_configured', iceServers: [] });
  }

  // 限流：签发本身不花钱，但防止被刷着白嫖额度
  const db = getDB(env);
  if (db) {
    const ok = await rateLimit(db, 'turn:' + getIp(request), 30, 60);
    if (!ok) return json({ configured: false, reason: 'rate_limited', iceServers: [] }, 429);
  }

  try {
    const r = await fetch(`${CF_API}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: TTL }),
    });

    const text = await r.text();
    if (!r.ok) {
      // 不把 Cloudflare 的原始错误透传给浏览器（可能含账号信息），只给状态码
      return json({ configured: false, reason: 'upstream_' + r.status, iceServers: [] });
    }

    let data;
    try { data = JSON.parse(text); } catch (e) {
      return json({ configured: false, reason: 'bad_json', iceServers: [] });
    }

    const servers = stripPort53(data.iceServers);
    if (!servers.length) {
      return json({ configured: false, reason: 'empty', iceServers: [] });
    }

    return json({ configured: true, ttl: TTL, iceServers: servers });
  } catch (e) {
    return json({ configured: false, reason: 'fetch_failed', iceServers: [] });
  }
}
