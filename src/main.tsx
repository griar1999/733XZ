// Entry for the demo (Claude preview): fictional members and data on this device only.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MockApi, type KeyValueStorage } from './services/mockApi';
import { AppProvider } from './ui/context';
import { App } from './ui/App';
import { demoPages } from './ui/more';
import { DemoTools, Plan } from './ui/demoPages';

demoPages.DemoTools = DemoTools;
demoPages.Plan = Plan;

function browserStorage(): KeyValueStorage | null {
  try { const k = '__ps_probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; } catch { return null; }
}

const api = new MockApi({ storage: browserStorage(), latencyMs: 220 });
createRoot(document.getElementById('root')!).render(<React.StrictMode><AppProvider api={api}><App /></AppProvider></React.StrictMode>);
