// Flight paths from the OpenSky Network (free, crowd-sourced ADS-B).
// Tracks are fetched for the time the aircraft was out on a booking, then saved here for good,
// because OpenSky only keeps tracks for 30 days.
//
// Optional secrets (Cloudflare → Settings → Variables): OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET.
// Without them requests are anonymous, which has a smaller daily allowance (and OpenSky may refuse some cloud servers).
import type { D1DB, Env } from './core';
import { loadApp } from './core';
import type { DbState, FlightRecord } from '../src/domain/types';
import { icaoFor } from '../src/domain/icao';
import { downsample, fromOpenSky, type TrackInfo, type TrackPoint } from '../src/domain/track';
import { localToUtc, addDays } from '../src/domain/time';

const API = 'https://opensky-network.org/api';
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const KEEP_DAYS = 30;            // OpenSky has nothing older than this
const RETRY_MIN = 60;            // wait between tries while a track isn't available yet
const GIVE_UP_HOURS = 72;        // stop trying after this long

export interface TrackEnv extends Env { OPENSKY_CLIENT_ID?: string; OPENSKY_CLIENT_SECRET?: string; OPENSKY_API_BASE?: string /* tests only */ }

let schemaReady = false;
async function ensureTable(db: D1DB) {
  if (schemaReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS tracks (flight_id TEXT PRIMARY KEY, status TEXT NOT NULL, points TEXT NOT NULL, legs INTEGER NOT NULL, message TEXT, tries INTEGER NOT NULL, first_try TEXT NOT NULL, last_try TEXT NOT NULL)').run();
  schemaReady = true;
}

interface Row { flight_id: string; status: TrackInfo['status']; points: string; legs: number; message: string | null; tries: number; first_try: string; last_try: string }
const toInfo = (r: Row): TrackInfo => ({ status: r.status, points: JSON.parse(r.points) as TrackPoint[], legs: r.legs, message: r.message ?? undefined, source: 'OpenSky Network', fetchedAt: r.last_try });

/** The window the aircraft was out: check-out → return, or the booked time, or the flight date's daytime. */
export function flightWindow(state: DbState, f: FlightRecord): { start: number; end: number } {
  const b = state.bookings.find((x) => x.id === f.bookingId);
  const pad = 20 * 60e3;
  if (b) {
    const start = Date.parse(b.checkedOutAt ?? b.startUtc) - pad;
    const end = Date.parse(b.returnedAt ?? b.endUtc) + pad;
    if (end > start) return { start, end };
  }
  const tz = state.settings.timeZone;
  const s = localToUtc(f.flightDate, '05:00', tz), e = localToUtc(addDays(f.flightDate, 0), '23:00', tz);
  return { start: s.ok ? Date.parse(s.utc) : Date.parse(f.flightDate), end: e.ok ? Date.parse(e.utc) : Date.parse(f.flightDate) + 86400e3 };
}

// ---------- OpenSky ----------
async function token(env: TrackEnv): Promise<string | null> {
  if (!env.OPENSKY_CLIENT_ID || !env.OPENSKY_CLIENT_SECRET) return null;
  const db = env.DB!;
  const cached = await db.prepare("SELECT value FROM meta WHERE key = 'opensky_token'").first<{ value: string }>();
  if (cached) { const t = JSON.parse(cached.value) as { v: string; exp: number }; if (t.exp > Date.now() + 60e3) return t.v; }
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.OPENSKY_CLIENT_ID, client_secret: env.OPENSKY_CLIENT_SECRET }) });
  if (!r.ok) throw new Error(`OpenSky sign-in failed (${r.status}). Check OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET.`);
  const d = await r.json() as { access_token: string; expires_in?: number };
  await db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('opensky_token', ?)").bind(JSON.stringify({ v: d.access_token, exp: Date.now() + (d.expires_in ?? 1800) * 1000 })).run();
  return d.access_token;
}

class RateLimited extends Error {}

async function trackAt(env: TrackEnv, icao: string, unix: number, auth: string | null): Promise<{ start: number; end: number; points: TrackPoint[] } | null> {
  const r = await fetch(`${env.OPENSKY_API_BASE || API}/tracks/all?icao24=${icao}&time=${unix}`, { headers: { accept: 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) } });
  if (r.status === 404 || r.status === 204) return null;
  if (r.status === 429) throw new RateLimited('OpenSky daily limit reached. Will try again later.');
  if (r.status === 401 && auth) { await env.DB!.prepare("DELETE FROM meta WHERE key = 'opensky_token'").run(); throw new Error('OpenSky sign-in expired. Will try again.'); }
  if (!r.ok) throw new Error(`OpenSky returned ${r.status}.`);
  const text = await r.text();
  if (!text.trim() || text.trim() === 'null') return null;
  const d = JSON.parse(text) as { startTime?: number; endTime?: number; path?: unknown[] };
  if (!Array.isArray(d.path) || !d.path.length) return null;
  return { start: d.startTime ?? 0, end: d.endTime ?? 0, points: fromOpenSky(d.path) };
}

/** Ask OpenSky for every track flown inside the window (touch-and-goes or stops show up as separate legs). */
async function fetchFromOpenSky(env: TrackEnv, icao: string, win: { start: number; end: number }): Promise<{ points: TrackPoint[]; legs: number }> {
  const auth = await token(env);
  const legs = new Map<number, TrackPoint[]>();
  const startS = Math.floor(win.start / 1000), endS = Math.floor(win.end / 1000);
  const step = 15 * 60;
  let calls = 0;
  for (let t = startS + 5 * 60; t <= endS && calls < 16; t += step) {
    if ([...legs.values()].some((p) => p.length && t >= p[0][0] && t <= p[p.length - 1][0])) continue; // already covered
    calls++;
    const tr = await trackAt(env, icao, t, auth);
    if (tr && tr.points.length && !legs.has(tr.start)) legs.set(tr.start, tr.points);
  }
  const points = [...legs.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, p]) => p)
    .filter((p) => p[0] >= startS - 3600 && p[0] <= endS + 3600);
  return { points: downsample(points), legs: legs.size };
}

// ---------- storage ----------
async function save(db: D1DB, id: string, info: Omit<TrackInfo, 'fetchedAt' | 'source'>, prev: Row | null) {
  const now = new Date().toISOString();
  await db.prepare('INSERT OR REPLACE INTO tracks (flight_id, status, points, legs, message, tries, first_try, last_try) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, info.status, JSON.stringify(info.points), info.legs, info.message ?? null, (prev?.tries ?? 0) + 1, prev?.first_try ?? now, now).run();
}

/** Try to get the path for one flight now. Saves the result (or that it isn't available yet). */
export async function fetchTrack(env: TrackEnv, state: DbState, f: FlightRecord, prev: Row | null): Promise<TrackInfo> {
  const db = env.DB!;
  const icao = icaoFor(state.settings);
  const win = flightWindow(state, f);
  const base = { points: [] as TrackPoint[], legs: 0 };
  if (!icao) { const i = { ...base, status: 'unavailable' as const, message: 'Set the aircraft transponder code in Settings to see flight paths.' }; await save(db, f.id, i, prev); return i; }
  if (Date.now() - win.end > KEEP_DAYS * 86400e3) { const i = { ...base, status: 'unavailable' as const, message: 'This flight is older than 30 days, so OpenSky no longer has its path.' }; await save(db, f.id, i, prev); return i; }
  try {
    const got = await fetchFromOpenSky(env, icao, win);
    if (got.points.length >= 2) { const i = { status: 'ok' as const, points: got.points, legs: got.legs }; await save(db, f.id, i, prev); return i; }
    const age = Date.now() - Date.parse(prev?.first_try ?? new Date().toISOString());
    const done = age > GIVE_UP_HOURS * 3600e3;
    const i = { ...base, status: done ? 'none' as const : 'pending' as const, message: done ? 'OpenSky has no path for this flight. The aircraft may have been out of range of ADS-B receivers.' : 'OpenSky usually posts paths within a day. The app will check again.' };
    await save(db, f.id, i, prev); return i;
  } catch (e) {
    const i = { ...base, status: 'pending' as const, message: (e as Error).message || 'Could not reach OpenSky. Will try again.' };
    await save(db, f.id, i, prev); return i;
  }
}

async function row(db: D1DB, id: string) { return db.prepare('SELECT * FROM tracks WHERE flight_id = ?').bind(id).first<Row>(); }

/** The saved path for a flight; tries OpenSky if there's nothing yet and it's time for another try. */
export async function getTrack(env: TrackEnv, flightId: string, opts: { force?: boolean; viewer?: { memberId: string; role: string } } = {}): Promise<TrackInfo | null> {
  await ensureTable(env.DB!);
  const { state } = await loadApp(env);
  const f = state.flights.find((x) => x.id === flightId);
  if (!f) return null;
  if (opts.viewer && opts.viewer.role !== 'admin' && f.pilotId !== opts.viewer.memberId) return null; // pilots see their own flights only
  const r = await row(env.DB!, flightId);
  if (r && r.status === 'ok' && !opts.force) return toInfo(r);
  if (r && !opts.force && (r.status !== 'pending' || Date.now() - Date.parse(r.last_try) < RETRY_MIN * 60e3)) return toInfo(r);
  return { ...(await fetchTrack(env, state, f, r)), source: 'OpenSky Network', fetchedAt: new Date().toISOString() };
}

/** Background: new flights get a first try, pending ones get retried. A couple per run to stay within limits. */
export async function processTracks(env: TrackEnv, limit = 2): Promise<number> {
  await ensureTable(env.DB!);
  const { state } = await loadApp(env);
  const cutoff = Date.now() - KEEP_DAYS * 86400e3;
  const recent = state.flights.filter((f) => !f.voided && Date.parse(f.createdAt) > cutoff);
  if (!recent.length) return 0;
  const rows = await env.DB!.prepare(`SELECT * FROM tracks WHERE flight_id IN (${recent.map(() => '?').join(',')})`).bind(...recent.map((f) => f.id)).all<Row>();
  const byId = new Map((rows.results ?? []).map((r) => [r.flight_id, r]));
  const due = recent.filter((f) => { const r = byId.get(f.id); return !r || (r.status === 'pending' && Date.now() - Date.parse(r.last_try) >= RETRY_MIN * 60e3); })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit);
  for (const f of due) await fetchTrack(env, state, f, byId.get(f.id) ?? null);
  return due.length;
}

export async function deleteTracks(env: Env, keepIds: Set<string>) {
  await ensureTable(env.DB!);
  const rows = await env.DB!.prepare('SELECT flight_id FROM tracks').all<{ flight_id: string }>();
  for (const r of rows.results ?? []) if (!keepIds.has(r.flight_id)) await env.DB!.prepare('DELETE FROM tracks WHERE flight_id = ?').bind(r.flight_id).run();
}
