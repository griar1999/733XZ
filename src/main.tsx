import React from 'react';
import { createRoot } from 'react-dom/client';
import { MockApi, type KeyValueStorage } from './services/mockApi';
import { HttpApi } from './services/httpApi';
import { IS_LIVE } from './services/buildMode';
import { AppProvider } from './ui/context';
import { App } from './ui/App';
import { LiveRoot } from './ui/live';

function browserStorage(): KeyValueStorage | null {
  try { const k = '__ps_probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; } catch { return null; }
}

const root = createRoot(document.getElementById('root')!);
if (IS_LIVE) {
  root.render(<React.StrictMode><LiveRoot api={new HttpApi()} /></React.StrictMode>);
} else {
  const api = new MockApi({ storage: browserStorage(), latencyMs: 220 });
  root.render(<React.StrictMode><AppProvider api={api}><App /></AppProvider></React.StrictMode>);
}

// Offline support + installability. Only on the real site (https, top-level), not in previews.
if ('serviceWorker' in navigator && location.protocol === 'https:' && window.top === window) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* not critical */ }); });
}
