import { handle, json, runTimedChecks } from '../../server/core';
import { pushNotices } from '../../server/push';
import { processTracks, type TrackEnv } from '../../server/tracks';

// POST /api/tick → send due booking reminders and overdue notices.
// Called every 15 minutes by .github/workflows/tick.yml. Safe to call any time: each notice goes out once.
export const onRequestPost = handle(async ({ env }) => {
  const notices = await runTimedChecks(env, true);
  await pushNotices(env, notices);
  // flight paths: first try for new flight records, retries for ones OpenSky hasn't posted yet
  const tracks = await processTracks(env as TrackEnv).catch((e) => { console.log('tracks', e); return 0; });
  return json({ ok: true, sent: notices.length, tracks });
});
