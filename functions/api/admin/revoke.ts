import { handle, HttpError, json, readJson, requireSession } from '../../../server/core';

// POST /api/admin/revoke { memberId } → turns off this member's code and phone sign-in and signs them out everywhere
export const onRequestPost = handle(async ({ request, env }) => {
  const me = await requireSession(request, env, true);
  const { memberId } = await readJson<{ memberId?: string }>(request);
  if (!memberId) throw new HttpError(400, 'Bad request.');
  if (memberId === me.memberId) throw new HttpError(400, "You can't turn off your own sign-in here.");
  await env.DB!.batch([
    env.DB!.prepare('UPDATE accounts SET code_hash = NULL WHERE member_id = ?').bind(memberId),
    env.DB!.prepare('DELETE FROM sessions WHERE member_id = ?').bind(memberId),
    env.DB!.prepare('DELETE FROM phones WHERE member_id = ?').bind(memberId),
  ]);
  return json({ ok: true });
});
