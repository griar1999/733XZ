// Worker entry: serves the app's files and routes /api/* to the same handlers Pages Functions use.
// Lets the repo deploy either as a Cloudflare Worker (npx wrangler deploy) or as a Pages project.
import type { Env } from './core';
import { onRequestPost as login } from '../functions/api/login';
import { onRequestPost as logout } from '../functions/api/logout';
import { onRequestGet as me } from '../functions/api/me';
import { onRequestGet as state } from '../functions/api/state';
import { onRequestPost as action } from '../functions/api/action';
import { onRequestGet as photo } from '../functions/api/photo/[id]';
import { onRequestGet as accounts } from '../functions/api/admin/accounts';
import { onRequestPost as code } from '../functions/api/admin/code';
import { onRequestPost as phones } from '../functions/api/admin/phones';
import { onRequestPost as revoke } from '../functions/api/admin/revoke';

interface WorkerEnv extends Env { ASSETS: { fetch(req: Request): Promise<Response> } }
type Handler = (ctx: { request: Request; env: Env; params?: Record<string, string>; waitUntil?: (p: Promise<unknown>) => void }) => Promise<Response>;

const routes: Record<string, Record<string, Handler>> = {
  '/api/login': { POST: login },
  '/api/logout': { POST: logout },
  '/api/me': { GET: me },
  '/api/state': { GET: state },
  '/api/action': { POST: action },
  '/api/admin/accounts': { GET: accounts },
  '/api/admin/code': { POST: code },
  '/api/admin/phones': { POST: phones },
  '/api/admin/revoke': { POST: revoke },
};

const notFound = () => new Response(JSON.stringify({ error: 'Not found.' }), { status: 404, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const waitUntil = (p: Promise<unknown>) => ctx.waitUntil(p);
    const m = /^\/api\/photo\/([^/]+)$/.exec(url.pathname);
    if (m) return request.method === 'GET' ? photo({ request, env, params: { id: m[1] }, waitUntil }) : notFound();
    const h = routes[url.pathname]?.[request.method];
    if (!h) return routes[url.pathname] ? new Response(JSON.stringify({ error: 'Method not allowed.' }), { status: 405, headers: { 'content-type': 'application/json' } }) : notFound();
    return h({ request, env, waitUntil });
  },
};
