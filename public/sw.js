// Network-first service worker: always try the latest version, fall back to the cached copy offline.
// Schedule data and sign-in (/api/) always go straight to the server and are never cached here;
// the app keeps its own clearly-labeled read-only copy for offline viewing.
const CACHE = 'planeshare-v8';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(req)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); return res; })
      .catch(() => caches.match(req).then((r) => r || caches.match('/')))
  );
});

// Phone notifications: show the message, and open the right screen when it's tapped.
self.addEventListener('push', (e) => {
  let msg = { title: '733XZ', body: 'Something changed on the schedule.', url: '/' };
  try { msg = { ...msg, ...e.data.json() }; } catch { /* plain or empty message */ }
  e.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body, icon: '/icon-192.png', badge: '/icon-192.png', tag: msg.tag, data: { url: msg.url },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        try { await w.navigate(url); } catch { w.postMessage({ type: 'open', url }); }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
