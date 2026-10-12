// Every change to the aircraft schedule is a named action. The same table runs on the phone
// (demo build) and on the server (live build). On the server the actor comes from the signed-in
// session, never from the request body, so a member can't act as someone else.
// Each action receives a private copy of the state, validates against it, mutates it, and returns
// a result. If it throws, nothing is saved.
import type { AircraftSettings, AuditEntry, Booking, BookingInput, DbState, FlightInput, FlightRecord, Issue, IssueStatus, IssueUrgency, MaintenanceBlock, Member, Restriction } from '../domain/types';
import { ApiError } from './api';
import { BLOCKING, canEditBooking, checkOutBlocker, findConflicts, overlaps, suggestSlot, validateFlight, validateTimes } from '../domain/rules';

export interface MaintenanceInput { title: string; startUtc: string; endUtc: string; notes: string }
export interface IssueInput { title: string; description: string; urgency: IssueUrgency; photoDataUrl?: string; groundAircraft: boolean }
export interface ReturnInput { note: string; fuelToppedOff: boolean }

let idCounter = 0;
export const newId = (p: string) => `${p}_${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const iso = (ms: number) => new Date(ms).toISOString();
const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null);
const isoArg = (v: unknown): string => { const s = str(v, 40); return Number.isFinite(Date.parse(s)) ? new Date(Date.parse(s)).toISOString() : 'invalid'; };

function actor(db: DbState, id: string): Member {
  const m = db.members.find((x) => x.id === id);
  if (!m || !m.active) throw new ApiError('forbidden', 'This account is not active.');
  return m;
}
function requireAdmin(db: DbState, id: string): Member {
  const m = actor(db, id);
  if (m.role !== 'admin') throw new ApiError('forbidden', 'Only an admin can do this.');
  return m;
}
function audit(db: DbState, now: number, e: Omit<AuditEntry, 'id' | 'at'>) {
  db.audit.push({ id: newId('a'), at: iso(now), ...e });
  if (db.audit.length > 2000) db.audit.splice(0, db.audit.length - 2000);
}
function booking(db: DbState, id: string): Booking {
  const b = db.bookings.find((x) => x.id === id);
  if (!b) throw new ApiError('not_found', 'That reservation no longer exists.');
  return b;
}
const name = (db: DbState, id: string) => db.members.find((m) => m.id === id)?.name ?? 'Unknown';

function cleanBookingInput(v: unknown): BookingInput {
  const o = (v ?? {}) as Record<string, unknown>;
  return { pilotId: str(o.pilotId, 40), startUtc: isoArg(o.startUtc), endUtc: isoArg(o.endUtc), destination: str(o.destination, 80), notes: str(o.notes, 600) };
}
function cleanFlightInput(v: unknown): FlightInput {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    bookingId: str(o.bookingId, 60), pilotId: str(o.pilotId, 40), flightDate: str(o.flightDate, 10), route: str(o.route, 120),
    hobbsStart: numOrNull(o.hobbsStart), hobbsEnd: numOrNull(o.hobbsEnd), tachStart: numOrNull(o.tachStart), tachEnd: numOrNull(o.tachEnd),
    fuelGallons: numOrNull(o.fuelGallons), fuelCostCents: numOrNull(o.fuelCostCents), notes: str(o.notes, 600), submissionKey: str(o.submissionKey, 80),
  };
}

function checkBookingInput(db: DbState, who: Member, input: BookingInput, now: number, excludeId?: string) {
  const fieldErrors: Record<string, string> = {};
  const pilot = db.members.find((m) => m.id === input.pilotId);
  if (!pilot || !pilot.active) fieldErrors.pilotId = 'Choose an active pilot.';
  if (who.role !== 'admin' && input.pilotId !== who.id) throw new ApiError('forbidden', 'Pilots can only book for themselves.');
  const t = validateTimes(input.startUtc, input.endUtc, now);
  if (t) fieldErrors.time = t;
  if (input.destination.length > 60) fieldErrors.destination = 'Keep the destination under 60 characters.';
  if (input.notes.length > 500) fieldErrors.notes = 'Keep notes under 500 characters.';
  if (Object.keys(fieldErrors).length) throw new ApiError('validation', Object.values(fieldErrors)[0], { fieldErrors });
  const conflicts = findConflicts(db, input.startUtc, input.endUtc, db.settings.bufferMinutes, excludeId);
  if (conflicts.length) {
    const dur = Math.round((Date.parse(input.endUtc) - Date.parse(input.startUtc)) / 60000);
    const from = iso(Math.max(Date.parse(input.startUtc), now));
    throw new ApiError('conflict', 'That time overlaps another reservation or maintenance.', {
      conflicts, suggestion: suggestSlot(db, dur, from, db.settings.bufferMinutes, excludeId),
    });
  }
}

type Run = (db: DbState, actorId: string, now: number, args: unknown[]) => unknown;
interface ActionDef { demoOnly?: boolean; run: Run }
const def = (run: Run, demoOnly = false): ActionDef => ({ run, demoOnly });

export const ACTIONS: Record<string, ActionDef> = {
  // ---------- bookings ----------
  createBooking: def((db, actorId, now, [raw]) => {
    const who = actor(db, actorId);
    const input = cleanBookingInput(raw);
    checkBookingInput(db, who, input, now);
    const b: Booking = { id: newId('b'), ...input, destination: input.destination.trim(), notes: input.notes.trim(), status: 'confirmed', createdBy: actorId, createdAt: iso(now), updatedAt: iso(now), version: 1 };
    db.bookings.push(b);
    audit(db, now, { actorId, action: 'booking.create', entityType: 'booking', entityId: b.id, summary: `Booked for ${name(db, b.pilotId)}`, after: b });
    return b;
  }),

  updateBooking: def((db, actorId, now, [rawId, raw, expectedVersion]) => {
    const who = actor(db, actorId);
    const id = str(rawId, 60);
    const b = booking(db, id);
    const why = canEditBooking(who, b);
    if (why) throw new ApiError('forbidden', why);
    if (b.version !== Number(expectedVersion)) throw new ApiError('stale', 'This reservation changed since you opened it. Close and reopen it to see the latest version.');
    const input = cleanBookingInput(raw);
    if (who.role !== 'admin' && input.pilotId !== b.pilotId) throw new ApiError('forbidden', 'Only an admin can reassign a reservation to another pilot.');
    checkBookingInput(db, who, input, now, id);
    const before = { ...b };
    Object.assign(b, { pilotId: input.pilotId, startUtc: input.startUtc, endUtc: input.endUtc, destination: input.destination.trim(), notes: input.notes.trim(), updatedAt: iso(now), version: b.version + 1 });
    audit(db, now, { actorId, action: 'booking.update', entityType: 'booking', entityId: id, summary: who.id === b.pilotId ? 'Changed reservation' : `Admin changed ${name(db, b.pilotId)}'s reservation`, before, after: { ...b } });
    return b;
  }),

  cancelBooking: def((db, actorId, now, [rawId, rawReason]) => {
    const who = actor(db, actorId);
    const id = str(rawId, 60), reason = str(rawReason, 300).trim();
    const b = booking(db, id);
    if (who.role !== 'admin' && b.pilotId !== who.id) throw new ApiError('forbidden', 'Only the booking pilot or an admin can cancel this reservation.');
    if (b.status !== 'confirmed') throw new ApiError('validation', 'Only confirmed reservations can be canceled.');
    const before = { ...b };
    Object.assign(b, { status: 'canceled', canceledAt: iso(now), canceledBy: actorId, cancelReason: reason, version: b.version + 1, updatedAt: iso(now) });
    audit(db, now, { actorId, action: 'booking.cancel', entityType: 'booking', entityId: id, summary: `Canceled ${name(db, b.pilotId)}'s reservation${reason ? ': ' + reason : ''}`, before, after: { ...b } });
    return b;
  }),

  markNoShow: def((db, actorId, now, [rawId, rawReason]) => {
    requireAdmin(db, actorId);
    const id = str(rawId, 60), reason = str(rawReason, 300).trim();
    const b = booking(db, id);
    if (b.status !== 'confirmed') throw new ApiError('validation', 'Only a confirmed reservation that was never checked out can be marked as a no-show.');
    if (now < Date.parse(b.startUtc)) throw new ApiError('validation', 'A no-show can only be recorded after the reservation start time.');
    Object.assign(b, { status: 'no_show', noShowAt: iso(now), noShowBy: actorId, version: b.version + 1 });
    audit(db, now, { actorId, action: 'booking.no_show', entityType: 'booking', entityId: id, summary: `Recorded no-show for ${name(db, b.pilotId)}${reason ? ': ' + reason : ''}` });
    return b;
  }),

  checkOut: def((db, actorId, now, [rawId]) => {
    const who = actor(db, actorId);
    const id = str(rawId, 60);
    const b = booking(db, id);
    const why = checkOutBlocker(db, b, who, now);
    if (why) throw new ApiError('validation', why);
    Object.assign(b, { status: 'checked_out', checkedOutAt: iso(now), checkedOutBy: actorId, version: b.version + 1 });
    audit(db, now, { actorId, action: 'booking.check_out', entityType: 'booking', entityId: id, summary: `Checked out aircraft for ${name(db, b.pilotId)}` });
    return b;
  }),

  returnAircraft: def((db, actorId, now, [rawId, raw]) => {
    const who = actor(db, actorId);
    const id = str(rawId, 60);
    const o = (raw ?? {}) as Record<string, unknown>;
    const input: ReturnInput = { note: str(o.note, 500), fuelToppedOff: o.fuelToppedOff === true };
    const b = booking(db, id);
    if (who.role !== 'admin' && b.pilotId !== who.id) throw new ApiError('forbidden', 'Only the booking pilot or an admin can return this aircraft.');
    if (b.status !== 'checked_out') throw new ApiError('validation', 'This reservation is not checked out.');
    if (who.id !== b.pilotId && !input.note.trim()) throw new ApiError('validation', 'Add a note explaining why you are returning another pilot\'s aircraft.', { fieldErrors: { note: 'A note is required when returning for another pilot.' } });
    const late = now > Date.parse(b.endUtc);
    Object.assign(b, { status: 'completed', returnedAt: iso(now), returnedBy: actorId, returnNote: input.note.trim(), fuelToppedOff: input.fuelToppedOff, flightRecordNeeded: !db.flights.some((f) => f.bookingId === id && !f.voided), version: b.version + 1 });
    audit(db, now, { actorId, action: 'booking.return', entityType: 'booking', entityId: id, summary: `Returned aircraft${late ? ' after reservation end' : ''}${input.fuelToppedOff ? ', fuel topped off' : ', fuel NOT topped off'}${who.id !== b.pilotId ? ' (on behalf of ' + name(db, b.pilotId) + ')' : ''}` });
    return b;
  }),

  // ---------- flight records ----------
  submitFlight: def((db, actorId, now, [raw]) => {
    const who = actor(db, actorId);
    const input = cleanFlightInput(raw);
    if (!input.submissionKey) throw new ApiError('validation', 'Missing submission key. Reload and try again.');
    const existing = db.flights.find((f) => f.submissionKey === input.submissionKey);
    if (existing) return { record: existing, flags: existing.flags, replayed: true };
    if (who.role !== 'admin' && input.pilotId !== who.id) throw new ApiError('forbidden', 'Pilots can only record their own flights.');
    const b = booking(db, input.bookingId);
    if (b.pilotId !== input.pilotId) throw new ApiError('validation', 'The pilot must match the reservation.', { fieldErrors: { pilotId: 'The pilot must match the reservation.' } });
    if (b.status !== 'checked_out' && b.status !== 'completed') throw new ApiError('validation', 'Flights can only be recorded for a reservation that was checked out.', { fieldErrors: { bookingId: 'Choose a checked-out or completed reservation.' } });
    const s = db.settings;
    const clean: FlightInput = { ...input, hobbsStart: s.hobbsEnabled ? input.hobbsStart : null, hobbsEnd: s.hobbsEnabled ? input.hobbsEnd : null, tachStart: s.tachEnabled ? input.tachStart : null, tachEnd: s.tachEnabled ? input.tachEnd : null };
    const v = validateFlight(clean, db);
    if (Object.keys(v.errors).length) throw new ApiError(v.errors.form?.includes('already recorded') ? 'duplicate' : 'validation', v.errors.form ?? Object.values(v.errors)[0], { fieldErrors: v.errors });
    const rec: FlightRecord = { id: newId('f'), ...clean, route: clean.route.trim(), notes: clean.notes.trim(), flags: v.flags, createdAt: iso(now), createdBy: actorId, revisions: [] };
    db.flights.push(rec);
    if (b.status === 'completed') b.flightRecordNeeded = false;
    audit(db, now, { actorId, action: 'flight.create', entityType: 'flight', entityId: rec.id, summary: `Recorded flight ${rec.route}${v.flags.length ? ` (${v.flags.length} flagged for review)` : ''}`, after: rec });
    return { record: rec, flags: v.flags, replayed: false };
  }),

  correctFlight: def((db, actorId, now, [rawId, rawChanges, rawReason]) => {
    const who = actor(db, actorId);
    const id = str(rawId, 60), reason = str(rawReason, 300).trim();
    const f = db.flights.find((x) => x.id === id);
    if (!f) throw new ApiError('not_found', 'That flight record no longer exists.');
    if (who.role !== 'admin' && f.pilotId !== who.id) throw new ApiError('forbidden', 'You can only correct your own flight records.');
    if (!reason) throw new ApiError('validation', 'Explain why this record is being corrected.', { fieldErrors: { reason: 'A reason is required.' } });
    const c = (rawChanges ?? {}) as Record<string, unknown>;
    const changes: Partial<FlightInput> = {};
    for (const k of ['flightDate', 'route', 'notes'] as const) if (k in c) changes[k] = str(c[k], k === 'flightDate' ? 10 : 600);
    for (const k of ['hobbsStart', 'hobbsEnd', 'tachStart', 'tachEnd', 'fuelGallons', 'fuelCostCents'] as const) if (k in c) changes[k] = numOrNull(c[k]);
    const keys = ['flightDate', 'route', 'hobbsStart', 'hobbsEnd', 'tachStart', 'tachEnd', 'fuelGallons', 'fuelCostCents', 'notes'] as const;
    const previous: Partial<FlightRecord> = {};
    const merged: FlightInput = { bookingId: f.bookingId, pilotId: f.pilotId, flightDate: f.flightDate, route: f.route, hobbsStart: f.hobbsStart, hobbsEnd: f.hobbsEnd, tachStart: f.tachStart, tachEnd: f.tachEnd, fuelGallons: f.fuelGallons, fuelCostCents: f.fuelCostCents, notes: f.notes, submissionKey: f.submissionKey };
    const M = merged as unknown as Record<string, unknown>, F = f as unknown as Record<string, unknown>, P = previous as Record<string, unknown>;
    for (const k of keys) if (k in changes && changes[k] !== F[k]) { P[k] = F[k]; M[k] = changes[k]; }
    if (!Object.keys(previous).length) throw new ApiError('validation', 'Nothing changed.');
    const v = validateFlight(merged, db, { editingId: id });
    if (Object.keys(v.errors).length) throw new ApiError('validation', Object.values(v.errors)[0], { fieldErrors: v.errors });
    for (const k of keys) F[k] = M[k];
    f.flags = [...v.flags, `Corrected by ${name(db, actorId)}: ${reason}`];
    f.revisions.push({ at: iso(now), by: actorId, reason, previous });
    audit(db, now, { actorId, action: 'flight.correct', entityType: 'flight', entityId: id, summary: `Corrected flight record: ${reason}`, before: previous, after: Object.fromEntries(Object.keys(previous).map((k) => [k, F[k]])) });
    return f;
  }),

  // ---------- issues, maintenance, restrictions ----------
  reportIssue: def((db, actorId, now, [raw]) => {
    actor(db, actorId);
    const o = (raw ?? {}) as Record<string, unknown>;
    const urgencies: IssueUrgency[] = ['low', 'medium', 'high', 'grounding'];
    const input: IssueInput = {
      title: str(o.title, 120), description: str(o.description, 2000),
      urgency: urgencies.includes(o.urgency as IssueUrgency) ? (o.urgency as IssueUrgency) : 'medium',
      photoDataUrl: typeof o.photoDataUrl === 'string' && o.photoDataUrl ? o.photoDataUrl : undefined,
      groundAircraft: o.groundAircraft === true,
    };
    if (!input.title.trim()) throw new ApiError('validation', 'Give the issue a short title.', { fieldErrors: { title: 'A title is required.' } });
    if (input.photoDataUrl && input.photoDataUrl.length > 1_500_000) throw new ApiError('validation', 'That photo is too large. Try a smaller image.');
    const at = iso(now);
    const issue: Issue = { id: newId('i'), title: input.title.trim(), description: input.description.trim(), urgency: input.urgency, status: 'open', reportedBy: actorId, reportedAt: at, photoDataUrl: input.photoDataUrl, history: [{ at, by: actorId, status: 'open', note: 'Reported' }] };
    db.issues.push(issue);
    audit(db, now, { actorId, action: 'issue.report', entityType: 'issue', entityId: issue.id, summary: `Reported issue: ${issue.title} (${issue.urgency})` });
    if (input.groundAircraft || input.urgency === 'grounding') {
      const r: Restriction = { id: newId('r'), level: 'grounded', reason: `Reported: ${issue.title}`, createdBy: actorId, createdAt: at, issueId: issue.id };
      db.restrictions.push(r);
      issue.restrictionId = r.id;
      audit(db, now, { actorId, action: 'restriction.add', entityType: 'restriction', entityId: r.id, summary: `Aircraft grounded from issue report: ${issue.title}` });
    }
    return issue;
  }),

  updateIssue: def((db, actorId, now, [rawId, rawStatus, rawNote]) => {
    requireAdmin(db, actorId);
    const statuses: IssueStatus[] = ['open', 'investigating', 'deferred', 'resolved'];
    const status = statuses.includes(rawStatus as IssueStatus) ? (rawStatus as IssueStatus) : null;
    if (!status) throw new ApiError('validation', 'Choose a status.');
    const note = str(rawNote, 500).trim();
    const i = db.issues.find((x) => x.id === str(rawId, 60));
    if (!i) throw new ApiError('not_found', 'That issue no longer exists.');
    if (!note) throw new ApiError('validation', 'Add a note describing this update.', { fieldErrors: { note: 'A note is required.' } });
    i.status = status;
    i.history.push({ at: iso(now), by: actorId, status, note });
    audit(db, now, { actorId, action: 'issue.update', entityType: 'issue', entityId: i.id, summary: `Issue "${i.title}" set to ${status}: ${note}` });
    return i;
  }),

  createMaintenance: def((db, actorId, now, [raw, ack]) => {
    requireAdmin(db, actorId);
    const o = (raw ?? {}) as Record<string, unknown>;
    const input: MaintenanceInput = { title: str(o.title, 120), startUtc: isoArg(o.startUtc), endUtc: isoArg(o.endUtc), notes: str(o.notes, 1000) };
    if (!input.title.trim()) throw new ApiError('validation', 'Enter a title for the maintenance block.', { fieldErrors: { title: 'A title is required.' } });
    const t = validateTimes(input.startUtc, input.endUtc, now);
    if (t) throw new ApiError('validation', t, { fieldErrors: { time: t } });
    const affected = db.bookings.filter((b) => BLOCKING.includes(b.status) && overlaps(b.startUtc, b.endUtc, input.startUtc, input.endUtc, 0));
    if (affected.length && ack !== true) throw new ApiError('needs_review', `${affected.length} reservation${affected.length > 1 ? 's overlap' : ' overlaps'} this maintenance window.`, { affected });
    const m: MaintenanceBlock = { id: newId('mx'), title: input.title.trim(), startUtc: input.startUtc, endUtc: input.endUtc, notes: input.notes.trim(), status: 'scheduled', createdBy: actorId, createdAt: iso(now) };
    db.maintenance.push(m);
    audit(db, now, { actorId, action: 'maintenance.create', entityType: 'maintenance', entityId: m.id, summary: `Scheduled maintenance: ${m.title}${affected.length ? ` — ${affected.length} reservation(s) kept for admin review` : ''}` });
    return m;
  }),

  endMaintenance: def((db, actorId, now, [rawId, rawMode, rawNote]) => {
    requireAdmin(db, actorId);
    const mode = rawMode === 'canceled' ? 'canceled' : 'ended';
    const note = str(rawNote, 300).trim();
    const m = db.maintenance.find((x) => x.id === str(rawId, 60));
    if (!m) throw new ApiError('not_found', 'That maintenance block no longer exists.');
    if (m.status !== 'scheduled') throw new ApiError('validation', 'This maintenance block is already closed.');
    m.status = mode; m.endedAt = iso(now); m.endedBy = actorId;
    if (mode === 'ended' && Date.parse(m.endUtc) > now) m.endUtc = iso(now);
    audit(db, now, { actorId, action: `maintenance.${mode}`, entityType: 'maintenance', entityId: m.id, summary: `${mode === 'ended' ? 'Ended' : 'Canceled'} maintenance: ${m.title}${note ? ' — ' + note : ''}. Restrictions unchanged.` });
    return m;
  }),

  addRestriction: def((db, actorId, now, [rawLevel, rawReason]) => {
    requireAdmin(db, actorId);
    const level: Restriction['level'] = rawLevel === 'caution' ? 'caution' : 'grounded';
    const reason = str(rawReason, 300).trim();
    if (!reason) throw new ApiError('validation', 'Enter the reason for this restriction.', { fieldErrors: { reason: 'A reason is required.' } });
    const r: Restriction = { id: newId('r'), level, reason, createdBy: actorId, createdAt: iso(now) };
    db.restrictions.push(r);
    audit(db, now, { actorId, action: 'restriction.add', entityType: 'restriction', entityId: r.id, summary: `Added ${level === 'grounded' ? 'grounding' : 'caution'}: ${r.reason}` });
    return r;
  }),

  clearRestriction: def((db, actorId, now, [rawId, rawReason]) => {
    requireAdmin(db, actorId);
    const reason = str(rawReason, 300).trim();
    const r = db.restrictions.find((x) => x.id === str(rawId, 60));
    if (!r) throw new ApiError('not_found', 'That restriction no longer exists.');
    if (r.clearedAt) throw new ApiError('validation', 'This restriction is already cleared.');
    if (reason.length < 10) throw new ApiError('validation', 'Record a specific reason (at least 10 characters), such as who signed off the repair.', { fieldErrors: { reason: 'At least 10 characters.' } });
    r.clearedAt = iso(now); r.clearedBy = actorId; r.clearReason = reason;
    audit(db, now, { actorId, action: 'restriction.clear', entityType: 'restriction', entityId: r.id, summary: `Cleared ${r.level === 'grounded' ? 'grounding' : 'caution'} "${r.reason}": ${r.clearReason}` });
    return r;
  }),

  // ---------- admin ----------
  updateSettings: def((db, actorId, now, [rawPatch]) => {
    requireAdmin(db, actorId);
    const p = (rawPatch ?? {}) as Record<string, unknown>;
    const patch: Partial<AircraftSettings> = {};
    for (const k of ['appName', 'tailNumber', 'model', 'homeAirport', 'timeZone'] as const) if (k in p) patch[k] = str(p[k], 80);
    if ('photoDataUrl' in p) patch.photoDataUrl = typeof p.photoDataUrl === 'string' && p.photoDataUrl ? p.photoDataUrl : undefined;
    for (const k of ['bufferMinutes', 'earlyCheckoutMinutes', 'rateCentsPerHour'] as const) if (k in p) patch[k] = Number(p[k]);
    for (const k of ['hobbsEnabled', 'tachEnabled', 'topOffRequired'] as const) if (k in p) patch[k] = p[k] === true;
    if ('rateBasis' in p) patch.rateBasis = p.rateBasis === 'tach' ? 'tach' : 'hobbs';
    if ('fuelPolicy' in p) patch.fuelPolicy = p.fuelPolicy === 'add_to_statement' ? 'add_to_statement' : 'pilot_pays_at_pump';
    const next = { ...db.settings, ...patch };
    const fe: Record<string, string> = {};
    if (!next.appName.trim()) fe.appName = 'App name is required.';
    if (!/^[A-Z0-9-]{2,10}$/i.test(next.tailNumber.trim())) fe.tailNumber = 'Enter a tail number like N12345.';
    if (!next.model.trim()) fe.model = 'Aircraft model is required.';
    if (!/^[A-Z0-9]{3,4}$/i.test(next.homeAirport.trim())) fe.homeAirport = 'Use a 3–4 character airport identifier.';
    try { new Intl.DateTimeFormat('en-US', { timeZone: next.timeZone }); } catch { fe.timeZone = 'Unknown time zone.'; }
    if (!Number.isInteger(next.bufferMinutes) || next.bufferMinutes < 0 || next.bufferMinutes > 240) fe.bufferMinutes = 'Buffer must be 0–240 minutes.';
    if (!Number.isInteger(next.earlyCheckoutMinutes) || next.earlyCheckoutMinutes < 0 || next.earlyCheckoutMinutes > 240) fe.earlyCheckoutMinutes = 'Early check-out must be 0–240 minutes.';
    if (!next.hobbsEnabled && !next.tachEnabled) fe.meters = 'Keep at least one meter turned on.';
    if (next.rateBasis === 'hobbs' && !next.hobbsEnabled) fe.rateBasis = 'Rental is billed on Hobbs, which is turned off. Switch the rate basis to tach first.';
    if (next.rateBasis === 'tach' && !next.tachEnabled) fe.rateBasis = 'Rental is billed on tach, which is turned off. Switch the rate basis to Hobbs first.';
    if (!Number.isInteger(next.rateCentsPerHour) || next.rateCentsPerHour < 0 || next.rateCentsPerHour > 100000) fe.rate = 'Enter an hourly rate between $0 and $1,000.';
    if (next.photoDataUrl && next.photoDataUrl.length > 1_500_000) fe.photo = 'That photo is too large.';
    if (Object.keys(fe).length) throw new ApiError('validation', Object.values(fe)[0], { fieldErrors: fe });
    next.tailNumber = next.tailNumber.trim().toUpperCase();
    next.homeAirport = next.homeAirport.trim().toUpperCase();
    const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
    for (const k of Object.keys(patch) as (keyof AircraftSettings)[]) {
      if (db.settings[k] !== next[k]) { before[k] = k === 'photoDataUrl' ? '(photo)' : db.settings[k]; after[k] = k === 'photoDataUrl' ? '(new photo)' : next[k]; }
    }
    db.settings = next;
    if (Object.keys(after).length) audit(db, now, { actorId, action: 'settings.update', entityType: 'settings', summary: `Changed settings: ${Object.keys(after).join(', ')}`, before, after });
    return next;
  }),

  updateMember: def((db, actorId, now, [rawId, rawPatch]) => {
    requireAdmin(db, actorId);
    const m = db.members.find((x) => x.id === str(rawId, 40));
    if (!m) throw new ApiError('not_found', 'Member not found.');
    const p = (rawPatch ?? {}) as Record<string, unknown>;
    const next: Member = { ...m };
    if ('name' in p) next.name = str(p.name, 60);
    if ('email' in p) next.email = str(p.email, 120);
    if ('role' in p) next.role = p.role === 'admin' ? 'admin' : 'pilot';
    if ('active' in p) next.active = p.active === true;
    if (!next.name.trim()) throw new ApiError('validation', 'Name is required.', { fieldErrors: { name: 'Name is required.' } });
    const admins = db.members.filter((x) => { const y = x.id === m.id ? next : x; return y.role === 'admin' && y.active; });
    if (admins.length === 0) throw new ApiError('validation', 'Keep at least one active admin.');
    const before = { ...m };
    Object.assign(m, next, { name: next.name.trim(), initials: initialsOf(next.name) });
    audit(db, now, { actorId, action: 'member.update', entityType: 'member', entityId: m.id, summary: `Updated member ${m.name}`, before, after: { ...m } });
    return m;
  }),

  /**
   * Admin: remove setup/test records. Keeps members, sign-in, settings and the aircraft photo.
   * The confirmation word must be typed exactly. Nothing else can undo this except a backup.
   */
  clearData: def((db, actorId, now, [rawOpts]) => {
    requireAdmin(db, actorId);
    const o = (rawOpts ?? {}) as Record<string, unknown>;
    if (o.confirm !== 'CLEAR') throw new ApiError('validation', 'Type CLEAR to confirm.', { fieldErrors: { confirm: 'Type CLEAR in capitals.' } });
    const what = { bookings: o.bookings === true, flights: o.flights === true, aircraft: o.aircraft === true, history: o.history === true };
    if (!what.bookings && !what.flights && !what.aircraft && !what.history) throw new ApiError('validation', 'Choose at least one thing to clear.');
    const counts: string[] = [];
    if (what.bookings) { counts.push(`${db.bookings.length} booking(s)`); db.bookings = []; }
    if (what.flights) { counts.push(`${db.flights.length} flight record(s)`); db.flights = []; }
    if (what.aircraft) {
      counts.push(`${db.issues.length} issue(s), ${db.maintenance.length} maintenance block(s), ${db.restrictions.length} restriction(s)`);
      db.issues = []; db.maintenance = []; db.restrictions = [];
    }
    if (what.history) db.audit = [];
    audit(db, now, { actorId, action: 'data.clear', entityType: 'settings', summary: `Cleared test data: ${counts.join('; ') || 'activity history'}${what.history && counts.length ? '; activity history' : ''}` });
    return { cleared: counts };
  }),

  addMember: def((db, actorId, now, [rawName, rawRole]) => {
    requireAdmin(db, actorId);
    const nm = str(rawName, 60).trim().replace(/\s+/g, ' ');
    if (!nm) throw new ApiError('validation', 'Enter the member\'s name.', { fieldErrors: { name: 'Name is required.' } });
    if (db.members.some((m) => m.name.toLowerCase() === nm.toLowerCase())) throw new ApiError('validation', `${nm} is already a member.`, { fieldErrors: { name: 'Already a member.' } });
    if (db.members.filter((m) => m.active).length >= 20) throw new ApiError('validation', 'This group already has 20 active members.');
    const m: Member = { id: newId('m'), name: nm, initials: initialsOf(nm), role: rawRole === 'admin' ? 'admin' : 'pilot', active: true, email: '' };
    db.members.push(m);
    audit(db, now, { actorId, action: 'member.add', entityType: 'member', entityId: m.id, summary: `Added member ${m.name}` });
    return m;
  }),
};

export function initialsOf(n: string): string {
  return n.trim().split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
}

/** Run one action on a copy of the state. Returns the new state and the action's result. */
export function runAction(state: DbState, actionName: string, args: unknown[], actorId: string, now: number, live: boolean): { state: DbState; result: unknown } {
  const a = ACTIONS[actionName];
  if (!a) throw new ApiError('validation', 'Unknown action.');
  if (a.demoOnly && live) throw new ApiError('forbidden', 'Not available in the live app.');
  const db: DbState = JSON.parse(JSON.stringify(state));
  try {
    const result = a.run(db, actorId, now, Array.isArray(args) ? args : []);
    db.savedAt = iso(now);
    return { state: db, result };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('validation', (e as Error).message || 'That request could not be processed.');
  }
}

export type { Member };
