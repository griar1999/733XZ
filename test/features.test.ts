import { describe, expect, it } from 'vitest';
import { MockApi, type KeyValueStorage } from '../src/services/mockApi';
import { noticesForChange, timedNotices } from '../src/domain/notices';
import { monthlyStatement, statementCsv } from '../src/domain/statements';
import { addDays, localToUtc } from '../src/domain/time';
import { runAction } from '../src/services/actions';
import { seedLive } from '../src/services/seed';
import type { DbState } from '../src/domain/types';

const NOW = Date.parse('2026-10-10T16:00:00Z');
const mem = (): KeyValueStorage => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }; };
const L = (d: number, t: string) => (localToUtc(addDays('2026-10-10', d), t, 'America/Los_Angeles') as { utc: string }).utc;
const clone = (s: DbState) => JSON.parse(JSON.stringify(s)) as DbState;

describe('Phone notifications', () => {
  it('new booking notifies everyone except the person who booked', () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    const before = clone(api.snapshot());
    const { state } = runAction(before, 'createBooking', [{ pilotId: 'm2', startUtc: L(9, '09:00'), endUtc: L(9, '11:00'), destination: 'KSBA', notes: '' }], 'm2', NOW, true);
    const n = noticesForChange(before, state);
    expect(n).toHaveLength(1);
    expect(n[0].to).not.toContain('m2');
    expect(n[0].to).toHaveLength(5);
    expect(n[0].body).toContain('KSBA');
  });
  it('cancel tells everyone the slot is open', () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    const before = clone(api.snapshot());
    const { state } = runAction(before, 'cancelBooking', ['b7', 'sick'], 'm3', NOW, true);
    const n = noticesForChange(before, state);
    expect(n[0].title).toMatch(/is open/);
    expect(n[0].to).not.toContain('m3');
  });
  it('grounding from an issue goes to everyone; a minor issue only to admins', () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    const b1 = clone(api.snapshot());
    const g = runAction(b1, 'reportIssue', [{ title: 'Oil leak', description: '', urgency: 'grounding', groundAircraft: true }], 'm4', NOW, true);
    const ng = noticesForChange(b1, g.state);
    expect(ng).toHaveLength(1);
    expect(ng[0].to).toHaveLength(5);
    const b2 = clone(g.state);
    const minor = runAction(b2, 'reportIssue', [{ title: 'Seat squeak', description: '', urgency: 'low', groundAircraft: false }], 'm4', NOW, true);
    expect(noticesForChange(b2, minor.state)[0].to).toEqual(['m1']);
  });
  it('maintenance warns pilots whose bookings overlap', () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    const before = clone(api.snapshot());
    const { state } = runAction(before, 'createMaintenance', [{ title: 'Avionics', startUtc: L(7, '07:00'), endUtc: L(7, '17:00'), notes: '' }, true], 'm1', NOW, true);
    const n = noticesForChange(before, state);
    expect(n.some((x) => x.to.length === 1 && x.to[0] === 'm6' && /overlaps your booking/.test(x.title))).toBe(true);
  });
  it('reminder 2 hours before, overdue 15 minutes after, each only once', () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    const s = clone(api.snapshot());
    const at = Date.parse(L(1, '07:30'));          // 90 min before b7 (9:00)
    const r1 = timedNotices(s, at);
    expect(r1.notices.some((n) => n.to[0] === 'm3' && /soon/.test(n.title))).toBe(true);
    expect(timedNotices(s, at + 60000).notices.filter((n) => /soon/.test(n.title))).toHaveLength(0);
    // seeded b6 is checked out and already past its end
    const od = r1.notices.filter((n) => /overdue/.test(n.title));
    expect(od.some((n) => n.to.includes('m1'))).toBe(true);
    expect(timedNotices(s, at + 120000).notices.filter((n) => /overdue/.test(n.title))).toHaveLength(0);
  });
});

describe('Monthly statements', () => {
  it('adds up hours, $50/h rental and fuel per pilot', () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    const st = monthlyStatement(api.snapshot(), '2026-10');
    const jordan = st.rows.find((r) => r.memberId === 'm3')!;
    expect(jordan.flights).toBe(2);
    expect(jordan.billable).toBe(190);        // 0.9 + 1.0 Hobbs
    expect(jordan.rentalCents).toBe(9500);    // 1.9 h x $50
    expect(jordan.fuelCents).toBe(8662);
    expect(jordan.owedCents).toBe(9500);      // fuel paid at the pump by default
    expect(st.totals.flights).toBe(4);
    const csv = statementCsv(st, api.snapshot());
    expect(csv.split('\n')[0]).toContain('owed_to_group');
    expect(csv).toContain('Jordan Kim');
  });
  it('fuel goes on the statement when the group reimburses it', () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    const s = { ...api.snapshot(), settings: { ...api.snapshot().settings, fuelPolicy: 'add_to_statement' as const } };
    expect(monthlyStatement(s, '2026-10').rows.find((r) => r.memberId === 'm3')!.owedCents).toBe(9500 + 8662);
  });
  it('empty month has no rows', () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    expect(monthlyStatement(api.snapshot(), '2025-01').rows).toHaveLength(0);
  });
});

describe('Clear test data', () => {
  it('admin clears bookings, flights and aircraft items; members and settings stay', async () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    await expect(api.clearData('m1', { bookings: true, flights: true, aircraft: true, history: false, confirm: 'clear' })).rejects.toThrow(/CLEAR/);
    await expect(api.clearData('m2', { bookings: true, flights: true, aircraft: true, history: false, confirm: 'CLEAR' })).rejects.toThrow(/admin/);
    await api.clearData('m1', { bookings: true, flights: true, aircraft: true, history: false, confirm: 'CLEAR' });
    const s = api.snapshot();
    expect(s.bookings.length + s.flights.length + s.issues.length + s.maintenance.length + s.restrictions.length).toBe(0);
    expect(s.members).toHaveLength(6);
    expect(s.settings.rateCentsPerHour).toBe(5000);
    expect(s.audit.at(-1)!.action).toBe('data.clear');
  });
  it('can clear history too', async () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    await api.clearData('m1', { bookings: false, flights: false, aircraft: false, history: true, confirm: 'CLEAR' });
    expect(api.snapshot().audit).toHaveLength(1);
  });
  it('live app starts with only the owner and no sample data', () => {
    const s = seedLive(NOW);
    expect(s.members.map((m) => m.id)).toEqual(['owner']);
    expect(s.bookings.length + s.flights.length + s.issues.length).toBe(0);
  });
});

describe('Remove member', () => {
  it('removes a pilot, cancels their upcoming bookings, keeps their history', async () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    await expect(api.removeMember('m2', 'm3', '')).rejects.toThrow(/admin/);
    await expect(api.removeMember('m1', 'm1', '')).rejects.toThrow(/yourself/);
    const r = await api.removeMember('m1', 'm3', 'Left the group');
    expect(r.canceledBookings).toBe(1);
    expect(r.deleted).toBe(false);                      // b7 tomorrow
    const s = api.snapshot();
    const jordan = s.members.find((m) => m.id === 'm3')!;
    expect(jordan.removed).toBe(true);
    expect(jordan.active).toBe(false);
    expect(s.bookings.find((b) => b.id === 'b7')!.status).toBe('canceled');
    expect(s.flights.filter((f) => f.pilotId === 'm3')).toHaveLength(2);   // history kept
    expect(monthlyStatement(s, '2026-10').rows.some((r) => r.name === 'Jordan Kim')).toBe(true);
    await expect(api.createBooking('m3', { pilotId: 'm3', startUtc: L(9, '09:00'), endUtc: L(9, '10:00'), destination: '', notes: '' })).rejects.toThrow(/not active/);
    await expect(api.removeMember('m1', 'm3', '')).rejects.toThrow(/not found/);
    // the name can be used again for a new member
    const again = await api.addMember('m1', 'Jordan Kim', 'pilot');
    expect(again.id).not.toBe('m3');
  });
  it('deletes a pilot completely when they have no flight history', async () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    const n = await api.addMember('m1', 'New Guy', 'pilot');
    await api.createBooking('m1', { pilotId: n.id, startUtc: L(10, '09:00'), endUtc: L(10, '10:00'), destination: '', notes: '' });
    const r = await api.removeMember('m1', n.id, '');
    expect(r.deleted).toBe(true);
    const s = api.snapshot();
    expect(s.members.some((m) => m.id === n.id)).toBe(false);
    expect(s.bookings.some((b) => b.pilotId === n.id)).toBe(false);
  });
  it('blocks removing someone who has the aircraft out, and the last admin', async () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    await api.updateMember('m1', 'm2', { role: 'admin' });
    await expect(api.removeMember('m2', 'm1', '')).rejects.toThrow(/checked out/);   // m1 has b6 out
    const api2 = new MockApi({ storage: mem(), now: () => NOW });
    await api2.updateMember('m1', 'm2', { role: 'admin' });
    await api2.returnAircraft('m1', 'b6', { note: '', fuelToppedOff: true });
    await api2.removeMember('m2', 'm1', '');
    await expect(api2.removeMember('m2', 'm2', '')).rejects.toThrow(/yourself/);
  });
});

import { dueInfo, endOfMonthAfter, defaultInspections, inspectionViews, ensureInspections } from '../src/domain/inspections';

describe('Inspections', () => {
  const base = () => defaultInspections();
  const get = (id: string) => base().find((i) => i.id === id)!;
  it('has the seven standard inspections', () => {
    expect(base().map((i) => i.name)).toEqual(['50-Hour Inspection', '100-Hour Inspection', 'ELT Inspection', 'Transponder & Altimeter', 'Static & Pitot System', 'Annual Inspection', 'VOR Check']);
  });
  it('calendar months run to the end of the month', () => {
    expect(endOfMonthAfter('2026-03-15', 12)).toBe('2027-03-31');
    expect(endOfMonthAfter('2026-01-31', 24)).toBe('2028-01-31');
    expect(endOfMonthAfter('2026-11-02', 3)).toBe('2027-02-28');
  });
  it('ELT 12 months, transponder 24 months, VOR 30 days, annual Dec 31', () => {
    const today = '2026-10-10';
    expect(dueInfo({ ...get('insp_elt'), lastDate: '2025-10-05' }, null, today).nextDate).toBe('2026-10-31');
    expect(dueInfo({ ...get('insp_elt'), lastDate: '2025-10-05' }, null, today).status).toBe('soon');
    expect(dueInfo({ ...get('insp_xpdr'), lastDate: '2024-09-20' }, null, today)).toMatchObject({ nextDate: '2026-09-30', status: 'overdue' });
    expect(dueInfo({ ...get('insp_vor'), lastDate: '2026-09-01' }, null, today)).toMatchObject({ nextDate: '2026-10-01', status: 'overdue' });
    expect(dueInfo({ ...get('insp_vor'), lastDate: '2026-10-01' }, null, today)).toMatchObject({ nextDate: '2026-10-31', status: 'ok' });
    expect(dueInfo({ ...get('insp_annual'), lastDate: '2025-12-15' }, null, today)).toMatchObject({ nextDate: '2026-12-31', status: 'ok' });
  });
  it('50 and 100 hour run on tach', () => {
    const d50 = dueInfo({ ...get('insp_50hr'), lastTach: 220000 }, 224600, '2026-10-10');
    expect(d50).toMatchObject({ nextTach: 225000, tachLeft: 400, status: 'soon' });   // 4.0 h left (< 5 h)
    const d100 = dueInfo({ ...get('insp_100hr'), lastTach: 210000 }, 220150, '2026-10-10');
    expect(d100).toMatchObject({ nextTach: 220000, status: 'overdue' });
    expect(d100.summary).toContain('overdue by 1.5 h');
    expect(dueInfo({ ...get('insp_100hr'), lastTach: 210000 }, 200000, '2026-10-10', false).status).toBe('no-meter');
  });
  it('not set until the last date is entered', () => {
    expect(dueInfo(get('insp_elt'), null, '2026-10-10').status).toBe('unset');
  });
  it('recording: admin only unless pilots can record (VOR); no future dates; tach required for hour-based', async () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    await expect(api.recordInspection('m2', 'insp_annual', { date: '2026-10-01', tach: null, notes: '' })).rejects.toThrow(/admin/);
    const vor = await api.recordInspection('m2', 'insp_vor', { date: '2026-10-09', tach: null, notes: 'VOT' });
    expect(vor.lastDate).toBe('2026-10-09');
    await expect(api.recordInspection('m1', 'insp_elt', { date: '2026-12-01', tach: null, notes: '' })).rejects.toThrow(/future/);
    await expect(api.recordInspection('m1', 'insp_100hr', { date: '2026-10-09', tach: null, notes: '' })).rejects.toThrow(/tach/);
    const h = await api.recordInspection('m1', 'insp_100hr', { date: '2026-10-09', tach: 221470, notes: 'Shop' });
    expect(h.lastTach).toBe(221470);
    expect(h.history[0].notes).toBe('Shop');
    expect(api.snapshot().audit.at(-1)!.action).toBe('inspection.record');
  });
  it('admin can change the interval, add and turn off inspections', async () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    await api.updateInspection('m1', 'insp_vor', { interval: 45 });
    expect(api.snapshot().inspections.find((i) => i.id === 'insp_vor')!.interval).toBe(45);
    const oil = await api.addInspection('m1', { name: 'Oil change', kind: 'tach', interval: 50, pilotsCanRecord: false });
    expect(oil.builtIn).toBe(false);
    await api.updateInspection('m1', oil.id, { active: false });
    expect(inspectionViews(api.snapshot(), '2026-10-10').some((v) => v.insp.id === oil.id)).toBe(false);
    await expect(api.updateInspection('m2', 'insp_vor', { interval: 10 })).rejects.toThrow(/admin/);
  });
  it('older saved data gets the standard list', () => {
    const s = ensureInspections({} as { inspections?: unknown[] } as never);
    expect((s as { inspections: unknown[] }).inspections).toHaveLength(7);
  });
  it('alerts admins when due soon and everyone when overdue, once each', () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    const s = clone(api.snapshot());
    s.inspections.find((i) => i.id === 'insp_xpdr')!.lastDate = '2024-08-01';  // overdue
    const r = timedNotices(s, NOW);
    expect(r.notices.some((n) => /Transponder.*overdue/.test(n.title) && n.to.length === 6)).toBe(true);
    expect(r.notices.some((n) => /due soon/.test(n.title) && n.to.length === 1)).toBe(true);   // demo VOR / ELT soon
    expect(timedNotices(s, NOW + 60000).notices.filter((n) => /Transponder/.test(n.title))).toHaveLength(0);
  });
});

describe('Editing names', () => {
  it('admin can rename anyone; a pilot can rename only himself', async () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    const s0 = api.snapshot();
    const pilot = s0.members.find((m) => m.role === 'pilot' && m.active)!;
    const other = s0.members.find((m) => m.role === 'pilot' && m.active && m.id !== pilot.id)!;
    expect((await api.updateMember('m1', other.id, { name: 'Sam Lee' })).name).toBe('Sam Lee');
    expect((await api.updateMember(pilot.id, pilot.id, { name: '  Jo Park ' })).name).toBe('Jo Park');
    // the Settings row sends role/active unchanged along with the name — still allowed
    await api.updateMember(pilot.id, pilot.id, { name: 'Jo P', role: 'pilot', active: true });
    await expect(api.updateMember(pilot.id, other.id, { name: 'X' })).rejects.toThrow(/admin/);
    await expect(api.updateMember(pilot.id, pilot.id, { role: 'admin' })).rejects.toThrow(/own name/);
    await expect(api.updateMember(pilot.id, pilot.id, { name: ' ' })).rejects.toThrow(/required/);
    await expect(api.updateMember(pilot.id, pilot.id, { name: 'sam lee' })).rejects.toThrow(/already/);
    expect(api.snapshot().audit.some((a) => a.summary === 'Renamed Jo Park to Jo P')).toBe(true);
  });
});

describe('Note to pilots', () => {
  it('admin sets requirements in settings; a caution can move there without a cleared notice', async () => {
    const api = new MockApi({ storage: mem(), now: () => NOW });
    const s = await api.updateSettings('m1', { pilotNotes: '  Only authorized pilots.  \n\n Wear a headset ' });
    expect(s.pilotNotes).toBe('Only authorized pilots.\nWear a headset');
    const rid = (await api.addRestriction('m1', 'caution', 'No passengers in the back seat.')).id;
    const mid = clone(api.snapshot());
    await api.restrictionToNote('m1', rid);
    const after = api.snapshot();
    expect(after.settings.pilotNotes!.split('\n')).toContain(after.restrictions.find((x) => x.id === rid)!.reason);
    expect(after.restrictions.find((x) => x.id === rid)!.clearedAt).toBeTruthy();
    expect(noticesForChange(mid, after)).toHaveLength(0);
    expect(after.settings.pilotNotes).toBe('Only authorized pilots.\nWear a headset\nNo passengers in the back seat.');
    const g = (await api.addRestriction('m1', 'grounded', 'Flat tire on the left main')).id;
    await expect(api.restrictionToNote('m1', g)).rejects.toThrow(/grounding/);
    const c2 = (await api.addRestriction('m1', 'caution', 'Another caution here')).id;
    await expect(api.restrictionToNote('m2', c2)).rejects.toThrow(/admin/);
  });
});

import { nNumberToIcao, icaoFor } from '../src/domain/icao';
import { trackStats, fromOpenSky, downsample } from '../src/domain/track';
describe('Flight paths', () => {
  it('works out the transponder code from the tail number', () => {
    expect(nNumberToIcao('N733XZ')).toBe('a9d855'); // FAA registry
    expect(nNumberToIcao('N1')).toBe('a00001');
    expect(nNumberToIcao('N99999')).toBe('adf7c7');
    expect(nNumberToIcao('N1A')).toBe('a00002');
    expect(nNumberToIcao('NBAD')).toBeNull();
    expect(icaoFor({ tailNumber: 'N733XZ' })).toBe('a9d855');
    expect(icaoFor({ tailNumber: 'N733XZ', icao24: 'ABC123' })).toBe('abc123');
  });
  it('converts OpenSky waypoints and measures the flight', () => {
    const pts = fromOpenSky([[1000, 35.43, -119.05, 150, 0, true], [1600, 35.6, -119.05, 1500, 0, false], [2200, 35.43, -119.05, null, 0, false], ['x']]);
    expect(pts).toHaveLength(3);
    expect(pts[1][3]).toBe(4921);
    const st = trackStats(pts);
    expect(st.minutes).toBe(20);
    expect(st.maxAlt).toBe(4921);
    expect(st.nm).toBeGreaterThan(20); expect(st.nm).toBeLessThan(21);
    expect(downsample(Array.from({ length: 2000 }, (_, i) => [i, 0, 0, 0] as [number, number, number, number]), 100)).toHaveLength(100);
  });
});
