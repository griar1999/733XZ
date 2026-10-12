import { handle, json, requireSession } from '../../../server/core';
import { getVapid } from '../../../server/push';

// GET /api/push/key → the public key phones need to subscribe
export const onRequestGet = handle(async ({ request, env }) => {
  await requireSession(request, env);
  return json({ key: (await getVapid(env.DB!)).publicKey });
});
