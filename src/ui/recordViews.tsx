import { FlightPath } from './flightPath';
import React, { useMemo, useRef, useState } from 'react';
import { useApp, useAction } from './context';
import { Banner, Button, Field, GatedButton, Icon, Modal, Pill } from './components';
import { fmtDateTime, fmtRange, localToUtc, toLocalParts } from '../domain/time';
import { billableHundredths, lastReadings, validateFlight } from '../domain/rules';
import { fmtHundredths, fmtMoney, parseCents, parseHundredths, rentalCents } from '../domain/decimal';
import type { FlightInput, IssueStatus, IssueUrgency, Restriction } from '../domain/types';
import { pilotName } from './bookingViews';

const keyGen = () => 'sub_' + Math.random().toString(36).slice(2) + Date.now().toString(36);

// ---------------- Flight record ----------------
export function FlightForm({ bookingId, afterReturn }: { bookingId?: string; afterReturn?: boolean }) {
  const { api, db, me, tz, closeModal, openModal, toast, offline, now } = useApp();
  const s = db.settings;
  const isAdmin = me.role === 'admin';
  const eligible = db.bookings.filter((b) => (b.status === 'checked_out' || b.status === 'completed') && (isAdmin || b.pilotId === me.id))
    .sort((a, b) => Date.parse(b.startUtc) - Date.parse(a.startUtc)).slice(0, 25);
  const [bid, setBid] = useState(bookingId ?? eligible[0]?.id ?? '');
  const booking = db.bookings.find((b) => b.id === bid);
  const last = lastReadings(db.flights);
  const [date, setDate] = useState(booking ? toLocalParts(booking.startUtc, tz).date : toLocalParts(now, tz).date);
  const [route, setRoute] = useState(booking?.destination && s.homeAirport ? `${s.homeAirport}–${booking.destination}–${s.homeAirport}` : '');
  const [hs, setHs] = useState(last.hobbs !== null ? fmtHundredths(last.hobbs) : '');
  const [he, setHe] = useState('');
  const [ts, setTs] = useState(last.tach !== null ? fmtHundredths(last.tach) : '');
  const [te, setTe] = useState('');
  const [gal, setGal] = useState('');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState<{ flags: string[]; replayed: boolean } | null>(null);
  const subKey = useRef(keyGen());

  const parsed = useMemo(() => {
    const fe: Record<string, string> = {};
    const p = (v: string, label: string, key: string, on: boolean) => {
      if (!on) return null;
      const r = parseHundredths(v, label);
      if (!r.ok) { fe[key] = r.error; return null; }
      return r.value;
    };
    const opt = (v: string, label: string, key: string, money = false) => {
      if (!v.trim()) return null;
      const r = money ? parseCents(v, label) : parseHundredths(v, label);
      if (!r.ok) { fe[key] = r.error; return null; }
      return r.value;
    };
    const input: FlightInput = {
      bookingId: bid, pilotId: booking?.pilotId ?? me.id, flightDate: date, route, notes, submissionKey: subKey.current,
      hobbsStart: p(hs, 'Starting Hobbs', 'hobbsStart', s.hobbsEnabled), hobbsEnd: p(he, 'Ending Hobbs', 'hobbsEnd', s.hobbsEnabled),
      tachStart: p(ts, 'Starting tach', 'tachStart', s.tachEnabled), tachEnd: p(te, 'Ending tach', 'tachEnd', s.tachEnabled),
      fuelGallons: opt(gal, 'Fuel gallons', 'fuelGallons'), fuelCostCents: opt(cost, 'Fuel cost', 'fuelCostCents', true),
    };
    const v = validateFlight(input, db);
    return { input, errors: { ...v.errors, ...fe }, flags: v.flags };
  }, [bid, date, route, hs, he, ts, te, gal, cost, notes, db]);

  const act = useAction(() => api.submitFlight(me.id, parsed.input));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setTried(true);
    if (Object.keys(parsed.errors).length) return;
    const r = await act.run();
    if (r) { setSaved({ flags: r.flags, replayed: r.replayed }); toast(r.replayed ? 'Already saved. No duplicate created.' : 'Flight record saved'); }
  };
  const nextLeg = () => {
    const prev = parsed.input;
    subKey.current = keyGen();
    setHs(prev.hobbsEnd !== null ? fmtHundredths(prev.hobbsEnd) : ''); setHe('');
    setTs(prev.tachEnd !== null ? fmtHundredths(prev.tachEnd) : ''); setTe('');
    setGal(''); setCost(''); setNotes(''); setRoute(''); setSaved(null); setTried(false);
  };

  const err = (k: string) => (tried ? parsed.errors[k] ?? act.error?.details.fieldErrors?.[k] : act.error?.details.fieldErrors?.[k]);
  const dh = parsed.input.hobbsStart !== null && parsed.input.hobbsEnd !== null && parsed.input.hobbsEnd >= parsed.input.hobbsStart ? parsed.input.hobbsEnd - parsed.input.hobbsStart : null;
  const dt = parsed.input.tachStart !== null && parsed.input.tachEnd !== null && parsed.input.tachEnd >= parsed.input.tachStart ? parsed.input.tachEnd - parsed.input.tachStart : null;
  const billH = s.rateBasis === 'tach' ? dt ?? dh : dh ?? dt;

  if (!eligible.length && !bookingId) {
    return <Modal title="Record flight" onClose={closeModal}><Banner tone="info" title="No flights to record">Flight records attach to a reservation that was checked out. Check out the aircraft on a reservation first.</Banner></Modal>;
  }

  if (saved) {
    return (
      <Modal title="Flight record saved" onClose={closeModal} footer={<><Button variant="ghost" onClick={nextLeg} icon="plus">Add another leg</Button><Button variant="primary" onClick={() => openModal({ kind: 'bookingDetail', bookingId: bid })}>Done</Button></>}>
        {afterReturn && <ol className="steps"><li className="done">Return aircraft</li><li className="done">Flight record</li></ol>}
        <Banner tone="ok" title={saved.replayed ? 'This flight was already saved. No duplicate was created.' : 'Saved'}>
          <p className="mono">{s.hobbsEnabled && dh !== null ? `Hobbs ${fmtHundredths(dh)}` : ''}{s.tachEnabled && dt !== null ? ` · Tach ${fmtHundredths(dt)}` : ''}</p>
          {billH !== null && <p>Rental {fmtHundredths(billH)} h × {fmtMoney(s.rateCentsPerHour)} = <strong>{fmtMoney(rentalCents(billH, s.rateCentsPerHour))}</strong></p>}
        </Banner>
        {saved.flags.length > 0 && <Banner tone="warn" title="Flagged for admin review">{saved.flags.map((f) => <p key={f}>{f}</p>)}<p className="fine">Flags do not change your readings. An admin can review and correct the record with a reason.</p></Banner>}
      </Modal>
    );
  }

  return (
    <Modal title="Flight record" onClose={closeModal}
      footer={<>
        <Button variant="ghost" onClick={() => (bid ? openModal({ kind: 'bookingDetail', bookingId: bid }) : closeModal())}>{afterReturn ? 'Do this later' : 'Cancel'}</Button>
        {offline ? <GatedButton variant="primary" reason="You are offline. Flight records can only be saved while connected.">Save</GatedButton>
          : <Button variant="primary" type="submit" form="flight-form" pending={act.pending}>Save flight record</Button>}
      </>}>
      <form id="flight-form" className="form" onSubmit={submit} noValidate>
        {afterReturn && <ol className="steps"><li className="done">Return aircraft</li><li className="on">Flight record</li></ol>}
        <p className="fine">Operational usage record for scheduling and cost sharing. It does not replace your pilot logbook or the aircraft logbooks. Hobbs, tach and logged flight time are different measurements.</p>
        <Field id="ff-booking" label="Reservation" error={err('bookingId')}>
          <select value={bid} onChange={(e) => setBid(e.target.value)} disabled={!!bookingId}>
            {eligible.map((b) => <option key={b.id} value={b.id}>{pilotName(db, b.pilotId)} · {fmtRange(b.startUtc, b.endUtc, tz)}</option>)}
          </select>
        </Field>
        <div className="grid2">
          <Field id="ff-date" label="Flight date" error={err('flightDate')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field id="ff-pilot" label="Pilot"><input value={booking ? pilotName(db, booking.pilotId) : ''} readOnly /></Field>
        </div>
        <Field id="ff-route" label="Route" error={err('route')}><input value={route} onChange={(e) => setRoute(e.target.value)} placeholder={s.homeAirport ? `${s.homeAirport}–KSBA–${s.homeAirport}` : 'e.g. KBFL–KSBA–KBFL'} autoComplete="off" /></Field>
        {s.hobbsEnabled && (
          <fieldset className="meter">
            <legend>Hobbs <span className="delta mono">{dh !== null ? `+${fmtHundredths(dh)}` : ''}</span></legend>
            <div className="grid2">
              <Field id="ff-hs" label="Start" error={err('hobbsStart')} hint={last.hobbs !== null ? `Last recorded ${fmtHundredths(last.hobbs)}` : undefined}><input inputMode="decimal" className="mono" value={hs} onChange={(e) => setHs(e.target.value)} /></Field>
              <Field id="ff-he" label="End" error={err('hobbsEnd')}><input inputMode="decimal" className="mono" value={he} onChange={(e) => setHe(e.target.value)} /></Field>
            </div>
          </fieldset>
        )}
        {s.tachEnabled && (
          <fieldset className="meter">
            <legend>Tach <span className="delta mono">{dt !== null ? `+${fmtHundredths(dt)}` : ''}</span></legend>
            <div className="grid2">
              <Field id="ff-ts" label="Start" error={err('tachStart')} hint={last.tach !== null ? `Last recorded ${fmtHundredths(last.tach)}` : undefined}><input inputMode="decimal" className="mono" value={ts} onChange={(e) => setTs(e.target.value)} /></Field>
              <Field id="ff-te" label="End" error={err('tachEnd')}><input inputMode="decimal" className="mono" value={te} onChange={(e) => setTe(e.target.value)} /></Field>
            </div>
          </fieldset>
        )}
        <fieldset className="meter">
          <legend>Fuel top-off</legend>
          <div className="grid2">
            <Field id="ff-gal" label="Gallons added" error={err('fuelGallons')}><input inputMode="decimal" className="mono" value={gal} onChange={(e) => setGal(e.target.value)} placeholder="0.0" /></Field>
            <Field id="ff-cost" label="Fuel cost ($)" error={err('fuelCostCents')}><input inputMode="decimal" className="mono" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" /></Field>
          </div>
          <p className="hint">{s.fuelPolicy === 'pilot_pays_at_pump' ? 'You pay for fuel at the pump. Record it so the group can see top-offs.' : 'Fuel cost is added to your usage statement.'}</p>
        </fieldset>
        {billH !== null && (
          <div className="charge-preview" aria-live="polite">
            <span>Rental ({s.rateBasis === 'tach' ? 'tach' : 'Hobbs'})</span><span className="mono">{fmtHundredths(billH)} h × {fmtMoney(s.rateCentsPerHour)} = {fmtMoney(rentalCents(billH, s.rateCentsPerHour))}</span>
            <span>Fuel</span><span className="mono">{fmtMoney(parsed.input.fuelCostCents ?? 0)} {s.fuelPolicy === 'pilot_pays_at_pump' ? '(paid at pump)' : ''}</span>
          </div>
        )}
        <Field id="ff-notes" label="Notes (optional)"><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {parsed.flags.length > 0 && !Object.keys(parsed.errors).length && <Banner tone="warn" title="Will be flagged for review">{parsed.flags.map((f) => <p key={f}>{f}</p>)}</Banner>}
        {tried && parsed.errors.form && <Banner tone="danger" title={parsed.errors.form} />}
        {act.error && !act.error.details.fieldErrors && <Banner tone="danger" title={act.error.message} />}
      </form>
    </Modal>
  );
}

export function FlightDetail({ flightId }: { flightId: string }) {
  const { api, db, me, tz, closeModal, toast, offline } = useApp();
  const f = db.flights.find((x) => x.id === flightId);
  const [editing, setEditing] = useState(false);
  const [vals, setVals] = useState(() => ({
    route: f?.route ?? '', hobbsStart: fmtHundredths(f?.hobbsStart), hobbsEnd: fmtHundredths(f?.hobbsEnd),
    tachStart: fmtHundredths(f?.tachStart), tachEnd: fmtHundredths(f?.tachEnd), reason: '',
  }));
  const act = useAction(async () => {
    const changes: Partial<FlightInput> = { route: vals.route };
    for (const k of ['hobbsStart', 'hobbsEnd', 'tachStart', 'tachEnd'] as const) {
      if (vals[k] === '—') continue;
      const r = parseHundredths(vals[k], k);
      if (!r.ok) throw new Error(r.error);
      changes[k] = r.value;
    }
    return api.correctFlight(me.id, flightId, changes, vals.reason);
  });
  if (!f) return <Modal title="Flight record" onClose={closeModal}><p>Record not found.</p></Modal>;
  const canCorrect = me.role === 'admin' || f.pilotId === me.id;
  const s = db.settings;
  return (
    <Modal title="Flight record" onClose={closeModal}>
      <p className="detail-when">{f.route}</p>
      <dl className="kv">
        <dt>Date</dt><dd>{f.flightDate}</dd>
        <dt>Pilot</dt><dd>{pilotName(db, f.pilotId)}</dd>
        {f.hobbsStart !== null && <><dt>Hobbs</dt><dd className="mono">{fmtHundredths(f.hobbsStart)} → {fmtHundredths(f.hobbsEnd)} (+{fmtHundredths(f.hobbsEnd! - f.hobbsStart)})</dd></>}
        {f.tachStart !== null && <><dt>Tach</dt><dd className="mono">{fmtHundredths(f.tachStart)} → {fmtHundredths(f.tachEnd)} (+{fmtHundredths(f.tachEnd! - f.tachStart)})</dd></>}
        <dt>Fuel</dt><dd className="mono">{f.fuelGallons !== null ? `${fmtHundredths(f.fuelGallons)} gal` : 'Not recorded'} {f.fuelCostCents !== null ? `· ${fmtMoney(f.fuelCostCents)}` : ''}</dd>
        <dt>Rental</dt><dd className="mono">{fmtMoney(rentalCents(billableHundredths(f, s), s.rateCentsPerHour))}</dd>
        <dt>Recorded</dt><dd>{fmtDateTime(f.createdAt, tz)} by {pilotName(db, f.createdBy)}</dd>
        {f.notes && <><dt>Notes</dt><dd>{f.notes}</dd></>}
      </dl>
      {!f.voided && <FlightPath flightId={f.id} />}
      {f.flags.length > 0 && <Banner tone="warn" title="Review flags">{f.flags.map((x) => <p key={x}>{x}</p>)}</Banner>}
      {f.revisions.length > 0 && (
        <div className="subcard"><h3>Corrections</h3>
          <ul className="plain">{f.revisions.map((r, i) => <li key={i}><strong>{pilotName(db, r.by)}</strong>, {fmtDateTime(r.at, tz)}: {r.reason}<br /><span className="mono small">Previous: {Object.entries(r.previous).map(([k, v]) => `${k} ${typeof v === 'number' && k !== 'fuelCostCents' ? fmtHundredths(v) : String(v)}`).join(', ')}</span></li>)}</ul>
        </div>
      )}
      {editing ? (
        <form className="form subcard" onSubmit={async (e) => { e.preventDefault(); const r = await act.run(); if (r) { toast('Correction saved with history'); setEditing(false); } }}>
          <h3>Correct this record</h3>
          <Field id="fd-route" label="Route"><input value={vals.route} onChange={(e) => setVals({ ...vals, route: e.target.value })} /></Field>
          <div className="grid2">
            {f.hobbsStart !== null && <><Field id="fd-hs" label="Hobbs start"><input className="mono" inputMode="decimal" value={vals.hobbsStart} onChange={(e) => setVals({ ...vals, hobbsStart: e.target.value })} /></Field>
            <Field id="fd-he" label="Hobbs end" error={act.error?.details.fieldErrors?.hobbsEnd}><input className="mono" inputMode="decimal" value={vals.hobbsEnd} onChange={(e) => setVals({ ...vals, hobbsEnd: e.target.value })} /></Field></>}
            {f.tachStart !== null && <><Field id="fd-ts" label="Tach start"><input className="mono" inputMode="decimal" value={vals.tachStart} onChange={(e) => setVals({ ...vals, tachStart: e.target.value })} /></Field>
            <Field id="fd-te" label="Tach end" error={act.error?.details.fieldErrors?.tachEnd}><input className="mono" inputMode="decimal" value={vals.tachEnd} onChange={(e) => setVals({ ...vals, tachEnd: e.target.value })} /></Field></>}
          </div>
          <Field id="fd-reason" label="Reason for correction (required)" error={act.error?.details.fieldErrors?.reason}><input value={vals.reason} onChange={(e) => setVals({ ...vals, reason: e.target.value })} /></Field>
          {act.error && !act.error.details.fieldErrors && <Banner tone="danger" title={act.error.message} />}
          <div className="btn-row"><Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button type="submit" variant="primary" pending={act.pending}>Save correction</Button></div>
        </form>
      ) : canCorrect && <GatedButton block reason={offline ? 'You are offline.' : null} onClick={() => setEditing(true)}>Correct this record</GatedButton>}
    </Modal>
  );
}

// ---------------- Issues ----------------
async function resizeImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const max = 900, k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.78);
  } finally { URL.revokeObjectURL(url); }
}
export { resizeImage };

export function IssueForm() {
  const { api, me, closeModal, toast, offline } = useApp();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [urgency, setUrgency] = useState<IssueUrgency>('medium');
  const [ground, setGround] = useState(false);
  const [photo, setPhoto] = useState<string | undefined>();
  const [photoErr, setPhotoErr] = useState('');
  const act = useAction(() => api.reportIssue(me.id, { title, description: desc, urgency, photoDataUrl: photo, groundAircraft: ground }));
  const [tried, setTried] = useState(false);
  return (
    <Modal title="Report an issue" onClose={closeModal} footer={<><Button variant="ghost" onClick={closeModal}>Cancel</Button>{offline ? <GatedButton variant="primary" reason="You are offline. Report the issue to an admin directly, then submit here when connected.">Submit</GatedButton> : <Button variant="primary" type="submit" form="issue-form" pending={act.pending}>Submit report</Button>}</>}>
      <form id="issue-form" className="form" noValidate onSubmit={async (e) => { e.preventDefault(); setTried(true); if (!title.trim()) return; const r = await act.run(); if (r) { toast(ground || urgency === 'grounding' ? 'Issue reported. Aircraft marked grounded.' : 'Issue reported'); closeModal(); } }}>
        <Field id="if-title" label="What's wrong?" error={tried && !title.trim() ? 'A short title is required.' : undefined}><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Nav 2 flag stuck" /></Field>
        <Field id="if-desc" label="Details"><textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="When you noticed it, what you saw, anything you tried" /></Field>
        <Field id="if-urg" label="Urgency">
          <select value={urgency} onChange={(e) => { const v = e.target.value as IssueUrgency; setUrgency(v); if (v === 'grounding') setGround(true); }}>
            <option value="low">Low — cosmetic or convenience</option>
            <option value="medium">Medium — fix soon</option>
            <option value="high">High — affects how the aircraft can be used</option>
            <option value="grounding">Grounding — do not fly</option>
          </select>
        </Field>
        <label className="check-row danger-check">
          <input type="checkbox" checked={ground} onChange={(e) => setGround(e.target.checked)} disabled={urgency === 'grounding'} />
          <span><strong>Ground the aircraft now</strong><br /><span className="fine">Blocks check-out for everyone until an admin clears it with a recorded reason.</span></span>
        </label>
        <div className="field">
          <label htmlFor="if-photo">Photo (demo only)</label>
          <label className="file-btn"><Icon name="camera" size={20} /> {photo ? 'Replace photo' : 'Add photo'}<input id="if-photo" type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setPhoto(await resizeImage(f)); setPhotoErr(''); } catch { setPhotoErr('Could not read that image. Try a JPG or PNG.'); } }} /></label>
          <p className="hint">Stays in this browser only. Nothing is uploaded.</p>
          {photoErr && <p className="field-error">{photoErr}</p>}
          {photo && <img src={photo} alt="Attached issue photo preview" className="issue-photo" />}
        </div>
        {act.error && <Banner tone="danger" title={act.error.message} />}
      </form>
    </Modal>
  );
}

const ISSUE_STATUS: Record<IssueStatus, string> = { open: 'Open', investigating: 'Investigating', deferred: 'Deferred', resolved: 'Resolved' };
export const issueStatusLabel = (s: IssueStatus) => ISSUE_STATUS[s];
export const urgencyTone = (u: IssueUrgency) => (u === 'grounding' || u === 'high' ? 'danger' : u === 'medium' ? 'warn' : 'muted') as 'danger' | 'warn' | 'muted';

export function IssueDetail({ issueId }: { issueId: string }) {
  const { api, db, me, tz, closeModal, toast, offline } = useApp();
  const i = db.issues.find((x) => x.id === issueId);
  const [status, setStatus] = useState<IssueStatus>(i?.status ?? 'open');
  const [note, setNote] = useState('');
  const act = useAction(() => api.updateIssue(me.id, issueId, status, note));
  if (!i) return <Modal title="Issue" onClose={closeModal}><p>Issue not found.</p></Modal>;
  const r = i.restrictionId ? db.restrictions.find((x) => x.id === i.restrictionId) : undefined;
  return (
    <Modal title="Issue" onClose={closeModal}>
      <div className="detail-head"><Pill tone={urgencyTone(i.urgency)}>{i.urgency === 'grounding' ? 'Grounding' : i.urgency[0].toUpperCase() + i.urgency.slice(1)}</Pill><Pill tone={i.status === 'resolved' ? 'ok' : 'info'}>{ISSUE_STATUS[i.status]}</Pill></div>
      <p className="detail-when">{i.title}</p>
      {i.description && <p>{i.description}</p>}
      <p className="fine">Reported by {pilotName(db, i.reportedBy)} · {fmtDateTime(i.reportedAt, tz)}</p>
      {i.photoDataUrl && <img src={i.photoDataUrl} alt={`Photo for ${i.title}`} className="issue-photo" />}
      {r && <Banner tone={r.clearedAt ? 'ok' : r.level === 'grounded' ? 'danger' : 'warn'} title={r.clearedAt ? `Restriction cleared: ${r.clearReason}` : `Active ${r.level === 'grounded' ? 'grounding' : 'caution'}: ${r.reason}`}>{!r.clearedAt && <p>Resolving this issue does not clear the restriction. An admin clears it separately in Aircraft status.</p>}</Banner>}
      <div className="subcard"><h3>History</h3>
        <ul className="timeline">{i.history.map((h, k) => <li key={k}><span className="mono small">{fmtDateTime(h.at, tz)}</span><span><strong>{ISSUE_STATUS[h.status]}</strong> · {pilotName(db, h.by)}: {h.note}</span></li>)}</ul>
      </div>
      {me.role === 'admin' ? (
        <form className="form subcard" onSubmit={async (e) => { e.preventDefault(); const x = await act.run(); if (x) { toast('Issue updated'); setNote(''); } }}>
          <h3>Update status</h3>
          <Field id="id-status" label="Status"><select value={status} onChange={(e) => setStatus(e.target.value as IssueStatus)}>{Object.entries(ISSUE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field id="id-note" label="Note (required)" error={act.error?.details.fieldErrors?.note}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {act.error && !act.error.details.fieldErrors && <Banner tone="danger" title={act.error.message} />}
          {offline ? <GatedButton reason="You are offline.">Save update</GatedButton> : <Button type="submit" variant="primary" pending={act.pending}>Save update</Button>}
        </form>
      ) : <p className="fine">Only an admin can change an issue's status.</p>}
    </Modal>
  );
}

// ---------------- Maintenance & restriction (admin) ----------------
export function MaintenanceForm() {
  const { api, db, me, tz, closeModal, toast, now } = useApp();
  const today = toLocalParts(now, tz).date;
  const [title, setTitle] = useState('');
  const [sd, setSd] = useState(today); const [st, setSt] = useState('08:00');
  const [ed, setEd] = useState(today); const [et, setEt] = useState('17:00');
  const [notes, setNotes] = useState('');
  const [ack, setAck] = useState(false);
  const s = localToUtc(sd, st, tz), e = localToUtc(ed, et, tz);
  const act = useAction(async () => {
    if (!s.ok) throw new Error(s.error); if (!e.ok) throw new Error(e.error);
    return api.createMaintenance(me.id, { title, startUtc: s.utc, endUtc: e.utc, notes }, ack);
  });
  const affected = act.error?.code === 'needs_review' ? act.error.details.affected ?? [] : [];
  return (
    <Modal title="Schedule maintenance" onClose={closeModal} footer={<><Button variant="ghost" onClick={closeModal}>Cancel</Button><Button variant="primary" type="submit" form="mx-form" pending={act.pending}>{affected.length && ack ? 'Schedule and keep bookings for review' : 'Schedule maintenance'}</Button></>}>
      <form id="mx-form" className="form" noValidate onSubmit={async (ev) => { ev.preventDefault(); const r = await act.run(); if (r) { toast('Maintenance scheduled'); closeModal(); } }}>
        <Field id="mx-title" label="Title" error={act.error?.details.fieldErrors?.title}><input value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="e.g. Annual inspection" /></Field>
        <fieldset className="pair"><legend>Start</legend>
          <Field id="mx-sd" label="Date"><input type="date" value={sd} onChange={(ev) => setSd(ev.target.value)} /></Field>
          <Field id="mx-st" label="Time"><input type="time" value={st} onChange={(ev) => setSt(ev.target.value)} /></Field></fieldset>
        <fieldset className="pair"><legend>End</legend>
          <Field id="mx-ed" label="Date" error={act.error?.details.fieldErrors?.time}><input type="date" value={ed} onChange={(ev) => setEd(ev.target.value)} /></Field>
          <Field id="mx-et" label="Time"><input type="time" value={et} onChange={(ev) => setEt(ev.target.value)} /></Field></fieldset>
        <Field id="mx-notes" label="Notes"><textarea rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} /></Field>
        <p className="fine">A maintenance block reserves calendar time. It does not ground the aircraft. Use a restriction for that.</p>
        {affected.length > 0 && (
          <Banner tone="warn" title={act.error!.message}>
            {affected.map((b) => <p key={b.id}>{pilotName(db, b.pilotId)}: {fmtRange(b.startUtc, b.endUtc, tz)}</p>)}
            <p>These reservations will not be deleted. They will be flagged for you to review with each pilot.</p>
            <label className="check-row"><input type="checkbox" checked={ack} onChange={(ev) => setAck(ev.target.checked)} /><span>I'll review these reservations</span></label>
          </Banner>
        )}
        {act.error && act.error.code !== 'needs_review' && !act.error.details.fieldErrors && <Banner tone="danger" title={act.error.message} />}
      </form>
    </Modal>
  );
}

export function RestrictionForm() {
  const { api, me, closeModal, toast } = useApp();
  const [level, setLevel] = useState<Restriction['level']>('grounded');
  const [reason, setReason] = useState('');
  const act = useAction(() => api.addRestriction(me.id, level, reason));
  return (
    <Modal title="Add restriction" onClose={closeModal} footer={<><Button variant="ghost" onClick={closeModal}>Cancel</Button><Button variant="danger" type="submit" form="rs-form" pending={act.pending}>Add restriction</Button></>}>
      <form id="rs-form" className="form" noValidate onSubmit={async (e) => { e.preventDefault(); const r = await act.run(); if (r) { toast('Restriction added'); closeModal(); } }}>
        <Field id="rs-level" label="Type"><select value={level} onChange={(e) => setLevel(e.target.value as Restriction['level'])}><option value="grounded">Grounded — blocks check-out</option><option value="caution">Caution — shown to pilots, does not block</option></select></Field>
        <Field id="rs-reason" label="Reason" error={act.error?.details.fieldErrors?.reason}><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <p className="fine">Restrictions stay in place until an admin clears them with a reason. Ending maintenance or resolving an issue does not clear them.</p>
        {act.error && !act.error.details.fieldErrors && <Banner tone="danger" title={act.error.message} />}
      </form>
    </Modal>
  );
}

export function CsvModal({ csv, filename }: { csv: string; filename: string }) {
  const { closeModal, toast } = useApp();
  const ref = useRef<HTMLTextAreaElement>(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(csv); toast('CSV copied'); }
    catch { ref.current?.select(); toast('Text selected. Press Ctrl+C or ⌘C to copy.', 'info'); }
  };
  const download = () => {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      toast('Download started. If nothing happened, this preview blocks downloads; use Copy instead.', 'info');
    } catch { toast('Downloads are blocked here. Use Copy instead.', 'error'); }
  };
  return (
    <Modal title="Export CSV" onClose={closeModal} wide footer={<><Button variant="ghost" icon="download" onClick={download}>Download {filename}</Button><Button variant="primary" icon="copy" onClick={copy}>Copy CSV</Button></>}>
      <p className="fine">The Claude preview blocks file downloads. Copy works everywhere; Download works once the app is hosted.</p>
      <textarea ref={ref} className="csv mono" readOnly value={csv} rows={12} aria-label="CSV data" />
    </Modal>
  );
}
