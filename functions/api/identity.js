import { json, err, genId, requireToken, refreshUser, getKV } from '../_shared.js';

// 匿名一次性身份：POST 发新 token；GET ?id= 取信誉/封禁状态
export async function onRequest(context) {
  const { request, env } = context;
  const kv = getKV(env);
  if (!kv) return err('KV_NOT_BOUND', 503);

  if (request.method === 'POST') {
    const id = 'u_' + genId(16);
    await kv.put('u:' + id, JSON.stringify({ banned: false, rep: 50, created: Date.now() }), { expirationTtl: 86400 });
    return json({ ok: true, id });
  }

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const r = await requireToken(env, id);
    if (r.error) return err(r.error, r.status);
    return json({ ok: true, id: r.id, rep: r.user.rep, banned: !!r.user.banned });
  }
  return err('method', 405);
}
