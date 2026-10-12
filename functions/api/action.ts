import { runAction } from '../../src/services/actions';
import { ApiError, STATUS_OF } from '../../src/services/api';
import { handle, HttpError, json, readJson, requireSession, storePhotos, updateApp, visibleState } from '../../server/core';

// POST /api/action  { name, args } → runs one action as the signed-in member.
// The member comes from the session cookie, never from the request.
export const onRequestPost = handle(async ({ request, env }) => {
  const s = await requireSession(request, env);
  const body = await readJson<{ name?: string; args?: unknown[] }>(request);
  const name = String(body.name ?? '');
  const args = (await storePhotos(env, Array.isArray(body.args) ? body.args.slice(0, 5) : [], s.memberId)) as unknown[];
  try {
    const out = await updateApp(env, (state) => runAction(state, name, args, s.memberId, Date.now(), true));
    return json({ state: visibleState(out.state, s), version: out.version, result: out.result, now: new Date().toISOString() });
  } catch (e) {
    if (e instanceof ApiError) throw new HttpError(STATUS_OF[e.code] ?? 400, e.message, e.code, e.details);
    throw e;
  }
});
