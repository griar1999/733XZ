import { handle, HttpError, json, loadApp, readJson, requireSession } from '../../../server/core';
import { formatPhone, normalizePhone } from '../../../src/domain/phones';

// POST /api/admin/phones { entries: [{ memberId, phone | null }] } → sets (or removes) one member's phone sign-in. Admins only. No bulk imports.
export const onRequestPost = handle(async ({ request, env }) => {
  await requireSession(request, env, true);
  const { entries } = await readJson<{ entries?: Array<{ memberId?: string; phone?: string | null }> }>(request);
  if (!Array.isArray(entries) || entries.length !== 1) throw new HttpError(400, 'Add phone numbers one member at a time.');
  const { state } = await loadApp(env);
  const ids = new Set(state.members.filter((m) => !m.removed).map((m) => m.id));
  const nameOf = (id: string) => state.members.find((m) => m.id === id)?.name ?? id;
  const clean: Array<{ memberId: string; phone: string | null }> = [];
  const used = new Map<string, string>();
  for (const e of entries) {
    const memberId = String(e?.memberId ?? '');
    if (!ids.has(memberId)) throw new HttpError(400, 'Unknown member in the list.');
    const phone = e?.phone == null || e.phone === '' ? null : normalizePhone(e.phone);
    if (e?.phone && !phone) throw new HttpError(400, `${nameOf(memberId)}: "${e.phone}" isn't a 10-digit US phone number.`);
    if (phone) {
      if (used.has(phone) && used.get(phone) !== memberId) throw new HttpError(400, `${formatPhone(phone)} is listed for both ${nameOf(used.get(phone)!)} and ${nameOf(memberId)}.`);
      used.set(phone, memberId);
    }
    clean.push({ memberId, phone });
  }
  const db = env.DB!;
  const existing = await db.prepare('SELECT phone, member_id AS memberId FROM phones').all<{ phone: string; memberId: string }>();
  const changing = new Set(clean.map((c) => c.memberId));
  for (const r of existing.results ?? []) {
    const want = used.get(r.phone);
    if (want && want !== r.memberId && !changing.has(r.memberId)) throw new HttpError(400, `${formatPhone(r.phone)} already belongs to ${nameOf(r.memberId)}.`);
  }
  const now = new Date().toISOString();
  await db.batch([
    ...clean.map((c) => db.prepare('DELETE FROM phones WHERE member_id = ?').bind(c.memberId)),
    ...clean.filter((c) => c.phone).map((c) => db.prepare('INSERT INTO phones (phone, member_id, added_at) VALUES (?, ?, ?)').bind(c.phone, c.memberId, now)),
  ]);
  return json({ ok: true, saved: clean.filter((c) => c.phone).length, removed: clean.filter((c) => !c.phone).length });
});
