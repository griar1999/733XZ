import { handle, json, loadApp, requireSession } from '../../../server/core';

// GET /api/admin/accounts → sign-in status for every member (admins only)
export const onRequestGet = handle(async ({ request, env }) => {
  await requireSession(request, env, true);
  const { state } = await loadApp(env);
  const rows = await env.DB!.prepare('SELECT member_id AS memberId, code_hash IS NOT NULL AS hasCode, last_login AS lastLogin FROM accounts')
    .all<{ memberId: string; hasCode: number; lastLogin: string | null }>();
  const byId = new Map((rows.results ?? []).map((r) => [r.memberId, r]));
  const ph = await env.DB!.prepare('SELECT member_id AS memberId, phone FROM phones').all<{ memberId: string; phone: string }>();
  const phoneOf = new Map((ph.results ?? []).map((r) => [r.memberId, r.phone]));
  const accounts = state.members.filter((m) => !m.removed).map((m) => {
    const r = byId.get(m.id);
    return { memberId: m.id, hasCode: !!r?.hasCode || (m.id === 'owner' && !!env.ADMIN_CODE), lastLogin: r?.lastLogin ?? null, phone: phoneOf.get(m.id) ?? null };
  });
  return json({ accounts });
});
