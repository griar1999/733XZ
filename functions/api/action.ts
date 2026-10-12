import { runAction } from '../../src/services/actions';
import { ApiError, STATUS_OF } from '../../src/services/api';
import { handle, HttpError, json, noticesForChange, readJson, requireSession, runTimedChecks, storePhotos, updateApp, visibleState } from '../../server/core';
import { pushNotices } from '../../server/push';
import { deleteTracks, getTrack, type TrackEnv } from '../../server/tracks';
import type { DbState } from '../../src/domain/types';
import type { PhoneNotice } from '../../src/domain/notices';

// POST /api/action  { name, args } → runs one action as the signed-in member.
// The member comes from the session cookie, never from the request.
export const onRequestPost = handle(async ({ request, env, waitUntil }) => {
  const s = await requireSession(request, env);
  const body = await readJson<{ name?: string; args?: unknown[] }>(request);
  const name = String(body.name ?? '');
  const args = (await storePhotos(env, Array.isArray(body.args) ? body.args.slice(0, 5) : [], s.memberId)) as unknown[];
  try {
    let notices: PhoneNotice[] = [];
    const out = await updateApp(env, (state: DbState) => {
      const r = runAction(state, name, args, s.memberId, Date.now(), true);
      notices = noticesForChange(state, r.state);
      return r;
    });
    if (name === 'clearData') { await deleteOrphanPhotos(env, out.state); await deleteTracks(env, new Set(out.state.flights.map((f) => f.id))); }
    if (name === 'removeMember') {
      const id = (out.result as { removed: string }).removed;
      await env.DB!.batch([
        env.DB!.prepare('DELETE FROM phones WHERE member_id = ?').bind(id),
        env.DB!.prepare('DELETE FROM sessions WHERE member_id = ?').bind(id),
        env.DB!.prepare('DELETE FROM accounts WHERE member_id = ?').bind(id),
        env.DB!.prepare('DELETE FROM push_subs WHERE member_id = ?').bind(id),
      ]);
    }
    // phone notifications go out after the reply is sent
    const later = (async () => {
      await pushNotices(env, notices);
      await pushNotices(env, await runTimedChecks(env));
      // new flight record: first try at its flight path (OpenSky often needs a few hours; the tick retries)
      if (name === 'submitFlight') { const id = (out.result as { record?: { id: string }; replayed?: boolean } | null)?.record?.id; if (id) await getTrack(env as TrackEnv, id).catch((e) => console.log('track', e)); }
    })().catch((e) => console.log('push', e));
    if (waitUntil) waitUntil(later); else await later;
    return json({ state: visibleState(out.state, s), version: out.version, result: out.result, now: new Date().toISOString() });
  } catch (e) {
    if (e instanceof ApiError) throw new HttpError(STATUS_OF[e.code] ?? 400, e.message, e.code, e.details);
    throw e;
  }
});

async function deleteOrphanPhotos(env: Parameters<typeof updateApp>[0], state: DbState) {
  const keep = new Set<string>();
  const add = (u?: string) => { const m = /^\/api\/photo\/([A-Za-z0-9_-]+)$/.exec(u ?? ''); if (m) keep.add(m[1]); };
  state.issues.forEach((i) => add(i.photoDataUrl));
  add(state.settings.photoDataUrl);
  const rows = await env.DB!.prepare('SELECT id FROM photos').all<{ id: string }>();
  const gone = (rows.results ?? []).map((r) => r.id).filter((id) => !keep.has(id));
  for (let i = 0; i < gone.length; i += 50) {
    const part = gone.slice(i, i + 50);
    await env.DB!.prepare(`DELETE FROM photos WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).run();
  }
}
