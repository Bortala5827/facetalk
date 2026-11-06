// FaceTalk 话题生成（Chat 模式）：转发到主站全局 AI 网关
// POST /api/topic -> { ok:true, topic:"...", cat:"tech|eco|soc|world|work|drama|mind" }
// 失败时前端回退本地题库（index.html 里的 TOPIC_CATS）

const AI_GATEWAY = 'https://955827.xyz/api/ai-chat';

// 话题领域：社会 / 经济 / 国际 / 科技 / 职场 / 影视现实 / 思辨
// 刻意排除纯情感、纯鸡汤、纯幻想题材
const CATS = ['tech', 'eco', 'soc', 'world', 'work', 'drama', 'mind'];

const CAT_NAMES = {
  tech: '科技与 AI',
  eco: '经济与钱',
  soc: '社会现象',
  world: '国际形势（如美国大选、关税战、全球化、汇率、不同媒体的报道差异）',
  work: '职场与选择',
  drama: '影视剧里的现实议题（如《白色巨塔》《岁月》《我主沉浮》这类现实主义剧）',
  mind: '反常识思辨',
};

function pickCat() {
  return CATS[Math.floor(Math.random() * CATS.length)];
}

function buildPrompt(cat) {
  return [
    '你是匿名语音社交 App「FaceTalk」的聊天话题出题人。请生成 1 个适合两个陌生人用 60 秒语音交换观点的话题。',
    '',
    '本次话题领域（必须严格限定在这个领域内，不要偏题）：' + CAT_NAMES[cat] + '。',
    '',
    '硬性要求：',
    '1. 一句话，18-32 个汉字，以问号结尾',
    '2. 必须有明确对立的两方立场，让人一听就想站队、能立刻接话',
    '3. 具体、有现实抓手，不空泛',
    '4. 禁止纯情感、纯鸡汤、纯幻想（例如「你最后一次哭是什么时候」「如果能重来」）',
    '5. 不涉及中国国内政治、宗教、民族、色情、自残、暴力，也不对真实政治人物作评价',
    '',
    '输出格式（严格一行，不要解释、不要引号、不要编号）：',
    '领域编号|话题',
    '领域编号只能取：' + cat,
    '',
    '示例： ' + cat + '|' + (cat === 'world'
      ? '美国大选的结果，真的会改变普通中国人的生活吗？'
      : cat === 'drama'
        ? '《白色巨塔》里，财前五郎算好医生吗？'
        : 'AI 能替你干 80% 的活，你还剩下什么价值？'),
  ].join('\n');
}

function clean(s) {
  return String(s || '')
    .replace(/^[\s"'“”「」『』*]+/, '')
    .replace(/[\s"'“”「」『』*]+$/, '')
    .replace(/^\d+\s*[.、)）]\s*/, '')
    .trim()
    .slice(0, 60);
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method' }), { status: 405, headers: { 'content-type': 'application/json' } });
  }

  try {
    const cat = pickCat();
    const resp = await fetch(AI_GATEWAY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scene: 'talk',
        messages: [{ role: 'user', content: buildPrompt(cat) }],
      }),
      signal: AbortSignal.timeout(9000),
    });
    const data = await resp.json().catch(() => ({}));
    // 主站网关返回格式：{ reply: "..." } 或 { content: "..." }
    const raw = (data.reply || data.content || data.message || '').toString().trim();

    // 从后往前找形如 `world|话题` 的行，容忍模型多说了几句
    const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).reverse();
    let aiCat = '';
    let topic = '';
    for (const line of lines) {
      const m = line.match(/^(tech|eco|soc|world|work|drama|mind)\s*[|｜:：]\s*(.+)$/i);
      if (m) {
        aiCat = m[1].toLowerCase();
        topic = clean(m[2]);
        break;
      }
    }
    if (!topic && lines.length) {
      // 模型没按格式输出时，整行当话题；领域就用本次指定的
      topic = clean(lines[0]);
    }
    if (!topic) return new Response(JSON.stringify({ ok: false, error: 'empty' }), { status: 502, headers: { 'content-type': 'application/json' } });
    // 过滤模型的拒答/免责式输出（如 "I'm sorry, but I can't comply"）——不像话题就当失败，前端回退本地题库
    if (
      topic.length < 10 ||
      /sorry|can'?t\s+(comply|help|assist)|无法|抱歉|不能提供|违反/i.test(topic) ||
      !/[？?]\s*$/.test(topic)
    ) {
      return new Response(JSON.stringify({ ok: false, error: 'rejected' }), { status: 502, headers: { 'content-type': 'application/json' } });
    }
    const outCat = aiCat && CATS.indexOf(aiCat) >= 0 ? aiCat : cat;

    return new Response(JSON.stringify({ ok: true, topic, cat: outCat }), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 502, headers: { 'content-type': 'application/json' } });
  }
}
