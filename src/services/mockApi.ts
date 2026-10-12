// Demo backend that runs entirely on this device. Writes go through the same action table the
// server uses, one at a time, so the demo behaves like the live app. It does NOT sync between devices.
import type { DbState } from '../domain/types';
import { ApiError, actionMethods, type PlaneShareApi } from './api';
import { runAction } from './actions';
import { SCHEMA_VERSION, seedState } from './seed';
import { ensureInspections } from '../domain/inspections';

export interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export interface MockOptions { storage?: KeyValueStorage | null; now?: () => number; latencyMs?: number; key?: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MockApi extends PlaneShareApi {}
export class MockApi {
  readonly mode = 'demo' as const;
  private state: DbState;
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private simulatedOffline = false;
  private storage: KeyValueStorage | null;
  private now: () => number;
  private latency: number;
  private key: string;
  storageAvailable = false;

  constructor(opts: MockOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.latency = opts.latencyMs ?? 0;
    this.key = opts.key ?? 'planeshare.demo';
    this.storage = opts.storage ?? null;
    this.state = this.load();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.emit());
      window.addEventListener('offline', () => this.emit());
    }
    Object.assign(this, actionMethods((name, actorId, args) => this.run(name, actorId, args)));
  }

  private load(): DbState {
    try {
      const raw = this.storage?.getItem(this.key);
      this.storageAvailable = !!this.storage;
      if (raw) {
        const parsed = JSON.parse(raw) as DbState;
        if (parsed.schemaVersion === SCHEMA_VERSION) return ensureInspections(parsed);
      }
    } catch { this.storageAvailable = false; }
    const s = seedState(this.now());
    this.persist(s);
    return s;
  }
  private persist(s: DbState) {
    try { this.storage?.setItem(this.key, JSON.stringify(s)); } catch { this.storageAvailable = false; }
  }
  private emit() { for (const l of this.listeners) l(); }
  snapshot(): DbState { return this.state; }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  isOffline(): boolean { return this.simulatedOffline || (typeof navigator !== 'undefined' && navigator.onLine === false); }
  setSimulatedOffline(v: boolean) { this.simulatedOffline = v; this.emit(); }
  nowMs(): number { return this.now(); }

  /** Serialized write: each action sees the result of the one before it. */
  private run<T>(name: string, actorId: string, args: unknown[]): Promise<T> {
    const go = async () => {
      if (this.latency) await sleep(this.latency);
      if (this.isOffline()) throw new ApiError('offline', 'You are offline. Changes are disabled until you reconnect, so nobody books from out-of-date availability.');
      const out = runAction(this.state, name, args, actorId, this.now(), false);
      this.state = out.state;
      this.persist(out.state);
      this.emit();
      return out.result as T;
    };
    const p = this.queue.then(go, go);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async resetDemo() {
    await this.queue;
    this.state = seedState(this.now());
    this.persist(this.state);
    this.emit();
  }
}
