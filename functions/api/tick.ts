import { handle, json, runTimedChecks } from '../../server/core';
import { pushNotices } from '../../server/push';

// POST /api/tick → send due booking reminders and overdue notices.
// Called every 15 minutes by .github/workflows/tick.yml. Safe to call any time: each notice goes out once.
export const onRequestPost = handle(async ({ env }) => {
  const notices = await runTimedChecks(env, true);
  await pushNotices(env, notices);
  return json({ ok: true, sent: notices.length });
});
