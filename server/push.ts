// Web Push (phone notifications) with no outside service and no secrets to set up:
// the server makes its own VAPID key pair on first use and keeps it in the database.
// Messages are encrypted for each phone (RFC 8291, aes128gcm) and signed (RFC 8292).
import type { D1DB, Env } from './core';
import type { PhoneNotice } from '../src/domain/notices';

const enc = new TextEncoder();
export const b64u = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64u = (s: string) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

export interface Vapid { publicKey: string; privateJwk: JsonWebKey }

export async function getVapid(db: D1DB): Promise<Vapid> {
  const row = await db.prepare("SELECT value FROM meta WHERE key = 'vapid'").first<{ value: string }>();
  if (row) return JSON.parse(row.value) as Vapid;
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const v: Vapid = { publicKey: b64u(await crypto.subtle.exportKey('raw', kp.publicKey) as ArrayBuffer), privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey) as JsonWebKey };
  await db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('vapid', ?)").bind(JSON.stringify(v)).run();
  const again = await db.prepare("SELECT value FROM meta WHERE key = 'vapid'").first<{ value: string }>();
  return JSON.parse(again!.value) as Vapid; // whoever won the race
}

async function vapidAuth(endpoint: string, v: Vapid): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:admin@riarinc.com' })));
  const key = await crypto.subtle.importKey('jwk', v.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${v.publicKey}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

/** Encrypt a payload for one subscription (aes128gcm content coding). */
export async function encryptPayload(p256dh: string, auth: string, payload: Uint8Array, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  const as = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as EcdhKeyDeriveParams, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export interface Sub { endpoint: string; p256dh: string; auth: string; memberId: string }

/** Send one message. Returns false when the phone has unsubscribed (the row should be removed). */
export async function sendPush(sub: Sub, v: Vapid, msg: { title: string; body: string; url: string; tag?: string }): Promise<boolean> {
  const body = await encryptPayload(sub.p256dh, sub.auth, enc.encode(JSON.stringify(msg)));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { TTL: '86400', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: await vapidAuth(sub.endpoint, v) },
    body,
  });
  if (res.status === 404 || res.status === 410) return false;
  if (!res.ok) console.log('push failed', res.status, await res.text().catch(() => ''));
  return true;
}

/** Push notices to each recipient's phones. Runs after the response is sent. */
export async function pushNotices(env: Env, notices: PhoneNotice[]) {
  if (!notices.length || !env.DB) return;
  const db = env.DB;
  const ids = [...new Set(notices.flatMap((n) => n.to))];
  if (!ids.length) return;
  const rows = await db.prepare(`SELECT endpoint, p256dh, auth, member_id AS memberId FROM push_subs WHERE member_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<Sub>();
  const subs = rows.results ?? [];
  if (!subs.length) return;
  const v = await getVapid(db);
  let sent = 0;
  for (const n of notices) {
    for (const sub of subs.filter((x) => n.to.includes(x.memberId))) {
      if (sent++ >= 40) return; // stay well inside the per-request limit
      try {
        const ok = await sendPush(sub, v, { title: n.title, body: n.body, url: n.url, tag: n.tag });
        if (!ok) await db.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(sub.endpoint).run();
      } catch (e) { console.log('push error', (e as Error).message); }
    }
  }
}
