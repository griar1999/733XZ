import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { DbState, Member, Booking } from '../domain/types';
import { ApiError, type PlaneShareApi } from '../services/api';
import type { HttpApi, Me } from '../services/httpApi';
import { reloadIfNewVersion } from '../services/buildMode';
import { scrollToTop } from './scroll';

export type Tab = 'home' | 'calendar' | 'bookings' | 'log' | 'more';
export type MorePage = 'menu' | 'inspections' | 'aircraft' | 'activity' | 'statements' | 'settings' | 'access' | 'install' | 'demo' | 'plan';

export type ModalState =
  | { kind: 'booking'; booking?: Booking; prefill?: { startUtc: string; endUtc: string } }
  | { kind: 'bookingDetail'; bookingId: string }
  | { kind: 'return'; bookingId: string }
  | { kind: 'flight'; bookingId?: string; afterReturn?: boolean }
  | { kind: 'flightDetail'; flightId: string }
  | { kind: 'issue' }
  | { kind: 'issueDetail'; issueId: string }
  | { kind: 'maintenance' }
  | { kind: 'maintenanceDetail'; id: string }
  | { kind: 'restriction' }
  | { kind: 'csv'; csv: string; filename: string }
  | null;

interface Toast { id: number; text: string; tone: 'success' | 'error' | 'info' }

interface Ctx {
  api: PlaneShareApi;
  live: boolean;
  /** live: refresh shared data from the server (quietly) */
  refresh: () => void;
  /** live: true when the screen shows this phone's last saved copy */
  fromCache: boolean;
  /** live: true while fresh data is loading */
  syncing: boolean;
  signOut: () => Promise<void>;
  db: DbState;
  me: Member;
  setMe: (id: string) => void;
  offline: boolean;
  tab: Tab; setTab: (t: Tab) => void;
  more: MorePage; setMore: (p: MorePage) => void;
  modal: ModalState; openModal: (m: ModalState) => void; closeModal: () => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  toasts: Toast[];
  now: number;
  tz: string;
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error('No app context');
  return c;
};

function safeGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } }

export function AppProvider({ api, liveMe, onSignOut, children }: { api: PlaneShareApi; liveMe?: Me; onSignOut?: () => Promise<void>; children: React.ReactNode }) {
  const live = api.mode === 'live';
  const db = useSyncExternalStore((fn) => api.subscribe(fn), () => api.snapshot());
  const offline = useSyncExternalStore((fn) => api.subscribe(fn), () => api.isOffline());
  const [meId, setMeId] = useState(() => safeGet('planeshare.me') ?? 'm1');
  const TABS: Tab[] = ['home', 'calendar', 'bookings', 'log', 'more'];
  const hashTab = () => { const h = (typeof location !== 'undefined' ? location.hash.replace('#', '') : '') as Tab; return TABS.includes(h) ? h : null; };
  const [tab, setTabState] = useState<Tab>(() => hashTab() ?? ((safeGet('planeshare.tab') as Tab) || 'home'));
  // a tapped notification opens /#calendar, /#log, etc.
  useEffect(() => {
    const f = () => {
      if (location.hash === '#inspections') { setTabState('more'); setMore('inspections'); history.replaceState(null, '', location.pathname); return; }
      const h = hashTab(); if (h) { setTabState(h); if (h === 'more') setMore('menu'); history.replaceState(null, '', location.pathname); }
    };
    f();
    window.addEventListener('hashchange', f);
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'open' && typeof e.data.url === 'string') { location.href = e.data.url; } };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => { window.removeEventListener('hashchange', f); navigator.serviceWorker?.removeEventListener('message', onMsg); };
  }, []);
  const [more, setMore] = useState<MorePage>('menu');
  const [modal, setModal] = useState<ModalState>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [now, setNow] = useState(() => api.nowMs());
  const tid = useRef(0);

  useEffect(() => { const t = setInterval(() => setNow(api.nowMs()), 30000); return () => clearInterval(t); }, [api]);
  useEffect(() => { setNow(api.nowMs()); }, [db, api]);

  // ---- live: keep shared data fresh (on return to the app, every minute, and when moving between tabs) ----
  const lastFetch = useRef(Date.now());
  // Every tab change and return to the app reloads: first checks for a newer version of the site
  // (and reloads the page if there is one), then pulls the latest shared data.
  const refresh = useCallback(() => {
    if (!live || Date.now() - lastFetch.current < 800) return;
    lastFetch.current = Date.now();
    void reloadIfNewVersion().then((reloading) => {
      if (reloading) return;
      return (api as HttpApi).refresh().catch(async (e) => { if (e instanceof ApiError && e.code === 'auth') await onSignOut?.(); });
    });
  }, [api, live, onSignOut]);
  useEffect(() => {
    if (!live) return;
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(onVis, 60_000);
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(t); };
  }, [live, refresh]);
  const fromCache = useSyncExternalStore((fn) => api.subscribe(fn), () => (live ? (api as HttpApi).fromCache : false));
  const syncing = useSyncExternalStore((fn) => api.subscribe(fn), () => (live ? (api as HttpApi).syncing : false));

  const me = live
    ? db.members.find((m) => m.id === liveMe?.memberId) ?? { id: liveMe?.memberId ?? '', name: liveMe?.name ?? 'Member', initials: '?', role: 'pilot' as const, active: false, email: '' }
    : db.members.find((m) => m.id === meId && m.active) ?? db.members.find((m) => m.active)!;
  useEffect(() => { if (live && !me.active && !fromCache) void onSignOut?.(); }, [live, me.active, fromCache, onSignOut]);
  const setMe = useCallback((id: string) => { if (live) return; setMeId(id); safeSet('planeshare.me', id); setModal(null); }, [live]);
  const setTab = useCallback((t: Tab) => { setTabState(t); safeSet('planeshare.tab', t); if (t === 'more') setMore('menu'); scrollToTop(); refresh(); }, [refresh]);
  const setMoreAndRefresh = useCallback((p: MorePage) => { setMore(p); scrollToTop(); refresh(); }, [refresh]);
  const signOut = useCallback(async () => { await onSignOut?.(); }, [onSignOut]);
  const toast = useCallback((text: string, tone: Toast['tone'] = 'success') => {
    const id = ++tid.current;
    setToasts((x) => [...x, { id, text, tone }]);
    setTimeout(() => setToasts((x) => x.filter((t) => t.id !== id)), 4200);
  }, []);

  const value = useMemo<Ctx>(() => ({
    api, live, refresh, fromCache, syncing, signOut, db, me, setMe, offline, tab, setTab, more, setMore: setMoreAndRefresh, modal,
    openModal: setModal, closeModal: () => setModal(null), toast, toasts, now, tz: db.settings.timeZone,
  }), [api, live, refresh, fromCache, syncing, signOut, db, me, setMe, offline, tab, setTab, more, setMoreAndRefresh, modal, toast, toasts, now]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function errText(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.';
}

/** Run an async action with pending state and error capture. */
export function useAction<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  const c = useContext(AppCtx);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useCallback(async (...a: A): Promise<R | undefined> => {
    setPending(true); setError(null);
    try { return await fn(...a); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'auth') { c?.toast('Your sign-in expired. Sign in again.', 'error'); void c?.signOut(); }
      setError(e instanceof ApiError ? e : new ApiError('validation', errText(e))); return undefined;
    }
    finally { setPending(false); }
  }, [fn]);
  return { run, pending, error, setError };
}
