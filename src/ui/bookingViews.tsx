import React, { useMemo, useState } from 'react';
import { useApp, useAction } from './context';
import { Banner, Button, Field, GatedButton, Icon, Modal, Pill, StatusPill } from './components';
import { addDays, fmtDateTime, fmtDuration, fmtRange, localToUtc, minutesBetween, toLocalParts, tzAbbrev } from '../domain/time';
import { canEditBooking, charges, checkOutBlocker, findConflicts, isOverdue, overlaps, sumMeter } from '../domain/rules';
import { fmtHundredths, fmtMoney } from '../domain/decimal';
import type { Booking } from '../domain/types';
import { OverdueInspectionsNote } from './inspections';

export function pilotName(db: { members: { id: string; name: string }[] }, id: string) {
  return db.members.find((m) => m.id === id)?.name ?? 'Unknown member';
}

// ---------------- Booking form ----------------
export function BookingForm({ booking, prefill }: { booking?: Booking; prefill?: { startUtc: string; endUtc: string } }) {
  const { api, db, me, tz, closeModal, toast, openModal, offline, now } = useApp();
  const isAdmin = me.role === 'admin';
  const init = useMemo(() => {
    if (booking) return { s: booking.startUtc, e: booking.endUtc };
    if (prefill) return { s: prefill.startUtc, e: prefill.endUtc };
    const h = Math.ceil(now / 3600e3) * 3600e3 + 3600e3;
    return { s: new Date(h).toISOString(), e: new Date(h + 2 * 3600e3).toISOString() };
  }, []);
  const sp = toLocalParts(init.s, tz), ep = toLocalParts(init.e, tz);
  const [pilotId, setPilotId] = useState(booking?.pilotId ?? (isAdmin && !prefill ? me.id : me.id));
  const [sDate, setSDate] = useState(sp.date); const [sTime, setSTime] = useState(sp.time);
  const [eDate, setEDate] = useState(ep.date); const [eTime, setETime] = useState(ep.time);
  const [destination, setDestination] = useState(booking?.destination ?? '');
  const [notes, setNotes] = useState(booking?.notes ?? '');
  const [tried, setTried] = useState(false);

  const sRes = localToUtc(sDate, sTime, tz), eRes = localToUtc(eDate, eTime, tz);
  const errs: Record<string, string> = {};
  if (!sRes.ok) errs.start = sRes.error;
  if (!eRes.ok) errs.end = eRes.error;
  if (sRes.ok && eRes.ok && Date.parse(eRes.utc) <= Date.parse(sRes.utc)) errs.end = 'End must be after start.';
  if (destination.length > 60) errs.destination = 'Keep the destination under 60 characters.';
  const timesOk = sRes.ok && eRes.ok && !errs.end;
  const localConflicts = timesOk ? findConflicts(db, sRes.utc, eRes.utc, db.settings.bufferMinutes, booking?.id) : [];

  const action = useAction(async () => {
    if (!sRes.ok || !eRes.ok) return;
    const input = { pilotId, startUtc: sRes.utc, endUtc: eRes.utc, destination, notes };
    return booking ? api.updateBooking(me.id, booking.id, input, booking.version) : api.createBooking(me.id, input);
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setTried(true);
    if (Object.keys(errs).length) return;
    const r = await action.run();
    if (r) { toast(booking ? 'Reservation updated' : 'Reservation confirmed'); openModal({ kind: 'bookingDetail', bookingId: r.id }); }
  };
  const useSuggestion = (s: { startUtc: string; endUtc: string }) => {
    const a = toLocalParts(s.startUtc, tz), b = toLocalParts(s.endUtc, tz);
    setSDate(a.date); setSTime(a.time); setEDate(b.date); setETime(b.time); action.setError(null);
  };
  const serverErr = action.error;
  const fe = serverErr?.details.fieldErrors ?? {};
  const show = (k: string) => (tried ? errs[k] : undefined);
  const activePilots = db.members.filter((m) => m.active);

  return (
    <Modal title={booking ? 'Change reservation' : 'Book aircraft'} onClose={closeModal}
      footer={<>
        <Button variant="ghost" type="button" onClick={booking ? () => openModal({ kind: 'bookingDetail', bookingId: booking.id }) : closeModal}>{booking ? 'Back' : 'Cancel'}</Button>
        {offline
          ? <GatedButton variant="primary" reason="You are offline. Bookings can only be saved while connected." >Save</GatedButton>
          : <Button variant="primary" type="submit" form="booking-form" pending={action.pending}>{booking ? 'Save changes' : 'Confirm reservation'}</Button>}
      </>}>
      <form id="booking-form" onSubmit={submit} noValidate className="form">
        <p className="tz-note"><Icon name="cloud" size={16} /> Times are {tz === 'America/Los_Angeles' ? 'Pacific Time' : tz.replace('_', ' ')} {db.settings.homeAirport ? `at ${db.settings.homeAirport} ` : ''}({sRes.ok ? tzAbbrev(sRes.utc, tz) : tzAbbrev(now, tz)}).</p>
        <Field id="bf-pilot" label="Pilot" error={fe.pilotId} hint={!isAdmin ? 'Pilots book for themselves. An admin can book for anyone.' : undefined}>
          <select value={pilotId} onChange={(e) => setPilotId(e.target.value)} disabled={!isAdmin}>
            {(isAdmin ? activePilots : [me]).map((m) => <option key={m.id} value={m.id}>{m.name}{m.role === 'admin' ? ' (admin)' : ''}</option>)}
          </select>
        </Field>
        <fieldset className="pair">
          <legend>Start</legend>
          <Field id="bf-sdate" label="Date" error={show('start')}><input type="date" value={sDate} onChange={(e) => { setSDate(e.target.value); if (e.target.value > eDate) setEDate(e.target.value); }} required /></Field>
          <Field id="bf-stime" label="Time"><input type="time" step={900} value={sTime} onChange={(e) => setSTime(e.target.value)} required /></Field>
        </fieldset>
        <fieldset className="pair">
          <legend>End</legend>
          <Field id="bf-edate" label="Date" error={show('end') ?? fe.time}><input type="date" value={eDate} min={sDate} onChange={(e) => setEDate(e.target.value)} required /></Field>
          <Field id="bf-etime" label="Time"><input type="time" step={900} value={eTime} onChange={(e) => setETime(e.target.value)} required /></Field>
        </fieldset>
        {timesOk && sRes.ok && eRes.ok && (
          <div className="duration-line">
            <span>{fmtDuration(minutesBetween(sRes.utc, eRes.utc))}</span>
            {sDate !== eDate && <Pill tone="info">Overnight · returns {addDays(sDate, 1) === eDate ? 'next day' : eDate}</Pill>}
            {tzAbbrev(sRes.utc, tz) !== tzAbbrev(eRes.utc, tz) && <Pill tone="warn">Clocks change during this booking ({tzAbbrev(sRes.utc, tz)} → {tzAbbrev(eRes.utc, tz)})</Pill>}
            {(sRes.ambiguous || eRes.ambiguous) && <Pill tone="warn">This hour happens twice on the clock change. Using the first one ({tzAbbrev((sRes.ambiguous ? sRes : eRes).utc, tz)}).</Pill>}
          </div>
        )}
        {timesOk && !serverErr && (localConflicts.length
          ? <Banner tone="warn" title="This time is already taken">{localConflicts.map((c) => <p key={c.id}>{c.label}: {fmtRange(c.startUtc, c.endUtc, tz)}</p>)}</Banner>
          : <p className="avail-note"><Icon name="check" size={16} /> Open on the schedule on this device. The server rechecks when you save.{db.settings.bufferMinutes ? ` A ${db.settings.bufferMinutes}-minute turnaround buffer applies.` : ''}</p>)}
        <Field id="bf-dest" label="Destination (optional)" error={show('destination') ?? fe.destination}><input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="e.g. KSBA" autoComplete="off" /></Field>
        <Field id="bf-notes" label="Notes (optional)" error={fe.notes}><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {serverErr && (
          <Banner tone={serverErr.code === 'conflict' ? 'warn' : 'danger'} title={serverErr.message}>
            {serverErr.details.conflicts?.map((c) => <p key={c.id}>{c.label}: {fmtRange(c.startUtc, c.endUtc, tz)}</p>)}
            {booking && serverErr.code === 'conflict' && <p>Your original reservation is unchanged.</p>}
            {serverErr.details.suggestion && (
              <Button type="button" variant="secondary" onClick={() => useSuggestion(serverErr.details.suggestion!)}>
                Use next open time: {fmtRange(serverErr.details.suggestion.startUtc, serverErr.details.suggestion.endUtc, tz)}
              </Button>
            )}
          </Banner>
        )}
        <p className="fine">An open calendar slot only means nobody has reserved it. It says nothing about whether the aircraft is airworthy.</p>
      </form>
    </Modal>
  );
}

// ---------------- Booking detail ----------------
export function BookingDetail({ bookingId }: { bookingId: string }) {
  const { api, db, me, tz, closeModal, openModal, toast, offline, now } = useApp();
  const b = db.bookings.find((x) => x.id === bookingId);
  const [confirm, setConfirm] = useState<null | 'cancel' | 'noshow' | 'checkout'>(null);
  const [reason, setReason] = useState('');
  const cancel = useAction(() => api.cancelBooking(me.id, bookingId, reason));
  const noShow = useAction(() => api.markNoShow(me.id, bookingId, reason));
  const checkOut = useAction(() => api.checkOut(me.id, bookingId));
  if (!b) return <Modal title="Reservation" onClose={closeModal}><p>This reservation no longer exists.</p></Modal>;

  const mine = b.pilotId === me.id;
  const isAdmin = me.role === 'admin';
  const owner = mine || isAdmin;
  const editWhy = canEditBooking(me, b);
  const offlineWhy = offline ? 'You are offline. Changes are disabled until you reconnect.' : null;
  const coWhy = offlineWhy ?? checkOutBlocker(db, b, me, now);
  const legs = db.flights.filter((f) => f.bookingId === b.id && !f.voided);
  const ch = charges(legs, db.settings);
  const overdue = isOverdue(b, now);
  const mxOverlap = b.status === 'confirmed' && db.maintenance.filter((m) => m.status === 'scheduled' && overlaps(b.startUtc, b.endUtc, m.startUtc, m.endUtc, 0));
  const history = db.audit.filter((a) => a.entityId === b.id).slice().reverse();

  const doConfirm = async () => {
    const r = confirm === 'cancel' ? await cancel.run() : confirm === 'noshow' ? await noShow.run() : await checkOut.run();
    if (r) { toast(confirm === 'cancel' ? 'Reservation canceled. The time is open again.' : confirm === 'noshow' ? 'No-show recorded' : 'Aircraft checked out. Have a good flight.'); setConfirm(null); setReason(''); }
  };
  const actErr = cancel.error ?? noShow.error ?? checkOut.error;

  return (
    <Modal title="Reservation" onClose={closeModal}>
      <div className="detail-head">
        <StatusPill status={b.status} />
        {b.flightRecordNeeded && <Pill tone="warn">Flight record needed</Pill>}
        {mine && <Pill tone="info">Your booking</Pill>}
      </div>
      <p className="detail-when">{fmtRange(b.startUtc, b.endUtc, tz)}</p>
      <dl className="kv">
        <dt>Pilot</dt><dd>{pilotName(db, b.pilotId)}</dd>
        <dt>Length</dt><dd>{fmtDuration(minutesBetween(b.startUtc, b.endUtc))}</dd>
        {b.destination && <><dt>Destination</dt><dd>{b.destination}</dd></>}
        {b.notes && <><dt>Notes</dt><dd>{b.notes}</dd></>}
        {b.checkedOutAt && <><dt>Checked out</dt><dd>{fmtDateTime(b.checkedOutAt, tz)} by {pilotName(db, b.checkedOutBy!)}</dd></>}
        {b.returnedAt && <><dt>Returned</dt><dd>{fmtDateTime(b.returnedAt, tz)} by {pilotName(db, b.returnedBy!)}{b.fuelToppedOff === false ? ' · fuel not topped off' : b.fuelToppedOff ? ' · fuel topped off' : ''}</dd></>}
        {b.returnNote && <><dt>Return note</dt><dd>{b.returnNote}</dd></>}
        {b.canceledAt && <><dt>Canceled</dt><dd>{fmtDateTime(b.canceledAt, tz)} by {pilotName(db, b.canceledBy!)}{b.cancelReason ? ` — ${b.cancelReason}` : ''}</dd></>}
        {b.noShowAt && <><dt>No-show</dt><dd>Recorded {fmtDateTime(b.noShowAt, tz)} by {pilotName(db, b.noShowBy!)}</dd></>}
      </dl>

      {overdue && <Banner tone="danger" title="Overdue return">The reservation ended {fmtDateTime(b.endUtc, tz)} and the aircraft is still checked out. It stays checked out until someone returns it.</Banner>}
      {mxOverlap && mxOverlap.length > 0 && <Banner tone="warn" title="Overlaps scheduled maintenance">{mxOverlap.map((m) => <p key={m.id}>{m.title}: {fmtRange(m.startUtc, m.endUtc, tz)}</p>)}<p>{isAdmin ? 'Review with the pilot: move or cancel this reservation.' : 'An admin will review this with you.'}</p></Banner>}

      {legs.length > 0 && (
        <div className="subcard">
          <h3>Flight record{legs.length > 1 ? `s (${legs.length} legs)` : ''}</h3>
          {legs.map((f) => (
            <button key={f.id} className="row-btn" onClick={() => openModal({ kind: 'flightDetail', flightId: f.id })}>
              <span>{f.route}</span>
              <span className="mono">{db.settings.hobbsEnabled && f.hobbsEnd !== null ? `Hobbs ${fmtHundredths(f.hobbsEnd! - f.hobbsStart!)}` : ''} {db.settings.tachEnabled && f.tachEnd !== null ? `· Tach ${fmtHundredths(f.tachEnd! - f.tachStart!)}` : ''}</span>
            </button>
          ))}
          <p className="charge-line">Rental {fmtHundredths(ch.hours)} h × {fmtMoney(db.settings.rateCentsPerHour)} = <strong>{fmtMoney(ch.rentalCents)}</strong> · Fuel {fmtMoney(ch.fuelCents)} {db.settings.fuelPolicy === 'pilot_pays_at_pump' ? '(paid at pump)' : '(added to statement)'}</p>
        </div>
      )}

      {confirm ? (
        <div className="confirm-box" role="group" aria-label="Confirm action">
          <p className="confirm-title">{confirm === 'cancel' ? 'Cancel this reservation?' : confirm === 'noshow' ? 'Record a no-show?' : 'Check out the aircraft now?'}</p>
          <p className="fine">{confirm === 'cancel' ? 'The record is kept as Canceled and the time opens for others right away.' : confirm === 'noshow' ? 'This marks the reservation as No-show. It is recorded in activity history.' : 'You confirm you are taking the aircraft. Check restrictions and do your normal preflight. 733XZ does not determine airworthiness.'}</p>
          {confirm === 'checkout' && <OverdueInspectionsNote />}
          {confirm !== 'checkout' && <Field id="bd-reason" label="Reason (optional)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
          {actErr && <Banner tone="danger" title={actErr.message} />}
          <div className="btn-row">
            <Button variant="ghost" onClick={() => { setConfirm(null); cancel.setError(null); noShow.setError(null); checkOut.setError(null); }}>Keep as is</Button>
            <Button variant={confirm === 'checkout' ? 'primary' : 'danger'} pending={cancel.pending || noShow.pending || checkOut.pending} onClick={doConfirm}>
              {confirm === 'cancel' ? 'Yes, cancel it' : confirm === 'noshow' ? 'Record no-show' : 'Check out'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="action-stack">
          {b.status === 'confirmed' && owner && <GatedButton variant="primary" size="lg" icon="key" block reason={coWhy} onClick={() => setConfirm('checkout')}>Check out aircraft</GatedButton>}
          {b.status === 'checked_out' && owner && <GatedButton variant="primary" size="lg" icon="check" block reason={offlineWhy} onClick={() => openModal({ kind: 'return', bookingId: b.id })}>Return aircraft</GatedButton>}
          {(b.status === 'checked_out' || b.status === 'completed') && owner && <GatedButton variant={b.flightRecordNeeded ? 'primary' : 'secondary'} icon="log" block reason={offlineWhy} onClick={() => openModal({ kind: 'flight', bookingId: b.id })}>{legs.length ? 'Add another leg' : 'Record flight'}</GatedButton>}
          {b.status === 'confirmed' && owner && <GatedButton icon="calendar" block reason={offlineWhy ?? editWhy} onClick={() => openModal({ kind: 'booking', booking: b })}>Change reservation</GatedButton>}
          {b.status === 'confirmed' && owner && <GatedButton variant="ghost" block reason={offlineWhy} onClick={() => setConfirm('cancel')}>Cancel reservation</GatedButton>}
          {b.status === 'confirmed' && isAdmin && <GatedButton variant="ghost" block reason={offlineWhy ?? (now < Date.parse(b.startUtc) ? 'A no-show can be recorded after the start time.' : null)} onClick={() => setConfirm('noshow')}>Record no-show</GatedButton>}
          {!owner && <p className="fine">Only {pilotName(db, b.pilotId)} or an admin can change this reservation.</p>}
        </div>
      )}

      {history.length > 0 && (
        <details className="history">
          <summary>History ({history.length})</summary>
          <ul>{history.map((h) => <li key={h.id}><span className="mono small">{fmtDateTime(h.at, tz)}</span> {pilotName(db, h.actorId)}: {h.summary}</li>)}</ul>
        </details>
      )}
    </Modal>
  );
}

// ---------------- Return ----------------
export function ReturnForm({ bookingId }: { bookingId: string }) {
  const { api, db, me, tz, closeModal, openModal, toast, now } = useApp();
  const b = db.bookings.find((x) => x.id === bookingId)!;
  const [topped, setTopped] = useState(false);
  const [note, setNote] = useState('');
  const act = useAction(() => api.returnAircraft(me.id, bookingId, { note, fuelToppedOff: topped }));
  const onBehalf = b.pilotId !== me.id;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await act.run();
    if (r) { toast('Aircraft returned. Now complete the flight record.'); openModal({ kind: 'flight', bookingId, afterReturn: true }); }
  };
  return (
    <Modal title="Return aircraft" onClose={closeModal} footer={<><Button variant="ghost" onClick={() => openModal({ kind: 'bookingDetail', bookingId })}>Back</Button><Button variant="primary" type="submit" form="return-form" pending={act.pending}>Return aircraft</Button></>}>
      <form id="return-form" className="form" onSubmit={submit} noValidate>
        <ol className="steps"><li className="on">Return aircraft</li><li>Flight record</li></ol>
        <p>Returning ends the check-out so others can take the aircraft. Your Hobbs and tach readings go in the <strong>flight record</strong>, which is the next step.</p>
        {isOverdue(b, now) && <Banner tone="warn" title="Returning after the reservation ended">Reservation ended {fmtDateTime(b.endUtc, tz)}.</Banner>}
        {onBehalf && <Banner tone="info" title={`Returning for ${pilotName(db, b.pilotId)}`}>Add a note so the record shows why an admin returned it.</Banner>}
        <label className="check-row">
          <input type="checkbox" id="rf-fuel" checked={topped} onChange={(e) => setTopped(e.target.checked)} />
          <span><strong>Fuel tanks topped off</strong><br /><span className="fine">{db.settings.topOffRequired ? 'Required by group rules. If you could not top off, leave unchecked and explain in the note.' : 'Optional for this aircraft.'}</span></span>
        </label>
        {!topped && db.settings.topOffRequired && <p className="field-warn"><Icon name="alert" size={16} /> The return will be recorded as not topped off.</p>}
        <Field id="rf-note" label={onBehalf ? 'Note (required)' : 'Note (optional)'} error={act.error?.details.fieldErrors?.note}>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tie-down spot, anything the next pilot should know" />
        </Field>
        {act.error && !act.error.details.fieldErrors && <Banner tone="danger" title={act.error.message} />}
      </form>
    </Modal>
  );
}
