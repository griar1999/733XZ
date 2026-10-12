import { describe, expect, it } from 'vitest';
import { createECDH, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { b64u, encryptPayload, unb64u } from '../server/push';

// Decrypt the way a phone's push service would (RFC 8291), using Node's own crypto — an independent check.
function decrypt(body: Uint8Array, uaPriv: ReturnType<typeof createECDH>, uaPub: Buffer, auth: Buffer) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPub = Buffer.from(body.slice(21, 21 + idlen));
  const cipher = Buffer.from(body.slice(21 + idlen));
  const shared = uaPriv.computeSecret(asPub);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.slice(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.slice(0, cipher.length - 16)), d.final()]);
  expect(plain[plain.length - 1]).toBe(2); // last-record delimiter
  return plain.slice(0, plain.length - 1).toString('utf8');
}

describe('phone notifications', () => {
  it('encrypts a message that the phone can read', async () => {
    const ua = createECDH('prime256v1');
    const uaPub = ua.generateKeys();
    const auth = randomBytes(16);
    const msg = JSON.stringify({ title: 'N733XZ booked', body: 'Alex · Sat, Oct 17, 9:00 – 11:00 AM PDT → KSBA', url: '/#calendar' });
    const body = await encryptPayload(b64u(uaPub), b64u(auth), new TextEncoder().encode(msg));
    expect(body.length).toBeLessThan(4096);
    expect(decrypt(body, ua, uaPub, auth)).toBe(msg);
    expect(unb64u(b64u(uaPub)).length).toBe(65);
  });
});
