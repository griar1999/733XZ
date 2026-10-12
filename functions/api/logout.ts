import { clearCookie, handle, json, sha256, SESSION_COOKIE } from '../../server/core';

// POST /api/logout → ends this phone's session
export const onRequestPost = handle(async ({ request, env }) => {
  const m = (request.headers.get('cookie') || '').match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (m) await env.DB!.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(decodeURIComponent(m[1]))).run();
  return json({ ok: true }, 200, { 'set-cookie': clearCookie });
});
