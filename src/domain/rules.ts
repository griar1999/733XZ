// Pure business rules. The mock service calls these; a production Worker should
// enforce the same rules on the server inside a single transaction.
import type { AircraftSettings, Booking, DbState, FlightInput, FlightRecord, Member, Restriction } from './types';
import { fmtHundredths, rentalCents } from './decimal';

export const BLOCKING: Booking['status'][] = ['confirmed', 'checked_out'];

export interface Conflict { kind: 'booking' | 'maintenance'; id: string; startUtc: string; endUtc: string; label: string }

/** Half-open intervals [start, end). With buffer b, a gap of at least b minutes is required. */
export function overlaps(aS: string, aE: string, bS: string, bE: string, bufferMin: number): boolean {
  const buf = bufferMin * 60000;
  return Date.parse(aS) < Date.parse(bE) + buf && Date.parse(bS) < Date.parse(aE) + buf;
}

export function findConflicts(db: Pick<DbState, 'bookings' | 'maintenance' | 'members'>, startUtc: string, endUtc: string, bufferMin: number, excludeBookingId?: string): Conflict[] {
  const out: Conflict[] = [];
  for (const b of db.bookings) {
    if (b.id === excludeBookingId || !BLOCKING.includes(b.status)) continue;
    if (overlaps(startUtc, endUtc, b.startUtc, b.endUtc, bufferMin)) {
      const who = db.members.find((m) => m.id === b.pilotId)?.name ?? 'Another member';
      out.push({ kind: 'booking', id: b.id, startUtc: b.startUtc, endUtc: b.endUtc, label: `${who}'s reservation` });
    }
  }
  for (const m of db.maintenance) {
    if (m.status !== 'scheduled') continue;
    if (overlaps(startUtc, endUtc, m.startUtc, m.endUtc, 0)) {
      out.push({ kind: 'maintenance', id: m.id, startUtc: m.startUtc, endUtc: m.endUtc, label: `Maintenance: ${m.title}` });
    }
  }
  return out.sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
}

export const MAX_BOOKING_HOURS = 14 * 24;

export function validateTimes(startUtc: string, endUtc: string, nowMs: number, opts: { allowPast?: boolean } = {}): string | null {
  const s = Date.parse(startUtc), e = Date.parse(endUtc);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 'Enter a valid start and end.';
  if (e <= s) return 'End must be after start.';
  if (e - s > MAX_BOOKING_HOURS * 3600e3) return 'Reservations can be at most 14 days long.';
  if (!opts.allowPast && e <= nowMs) return 'This time has already passed. Choose a future time.';
  return null;
}

/** Earliest free window of the same length starting at or after `fromUtc`, rounded to 30 min. */
export function suggestSlot(db: Pick<DbState, 'bookings' | 'maintenance' | 'members'>, durationMin: number, fromUtc: string, bufferMin: number, excludeBookingId?: string): { startUtc: string; endUtc: string } | null {
  const step = 30 * 60000;
  let t = Math.ceil(Date.parse(fromUtc) / step) * step;
  const limit = t + 60 * 864e5;
  while (t < limit) {
    const s = new Date(t).toISOString();
    const e = new Date(t + durationMin * 60000).toISOString();
    const c = findConflicts(db, s, e, bufferMin, excludeBookingId);
    if (c.length === 0) return { startUtc: s, endUtc: e };
    // Jump past the latest-ending conflict instead of stepping 30 minutes at a time.
    const maxEnd = Math.max(...c.map((x) => Date.parse(x.endUtc) + (x.kind === 'booking' ? bufferMin * 60000 : 0)));
    t = Math.max(t + step, Math.ceil(maxEnd / step) * step);
  }
  return null;
}

export function activeRestrictions(db: Pick<DbState, 'restrictions'>): Restriction[] {
  return db.restrictions.filter((r) => !r.clearedAt);
}
export function isGrounded(db: Pick<DbState, 'restrictions'>): boolean {
  return activeRestrictions(db).some((r) => r.level === 'grounded');
}
export function aircraftOut(db: Pick<DbState, 'bookings'>): Booking | undefined {
  return db.bookings.find((b) => b.status === 'checked_out');
}
export function isOverdue(b: Booking, nowMs: number): boolean {
  return b.status === 'checked_out' && Date.parse(b.endUtc) <= nowMs;
}

export function canEditBooking(actor: Member, b: Booking): string | null {
  if (actor.role !== 'admin' && b.pilotId !== actor.id) return 'Only the booking pilot or an admin can change this reservation.';
  if (b.status !== 'confirmed') return `This reservation is ${statusLabel(b.status).toLowerCase()} and can no longer be changed.`;
  return null;
}

export function checkOutBlocker(db: DbState, b: Booking, actor: Member, nowMs: number): string | null {
  if (actor.role !== 'admin' && b.pilotId !== actor.id) return 'Only the booking pilot or an admin can check out this reservation.';
  if (b.status !== 'confirmed') return `This reservation is ${statusLabel(b.status).toLowerCase()}.`;
  const out = aircraftOut(db);
  if (out) return 'The aircraft is already checked out on another reservation.';
  if (isGrounded(db)) return 'The aircraft has an active grounding restriction. An admin must clear it before check-out.';
  const early = db.settings.earlyCheckoutMinutes * 60000;
  if (nowMs < Date.parse(b.startUtc) - early) return `Check-out opens ${db.settings.earlyCheckoutMinutes} minutes before the reservation starts.`;
  if (nowMs >= Date.parse(b.endUtc)) return 'This reservation has already ended.';
  const maint = db.maintenance.find((m) => m.status === 'scheduled' && Date.parse(m.startUtc) <= nowMs && nowMs < Date.parse(m.endUtc));
  if (maint) return `Maintenance is scheduled right now (${maint.title}).`;
  return null;
}

export function statusLabel(s: Booking['status']): string {
  return { confirmed: 'Confirmed', checked_out: 'Checked Out', completed: 'Completed', canceled: 'Canceled', no_show: 'No-show' }[s];
}

/** Highest recorded end readings across all active flight records. */
export function lastReadings(flights: FlightRecord[], excludeId?: string): { hobbs: number | null; tach: number | null } {
  let hobbs: number | null = null, tach: number | null = null;
  for (const f of flights) {
    if (f.voided || f.id === excludeId) continue;
    if (f.hobbsEnd !== null && (hobbs === null || f.hobbsEnd > hobbs)) hobbs = f.hobbsEnd;
    if (f.tachEnd !== null && (tach === null || f.tachEnd > tach)) tach = f.tachEnd;
  }
  return { hobbs, tach };
}

export interface FlightValidation { errors: Record<string, string>; flags: string[] }

export function validateFlight(input: FlightInput, db: DbState, opts: { editingId?: string } = {}): FlightValidation {
  const s = db.settings;
  const errors: Record<string, string> = {};
  const flags: string[] = [];
  if (!s.hobbsEnabled && !s.tachEnabled) errors.form = 'Both meters are turned off in aircraft settings. Turn one on to record usage.';
  const booking = db.bookings.find((b) => b.id === input.bookingId);
  if (!booking) errors.bookingId = 'Choose the reservation this flight belongs to.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.flightDate)) errors.flightDate = 'Enter the flight date.';
  if (!input.route.trim()) errors.route = 'Enter the route, like KBFL–KSBA–KBFL.';

  const last = lastReadings(db.flights, opts.editingId);
  const meters: Array<['hobbs' | 'tach', boolean, number | null, number | null, string]> = [
    ['hobbs', s.hobbsEnabled, input.hobbsStart, input.hobbsEnd, 'Hobbs'],
    ['tach', s.tachEnabled, input.tachStart, input.tachEnd, 'Tach'],
  ];
  const deltas: Record<string, number | null> = { hobbs: null, tach: null };
  for (const [key, enabled, start, end, label] of meters) {
    if (!enabled) continue;
    if (start === null) { errors[key + 'Start'] = `Enter the starting ${label} reading.`; continue; }
    if (end === null) { errors[key + 'End'] = `Enter the ending ${label} reading.`; continue; }
    if (end < start) { errors[key + 'End'] = `Ending ${label} (${fmtHundredths(end)}) is lower than starting ${label} (${fmtHundredths(start)}). Readings cannot decrease.`; continue; }
    const prev = last[key];
    if (!opts.editingId && prev !== null && start < prev) {
      errors[key + 'Start'] = `Starting ${label} ${fmtHundredths(start)} is below the last recorded ${label} ${fmtHundredths(prev)}. Readings cannot go backwards. If an earlier record is wrong, ask an admin to correct it.`;
      continue;
    }
    const delta = end - start;
    deltas[key] = delta;
    if (!opts.editingId && prev !== null && start > prev) flags.push(`${label} gap: starts at ${fmtHundredths(start)}, last recorded end was ${fmtHundredths(prev)} (${fmtHundredths(start - prev)} unaccounted).`);
    if (delta === 0) flags.push(`${label} shows no change for this flight.`);
    if (delta > 800) flags.push(`${label} change of ${fmtHundredths(delta)} hours is unusually large for one leg.`);
    if (booking && delta > Math.ceil((Date.parse(booking.endUtc) - Date.parse(booking.startUtc)) / 36000) + 50) {
      flags.push(`${label} change of ${fmtHundredths(delta)} hours is longer than the reservation itself.`);
    }
  }
  if (deltas.hobbs !== null && deltas.tach !== null && deltas.tach > deltas.hobbs) {
    flags.push(`Tach change (${fmtHundredths(deltas.tach)}) is greater than Hobbs change (${fmtHundredths(deltas.hobbs)}). Tach normally runs slower than Hobbs.`);
  }
  if (s.topOffRequired && input.fuelGallons === null) flags.push('No fuel top-off recorded for this leg.');

  // Duplicate check: same reservation and identical readings already recorded.
  if (!opts.editingId) {
    const dup = db.flights.find((f) => !f.voided && f.bookingId === input.bookingId &&
      f.hobbsStart === input.hobbsStart && f.hobbsEnd === input.hobbsEnd && f.tachStart === input.tachStart && f.tachEnd === input.tachEnd);
    if (dup) errors.form = 'A flight with these exact readings is already recorded for this reservation.';
  }
  return { errors, flags };
}

export function billableHundredths(f: FlightRecord, s: AircraftSettings): number {
  const hobbs = f.hobbsStart !== null && f.hobbsEnd !== null ? f.hobbsEnd - f.hobbsStart : null;
  const tach = f.tachStart !== null && f.tachEnd !== null ? f.tachEnd - f.tachStart : null;
  if (s.rateBasis === 'tach') return tach ?? hobbs ?? 0;
  return hobbs ?? tach ?? 0;
}

export interface Charges { hours: number; rentalCents: number; fuelCents: number; fuelOwedCents: number; totalOwedCents: number }

/** Usage charges for a set of flight records: rental per billable hour, plus fuel. */
export function charges(flights: FlightRecord[], s: AircraftSettings): Charges {
  let hours = 0, fuel = 0;
  for (const f of flights) {
    if (f.voided) continue;
    hours += billableHundredths(f, s);
    fuel += f.fuelCostCents ?? 0;
  }
  const rental = rentalCents(hours, s.rateCentsPerHour);
  const fuelOwed = s.fuelPolicy === 'add_to_statement' ? fuel : 0;
  return { hours, rentalCents: rental, fuelCents: fuel, fuelOwedCents: fuelOwed, totalOwedCents: rental + fuelOwed };
}

export function sumMeter(flights: FlightRecord[], key: 'hobbs' | 'tach'): number {
  let t = 0;
  for (const f of flights) {
    if (f.voided) continue;
    const s = key === 'hobbs' ? f.hobbsStart : f.tachStart;
    const e = key === 'hobbs' ? f.hobbsEnd : f.tachEnd;
    if (s !== null && e !== null) t += e - s;
  }
  return t;
}
