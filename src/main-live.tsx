// Entry for the live site: real sign-in and shared data. No demo code or sample data.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HttpApi } from './services/httpApi';
import { LiveRoot } from './ui/live';

createRoot(document.getElementById('root')!).render(<React.StrictMode><LiveRoot api={new HttpApi()} /></React.StrictMode>);

// Installable web app + offline shell. Only on the real site (https, top-level).
if ('serviceWorker' in navigator && location.protocol === 'https:' && window.top === window) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* not critical */ }); });
}
