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
