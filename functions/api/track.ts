import { handle, HttpError, json, requireSession } from '../../server/core';
import { getTrack, type TrackEnv } from '../../server/tracks';

// GET  /api/track?flight=ID  → the saved flight path (fetches from OpenSky the first time)
// POST /api/track?flight=ID  → admin: try OpenSky again now
export const onRequestGet = handle(async ({ request, env }) => {
  const s = await requireSession(request, env);
  const id = new URL(request.url).searchParams.get('flight') ?? '';
  const t = await getTrack(env as TrackEnv, id, { viewer: s });
  if (!t) throw new HttpError(404, 'Flight record not found.');
  return json(t);
});

export const onRequestPost = handle(async ({ request, env }) => {
  await requireSession(request, env, true);
  const id = new URL(request.url).searchParams.get('flight') ?? '';
  const t = await getTrack(env as TrackEnv, id, { force: true });
  if (!t) throw new HttpError(404, 'Flight record not found.');
  return json(t);
});
