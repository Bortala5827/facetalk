import { json, err, genId, requireToken, refreshUser, clampRep, getKV } from '../_shared.js';

const SESSION_TTL = 1800; // 单次互练软上限 30 分钟

// 配对：决定(同意/拒绝) / 状态 / 互评 / 举报
export async function onRequest(context) {
  const { request, env } = context;
  const kv = getKV(env);
  if (!kv) return err('KV_NOT_BOUND', 503);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const me = url.searchParams.get('me');
    const r = await requireToken(env, me);
    if (r.error) return err(r.error, r.status);
    const pid = await kv.get('mypair:' + r.id);
    if (!pid) return json({ ok: true, pair: null });
    const raw = await kv.get('pair:' + pid);
    if (!raw) { await kv.delete('mypair:' + r.id).catch(() => {}); return json({ ok: true, pair: null }); }
    const p = JSON.parse(raw);
    const other = r.id === p.a ? p.b : p.a;
    const oRaw = await kv.get('u:' + other);
    const otherRep = oRaw ? JSON.parse(oRaw).rep : 50;
    const rated = !!p.ratings[r.id];
    const remaining = Math.max(0, Math.floor(SESSION_TTL - (Date.now() - p.created) / 1000));
    return json({
      ok: true,
      pair: {
        pairId: p.id, otherRep, meet: p.meet, mode: p.mode, status: p.status,
        ratingsCount: Object.keys(p.ratings || {}).length, remaining, rated,
        nextAllowed: p.status === 'done' && bothNext(p) && bothPass(p),
      },
    });
  }

  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) { return err('bad_json'); }
    const r = await requireToken(env, body.me);
    if (r.error) return err(r.error, r.status);
    const action = body.action;

    if (action === 'decide') {
      const appRaw = await kv.get('app:' + body.appId);
      if (!appRaw) return err('app_gone', 404);
      const app = JSON.parse(appRaw);
      const intentRaw = await kv.get('intent:' + app.intentId);
      if (!intentRaw) return err('intent_gone', 409);
      const intent = JSON.parse(intentRaw);
      if (intent.owner !== r.id) return err('not_owner', 403);

      if (body.decision === 'accept') {
        const pairId = 'p_' + genId(12);
        const pair = { id: pairId, a: intent.owner, b: app.applicant, intentId: app.intentId, status: 'matched', meet: intent.meet || '', mode: intent.mode, created: Date.now(), ratings: {} };
        await kv.put('pair:' + pairId, JSON.stringify(pair), { expirationTtl: SESSION_TTL });
        app.status = 'accepted'; await kv.put('app:' + app.id, JSON.stringify(app), { expirationTtl: 86400 });
        intent.status = 'matched'; await kv.put('intent:' + app.intentId, JSON.stringify(intent), { expirationTtl: 86400 });
        await kv.put('mypair:' + intent.owner, pairId, { expirationTtl: SESSION_TTL });
        await kv.put('mypair:' + app.applicant, pairId, { expirationTtl: SESSION_TTL });
        return json({ ok: true, pairId });
      } else {
        app.status = 'rejected'; await kv.put('app:' + app.id, JSON.stringify(app), { expirationTtl: 86400 });
        return json({ ok: true, status: 'rejected' });
      }
    }

    if (action === 'rate') {
      const raw = await kv.get('pair:' + body.pairId);
      if (!raw) return err('pair_gone', 404);
      const p = JSON.parse(raw);
      if (r.id !== p.a && r.id !== p.b) return err('not_party', 403);
      if (p.ratings[r.id]) return err('already_rated', 409);
      const score = Math.max(1, Math.min(5, parseInt(body.score, 10) || 3));
      const tags = Array.isArray(body.tags) ? body.tags.slice(0, 5).map(String) : [];
      const next = !!body.next;
      p.ratings[r.id] = { score, tags, next, at: Date.now() };
      const other = r.id === p.a ? p.b : p.a;
      const oRaw = await kv.get('u:' + other);
      if (oRaw) {
        const o = JSON.parse(oRaw);
        o.rep = clampRep((o.rep || 50) + (score - 3));
        await refreshUser(kv, other, { rep: o.rep });
      }
      if (Object.keys(p.ratings).length >= 2) p.status = 'done';
      await kv.put('pair:' + p.id, JSON.stringify(p), { expirationTtl: SESSION_TTL });
      return json({ ok: true, done: p.status === 'done' });
    }

    if (action === 'report') {
      const raw = await kv.get('pair:' + body.pairId);
      if (!raw) return err('pair_gone', 404);
      const p = JSON.parse(raw);
      if (r.id !== p.a && r.id !== p.b) return err('not_party', 403);
      const other = r.id === p.a ? p.b : p.a;
      const cnt = parseInt((await kv.get('report:' + other)) || '0', 10) + 1;
      await kv.put('report:' + other, String(cnt), { expirationTtl: 86400 * 7 });
      let banned = false;
      if (cnt >= 3) {
        await refreshUser(kv, other, { banned: true });
        await kv.delete('mypair:' + other).catch(() => {});
        banned = true;
      }
      return json({ ok: true, banned });
    }

    return err('unknown_action', 400);
  }
  return err('method', 405);
}

function bothNext(p) { return p.ratings[p.a] && p.ratings[p.b] && p.ratings[p.a].next && p.ratings[p.b].next; }
function bothPass(p) { return p.ratings[p.a] && p.ratings[p.b] && p.ratings[p.a].score >= 3 && p.ratings[p.b].score >= 3; }
