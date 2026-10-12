// Runs before every request. Sends anyone on a *.pages.dev address (including one-off
// deployment preview links) to the real address, so there is one site, one sign-in and one copy of the app.
// Set CANONICAL_HOST to "off" in Cloudflare to turn this off (for example while fixing DNS).
interface Ctx { request: Request; env: { CANONICAL_HOST?: string }; next: () => Promise<Response> }

export const onRequest = async ({ request, env, next }: Ctx): Promise<Response> => {
  const canonical = (env.CANONICAL_HOST || '733xz.riarinc.com').trim();
  const url = new URL(request.url);
  if (canonical !== 'off' && url.hostname.endsWith('.pages.dev') && url.hostname !== canonical) {
    url.protocol = 'https:'; url.hostname = canonical; url.port = '';
    return new Response(null, { status: 302, headers: { location: url.toString(), 'cache-control': 'no-store' } });
  }
  return next();
};
