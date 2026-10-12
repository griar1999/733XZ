// Time zone helpers built on Intl only (no library). Everything is stored in UTC;
// wall-clock times are always interpreted in the aircraft base time zone.

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface LocalParts { date: string; time: string; y: number; m: number; d: number; hh: number; mm: number; weekday: string }

export function toLocalParts(utc: string | number, tz: string): LocalParts {
  const ms = typeof utc === 'number' ? utc : Date.parse(utc);
  const p: Record<string, string> = {};
  for (const x of partsFormatter(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  const y = +p.year, m = +p.month, d = +p.day, hh = +p.hour % 24, mm = +p.minute;
  return {
    y, m, d, hh, mm, weekday: p.weekday,
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${String(hh).padStart(2, '0')}:${p.minute}`,
  };
}

/** Offset of tz from UTC at the given instant, in minutes (PDT = -420). */
export function offsetMinutes(ms: number, tz: string): number {
  const p = toLocalParts(ms, tz);
  const sec = new Date(ms).getUTCSeconds();
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, sec);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

export type LocalToUtcResult =
  | { ok: true; utc: string; ambiguous: boolean }
  | { ok: false; error: string };

/**
 * Convert a wall-clock date/time in tz to a UTC ISO string.
 * Spring-forward gaps are rejected. Fall-back repeats resolve to the first occurrence
 * (daylight time) and report ambiguous=true so the UI can say so.
 */
export function localToUtc(date: string, time: string, tz: string): LocalToUtcResult {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return { ok: false, error: 'Enter a valid date and time.' };
  const wall = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
  const candidates = new Set<number>();
  for (const probe of [wall - 14 * 3600e3, wall, wall + 14 * 3600e3]) {
    candidates.add(wall - offsetMinutes(probe, tz) * 60000);
  }
  const matches = [...candidates].filter((t) => {
    const p = toLocalParts(t, tz);
    return p.date === date && p.time === time;
  }).sort((a, b) => a - b);
  if (matches.length === 0) {
    return { ok: false, error: `${time} on ${date} does not exist in this time zone (clocks spring forward). Pick a later time.` };
  }
  return { ok: true, utc: new Date(matches[0]).toISOString(), ambiguous: matches.length > 1 };
}

export function tzAbbrev(utc: string | number, tz: string): string {
  const ms = typeof utc === 'number' ? utc : Date.parse(utc);
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(ms));
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz;
  } catch { return tz; }
}

export function fmtTime(utc: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(utc));
}
export function fmtDate(utc: string, tz: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(new Date(utc));
}
export function fmtDateTime(utc: string, tz: string): string {
  return `${fmtDate(utc, tz)}, ${fmtTime(utc, tz)} ${tzAbbrev(utc, tz)}`;
}
/** "Sat, Oct 17, 9:00 AM – 1:00 PM PDT" or a two-date range for overnight bookings. */
export function fmtRange(startUtc: string, endUtc: string, tz: string): string {
  const s = toLocalParts(startUtc, tz), e = toLocalParts(endUtc, tz);
  const sa = tzAbbrev(startUtc, tz), ea = tzAbbrev(endUtc, tz);
  if (s.date === e.date) return `${fmtDate(startUtc, tz)}, ${fmtTime(startUtc, tz)} – ${fmtTime(endUtc, tz)} ${ea}`;
  return `${fmtDate(startUtc, tz)}, ${fmtTime(startUtc, tz)}${sa !== ea ? ' ' + sa : ''} – ${fmtDate(endUtc, tz)}, ${fmtTime(endUtc, tz)} ${ea}`;
}

/** Plain calendar-date arithmetic on YYYY-MM-DD strings. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
/** UTC instants bounding a local calendar day (handles 23h and 25h days). */
export function localDayBounds(date: string, tz: string): { start: string; end: string } {
  const s = localToUtc(date, '00:00', tz);
  const e = localToUtc(addDays(date, 1), '00:00', tz);
  // Midnight always exists in the zones we support; fall back to +24h if not.
  const start = s.ok ? s.utc : new Date(Date.parse(date + 'T00:00:00Z')).toISOString();
  const end = e.ok ? e.utc : new Date(Date.parse(start) + 864e5).toISOString();
  return { start, end };
}
export function minutesBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 60000);
}
export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

export const TIME_ZONES = [
  'America/Los_Angeles', 'America/Phoenix', 'America/Denver', 'America/Chicago',
  'America/New_York', 'America/Anchorage', 'Pacific/Honolulu', 'UTC',
];
