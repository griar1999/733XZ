import { handle, json, loadApp, memberInfo, readJson, signIn, startSession } from '../../server/core';

// POST /api/login  { code }  (a phone number, a sign-in code, or the admin code) → sets the session cookie
export const onRequestPost = handle(async ({ request, env }) => {
  const body = await readJson<{ code?: string }>(request);
  const memberId = await signIn(request, env, body.code);
  const cookie = await startSession(env, memberId);
  const { state } = await loadApp(env);
  const me = memberInfo(state, memberId)!;
  return json({ me }, 200, { 'set-cookie': cookie });
});
