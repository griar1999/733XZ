// Who gets a phone notification for each change. Pure functions: the server compares the
// state before and after an action (or a timed check) and sends whatever these return.
import type { AuditEntry, Booking, DbState } from './types';
import { fmtDateTime, fmtRange } from './time';

export interface PhoneNotice { to: string[]; title: string; body: string; url: string; tag: string }

const REMIND_BEFORE_MIN = 120; // "your booking starts soon" this many minutes ahead
const OVERDUE_AFTER_MIN = 15;  // "aircraft overdue" this many minutes after the booking ends

const active = (db: DbState) => db.members.filter((m) => m.active).map((m) => m.id);
const admins = (db: DbState) => db.members.filter((m) => m.active && m.role === 'admin').map((m) => m.id);
const nameOf = (db: DbState, id: string) => db.members.find((m) => m.id === id)?.name ?? 'Someone';
const firstName = (db: DbState, id: string) => nameOf(db, id).split(' ')[0];
const uniq = (ids: string[], except?: string) => [...new Set(ids)].filter((x) => x !== except);

/** Notices for the audit entries an action just added. */
export function noticesForChange(before: DbState, after: DbState): PhoneNotice[] {
  const seen = new Set(before.audit.map((a) => a.id));
  const fresh = after.audit.filter((a) => !seen.has(a.id));
  const out: PhoneNotice[] = [];
  const tz = after.settings.timeZone;
  const tail = after.settings.tailNumber;
  for (const a of fresh) {
    const n = noticeFor(a, before, after, tz, tail);
    for (const x of n) if (x.to.length) out.push(x);
  }
  return out;
}

function noticeFor(a: AuditEntry, before: DbState, db: DbState, tz: string, tail: string): PhoneNotice[] {
  const who = firstName(db, a.actorId);
  const b = a.entityType === 'booking' ? db.bookings.find((x) => x.id === a.entityId) : undefined;
  const when = b ? fmtRange(b.startUtc, b.endUtc, tz) : '';
  const tag = `${a.action}:${a.entityId ?? a.id}`;
  switch (a.action) {
    case 'booking.create':
      if (!b) return [];
      return [{ to: uniq(active(db), a.actorId), title: `${tail} booked`, body: `${firstName(db, b.pilotId)} · ${when}${b.destination ? ` → ${b.destination}` : ''}`, url: '/#calendar', tag }];
    case 'booking.update': {
      if (!b) return [];
      const old = before.bookings.find((x) => x.id === b.id);
      const moved = old ? `Was ${fmtRange(old.startUtc, old.endUtc, tz)}. ` : '';
      return [{ to: uniq(active(db), a.actorId), title: `${tail} booking changed`, body: `${firstName(db, b.pilotId)} · now ${when}. ${moved}`.trim(), url: '/#calendar', tag: `${tag}:${b.version}` }];
    }
    case 'booking.cancel':
      if (!b) return [];
      return [{ to: uniq(active(db), a.actorId), title: `${tail} is open`, body: `${firstName(db, b.pilotId)} canceled ${when}.${a.actorId !== b.pilotId ? ` (Canceled by ${who}.)` : ''}`, url: '/#calendar', tag }];
    case 'booking.no_show':
      if (!b) return [];
      return [{ to: uniq([b.pilotId], a.actorId), title: 'No-show recorded', body: `${who} recorded a no-show for your booking ${when}.`, url: '/#bookings', tag }];
    case 'booking.return': {
      if (!b) return [];
      const out: PhoneNotice[] = [];
      if (b.fuelToppedOff === false) out.push({ to: uniq(admins(db), a.actorId), title: `${tail} returned without top-off`, body: `${firstName(db, b.pilotId)} returned the aircraft without topping off the fuel.${b.returnNote ? ` Note: ${b.returnNote}` : ''}`, url: '/#bookings', tag: `${tag}:fuel` });
      if (a.actorId !== b.pilotId) out.push({ to: [b.pilotId], title: `${tail} returned for you`, body: `${who} returned the aircraft on your booking. Add your flight record if you haven't.`, url: '/#log', tag });
      return out;
    }
    case 'flight.create': {
      const f = db.flights.find((x) => x.id === a.entityId);
      if (!f || !f.flags.length) return [];
      return [{ to: uniq(admins(db), a.actorId), title: 'Flight record needs review', body: `${firstName(db, f.pilotId)} · ${f.route}: ${f.flags[0]}`, url: '/#log', tag }];
    }
    case 'issue.report': {
      const i = db.issues.find((x) => x.id === a.entityId);
      if (!i) return [];
      const grounding = i.urgency === 'grounding' || !!i.restrictionId;
      return [{ to: uniq(grounding ? active(db) : admins(db), a.actorId), title: grounding ? `${tail} grounded: issue reported` : `${tail} issue reported`, body: `${who}: ${i.title} (${i.urgency})`, url: '/#more', tag }];
    }
    case 'restriction.add': {
      const r = db.restrictions.find((x) => x.id === a.entityId);
      if (!r || r.issueId) return []; // grounding from an issue report is already covered above
      return [{ to: uniq(active(db), a.actorId), title: r.level === 'grounded' ? `${tail} grounded` : `${tail} caution`, body: r.reason, url: '/#more', tag }];
    }
    case 'restriction.clear': {
      const r = db.restrictions.find((x) => x.id === a.entityId);
      if (!r) return [];
      return [{ to: uniq(active(db), a.actorId), title: r.level === 'grounded' ? `${tail} grounding cleared` : `${tail} caution cleared`, body: `${r.reason} — cleared by ${who}: ${r.clearReason ?? ''}`.trim(), url: '/', tag }];
    }
    case 'maintenance.create': {
      const m = db.maintenance.find((x) => x.id === a.entityId);
      if (!m) return [];
      const span = fmtRange(m.startUtc, m.endUtc, tz);
      const hit = db.bookings.filter((x) => (x.status === 'confirmed' || x.status === 'checked_out') && Date.parse(x.startUtc) < Date.parse(m.endUtc) && Date.parse(m.startUtc) < Date.parse(x.endUtc));
      const hitPilots = new Set(hit.map((x) => x.pilotId));
      return [
        { to: uniq(active(db).filter((id) => !hitPilots.has(id)), a.actorId), title: `${tail} maintenance scheduled`, body: `${m.title} · ${span}`, url: '/#calendar', tag },
        ...hit.map((x) => ({ to: uniq([x.pilotId], a.actorId), title: 'Maintenance overlaps your booking', body: `${m.title} (${span}) overlaps your booking ${fmtRange(x.startUtc, x.endUtc, tz)}. Talk to ${who} about moving it.`, url: '/#bookings', tag: `${tag}:${x.id}` })),
      ];
    }
    default:
      return [];
  }
}

/**
 * Timed checks: booking reminders and overdue returns. Marks each booking so a notice goes out once.
 * Returns the notices and whether the state changed.
 */
export function timedNotices(db: DbState, nowMs: number): { notices: PhoneNotice[]; changed: boolean } {
  const tz = db.settings.timeZone;
  const tail = db.settings.tailNumber;
  const at = new Date(nowMs).toISOString();
  const notices: PhoneNotice[] = [];
  let changed = false;
  const grounded = db.restrictions.some((r) => !r.clearedAt && r.level === 'grounded');
  for (const b of db.bookings) {
    const start = Date.parse(b.startUtc), end = Date.parse(b.endUtc);
    if (b.status === 'confirmed' && !b.remindedAt && start > nowMs && start - nowMs <= REMIND_BEFORE_MIN * 60000) {
      b.remindedAt = at; changed = true;
      notices.push({ to: [b.pilotId], title: `Your ${tail} booking is soon`, body: `${fmtRange(b.startUtc, b.endUtc, tz)}.${grounded ? ' Heads up: the aircraft is grounded right now.' : ' Check restrictions before you go.'}`, url: '/', tag: `remind:${b.id}` });
    }
    if (b.status === 'checked_out' && !b.overdueNotifiedAt && nowMs - end >= OVERDUE_AFTER_MIN * 60000) {
      b.overdueNotifiedAt = at; changed = true;
      notices.push({ to: [b.pilotId], title: `${tail} is overdue`, body: `Your booking ended ${fmtDateTime(b.endUtc, tz)}. Return the aircraft in the app when you're back.`, url: '/#bookings', tag: `overdue:${b.id}` });
      const others = admins(db).filter((x) => x !== b.pilotId);
      if (others.length) notices.push({ to: others, title: `${tail} is overdue`, body: `${nameOf(db, b.pilotId)} hasn't returned the aircraft. Booking ended ${fmtDateTime(b.endUtc, tz)}.`, url: '/#bookings', tag: `overdue-admin:${b.id}` });
      // the next pilot waiting on the aircraft
      const next = db.bookings.filter((x) => x.status === 'confirmed' && Date.parse(x.startUtc) >= end && Date.parse(x.startUtc) - nowMs < 6 * 3600e3).sort((x, y) => Date.parse(x.startUtc) - Date.parse(y.startUtc))[0];
      if (next && next.pilotId !== b.pilotId) notices.push({ to: [next.pilotId], title: `${tail} not back yet`, body: `${firstName(db, b.pilotId)}'s booking ended ${fmtDateTime(b.endUtc, tz)} and the aircraft is still checked out. Your booking: ${fmtRange(next.startUtc, next.endUtc, tz)}.`, url: '/', tag: `overdue-next:${b.id}` });
    }
  }
  return { notices, changed };
}

/** True if any booking is due a timed notice, so the server only writes when needed. */
export function timedNoticesDue(db: DbState, nowMs: number): boolean {
  return db.bookings.some((b: Booking) =>
    (b.status === 'confirmed' && !b.remindedAt && Date.parse(b.startUtc) > nowMs && Date.parse(b.startUtc) - nowMs <= REMIND_BEFORE_MIN * 60000) ||
    (b.status === 'checked_out' && !b.overdueNotifiedAt && nowMs - Date.parse(b.endUtc) >= OVERDUE_AFTER_MIN * 60000));
}
