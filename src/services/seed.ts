// Fictional demo data, generated relative to "now" so the demo always looks current.
import type { AuditEntry, Booking, DbState, FlightRecord, Member } from '../domain/types';
import { addDays, localToUtc, toLocalParts } from '../domain/time';

export const SCHEMA_VERSION = 3;

export const DEMO_MEMBERS: Member[] = [
  { id: 'm1', name: 'Morgan Hale', initials: 'MH', role: 'admin', active: true, email: 'morgan@example.com' },
  { id: 'm2', name: 'Alex Rivera', initials: 'AR', role: 'pilot', active: true, email: 'alex@example.com' },
  { id: 'm3', name: 'Jordan Kim', initials: 'JK', role: 'pilot', active: true, email: 'jordan@example.com' },
  { id: 'm4', name: 'Sam Patel', initials: 'SP', role: 'pilot', active: true, email: 'sam@example.com' },
  { id: 'm5', name: 'Taylor Brooks', initials: 'TB', role: 'pilot', active: true, email: 'taylor@example.com' },
  { id: 'm6', name: 'Casey Nguyen', initials: 'CN', role: 'pilot', active: true, email: 'casey@example.com' },
];

export function seedState(nowMs: number, tz = 'America/Los_Angeles'): DbState {
  const today = toLocalParts(nowMs, tz).date;
  const at = (dayOffset: number, time: string): string => {
    const r = localToUtc(addDays(today, dayOffset), time, tz);
    if (!r.ok) throw new Error(r.error);
    return r.utc;
  };
  const iso = (ms: number) => new Date(ms).toISOString();
  const created = iso(nowMs - 10 * 864e5);
  const bk = (id: string, pilotId: string, s: string, e: string, status: Booking['status'], destination = '', notes = '', extra: Partial<Booking> = {}): Booking => ({
    id, pilotId, startUtc: s, endUtc: e, destination, notes, status, createdBy: pilotId,
    createdAt: created, updatedAt: created, version: 1, ...extra,
  });

  const q15 = 15 * 60000;
  const outStart = Math.floor((nowMs - 4 * 3600e3) / q15) * q15;
  const outEnd = Math.floor((nowMs - 40 * 60000) / q15) * q15;

  const bookings: Booking[] = [
    bk('b1', 'm2', at(-6, '08:00'), at(-6, '11:00'), 'completed', 'KSBA', 'Lunch run', { checkedOutAt: at(-6, '07:52'), checkedOutBy: 'm2', returnedAt: at(-6, '10:48'), returnedBy: 'm2', fuelToppedOff: true }),
    bk('b2', 'm3', at(-4, '13:00'), at(-4, '16:00'), 'completed', 'KVIS', 'Two legs', { checkedOutAt: at(-4, '12:55'), checkedOutBy: 'm3', returnedAt: at(-4, '15:40'), returnedBy: 'm3', fuelToppedOff: true }),
    bk('b3', 'm4', at(-3, '09:00'), at(-3, '12:00'), 'canceled', 'KPRB', '', { canceledAt: at(-4, '18:10'), canceledBy: 'm4', cancelReason: 'Low ceilings forecast' }),
    bk('b4', 'm5', at(-2, '10:00'), at(-2, '13:00'), 'completed', 'Local', 'Pattern work', { checkedOutAt: at(-2, '09:50'), checkedOutBy: 'm5', returnedAt: at(-2, '12:30'), returnedBy: 'm5', fuelToppedOff: true }),
    bk('b5', 'm6', at(-1, '07:00'), at(-1, '10:00'), 'no_show', '', '', { noShowAt: at(-1, '10:20'), noShowBy: 'm1' }),
    bk('b6', 'm1', iso(outStart), iso(outEnd), 'checked_out', 'KIYK', 'Proficiency flight', { checkedOutAt: iso(outStart + 5 * 60000), checkedOutBy: 'm1' }),
    bk('b7', 'm3', at(1, '09:00'), at(1, '12:00'), 'confirmed', 'KSBP', ''),
    bk('b8', 'm4', at(1, '12:00'), at(1, '15:00'), 'confirmed', 'Local', 'Starts right as Jordan returns'),
    bk('b12', 'm1', at(2, '09:00'), at(2, '11:00'), 'canceled', '', '', { canceledAt: iso(nowMs - 864e5), canceledBy: 'm1', cancelReason: 'Schedule change' }),
    bk('b9', 'm5', at(3, '16:00'), at(4, '11:00'), 'confirmed', 'KMRY', 'Overnight in Monterey'),
    bk('b10', 'm6', at(7, '08:00'), at(7, '12:00'), 'confirmed', 'KSMX', ''),
    bk('b11', 'm2', at(8, '13:00'), at(8, '17:00'), 'confirmed', 'KCMA', ''),
  ];

  const fr = (id: string, bookingId: string, pilotId: string, day: number, route: string, h: [number, number], t: [number, number], gal: number, cost: number, flags: string[] = []): FlightRecord => ({
    id, bookingId, pilotId, flightDate: addDays(today, day), route,
    hobbsStart: h[0], hobbsEnd: h[1], tachStart: t[0], tachEnd: t[1],
    fuelGallons: gal, fuelCostCents: cost, notes: '', flags, submissionKey: 'seed-' + id,
    createdAt: at(day, '16:30'), createdBy: pilotId, revisions: [],
  });
  const flights: FlightRecord[] = [
    fr('f1', 'b1', 'm2', -6, 'KBFL–KSBA–KBFL', [284120, 284310], [221040, 221200], 1840, 11224),
    fr('f2', 'b2', 'm3', -4, 'KBFL–KVIS', [284310, 284400], [221200, 221280], 0, 0),
    fr('f3', 'b2', 'm3', -4, 'KVIS–KBFL', [284400, 284500], [221280, 221360], 1420, 8662),
    fr('f4', 'b4', 'm5', -2, 'KBFL local pattern', [284500, 284640], [221360, 221470], 1260, 7686),
  ];

  const audit: AuditEntry[] = [
    { id: 'a0', at: iso(nowMs - 11 * 864e5), actorId: 'm1', action: 'demo.seed', entityType: 'demo', summary: 'Demo data loaded with fictional members and aircraft' },
    { id: 'a1', at: at(-4, '18:10'), actorId: 'm4', action: 'booking.cancel', entityType: 'booking', entityId: 'b3', summary: 'Canceled reservation: Low ceilings forecast' },
    { id: 'a2', at: at(-2, '14:05'), actorId: 'm5', action: 'issue.report', entityType: 'issue', entityId: 'i1', summary: 'Reported issue: Left landing light inoperative' },
    { id: 'a3', at: at(-2, '15:00'), actorId: 'm1', action: 'restriction.add', entityType: 'restriction', entityId: 'r1', summary: 'Added caution: No night flights until left landing light is repaired' },
    { id: 'a4', at: at(-1, '10:20'), actorId: 'm1', action: 'booking.no_show', entityType: 'booking', entityId: 'b5', summary: 'Recorded no-show for Casey Nguyen' },
    { id: 'a5', at: iso(outStart + 5 * 60000), actorId: 'm1', action: 'booking.check_out', entityType: 'booking', entityId: 'b6', summary: 'Checked out aircraft' },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    members: DEMO_MEMBERS.map((m) => ({ ...m })),
    bookings,
    maintenance: [{ id: 'mx1', title: '100-hour inspection', startUtc: at(5, '07:00'), endUtc: at(6, '17:00'), notes: 'Demo shop: Valley Aero Service', status: 'scheduled', createdBy: 'm1', createdAt: created }],
    issues: [
      { id: 'i1', title: 'Left landing light inoperative', description: 'Left landing light did not come on during preflight. Right light works.', urgency: 'medium', status: 'open', reportedBy: 'm5', reportedAt: at(-2, '14:05'), history: [{ at: at(-2, '14:05'), by: 'm5', status: 'open', note: 'Reported' }], restrictionId: 'r1' },
      { id: 'i2', title: 'Co-pilot headset jack loose', description: 'Right-seat headset jack moves when the plug is inserted. Audio still works.', urgency: 'low', status: 'investigating', reportedBy: 'm3', reportedAt: at(-4, '16:00'), history: [{ at: at(-4, '16:00'), by: 'm3', status: 'open', note: 'Reported' }, { at: at(-3, '09:00'), by: 'm1', status: 'investigating', note: 'Asked shop to look at it during the 100-hour' }] },
    ],
    restrictions: [
      { id: 'r1', level: 'caution', reason: 'No night flights until left landing light is repaired', createdBy: 'm1', createdAt: at(-2, '15:00'), issueId: 'i1' },
    ],
    flights,
    settings: {
      appName: 'PlaneShare', tailNumber: 'N482PS', model: 'Cessna 172S Skyhawk', homeAirport: 'KBFL',
      timeZone: tz, bufferMinutes: 0, hobbsEnabled: true, tachEnabled: true, earlyCheckoutMinutes: 60,
      rateCentsPerHour: 5000, rateBasis: 'hobbs', fuelPolicy: 'pilot_pays_at_pump', topOffRequired: true,
    },
    audit,
    savedAt: iso(nowMs),
  };
}

/** Starting point for the live app: just the owner (admin) and the group's aircraft settings. No sample data. */
export const OWNER_ID = 'owner';
export function seedLive(nowMs: number, ownerName = 'G'): DbState {
  const at = new Date(nowMs).toISOString();
  const nm = ownerName.trim() || 'G';
  return {
    schemaVersion: SCHEMA_VERSION,
    members: [{ id: OWNER_ID, name: nm, initials: nm.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(), role: 'admin', active: true, email: '' }],
    bookings: [], maintenance: [], issues: [], restrictions: [], flights: [],
    settings: {
      appName: 'PlaneShare', tailNumber: 'N733XZ', model: '', homeAirport: '',
      timeZone: 'America/Los_Angeles', bufferMinutes: 0, hobbsEnabled: true, tachEnabled: true, earlyCheckoutMinutes: 60,
      rateCentsPerHour: 5000, rateBasis: 'hobbs', fuelPolicy: 'pilot_pays_at_pump', topOffRequired: true,
    },
    audit: [{ id: 'a_start', at, actorId: OWNER_ID, action: 'app.create', entityType: 'settings', summary: 'PlaneShare set up' }],
    savedAt: at,
  };
}
