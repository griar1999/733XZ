// Live backend: talks to the Cloudflare Pages Functions under /api.
// The server re-runs every rule (permissions, overlaps, meters) as the signed-in member and
// saves with a version check, so two phones can't both win the same slot.
import type { DbState, Member } from '../domain/types';
import { ApiError, actionMethods, type ApiErrorCode, type ApiErrorDetails, type PlaneShareApi } from './api';

export interface Me { memberId: string; name: string; role: Member['role']; isOwner: boolean }
export interface AccountRow { memberId: string; hasCode: boolean; lastLogin: string | null; phone: string | null }

const CACHE_KEY = 'planeshare.live.cache.v1';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError('offline', "Can't reach the PlaneShare server. Check your connection and try again. Nothing was saved.");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: ApiErrorCode; details?: ApiErrorDetails };
  if (!res.ok) {
    const code: ApiErrorCode = data.code ?? (res.status === 401 ? 'auth' : res.status === 403 ? 'forbidden' : res.status === 404 ? 'not_found' : 'validation');
    throw new ApiError(code, data.error || 'Something went wrong. Try again.', data.details ?? {});
  }
  return data;
}

export const auth = {
  me: () => call<{ me: Me }>('/api/me'),
  login: (code: string) => call<{ me: Me }>('/api/login', { method: 'POST', body: JSON.stringify({ code }) }),
  logout: () => call<{ ok: true }>('/api/logout', { method: 'POST' }),
  accounts: () => call<{ accounts: AccountRow[] }>('/api/admin/accounts'),
  setPhones: (entries: Array<{ memberId: string; phone: string | null }>) => call<{ ok: true; saved: number; removed: number }>('/api/admin/phones', { method: 'POST', body: JSON.stringify({ entries }) }),
  newCode: (memberId: string) => call<{ memberId: string; code: string }>('/api/admin/code', { method: 'POST', body: JSON.stringify({ memberId }) }),
  revoke: (memberId: string) => call<{ ok: true }>('/api/admin/revoke', { method: 'POST', body: JSON.stringify({ memberId }) }),
};

export interface HttpApi extends PlaneShareApi {}
export class HttpApi {
  readonly mode = 'live' as const;
  private state: DbState | null = null;
  private version = 0;
  private listeners = new Set<() => void>();
  private serverOffline = false;
  /** true when the data on screen came from this phone's cache instead of the server */
  fromCache = false;
  /** server clock minus phone clock, so overdue and check-out windows use server time */
  private skew = 0;

  constructor() {
    Object.assign(this, actionMethods((name, _actorId, args) => this.run(name, args)));
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => { this.emit(); void this.refresh().catch(() => undefined); });
      window.addEventListener('offline', () => this.emit());
    }
  }

  hasState() { return this.state !== null; }
  snapshot(): DbState {
    if (!this.state) throw new Error('Not loaded yet');
    return this.state;
  }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { for (const l of this.listeners) l(); }
  isOffline(): boolean { return this.serverOffline || (typeof navigator !== 'undefined' && navigator.onLine === false); }
  setSimulatedOffline(_v: boolean) { /* demo only */ }
  nowMs(): number { return Date.now() + this.skew; }

  private accept(state: DbState, version: number, serverNow?: string) {
    this.state = state;
    this.version = version;
    this.fromCache = false;
    this.serverOffline = false;
    if (serverNow) this.skew = Date.parse(serverNow) - Date.now();
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ state, version, at: new Date().toISOString() })); } catch { /* storage blocked */ }
    this.emit();
  }

  /** Load the latest shared data. Falls back to this phone's last copy (read-only) when offline. */
  async refresh(): Promise<void> {
    try {
      const r = await call<{ state: DbState; version: number; now: string }>('/api/state');
      this.accept(r.state, r.version, r.now);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'offline') {
        this.serverOffline = true;
        if (!this.state) this.loadCache();
        this.emit();
        if (this.state) return;
      }
      throw e;
    }
  }

  private loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const c = JSON.parse(raw) as { state: DbState; version: number };
      this.state = c.state; this.version = c.version; this.fromCache = true;
    } catch { /* nothing cached */ }
  }

  clear() {
    this.state = null; this.version = 0;
    try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
    this.emit();
  }

  private async run<T>(name: string, args: unknown[]): Promise<T> {
    if (this.isOffline()) throw new ApiError('offline', 'You are offline. Changes are disabled until you reconnect, so nobody books from out-of-date availability.');
    try {
      const r = await call<{ state: DbState; version: number; result: T; now: string }>('/api/action', { method: 'POST', body: JSON.stringify({ name, args, seen: this.version }) });
      this.accept(r.state, r.version, r.now);
      return r.result;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'offline') { this.serverOffline = true; this.emit(); }
      // A rejected change may mean someone else changed things first: show the latest.
      if (e instanceof ApiError && (e.code === 'conflict' || e.code === 'stale' || e.code === 'not_found')) void this.refresh().catch(() => undefined);
      throw e;
    }
  }

  async resetDemo() { throw new ApiError('forbidden', 'Reset is only available in the demo.'); }
}
