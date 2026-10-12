// Turning phone notifications on and off (live site only).
const unb64u = (s: string) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
};
const post = (path: string, body: unknown) =>
  fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Something went wrong.'); return d; });

export type PushState = 'unsupported' | 'needs-install' | 'blocked' | 'off' | 'on';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export async function pushState(): Promise<PushState> {
  if (isIos() && !standalone()) return 'needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  try {
    // On a fresh app launch the service worker may not be registered yet; wait for it briefly.
    const reg = (await navigator.serviceWorker.getRegistration())
      ?? (await Promise.race([navigator.serviceWorker.ready, new Promise<undefined>((r) => setTimeout(() => r(undefined), 3000))]));
    const sub = await reg?.pushManager.getSubscription();
    const on = !!sub && Notification.permission === 'granted';
    rememberOn(on);
    return on ? 'on' : 'off';
  } catch { return 'off'; }
}

const ON_KEY = 'planeshare.push.on';
function rememberOn(on: boolean) { try { if (on) localStorage.setItem(ON_KEY, '1'); else localStorage.removeItem(ON_KEY); } catch { /* ignore */ } }

/** True if notifications were turned on on this phone (or the phone already allows them). Used to keep the Home nudge away. */
export function pushLikelyOn(): boolean {
  try { if (localStorage.getItem(ON_KEY) === '1') return true; } catch { /* ignore */ }
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

export async function enablePush(): Promise<void> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this site. Turn them on in your phone settings for 733XZ.' : 'Notifications were not turned on.');
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const { key } = await fetch('/api/push/key', { credentials: 'same-origin' }).then((r) => r.json());
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(key) });
  await post('/api/push/subscribe', { subscription: sub.toJSON() });
  rememberOn(true);
  await post('/api/push/test', {}).catch(() => undefined);
}

export async function disablePush(): Promise<void> {
  rememberOn(false);
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
}
