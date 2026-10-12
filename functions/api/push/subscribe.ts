import { handle, HttpError, json, readJson, requireSession } from '../../../server/core';

// POST /api/push/subscribe { subscription } → this phone gets notices for the signed-in member
export const onRequestPost = handle(async ({ request, env }) => {
  const me = await requireSession(request, env);
  const { subscription } = await readJson<{ subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } }>(request);
  const ep = String(subscription?.endpoint ?? '');
  const p256dh = String(subscription?.keys?.p256dh ?? '');
  const auth = String(subscription?.keys?.auth ?? '');
  if (!/^https:\/\//.test(ep) || ep.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 60) throw new HttpError(400, "This phone can't take notifications.");
  await env.DB!.prepare('INSERT INTO push_subs (endpoint, member_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth')
    .bind(ep, me.memberId, p256dh, auth, new Date().toISOString()).run();
  return json({ ok: true });
});
