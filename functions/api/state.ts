import { handle, json, loadApp, requireSession, runTimedChecks, visibleState } from '../../server/core';
import { pushNotices } from '../../server/push';

// GET /api/state → the whole schedule (signed-in members only)
export const onRequestGet = handle(async ({ request, env, waitUntil }) => {
  const s = await requireSession(request, env);
  const { state, version } = await loadApp(env);
  // Opportunistic: send any due reminders / overdue notices without slowing the reply.
  const later = runTimedChecks(env).then((n) => pushNotices(env, n)).catch((e) => console.log('timed', e));
  if (waitUntil) waitUntil(later);
  return json({ state: visibleState(state, s), version, now: new Date().toISOString() });
});
