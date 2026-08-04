import { json, getKV } from '../_shared.js';
export async function onRequest(context) {
  const { request, env } = context;
  const kv = getKV(env);
  if (!kv) return json({ error: 'KV_NOT_BOUND' }, 503);
  const keys = [];
  try {
    const iter = kv.list({ prefix: 'intent:' });
    for await (const { name } of iter) {
      const raw = await kv.get(name);
      let parse = 'ok';
      try { JSON.parse(raw); } catch (e) { parse = 'BAD:' + e.message; }
      keys.push({ name, len: raw ? raw.length : 0, parse });
    }
  } catch (e) {
    return json({ error: 'list_threw', msg: e.message });
  }
  return json({ count: keys.length, keys });
}
