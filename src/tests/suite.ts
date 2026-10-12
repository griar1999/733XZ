// Shared test suite. Runs in Node through Vitest and in the browser from Demo tools.
import { MockApi, type KeyValueStorage } from '../services/mockApi';
import { ApiError } from '../services/api';
import { simulateRace } from '../services/race';
import { addDays, localToUtc, minutesBetween } from '../domain/time';
import { charges, isGrounded, isOverdue, sumMeter } from '../domain/rules';
import { parseHundredths, rentalCents, fmtHundredths } from '../domain/decimal';
import type { BookingInput, FlightInput } from '../domain/types';

export interface TestCase { area: string; name: string; run: () => Promise<void> }

const FIXED_NOW = Date.parse('2026-10-10T16:00:00Z'); // Sat 9:00 AM PDT
const TODAY = '2026-10-10';
const TZ = 'America/Los_Angeles';

function memStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
function setup(nowMs = FIXED_NOW) {
  const clock = { now: nowMs };
  const api = new MockApi({ storage: memStorage(), now: () => clock.now, latencyMs: 0, key: 'test' });
  return { api, clock };
}
function L(day: number, time: string): string {
  const r = localToUtc(addDays(TODAY, day), time, TZ);
  if (!r.ok) throw new Error(r.error);
  return r.utc;
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error('Assertion failed: ' + msg); }
function eq<T>(a: T, b: T, msg: string) { if (a !== b) throw new Error(`${msg}: expected ${String(b)}, got ${String(a)}`); }
async function rejects(p: Promise<unknown>, code: string, msg: string): Promise<ApiError> {
  try { await p; } catch (e) {
    if (e instanceof ApiError) { eq(e.code, code, msg); return e; }
    throw e;
  }
  throw new Error(`${msg}: expected rejection with ${code}`);
}
const bi = (pilotId: string, s: string, e: string): BookingInput => ({ pilotId, startUtc: s, endUtc: e, destination: '', notes: '' });
let keyN = 0;
const fi = (bookingId: string, pilotId: string, h: [string, string], t: [string, string], extra: Partial<FlightInput> = {}): FlightInput => ({
  bookingId, pilotId, flightDate: TODAY, route: 'KBFL–KBFL',
  hobbsStart: (parseHundredths(h[0], 'h') as { value: number }).value, hobbsEnd: (parseHundredths(h[1], 'h') as { value: number }).value,
  tachStart: (parseHundredths(t[0], 't') as { value: number }).value, tachEnd: (parseHundredths(t[1], 't') as { value: number }).value,
  fuelGallons: 1000, fuelCostCents: 6100, notes: '', submissionKey: 'k' + ++keyN, ...extra,
});

export const tests: TestCase[] = [
  { area: 'Bookings', name: 'Creates a booking and records it in activity history', run: async () => {
    const { api } = setup();
    const b = await api.createBooking('m2', bi('m2', L(2, '13:00'), L(2, '15:00')));
    eq(b.status, 'confirmed', 'status');
    assert(api.snapshot().audit.some((a) => a.entityId === b.id && a.action === 'booking.create'), 'audit entry exists');
  } },
  { area: 'Bookings', name: 'Rejects end before or equal to start', run: async () => {
    const { api } = setup();
    await rejects(api.createBooking('m2', bi('m2', L(2, '15:00'), L(2, '13:00'))), 'validation', 'reversed');
    await rejects(api.createBooking('m2', bi('m2', L(2, '15:00'), L(2, '15:00'))), 'validation', 'zero length');
  } },
  { area: 'Bookings', name: 'Rejects overlap with a confirmed booking and suggests another slot', run: async () => {
    const { api } = setup();
    const e = await rejects(api.createBooking('m2', bi('m2', L(1, '10:00'), L(1, '11:00'))), 'conflict', 'overlap');
    assert(e.details.conflicts?.some((c) => c.id === 'b7'), 'names conflicting booking b7');
    assert(e.details.suggestion, 'offers suggestion');
    eq(e.details.suggestion!.startUtc, L(1, '15:00'), 'suggests first free slot after Sam');
  } },
  { area: 'Bookings', name: 'Allows adjacent bookings when buffer is zero', run: async () => {
    const { api } = setup();
    const b = await api.createBooking('m2', bi('m2', L(1, '15:00'), L(1, '16:00')));
    eq(b.status, 'confirmed', 'adjacent accepted');
  } },
  { area: 'Bookings', name: 'Applies the turnaround buffer', run: async () => {
    const { api } = setup();
    await api.updateSettings('m1', { bufferMinutes: 30 });
    await rejects(api.createBooking('m2', bi('m2', L(1, '15:00'), L(1, '16:00'))), 'conflict', 'adjacent rejected with 30 min buffer');
    await rejects(api.createBooking('m2', bi('m2', L(1, '15:15'), L(1, '16:00'))), 'conflict', '15 min gap rejected');
    const ok = await api.createBooking('m2', bi('m2', L(1, '15:30'), L(1, '16:30')));
    eq(ok.status, 'confirmed', '30 min gap accepted');
  } },
  { area: 'Bookings', name: 'Failed edit leaves the original booking unchanged', run: async () => {
    const { api } = setup();
    const before = { ...api.snapshot().bookings.find((b) => b.id === 'b7')! };
    await rejects(api.updateBooking('m3', 'b7', bi('m3', L(1, '09:00'), L(1, '13:00')), before.version), 'conflict', 'edit into Sam');
    const after = api.snapshot().bookings.find((b) => b.id === 'b7')!;
    eq(after.endUtc, before.endUtc, 'end unchanged'); eq(after.version, before.version, 'version unchanged');
  } },
  { area: 'Bookings', name: 'Rejects an edit made from an out-of-date copy', run: async () => {
    const { api } = setup();
    await api.updateBooking('m1', 'b7', { ...bi('m3', L(1, '08:00'), L(1, '12:00')), destination: 'KSBP' }, 1);
    await rejects(api.updateBooking('m3', 'b7', bi('m3', L(1, '09:00'), L(1, '11:00')), 1), 'stale', 'stale version');
  } },
  { area: 'Bookings', name: 'Cancel keeps the record and frees the slot immediately', run: async () => {
    const { api } = setup();
    await api.cancelBooking('m3', 'b7', 'Plans changed');
    const b7 = api.snapshot().bookings.find((b) => b.id === 'b7')!;
    eq(b7.status, 'canceled', 'retained as canceled');
    const nb = await api.createBooking('m2', bi('m2', L(1, '09:00'), L(1, '12:00')));
    eq(nb.status, 'confirmed', 'slot reusable');
  } },
  { area: 'Bookings', name: 'Overnight booking across the fall DST change has the right length', run: async () => {
    const s = localToUtc('2026-10-31', '20:00', TZ), e = localToUtc('2026-11-01', '09:00', TZ);
    assert(s.ok && e.ok, 'both times valid');
    if (s.ok && e.ok) eq(minutesBetween(s.utc, e.utc), 14 * 60, '13 wall-clock hours + 1 repeated hour');
    const gap = localToUtc('2026-03-08', '02:30', TZ);
    eq(gap.ok, false, 'spring-forward gap rejected');
    const amb = localToUtc('2026-11-01', '01:30', TZ);
    assert(amb.ok && amb.ambiguous, 'fall-back hour flagged ambiguous');
  } },
  { area: 'Concurrency', name: 'Two members race for the same slot; exactly one wins', run: async () => {
    const { api } = setup();
    const slot = bi('m2', L(9, '09:00'), L(9, '11:00'));
    const r = await simulateRace(api, { actorId: 'm2', input: slot }, { actorId: 'm4', input: { ...slot, pilotId: 'm4' } });
    assert(r.frontendCheckPassedForBoth, 'both clients thought the slot was free');
    eq(r.results.filter((x) => x.ok).length, 1, 'exactly one success');
  } },
  { area: 'Permissions', name: 'Pilots cannot act on other pilots\' bookings or admin functions', run: async () => {
    const { api } = setup();
    await rejects(api.cancelBooking('m2', 'b7', ''), 'forbidden', 'cancel other');
    await rejects(api.createBooking('m2', bi('m3', L(9, '09:00'), L(9, '10:00'))), 'forbidden', 'book for other');
    await rejects(api.updateBooking('m2', 'b7', bi('m3', L(1, '09:00'), L(1, '10:00')), 1), 'forbidden', 'edit other');
    await rejects(api.createMaintenance('m2', { title: 'x', startUtc: L(9, '09:00'), endUtc: L(9, '10:00'), notes: '' }, true), 'forbidden', 'maintenance');
    await rejects(api.clearRestriction('m2', 'r1', 'pilot wants to clear'), 'forbidden', 'clear restriction');
    await rejects(api.updateSettings('m2', { bufferMinutes: 15 }), 'forbidden', 'settings');
  } },
  { area: 'Permissions', name: 'Admin can change any booking and the change is recorded', run: async () => {
    const { api } = setup();
    await api.updateBooking('m1', 'b7', bi('m3', L(1, '08:00'), L(1, '12:00')), 1);
    const a = api.snapshot().audit.filter((x) => x.entityId === 'b7' && x.action === 'booking.update');
    eq(a.length, 1, 'one audit entry'); eq(a[0].actorId, 'm1', 'by admin'); assert(a[0].before, 'stores previous values');
  } },
  { area: 'Check-out', name: 'Overdue aircraft shows overdue and is never auto-returned', run: async () => {
    const { api, clock } = setup();
    const b6 = () => api.snapshot().bookings.find((b) => b.id === 'b6')!;
    assert(isOverdue(b6(), clock.now), 'seeded booking overdue');
    clock.now += 6 * 3600e3;
    eq(b6().status, 'checked_out', 'still checked out hours later');
  } },
  { area: 'Check-out', name: 'Cannot check out while the aircraft is already out', run: async () => {
    const { api, clock } = setup();
    clock.now = Date.parse(L(1, '08:30'));
    await rejects(api.checkOut('m3', 'b7'), 'validation', 'blocked by b6');
  } },
  { area: 'Check-out', name: 'Return marks the reservation done and asks for the flight record', run: async () => {
    const { api } = setup();
    const r = await api.returnAircraft('m1', 'b6', { note: '', fuelToppedOff: true });
    eq(r.status, 'completed', 'completed'); eq(r.flightRecordNeeded, true, 'record still needed');
    await api.submitFlight('m1', fi('b6', 'm1', ['2846.4', '2848.0'], ['2214.7', '2216.0']));
    eq(api.snapshot().bookings.find((b) => b.id === 'b6')!.flightRecordNeeded, false, 'record completed');
  } },
  { area: 'Check-out', name: 'No-show is only recorded explicitly by an admin', run: async () => {
    const { api, clock } = setup();
    await rejects(api.markNoShow('m1', 'b7', ''), 'validation', 'not before start');
    clock.now = Date.parse(L(2, '09:00'));
    eq(api.snapshot().bookings.find((b) => b.id === 'b7')!.status, 'confirmed', 'elapsed time does not change status');
    await rejects(api.markNoShow('m2', 'b7', ''), 'forbidden', 'pilot cannot');
    const b = await api.markNoShow('m1', 'b7', 'Did not arrive');
    eq(b.status, 'no_show', 'recorded');
  } },
  { area: 'Restrictions', name: 'Grounding persists through issue resolution, maintenance end and return', run: async () => {
    const { api, clock } = setup();
    const issue = await api.reportIssue('m2', { title: 'Oil leak at cowl', description: '', urgency: 'grounding', groundAircraft: true });
    assert(isGrounded(api.snapshot()), 'grounded');
    await api.updateIssue('m1', issue.id, 'resolved', 'Gasket replaced');
    await api.returnAircraft('m1', 'b6', { note: '', fuelToppedOff: true });
    const mx = await api.createMaintenance('m1', { title: 'Leak check', startUtc: L(0, '12:00'), endUtc: L(0, '14:00'), notes: '' }, true);
    await api.endMaintenance('m1', mx.id, 'ended', 'Done');
    assert(isGrounded(api.snapshot()), 'still grounded after all three');
    clock.now = Date.parse(L(1, '08:30'));
    await rejects(api.checkOut('m3', 'b7'), 'validation', 'check-out blocked');
    const rid = api.snapshot().restrictions.find((r) => r.issueId === issue.id)!.id;
    await rejects(api.clearRestriction('m1', rid, 'ok'), 'validation', 'reason too short');
    await api.clearRestriction('m1', rid, 'Repair signed off by shop, logbook entry reviewed');
    assert(!isGrounded(api.snapshot()), 'cleared by explicit admin action');
    const c = await api.checkOut('m3', 'b7');
    eq(c.status, 'checked_out', 'check-out now allowed');
  } },
  { area: 'Maintenance', name: 'Maintenance over an existing booking needs admin review and keeps the booking', run: async () => {
    const { api } = setup();
    const input = { title: 'Avionics check', startUtc: L(7, '07:00'), endUtc: L(7, '17:00'), notes: '' };
    const e = await rejects(api.createMaintenance('m1', input, false), 'needs_review', 'review required');
    assert(e.details.affected?.some((b) => b.id === 'b10'), 'lists b10');
    await api.createMaintenance('m1', input, true);
    eq(api.snapshot().bookings.find((b) => b.id === 'b10')!.status, 'confirmed', 'booking not deleted');
    await rejects(api.createBooking('m2', bi('m2', L(7, '13:00'), L(7, '14:00'))), 'conflict', 'new booking blocked by maintenance');
  } },
  { area: 'Flight log', name: 'Rejects decreasing readings and readings below the last recorded value', run: async () => {
    const { api } = setup();
    await api.returnAircraft('m1', 'b6', { note: '', fuelToppedOff: true });
    const e1 = await rejects(api.submitFlight('m1', fi('b6', 'm1', ['2848.0', '2846.4'], ['2214.7', '2216.0'])), 'validation', 'end < start');
    assert(e1.details.fieldErrors?.hobbsEnd, 'hobbsEnd error');
    const e2 = await rejects(api.submitFlight('m1', fi('b6', 'm1', ['2840.0', '2841.0'], ['2214.7', '2216.0'])), 'validation', 'below last');
    assert(e2.details.fieldErrors?.hobbsStart, 'hobbsStart error');
  } },
  { area: 'Flight log', name: 'Flags gaps and tach running faster than Hobbs', run: async () => {
    const { api } = setup();
    await api.returnAircraft('m1', 'b6', { note: '', fuelToppedOff: true });
    const r = await api.submitFlight('m1', fi('b6', 'm1', ['2847.0', '2848.0'], ['2214.7', '2216.0']));
    assert(r.flags.some((f) => f.startsWith('Hobbs gap')), 'gap flagged');
    assert(r.flags.some((f) => f.startsWith('Tach change')), 'tach > hobbs flagged');
    const prior = api.snapshot().flights.find((f) => f.id === 'f4')!;
    eq(prior.hobbsEnd, 284640, 'prior reading untouched');
  } },
  { area: 'Flight log', name: 'Decimal-safe meter math and $50/hour rental', run: async () => {
    const a = parseHundredths('2846.7', 'x'), b = parseHundredths('2846.4', 'x');
    assert(a.ok && b.ok, 'parse');
    if (a.ok && b.ok) { eq(a.value - b.value, 30, '0.3 h exactly'); eq(fmtHundredths(a.value - b.value), '0.3', 'formats 0.3'); }
    eq(rentalCents(190, 5000), 9500, '1.9 h = $95.00');
    eq(rentalCents(123, 5000), 6150, '1.23 h = $61.50');
    eq(parseHundredths('12.345', 'x').ok, false, 'rejects 3 decimals');
    eq(parseHundredths('-1', 'x').ok, false, 'rejects negative');
  } },
  { area: 'Flight log', name: 'Duplicate submissions are blocked', run: async () => {
    const { api } = setup();
    await api.returnAircraft('m1', 'b6', { note: '', fuelToppedOff: true });
    const input = fi('b6', 'm1', ['2846.4', '2848.0'], ['2214.7', '2216.0']);
    const [r1, r2] = await Promise.all([api.submitFlight('m1', input), api.submitFlight('m1', input)]);
    eq(r2.replayed, true, 'second tap replays the first'); eq(r1.record.id, r2.record.id, 'same record');
    eq(api.snapshot().flights.filter((f) => f.bookingId === 'b6').length, 1, 'one record stored');
    await rejects(api.submitFlight('m1', { ...input, submissionKey: 'other' }), 'duplicate', 'same readings again');
  } },
  { area: 'Flight log', name: 'Multiple legs per reservation, totals and charges', run: async () => {
    const { api } = setup();
    await api.submitFlight('m1', fi('b6', 'm1', ['2846.4', '2847.3'], ['2214.7', '2215.4']));
    await api.submitFlight('m1', fi('b6', 'm1', ['2847.3', '2848.0'], ['2215.4', '2216.0']));
    const legs = api.snapshot().flights.filter((f) => f.bookingId === 'b6');
    eq(legs.length, 2, 'two legs');
    eq(sumMeter(legs, 'hobbs'), 160, '1.6 Hobbs');
    const s = api.snapshot().settings;
    const c = charges(legs, s);
    eq(c.rentalCents, 8000, '1.6 h x $50 = $80'); eq(c.fuelOwedCents, 0, 'fuel paid at pump by default');
    const c2 = charges(legs, { ...s, fuelPolicy: 'add_to_statement' });
    eq(c2.totalOwedCents, 8000 + 12200, 'rental + fuel when fuel goes on statement');
  } },
  { area: 'Flight log', name: 'Disabled meter is not required or stored', run: async () => {
    const { api } = setup();
    await api.updateSettings('m1', { tachEnabled: false });
    const r = await api.submitFlight('m1', { ...fi('b6', 'm1', ['2846.4', '2848.0'], ['0', '0']), tachStart: null, tachEnd: null });
    eq(r.record.tachStart, null, 'tach not stored');
    await rejects(api.updateSettings('m1', { hobbsEnabled: false }), 'validation', 'cannot disable both / billing meter');
  } },
  { area: 'Flight log', name: 'Corrections keep who, when, why and previous values', run: async () => {
    const { api } = setup();
    await rejects(api.correctFlight('m1', 'f4', { route: 'KBFL–KTSP–KBFL' }, ''), 'validation', 'reason required');
    const f = await api.correctFlight('m1', 'f4', { route: 'KBFL–KTSP–KBFL', hobbsEnd: 284650 }, 'Pilot misread Hobbs');
    eq(f.revisions.length, 1, 'one revision'); eq(f.revisions[0].by, 'm1', 'who');
    eq(f.revisions[0].previous.hobbsEnd, 284640, 'previous value kept');
    await rejects(api.correctFlight('m2', 'f4', { route: 'x' }, 'not mine'), 'forbidden', 'pilot cannot correct others');
  } },
  { area: 'Offline', name: 'Offline blocks changes but keeps cached data readable', run: async () => {
    const { api } = setup();
    api.setSimulatedOffline(true);
    const count = api.snapshot().bookings.length;
    await rejects(api.createBooking('m2', bi('m2', L(9, '09:00'), L(9, '10:00'))), 'offline', 'blocked');
    await rejects(api.submitFlight('m1', fi('b6', 'm1', ['2846.4', '2848.0'], ['2214.7', '2216.0'])), 'offline', 'flight blocked');
    eq(api.snapshot().bookings.length, count, 'no change');
    api.setSimulatedOffline(false);
    await api.createBooking('m2', bi('m2', L(9, '09:00'), L(9, '10:00')));
  } },
  { area: 'Admin', name: 'Settings changes are validated and logged', run: async () => {
    const { api } = setup();
    await rejects(api.updateSettings('m1', { tailNumber: '' }), 'validation', 'tail required');
    await api.updateSettings('m1', { tailNumber: 'n733demo', timeZone: 'America/Denver' });
    eq(api.snapshot().settings.tailNumber, 'N733DEMO', 'normalized');
    assert(api.snapshot().audit.some((a) => a.action === 'settings.update'), 'logged');
    await rejects(api.updateMember('m1', 'm1', { role: 'pilot' }), 'validation', 'keeps one admin');
  } },
];

export async function runAll(): Promise<Array<{ area: string; name: string; ok: boolean; error?: string; ms: number }>> {
  const out = [];
  for (const t of tests) {
    const s = performance.now();
    try { await t.run(); out.push({ area: t.area, name: t.name, ok: true, ms: performance.now() - s }); }
    catch (e) { out.push({ area: t.area, name: t.name, ok: false, error: (e as Error).message, ms: performance.now() - s }); }
  }
  return out;
}

tests.push({ area: 'Flight log', name: 'Accepts readings displayed with thousands separators', run: async () => {
  const r = parseHundredths('2,846.4', 'x');
  assert(r.ok && r.value === 284640, 'comma-formatted reading parses');
} });
