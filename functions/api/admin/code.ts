import { codeHash, handle, HttpError, json, loadApp, newCode, readJson, requireSession } from '../../../server/core';

// POST /api/admin/code { memberId } → makes a new sign-in code (shown once). The old code and that member's other sessions stop working.
export const onRequestPost = handle(async ({ request, env }) => {
  const me = await requireSession(request, env, true);
  const { memberId } = await readJson<{ memberId?: string }>(request);
  const { state } = await loadApp(env);
  const m = state.members.find((x) => x.id === memberId && !x.removed);
  if (!m) throw new HttpError(404, 'Member not found.');
  const db = env.DB!;
  const code = newCode();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare('INSERT INTO accounts (member_id, code_hash, code_created_at) VALUES (?, ?, ?) ON CONFLICT(member_id) DO UPDATE SET code_hash = excluded.code_hash, code_created_at = excluded.code_created_at').bind(m.id, await codeHash(db, code), now),
    db.prepare('DELETE FROM sessions WHERE member_id = ? AND ? <> member_id').bind(m.id, me.memberId),
  ]);
  return json({ memberId: m.id, code });
});
