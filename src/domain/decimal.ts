// Decimal-safe helpers. Meter values are integer hundredths; money is integer cents.
// No floating-point arithmetic is ever applied to stored values.

export type Parsed = { ok: true; value: number } | { ok: false; error: string };

/** Parse "1234.5" or "1234.56" into hundredths (123450 / 123456). */
export function parseHundredths(input: string, label: string): Parsed {
  const s = input.trim().replace(/,/g, '');
  if (!s) return { ok: false, error: `${label} is required.` };
  const m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return { ok: false, error: `${label} must be a positive number with up to 2 decimals, like 1234.5.` };
  const whole = parseInt(m[1], 10);
  const frac = (m[2] ?? '').padEnd(2, '0');
  return { ok: true, value: whole * 100 + parseInt(frac || '0', 10) };
}

export function fmtHundredths(h: number | null | undefined, minDecimals = 1): string {
  if (h === null || h === undefined) return '—';
  const neg = h < 0;
  const a = Math.abs(h);
  const whole = Math.floor(a / 100);
  const frac = String(a % 100).padStart(2, '0');
  const f = minDecimals === 1 && frac.endsWith('0') ? frac[0] : frac;
  return `${neg ? '-' : ''}${whole.toLocaleString('en-US')}.${f}`;
}

/** Parse "$12.34" / "12.3" / "12" into cents. */
export function parseCents(input: string, label: string): Parsed {
  const s = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!s) return { ok: false, error: `${label} is required.` };
  const m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return { ok: false, error: `${label} must be an amount like 84.50.` };
  return { ok: true, value: parseInt(m[1], 10) * 100 + parseInt((m[2] ?? '').padEnd(2, '0') || '0', 10) };
}

export function fmtMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const neg = cents < 0;
  const a = Math.abs(cents);
  return `${neg ? '-' : ''}$${Math.floor(a / 100).toLocaleString('en-US')}.${String(a % 100).padStart(2, '0')}`;
}

/** hours (hundredths) x rate (cents/hour) -> cents, rounded half up to the cent. */
export function rentalCents(hoursHundredths: number, rateCentsPerHour: number): number {
  return Math.floor((hoursHundredths * rateCentsPerHour + 50) / 100);
}
