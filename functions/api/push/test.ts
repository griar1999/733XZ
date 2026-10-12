import { handle, json, requireSession } from '../../../server/core';
import { getVapid, sendPush, type Sub } from '../../../server/push';

// POST /api/push/test → sends "Notifications are on" to the signed-in member's phones
export const onRequestPost = handle(async ({ request, env }) => {
  const me = await requireSession(request, env);
  const rows = await env.DB!.prepare('SELECT endpoint, p256dh, auth, member_id AS memberId FROM push_subs WHERE member_id = ?').bind(me.memberId).all<Sub>();
  const v = await getVapid(env.DB!);
  let sent = 0;
  for (const sub of rows.results ?? []) {
    try {
      if (await sendPush(sub, v, { title: 'PlaneShare', body: "Notifications are on. You'll hear about bookings, cancellations and groundings here.", url: '/' })) sent++;
      else await env.DB!.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(sub.endpoint).run();
    } catch (e) { console.log('push test', (e as Error).message); }
  }
  return json({ sent });
});
