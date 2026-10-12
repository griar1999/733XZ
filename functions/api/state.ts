import { handle, json, loadApp, requireSession, visibleState } from '../../server/core';

// GET /api/state → the whole schedule (signed-in members only)
export const onRequestGet = handle(async ({ request, env }) => {
  const s = await requireSession(request, env);
  const { state, version } = await loadApp(env);
  return json({ state: visibleState(state, s), version, now: new Date().toISOString() });
});
