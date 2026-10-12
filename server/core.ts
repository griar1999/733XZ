// Shared server code for the Pages Functions under functions/api. Same design as PGL.
// Storage: one Cloudflare D1 database bound as `DB`.
//   app            – the whole schedule as one JSON document with a version number (optimistic locking)
//   accounts       – sign-in code hash and last sign-in per member (roles live in the app document)
//   sessions       – signed-in phones (hash of the cookie token)
//   phones         – phone-number sign-in, one number per member
//   photos         – issue and aircraft photos, served only to signed-in members
//   meta           – server secrets generated on first run (code pepper)
//   login_attempts – recent failed sign-ins per IP, to slow down guessing
import { normalizePhone } from '../src/domain/phones';
import type { DbState, Member } from '../src/domain/types';
import { OWNER_ID, SCHEMA_VERSION, seedLive } from '../src/services/seed';

// Minimal D1 types (avoids depending on @cloudflare/workers-types)
export interface D1Result<T = unknown> { results?: T[]; meta?: { changes?: number } }
export interface D1Stmt { bind(...v: unknown[]): D1Stmt; first<T = unknown>(): Promise<T | null>; all<T = unknown>(): Promise<D1Result<T>>; run(): Promise<D1Result> }
export interface D1DB { prepare(sql: string): D1Stmt; batch(s: D1Stmt[]): Promise<D1Result[]> }

export interface Env {
  DB?: D1DB;
  ADMIN_CODE?: string;
  OWNER_NAME?: string;
}

export interface SessionInfo { memberId: string; role: Member['role']; isOwner: boolean; name: string }

export const SESSION_COOKIE = 'ps_session';
const SESSION_DAYS = 180;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) { super(message); }
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

export interface Ctx { request: Request; env: Env; params?: Record<string, string | string[]>; waitUntil?: (p: Promise<unknown>) => void }
export function handle(fn: (ctx: Ctx) => Promise<Response>) {
  return async (ctx: Ctx) => {
    try {
      if (!ctx.env.DB) return json({ error: 'The PlaneShare database is not connected yet. The admin needs to finish setup in Cloudflare.' }, 503);
      sameOrigin(ctx.request);
      await ensureSchema(ctx.env.DB);
      return await fn(ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, code: e.code, details: e.details }, e.status);
      console.log('server error', (e as Error).stack || e);
      return json({ error: 'Something went wrong on the server. Nothing was saved. Try again.' }, 500);
    }
  };
}

function sameOrigin(request: Request) {
  if (request.method === 'GET') return;
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) throw new HttpError(403, 'Not allowed.');
}

const nowIso = () => new Date().toISOString();

// ---------- schema ----------
let schemaReady = false;
export async function ensureSchema(db: D1DB) {
  if (schemaReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS app (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS accounts (member_id TEXT PRIMARY KEY, code_hash TEXT UNIQUE, code_created_at TEXT, last_login TEXT)'),
    db.prepare('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)'),
    db.prepare('CREATE INDEX IF NOT EXISTS sessions_member ON sessions (member_id)'),
    db.prepare('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT NOT NULL, at INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS phones (phone TEXT PRIMARY KEY, member_id TEXT NOT NULL UNIQUE, added_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL, added_by TEXT NOT NULL, added_at TEXT NOT NULL)'),
    // daily copies of the app document, kept 60 days (on top of D1's own 30-day Time Travel)
    db.prepare('CREATE TABLE IF NOT EXISTS snapshots (day TEXT PRIMARY KEY, state TEXT NOT NULL, version INTEGER NOT NULL)'),
  ]);
  schemaReady = true;
}

// ---------- crypto helpers ----------
export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function randomToken(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function newCode(): string {
  let out = '';
  while (out.length < 8) {
    for (const x of crypto.getRandomValues(new Uint8Array(16))) {
      if (x < 248 && out.length < 8) out += CODE_ALPHABET[x % 31]; // 248 = 31*8, avoids bias
    }
  }
  return out;
}
export const normalizeCode = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);

async function pepper(db: D1DB): Promise<string> {
  const row = await db.prepare("SELECT value FROM meta WHERE key = 'pepper'").first<{ value: string }>();
  if (row) return row.value;
  await db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('pepper', ?)").bind(randomToken(32)).run();
  return (await db.prepare("SELECT value FROM meta WHERE key = 'pepper'").first<{ value: string }>())!.value;
}
export const codeHash = async (db: D1DB, code: string) => sha256(`${await pepper(db)}:${normalizeCode(code)}`);

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- app document ----------
export async function loadApp(env: Env): Promise<{ state: DbState; version: number }> {
  const db = env.DB!;
  const row = await db.prepare('SELECT state, version FROM app WHERE id = 1').first<{ state: string; version: number }>();
  if (row) {
    const state = JSON.parse(row.state) as DbState;
    if (state.schemaVersion !== SCHEMA_VERSION) throw new HttpError(500, 'The saved data is from a different app version. The admin needs to run an upgrade.');
    return { state, version: row.version };
  }
  const state = seedLive(Date.now(), env.OWNER_NAME);
  await db.prepare('INSERT OR IGNORE INTO app (id, state, version, updated_at) VALUES (1, ?, 1, ?)').bind(JSON.stringify(state), nowIso()).run();
  return loadApp(env);
}

/**
 * Apply a change with optimistic locking. The change re-runs against the latest saved state,
 * so its checks (overlaps, permissions, meter readings) always see what is really saved.
 * If someone else saved in between, the version no longer matches and we start over.
 */
export async function updateApp<R>(env: Env, change: (s: DbState) => { state: DbState; result: R }): Promise<{ state: DbState; version: number; result: R }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { state, version } = await loadApp(env);
    const out = change(state);
    const body = JSON.stringify(out.state);
    if (body.length > 1_800_000) throw new HttpError(507, 'The schedule data is too large to save. Ask the admin to clear out old photos.');
    const r = await env.DB!.prepare('UPDATE app SET state = ?, version = version + 1, updated_at = ? WHERE id = 1 AND version = ?')
      .bind(body, nowIso(), version).run();
    if ((r.meta?.changes ?? 0) === 1) {
      await snapshotDaily(env, out.state, version + 1).catch(() => undefined);
      return { state: out.state, version: version + 1, result: out.result };
    }
  }
  throw new HttpError(409, 'Someone else saved at the same moment. Try again.', 'conflict');
}

function todayPacific(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
async function snapshotDaily(env: Env, state: DbState, version: number) {
  const day = todayPacific();
  const db = env.DB!;
  const r = await db.prepare('INSERT OR IGNORE INTO snapshots (day, state, version) VALUES (?, ?, ?)').bind(day, JSON.stringify(state), version).run();
  if ((r.meta?.changes ?? 0) === 1) {
    const cutoff = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    await db.prepare('DELETE FROM snapshots WHERE day < ?').bind(cutoff).run();
  }
}

// ---------- sessions ----------
function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function memberInfo(state: DbState, memberId: string): SessionInfo | null {
  const m = state.members.find((x) => x.id === memberId);
  if (!m || !m.active) return null;
  return { memberId: m.id, role: m.role, isOwner: m.id === OWNER_ID, name: m.name };
}

export async function getSession(request: Request, env: Env): Promise<SessionInfo | null> {
  const token = cookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB!.prepare('SELECT member_id AS memberId FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await sha256(token), nowIso()).first<{ memberId: string }>();
  if (!row) return null;
  const { state } = await loadApp(env);
  return memberInfo(state, row.memberId); // deactivated members are signed out everywhere
}

export async function requireSession(request: Request, env: Env, needAdmin = false): Promise<SessionInfo> {
  const s = await getSession(request, env);
  if (!s) throw new HttpError(401, 'Please sign in.', 'auth');
  if (needAdmin && s.role !== 'admin') throw new HttpError(403, 'Only an admin can do that.', 'forbidden');
  return s;
}

export async function startSession(env: Env, memberId: string): Promise<string> {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  const db = env.DB!;
  await db.batch([
    db.prepare('INSERT INTO sessions (token_hash, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(token), memberId, nowIso(), expires),
    db.prepare('INSERT INTO accounts (member_id, last_login) VALUES (?, ?) ON CONFLICT(member_id) DO UPDATE SET last_login = excluded.last_login').bind(memberId, nowIso()),
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso()),
  ]);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}
export const clearCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// ---------- sign-in ----------
const WINDOW_MS = 10 * 60_000;
const MAX_FAILS = 10;

export async function signIn(request: Request, env: Env, raw: unknown): Promise<string> {
  const db = env.DB!;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const since = Date.now() - WINDOW_MS;
  const fails = await db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > ?').bind(ip, since).first<{ n: number }>();
  if ((fails?.n ?? 0) >= MAX_FAILS) throw new HttpError(429, 'Too many tries. Wait 10 minutes and try again.');
  const code = normalizeCode(raw);
  const fail = async (msg = "That didn't work. Check your phone number and try again, or ask the admin to add it."): Promise<never> => {
    await db.batch([
      db.prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)').bind(ip, Date.now()),
      db.prepare('DELETE FROM login_attempts WHERE at < ?').bind(since),
    ]);
    throw new HttpError(401, msg);
  };
  if (code.length < 8) return fail();

  const { state } = await loadApp(env); // creates the app and owner on first run
  const active = (id: string) => !!memberInfo(state, id);

  // The admin code (a secret in Cloudflare) always signs in as the owner.
  const admin = normalizeCode(env.ADMIN_CODE);
  if (admin.length >= 8 && safeEqual(code, admin)) return OWNER_ID;

  // A phone number the admin added signs in as that member.
  const phone = /^\d+$/.test(code) ? normalizePhone(code) : null;
  if (phone) {
    const p = await db.prepare('SELECT member_id AS memberId FROM phones WHERE phone = ?').bind(phone).first<{ memberId: string }>();
    if (p && active(p.memberId)) return p.memberId;
    return fail();
  }
  const row = await db.prepare('SELECT member_id AS memberId FROM accounts WHERE code_hash = ?').bind(await codeHash(db, code)).first<{ memberId: string }>();
  if (row && active(row.memberId)) return row.memberId;
  if (admin.length < 8) {
    return fail(env.ADMIN_CODE
      ? "That didn't work. (Setup: the ADMIN_CODE saved in Cloudflare has fewer than 8 letters and numbers.)"
      : "That didn't work. (Setup: this site can't see an ADMIN_CODE yet. Check it's saved on the Pages project for Production, then redeploy.)");
  }
  return fail("That code didn't work. Check it and try again, or ask the admin for a new one.");
}

export async function readJson<T>(request: Request): Promise<T> {
  try { return (await request.json()) as T; } catch { throw new HttpError(400, 'Bad request.'); }
}

/** Members see everyone's names; only admins see emails. */
export function visibleState(state: DbState, s: SessionInfo): DbState {
  if (s.role === 'admin') return state;
  return { ...state, members: state.members.map((m) => ({ ...m, email: m.id === s.memberId ? m.email : '' })) };
}

// ---------- photos ----------
const DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

/** Move any photo data in an action's arguments into the photos table; the app document keeps only a link. */
export async function storePhotos(env: Env, args: unknown, memberId: string): Promise<unknown> {
  if (typeof args === 'string') {
    const m = DATA_URL.exec(args);
    if (!m) return args;
    if (args.length > 1_500_000) throw new HttpError(400, 'That photo is too large. Try a smaller image.', 'validation');
    const id = randomToken(16);
    await env.DB!.prepare('INSERT INTO photos (id, mime, data, added_by, added_at) VALUES (?, ?, ?, ?, ?)').bind(id, m[1], m[2], memberId, nowIso()).run();
    return `/api/photo/${id}`;
  }
  if (Array.isArray(args)) return Promise.all(args.map((a) => storePhotos(env, a, memberId)));
  if (args && typeof args === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) out[k] = await storePhotos(env, v, memberId);
    return out;
  }
  return args;
}
