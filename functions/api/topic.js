// Late Talk 话题生成：转发到主站全局 AI 网关
// POST /api/topic -> { topic: "..." }
// 失败时前端回退本地题库

const AI_GATEWAY = 'https://955827.xyz/api/ai-chat';

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method' }), { status: 405, headers: { 'content-type': 'application/json' } });
  }

  try {
    const resp = await fetch(AI_GATEWAY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scene: 'talk',
        messages: [{ role: 'user', content: '请随机生成一个适合两个陌生人深夜匿名语音聊天的话题（一句话问题，15-30字，有思辨性但不沉重，不涉及政治/宗教/性/自残）。直接输出话题本身，不要解释，不要引号。' }],
      }),
    });
    const data = await resp.json().catch(() => ({}));
    // 主站网关返回格式：{ reply: "..." } 或 { content: "..." }
    const topic = (data.reply || data.content || data.message || '').toString().trim().slice(0, 60);
    if (!topic) return new Response(JSON.stringify({ ok: false, error: 'empty' }), { status: 502 });
    return new Response(JSON.stringify({ ok: true, topic }), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 502 });
  }
}
