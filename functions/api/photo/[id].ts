import { handle, HttpError, requireSession } from '../../../server/core';

// GET /api/photo/:id → a stored photo (signed-in members only, never public)
export const onRequestGet = handle(async ({ request, env, params }) => {
  await requireSession(request, env);
  const id = String(params?.id ?? '');
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(id)) throw new HttpError(404, 'Photo not found.');
  const row = await env.DB!.prepare('SELECT mime, data FROM photos WHERE id = ?').bind(id).first<{ mime: string; data: string }>();
  if (!row) throw new HttpError(404, 'Photo not found.');
  const bytes = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { 'content-type': row.mime, 'cache-control': 'private, max-age=31536000, immutable' } });
});
