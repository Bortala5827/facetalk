import { json, err, genId, requireToken, rateLimit, getIp } from '../_shared.js';

// 申请组队 + 收件箱
export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.DAZI_KV;
  if (!kv) return err('KV_NOT_BOUND', 503);
  const ip = getIp(request);

  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) { return err('bad_json'); }
    const r = await requireToken(env, body.me);
    if (r.error) return err(r.error, r.status);
    if (!await rateLimit(kv, 'rl:apply:' + ip, 40, 3600)) return err('rate_limited', 429);
    if (!await rateLimit(kv, 'rl:apply:u:' + r.id, 20, 3600)) return err('too_many_applies', 429);

    const intentId = String(body.intentId || '');
    const intentRaw = await kv.get('intent:' + intentId);
    if (!intentRaw) return err('intent_gone', 409);
    const intent = JSON.parse(intentRaw);
    if (intent.status !== 'open') return err('intent_closed', 409);
    if (intent.owner === r.id) return err('self_apply', 400);

    const appId = 'a_' + genId(12);
    const app = { id: appId, intentId, applicant: r.id, status: 'pending', created: Date.now() };
    await kv.put('app:' + appId, JSON.stringify(app), { expirationTtl: 86400 });

    // owner 收件箱
    const inboxKey = 'inbox:' + intent.owner;
    const inbox = JSON.parse((await kv.get(inboxKey)) || '[]');
    inbox.push(appId);
    await kv.put(inboxKey, JSON.stringify(inbox), { expirationTtl: 86400 });
    // applicant 发出箱
    const outKey = 'out:' + r.id;
    const out = JSON.parse((await kv.get(outKey)) || '[]');
    out.push({ appId, intentId });
    await kv.put(outKey, JSON.stringify(out), { expirationTtl: 86400 });

    return json({ ok: true, appId, status: 'pending' });
  }

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const me = url.searchParams.get('me');
    const box = url.searchParams.get('box') || 'in';
    const r = await requireToken(env, me);
    if (r.error) return err(r.error, r.status);

    if (box === 'in') {
      const ids = JSON.parse((await kv.get('inbox:' + r.id)) || '[]');
      const list = [];
      for (const appId of ids) {
        const raw = await kv.get('app:' + appId);
        if (!raw) continue;
        const app = JSON.parse(raw);
        const intent = JSON.parse((await kv.get('intent:' + app.intentId)) || '{}');
        const aRaw = await kv.get('u:' + app.applicant);
        const rep = aRaw ? JSON.parse(aRaw).rep : 50;
        list.push({
          appId: app.id, status: app.status, created: app.created,
          role: intent.role, city: intent.city, mode: intent.mode, note: intent.note, rep,
        });
      }
      return json({ ok: true, list });
    } else {
      const outs = JSON.parse((await kv.get('out:' + r.id)) || '[]');
      const list = [];
      for (const o of outs) {
        const raw = await kv.get('app:' + o.appId);
        if (!raw) continue;
        const app = JSON.parse(raw);
        list.push({ appId: app.id, intentId: o.intentId, status: app.status, created: app.created });
      }
      return json({ ok: true, list });
    }
  }
  return err('method', 405);
}
