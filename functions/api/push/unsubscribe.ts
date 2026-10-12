import { handle, json, readJson, requireSession } from '../../../server/core';

// POST /api/push/unsubscribe { endpoint } → stop notifications on this phone
export const onRequestPost = handle(async ({ request, env }) => {
  const me = await requireSession(request, env);
  const { endpoint } = await readJson<{ endpoint?: string }>(request);
  await env.DB!.prepare('DELETE FROM push_subs WHERE endpoint = ? AND member_id = ?').bind(String(endpoint ?? ''), me.memberId).run();
  return json({ ok: true });
});
