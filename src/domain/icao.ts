// US tail number (N-number) → 24-bit ICAO transponder address, the code ADS-B trackers use.
// Same allocation scheme the FAA uses. Example: N733XZ → a9d855.
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const SUFFIX = 1 + LETTERS.length * (1 + LETTERS.length); // 601
const B4 = 1 + LETTERS.length + 10;                        // 35
const B3 = 10 * B4 + SUFFIX;                               // 951
const B2 = 10 * B3 + SUFFIX;                               // 10111
const B1 = 10 * B2 + SUFFIX;                               // 101711

function suffixOffset(s: string): number {
  if (!s) return 0;
  let r = LETTERS.indexOf(s[0]) * (LETTERS.length + 1) + 1;
  if (s.length === 2) r += LETTERS.indexOf(s[1]) + 1;
  return r;
}

export function nNumberToIcao(tail: string): string | null {
  const t = tail.trim().toUpperCase().replace(/^N/, '');
  if (!/^[1-9][0-9]{0,4}[A-HJ-NP-Z]{0,2}$/.test(t) || t.length > 5) return null;
  let out = 0xa00001 + (Number(t[0]) - 1) * B1;
  const steps: [number, number][] = [[1, B2], [2, B3], [3, B4]];
  for (const [i, bucket] of steps) {
    if (t.length === i) return hex(out);
    if (LETTERS.includes(t[i])) { if (t.length - i > 2) return null; return hex(out + suffixOffset(t.slice(i, i + 2))); }
    out += Number(t[i]) * bucket + SUFFIX;
  }
  if (t.length === 4) return hex(out);
  if (LETTERS.includes(t[4])) return hex(out + LETTERS.indexOf(t[4]) + 1);
  return hex(out + Number(t[4]) + 1 + LETTERS.length);
}
const hex = (n: number) => n.toString(16).padStart(6, '0');

/** The transponder code to look up: the one set in Settings, otherwise worked out from the tail number. */
export function icaoFor(settings: { icao24?: string; tailNumber: string }): string | null {
  const set = (settings.icao24 ?? '').trim().toLowerCase();
  if (/^[0-9a-f]{6}$/.test(set)) return set;
  return nNumberToIcao(settings.tailNumber);
}
