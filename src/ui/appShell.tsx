// Web-app behavior: pull down to refresh, and the "install this app" card.
import React, { useEffect, useRef, useState } from 'react';
import { isStandalone } from '../services/buildMode';
import { disablePush, enablePush, pushLikelyOn, pushState, type PushState } from '../services/pushClient';
import { useApp } from './context';
import { Button, Icon } from './components';

const THRESHOLD = 72; // px of damped pull needed to refresh
const MAX = 120;

/**
 * Pull down from the top of any screen to reload the site (latest version + latest data).
 * Home Screen apps on iPhone have no built-in pull-to-refresh, so the app provides its own.
 */
export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<{ y: number; x: number } | null>(null);
  const active = useRef(false);
  const pullRef = useRef(0);

  useEffect(() => {
    const blocked = (t: EventTarget | null) => {
      if (document.querySelector('.modal-backdrop')) return true;
      const el = t as HTMLElement | null;
      return !!el?.closest?.('.table-wrap, .week-wrap, .segmented, input, textarea, select');
    };
    const go = () => {
      setRefreshing(true); setPull(THRESHOLD);
      try { navigator.vibrate?.(10); } catch { /* ignore */ }
      setTimeout(() => window.location.reload(), 300);
    };
    const onStart = (e: TouchEvent) => {
      if (refreshing || e.touches.length !== 1 || window.scrollY > 0 || blocked(e.target)) { start.current = null; return; }
      start.current = { y: e.touches[0].clientY, x: e.touches[0].clientX };
      active.current = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!start.current) return;
      const dy = e.touches[0].clientY - start.current.y;
      const dx = Math.abs(e.touches[0].clientX - start.current.x);
      if (!active.current) {
        if (dy <= 0 || dx > dy || window.scrollY > 0) { start.current = null; return; }
        active.current = true;
      }
      const damped = Math.min(MAX, dy * 0.5);
      pullRef.current = damped;
      setPull(damped);
      if (e.cancelable) e.preventDefault();
    };
    const onEnd = () => {
      if (!start.current || !active.current) { start.current = null; return; }
      start.current = null; active.current = false;
      if (pullRef.current >= THRESHOLD) go(); else setPull(0);
      pullRef.current = 0;
    };
    // Computers: trackpad or wheel scroll up while already at the top does the same thing.
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      if (refreshing || e.ctrlKey || window.scrollY > 0 || e.deltaY >= 0 || blocked(e.target)) return;
      const next = Math.min(MAX, pullRef.current + Math.min(40, -e.deltaY) * 0.35);
      pullRef.current = next;
      setPull(next);
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => { if (pullRef.current >= THRESHOLD) go(); else setPull(0); pullRef.current = 0; }, 220);
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      clearTimeout(wheelTimer);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [refreshing]);

  if (pull <= 0 && !refreshing) return null;
  const ready = pull >= THRESHOLD;
  return (
    <div className="ptr" style={{ transform: `translate(-50%, ${pull}px)`, opacity: Math.min(1, pull / 40) }} role="status" aria-live="polite">
      <span className="ptr-ball" style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}>
        {refreshing ? <span className="spinner" aria-hidden="true" /> : <Icon name="history" size={20} />}
      </span>
      <span className="sr-only">{refreshing ? 'Refreshing' : ready ? 'Release to refresh' : 'Pull to refresh'}</span>
    </div>
  );
}

/** Thin orange bar at the top while fresh data loads. */
export function SyncBar() {
  const { syncing } = useApp();
  return syncing ? <div className="sync-bar" aria-hidden="true" /> : null;
}

interface InstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: InstallPromptEvent | null = null;
const waiters = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallPromptEvent; waiters.forEach((f) => f()); });
}
const DISMISS_KEY = 'planeshare.install.dismissed';

/** Shown on Home until the app is installed (or dismissed). Android gets a one-tap install; iPhone gets the steps. */
export function InstallCard({ force }: { force?: boolean }) {
  const { setTab, setMore } = useApp();
  const [, bump] = useState(0);
  const [hidden, setHidden] = useState(() => { try { return !force && localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } });
  useEffect(() => { const f = () => bump((x) => x + 1); waiters.add(f); return () => { waiters.delete(f); }; }, []);
  if (isStandalone() || hidden) return null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } setHidden(true); };
  return (
    <div className="install-card" role="region" aria-label="Install the app">
      <Icon name="phone" />
      <div className="grow">
        <p><strong>Put 733XZ on your Home Screen</strong></p>
        {deferred
          ? <p className="fine">Opens full screen like a regular app, and you stay signed in.</p>
          : ios
            ? <p className="fine">In Safari, tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>.</p>
            : <p className="fine">In your browser menu, choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>}
        <div className="btn-row">
          {deferred && <Button variant="primary" onClick={async () => { const d = deferred!; deferred = null; await d.prompt(); await d.userChoice.catch(() => undefined); bump((x) => x + 1); }}>Install app</Button>}
          {!deferred && <Button onClick={() => { setTab('more'); setMore('install'); }}>Show me how</Button>}
          {!force && <Button variant="ghost" onClick={dismiss}>Not now</Button>}
        </div>
      </div>
    </div>
  );
}

// ---------------- Phone notifications ----------------
const PUSH_DISMISS = 'planeshare.push.dismissed';

/** Turn phone notifications on/off. `prompt` = the Home nudge, hidden once on or dismissed. */
export function PushToggle({ prompt = false }: { prompt?: boolean }) {
  const { toast } = useApp();
  const [st, setSt] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(() => { try { return prompt && (localStorage.getItem(PUSH_DISMISS) === '1' || pushLikelyOn()); } catch { return false; } });
  useEffect(() => { void pushState().then(setSt); }, []);
  if (!st || hidden) return null;
  if (prompt && (st === 'on' || st === 'unsupported' || st === 'blocked' || st === 'needs-install')) return null;

  const turnOn = async () => {
    setBusy(true);
    try {
      await enablePush(); setSt('on'); toast('Notifications are on. A test one is on its way.');
      if (prompt) setHidden(true); // done — the Home card goes away for good (turn off under More → Your account)
    }
    catch (e) { toast((e as Error).message, 'error'); setSt(await pushState()); }
    finally { setBusy(false); }
  };
  const turnOff = async () => {
    setBusy(true);
    try { await disablePush(); setSt('off'); toast('Notifications are off on this phone.'); } finally { setBusy(false); }
  };

  return (
    <div className="install-card" role="region" aria-label="Phone notifications">
      <Icon name="bell" />
      <div className="grow">
        {st === 'on' && <><p><strong>Notifications are on</strong></p><p className="fine">New bookings, cancellations, changes, groundings, maintenance, your booking reminders and overdue returns.</p></>}
        {st === 'off' && <><p><strong>Get notified on your phone</strong></p><p className="fine">When someone books or cancels, the aircraft is grounded, or your booking is coming up.</p></>}
        {st === 'needs-install' && <><p><strong>Notifications on iPhone</strong></p><p className="fine">First add 733XZ to your Home Screen (Share → Add to Home Screen). Open it from the icon, then turn notifications on here.</p></>}
        {st === 'blocked' && <><p><strong>Notifications are blocked</strong></p><p className="fine">Allow notifications for 733XZ in your phone or browser settings, then come back.</p></>}
        {st === 'unsupported' && <><p><strong>No notifications in this browser</strong></p><p className="fine">Use Safari on iPhone (from the Home Screen icon) or Chrome.</p></>}
        <div className="btn-row">
          {st === 'off' && <Button variant="primary" pending={busy} onClick={turnOn}>Turn on</Button>}
          {st === 'on' && !prompt && <Button pending={busy} onClick={turnOff}>Turn off on this phone</Button>}
          {prompt && <Button variant="ghost" onClick={() => { setHidden(true); try { localStorage.setItem(PUSH_DISMISS, '1'); } catch { /* ignore */ } }}>Not now</Button>}
        </div>
      </div>
    </div>
  );
}
