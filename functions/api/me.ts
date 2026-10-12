import { handle, json, requireSession } from '../../server/core';

// GET /api/me → who is signed in on this phone
export const onRequestGet = handle(async ({ request, env }) => {
  const me = await requireSession(request, env);
  return json({ me });
});
