import { json, err, getDB, getIp, rateLimit } from '../_shared.js';

// ============================================================
// FaceTalk v2.1 「自添加大模型接口」代理
// 用户在前端设置里填写自己的 API Base / Key / Model（仅存本地，服务端不落库）。
// 本函数只做「同域转发」消除浏览器 CORS 限制，并把 key 从请求体里取出来转发给厂商，
// 不在服务端保存任何 key（不写日志、不写 DB）。
//
// 两种能力：
//   type=chat       → 转发到 {base}/chat/completions（OpenAI 兼容：DeepSeek / 通义 / Moonshot / OpenAI / 本地 Ollama 等）
//   type=transcribe → 转发到 {base}/audio/transcriptions（OpenAI Whisper 兼容：OpenAI / Groq / 本地 Whisper 等）
// ============================================================

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return err('method', 405);
  const ip = getIp(request);
  // 防刷：每 IP 每分钟最多 20 次（转录/评价都是小请求）
  if (!await rateLimit(getDB(env), 'rl:llm:' + ip, 20, 60)) return err('rate_limited', 429);

  const url = new URL(request.url);
  const type = url.searchParams.get('type') || '';

  if (type === 'chat') return proxyChat(request, env);
  if (type === 'transcribe') return proxyTranscribe(request, env);
  return err('unknown_type', 400);
}

// ── 聊天补全（结构化面试评价）──
async function proxyChat(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return err('bad_json'); }
  const base = normBase(body.base);
  const key = String(body.key || '').trim();
  const model = String(body.model || '').trim();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!base) return err('missing_base', 400);
  if (!model) return err('missing_model', 400);
  if (!messages.length) return err('empty_messages', 400);

  const upstream = base + (base.endsWith('/') ? '' : '/') + 'chat/completions';
  const hdrs = { 'content-type': 'application/json' };
  if (key) hdrs['authorization'] = 'Bearer ' + key;
  try {
    const r = await fetch(upstream, {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({ model, messages, temperature: Number(body.temperature) || 0.4, stream: false }),
    });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch (e) { data = null; }
    if (!r.ok) {
      return json({ ok: false, status: r.status, error: data && (data.error && data.error.message) || txt.slice(0, 300) }, r.status);
    }
    // 透传 content（兼容 {choices:[{message:{content}}]} 或 {choices:[{text}]}）
    const choice = data && data.choices && data.choices[0];
    const content = choice ? (choice.message && choice.message.content != null ? choice.message.content : choice.text) : '';
    return json({ ok: true, content: String(content || ''), raw: data });
  } catch (e) {
    return err('upstream_error:' + (e && e.message ? e.message : 'fetch_failed'), 502);
  }
}

// ── 语音转文字（Whisper 兼容）──
async function proxyTranscribe(request, env) {
  let form;
  try { form = await request.formData(); } catch (e) { return err('bad_form'); }
  const base = normBase(form.get('base'));
  const key = String(form.get('key') || '').trim();
  const model = String(form.get('model') || '').trim();
  const file = form.get('file');
  if (!base) return err('missing_base', 400);
  if (!model) return err('missing_model', 400);
  if (!file || !file.size) return err('missing_audio', 400);
  if (file.size > 25 * 1024 * 1024) return err('audio_too_big', 413);

  const upstream = base + (base.endsWith('/') ? '' : '/') + 'audio/transcriptions';
  const fd = new FormData();
  fd.append('file', file, 'seg.webm');
  fd.append('model', model);
  fd.append('response_format', 'json');
  const hdrs = {};
  if (key) hdrs['authorization'] = 'Bearer ' + key;
  try {
    const r = await fetch(upstream, { method: 'POST', headers: hdrs, body: fd });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch (e) { data = null; }
    if (!r.ok) {
      return json({ ok: false, status: r.status, error: data && (data.error && data.error.message) || txt.slice(0, 300) }, r.status);
    }
    const text = data && (data.text != null ? data.text : '');
    return json({ ok: true, text: String(text || '').trim() });
  } catch (e) {
    return err('upstream_error:' + (e && e.message ? e.message : 'fetch_failed'), 502);
  }
}

// 标准化 base：必须是 https，去掉尾随空格
function normBase(b) {
  b = String(b || '').trim();
  if (!b) return '';
  if (!/^https:\/\//i.test(b)) return '';   // 仅允许 https，避免内网穿透/明文泄露 key
  return b.replace(/\s+/g, '');
}
