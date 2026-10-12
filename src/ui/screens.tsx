import React, { useMemo, useState } from 'react';
import { useApp } from './context';
import { Avatar, Banner, Button, Empty, GatedButton, Icon, Pill, Section, Segmented, StatusPill } from './components';
import { activeRestrictions, aircraftOut, charges, checkOutBlocker, isOverdue, lastReadings, overlaps, sumMeter } from '../domain/rules';
import { fmtDateTime, fmtRange, fmtTime, toLocalParts, addDays } from '../domain/time';
import { fmtHundredths, fmtMoney } from '../domain/decimal';
import type { Booking, FlightRecord } from '../domain/types';
import { pilotName } from './bookingViews';
import { issueStatusLabel, urgencyTone } from './recordViews';
import { InstallCard, PushToggle } from './appShell';
import { InspectionsSummary, useInspectionViews } from './inspections';

export function AircraftHero({ compact }: { compact?: boolean }) {
  const { db } = useApp();
  const s = db.settings;
  return (
    <div className={`aircraft ${compact ? 'compact' : ''}`}>
      {s.photoDataUrl
        ? <img src={s.photoDataUrl} alt={`${s.tailNumber} ${s.model}`} className="aircraft-photo" />
        : <div className="aircraft-photo placeholder" aria-hidden="true"><Icon name="plane" size={34} /></div>}
      <div>
        <p className="tail">{s.tailNumber}</p>
        <p className="model">{s.model || 'Aircraft model not set'}</p>
        <p className="base">{s.homeAirport ? <>Based at <strong>{s.homeAirport}</strong></> : 'Home airport not set (admin: More → Settings)'}</p>
      </div>
    </div>
  );
}

export function BookingCard({ b, showPilot = true }: { b: Booking; showPilot?: boolean }) {
  const { db, tz, openModal, me, now } = useApp();
  const mine = b.pilotId === me.id;
  return (
    <button className={`bcard ${mine ? 'mine' : ''} st-${b.status}`} onClick={() => openModal({ kind: 'bookingDetail', bookingId: b.id })}>
      <span className="bcard-when">{fmtRange(b.startUtc, b.endUtc, tz)}</span>
      <span className="bcard-meta">
        {showPilot && <span className="who"><Avatar m={db.members.find((m) => m.id === b.pilotId)} size={22} /> {pilotName(db, b.pilotId)}{mine ? ' (you)' : ''}</span>}
        {b.destination && <span>→ {b.destination}</span>}
      </span>
      <span className="bcard-pills">
        <StatusPill status={b.status} />
        {isOverdue(b, now) && <Pill tone="danger">Overdue</Pill>}
        {b.flightRecordNeeded && <Pill tone="warn">Flight record needed</Pill>}
      </span>
    </button>
  );
}

// ---------------- Home ----------------
export function Home() {
  const { db, me, tz, now, openModal, setTab, setMore, offline } = useApp();
  const out = aircraftOut(db);
  const overdue = out ? isOverdue(out, now) : false;
  const upcoming = db.bookings.filter((b) => (b.status === 'confirmed' || b.status === 'checked_out') && Date.parse(b.endUtc) > now).sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
  const current = upcoming.find((b) => Date.parse(b.startUtc) <= now && b.status === 'confirmed');
  const nextAny = upcoming.find((b) => Date.parse(b.startUtc) > now);
  const myNext = upcoming.find((b) => b.pilotId === me.id);
  const restrictions = activeRestrictions(db);
  const inspOver = useInspectionViews().filter((v) => v.due.status === 'overdue');
  const grounded = restrictions.some((r) => r.level === 'grounded');
  const openIssues = db.issues.filter((i) => i.status !== 'resolved');
  const mxUpcoming = db.maintenance.filter((m) => m.status === 'scheduled' && Date.parse(m.endUtc) > now).sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
  const recordsNeeded = db.bookings.filter((b) => b.flightRecordNeeded && (b.pilotId === me.id || me.role === 'admin'));
  const reviewBookings = me.role === 'admin' ? db.bookings.filter((b) => b.status === 'confirmed' && db.maintenance.some((m) => m.status === 'scheduled' && overlaps(b.startUtc, b.endUtc, m.startUtc, m.endUtc, 0))) : [];
  const last = lastReadings(db.flights);
  const since = Date.parse(addDays(toLocalParts(now, tz).date, -30));
  const recent = db.flights.filter((f) => Date.parse(f.flightDate) >= since);

  // Check out / return action for the signed-in member
  const myOut = db.bookings.find((b) => b.status === 'checked_out' && b.pilotId === me.id);
  const myEligible = db.bookings.filter((b) => b.status === 'confirmed' && b.pilotId === me.id && Date.parse(b.endUtc) > now)
    .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))[0];
  let coLabel = 'Check out', coReason: string | null, coAction = () => {};
  if (offline) { coReason = 'You are offline. Check-out and return need a connection.'; }
  else if (myOut) { coLabel = 'Return aircraft'; coReason = null; coAction = () => openModal({ kind: 'return', bookingId: myOut.id }); }
  else if (myEligible) { coReason = checkOutBlocker(db, myEligible, me, now); coAction = () => openModal({ kind: 'bookingDetail', bookingId: myEligible.id }); }
  else coReason = 'You have no upcoming reservation to check out. Book the aircraft first.';

  let sched: { tone: 'ok' | 'warn' | 'danger' | 'info'; label: string; detail: string };
  if (out && overdue) sched = { tone: 'danger', label: 'Overdue return', detail: `Checked out by ${pilotName(db, out.pilotId)}. Was due back ${fmtDateTime(out.endUtc, tz)}.` };
  else if (out) sched = { tone: 'info', label: 'Checked out', detail: `${pilotName(db, out.pilotId)} until ${fmtTime(out.endUtc, tz)}.` };
  else if (current) sched = { tone: 'info', label: 'Reserved now', detail: `${pilotName(db, current.pilotId)} until ${fmtTime(current.endUtc, tz)} (not yet checked out).` };
  else sched = { tone: 'ok', label: 'Not reserved right now', detail: nextAny ? `Next reservation ${fmtDateTime(nextAny.startUtc, tz)}.` : 'No upcoming reservations.' };

  return (
    <div className="screen home">
      <div className="home-top">
        <AircraftHero />
        <div className="status-pair">
          <div className={`status-tile tone-${sched.tone}`}>
            <p className="eyebrow">Schedule</p>
            <p className="status-label">{sched.label}</p>
            <p className="status-detail">{sched.detail}</p>
          </div>
          <div className={`status-tile tone-${grounded || inspOver.length ? 'danger' : restrictions.length ? 'warn' : 'neutral'}`}>
            <p className="eyebrow">Operational restrictions</p>
            <p className="status-label">{grounded ? 'Grounded' : restrictions.length ? `${restrictions.length} caution${restrictions.length > 1 ? 's' : ''}` : 'None recorded'}</p>
            <p className="status-detail">{grounded ? 'Check-out is blocked until an admin clears it.' : 'Recorded restrictions only. The pilot in command determines airworthiness.'}</p>
            {inspOver.length > 0 && <p className="status-detail insp-over-line"><strong>{inspOver.length} inspection{inspOver.length > 1 ? 's' : ''} overdue</strong></p>}
          </div>
        </div>
      </div>

      {__LIVE__ && <InstallCard />}
      {__LIVE__ && <PushToggle prompt />}

      {overdue && out && <Banner tone="danger" title="Aircraft overdue">{pilotName(db, out.pilotId)}'s reservation ended {fmtDateTime(out.endUtc, tz)}. It stays checked out until returned. <button className="link" onClick={() => openModal({ kind: 'bookingDetail', bookingId: out.id })}>Open reservation</button></Banner>}

      <div className="actions">
        <Button variant="primary" size="lg" icon="plus" onClick={() => openModal({ kind: 'booking' })} disabled={false}>Book aircraft</Button>
        <GatedButton variant={myOut ? 'primary' : 'secondary'} size="lg" icon="key" reason={coReason} onClick={coAction}>{coLabel}</GatedButton>
        <Button size="lg" icon="alert" onClick={() => openModal({ kind: 'issue' })}>Report issue</Button>
      </div>

      {recordsNeeded.length > 0 && (
        <Banner tone="warn" title={`Flight record${recordsNeeded.length > 1 ? 's' : ''} needed`} icon="log">
          {recordsNeeded.map((b) => <p key={b.id}><button className="link" onClick={() => openModal({ kind: 'flight', bookingId: b.id })}>{pilotName(db, b.pilotId)} · {fmtRange(b.startUtc, b.endUtc, tz)}</button></p>)}
          <p className="fine">The aircraft was returned, but Hobbs and tach readings have not been recorded yet.</p>
        </Banner>
      )}
      {reviewBookings.length > 0 && (
        <Banner tone="warn" title="Reservations overlap maintenance (admin review)">
          {reviewBookings.map((b) => <p key={b.id}><button className="link" onClick={() => openModal({ kind: 'bookingDetail', bookingId: b.id })}>{pilotName(db, b.pilotId)} · {fmtRange(b.startUtc, b.endUtc, tz)}</button></p>)}
        </Banner>
      )}

      <div className="home-grid">
        <Section title="My next booking">
          {myNext ? <BookingCard b={myNext} showPilot={false} /> : <Empty title="Nothing booked" action={<Button onClick={() => openModal({ kind: 'booking' })}>Book aircraft</Button>}>You have no upcoming reservations.</Empty>}
        </Section>
        <Section title="Next reservation" action={<button className="link" onClick={() => setTab('calendar')}>Calendar</button>}>
          {nextAny ? <BookingCard b={nextAny} /> : <Empty title="No upcoming reservations" />}
        </Section>

        <Section title="Restrictions and issues" action={<button className="link" onClick={() => { setTab('more'); setMore('aircraft'); }}>Aircraft status</button>}>
          {restrictions.length === 0 && openIssues.length === 0 && <Empty title="No open items">No restrictions or open issues are recorded.</Empty>}
          <ul className="list">
            {restrictions.map((r) => (
              <li key={r.id} className={`li-restrict ${r.level}`}>
                <Pill tone={r.level === 'grounded' ? 'danger' : 'warn'}>{r.level === 'grounded' ? 'Grounded' : 'Caution'}</Pill>
                <span>{r.reason}</span>
              </li>
            ))}
            {openIssues.map((i) => (
              <li key={i.id}><button className="row-btn" onClick={() => openModal({ kind: 'issueDetail', issueId: i.id })}>
                <span>{i.title}</span><span className="pills"><Pill tone={urgencyTone(i.urgency)}>{i.urgency}</Pill><Pill tone="muted">{issueStatusLabel(i.status)}</Pill></span>
              </button></li>
            ))}
          </ul>
          {mxUpcoming[0] && <p className="mx-line"><Icon name="wrench" size={18} /> Maintenance {fmtRange(mxUpcoming[0].startUtc, mxUpcoming[0].endUtc, tz)}: {mxUpcoming[0].title}</p>}
        </Section>

        <InspectionsSummary />

        <Section title="Meter readings">
          <div className="meters">
            {db.settings.hobbsEnabled && <div className="meter-tile"><p className="eyebrow">Hobbs · last recorded</p><p className="reading">{fmtHundredths(last.hobbs)}</p><p className="fine">+{fmtHundredths(sumMeter(recent, 'hobbs'))} in last 30 days</p></div>}
            {db.settings.tachEnabled && <div className="meter-tile"><p className="eyebrow">Tach · last recorded</p><p className="reading">{fmtHundredths(last.tach)}</p><p className="fine">+{fmtHundredths(sumMeter(recent, 'tach'))} in last 30 days</p></div>}
          </div>
          <p className="fine">Hobbs and tach measure different things and are tracked separately. Neither is your logbook flight time.</p>
        </Section>
      </div>
    </div>
  );
}

// ---------------- My bookings ----------------
export function MyBookings() {
  const { db, me, now, openModal } = useApp();
  const [view, setView] = useState<'upcoming' | 'past' | 'canceled'>('upcoming');
  const [everyone, setEveryone] = useState(false);
  const scope = db.bookings.filter((b) => everyone && me.role === 'admin' ? true : b.pilotId === me.id);
  const list = scope.filter((b) => {
    if (view === 'canceled') return b.status === 'canceled' || b.status === 'no_show';
    if (view === 'upcoming') return (b.status === 'confirmed' && Date.parse(b.endUtc) > now) || b.status === 'checked_out' || (b.status === 'completed' && b.flightRecordNeeded);
    return (b.status === 'completed' && !b.flightRecordNeeded) || (b.status === 'confirmed' && Date.parse(b.endUtc) <= now);
  }).sort((a, b) => (view === 'upcoming' ? 1 : -1) * (Date.parse(a.startUtc) - Date.parse(b.startUtc)));
  return (
    <div className="screen">
      <div className="screen-head">
        <h1>{everyone ? 'All bookings' : 'My bookings'}</h1>
        <Button variant="primary" icon="plus" onClick={() => openModal({ kind: 'booking' })}>Book</Button>
      </div>
      <div className="toolbar">
        <Segmented label="Which bookings" value={view} onChange={setView} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }, { value: 'canceled', label: 'Canceled / no-show' }]} />
        {me.role === 'admin' && <label className="switch"><input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> Everyone's bookings</label>}
      </div>
      {list.length === 0
        ? <Empty title={view === 'upcoming' ? 'No upcoming bookings' : view === 'past' ? 'No past bookings' : 'Nothing canceled'} action={view === 'upcoming' ? <Button variant="primary" onClick={() => openModal({ kind: 'booking' })}>Book aircraft</Button> : undefined} />
        : <div className="stack">{list.map((b) => <BookingCard key={b.id} b={b} showPilot={everyone} />)}</div>}
      {view === 'past' && list.some((b) => b.status === 'confirmed') && <p className="fine">Past reservations still shown as Confirmed were never checked out. An admin can record them as a no-show; 733XZ never assumes it.</p>}
    </div>
  );
}

// ---------------- Flight log ----------------
const csvCell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function FlightLog() {
  const { db, me, tz, openModal } = useApp();
  const isAdmin = me.role === 'admin';
  const [pilot, setPilot] = useState(isAdmin ? 'all' : me.id);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const s = db.settings;
  const rows = useMemo(() => db.flights.filter((f) => !f.voided && (isAdmin ? (pilot === 'all' || f.pilotId === pilot) : f.pilotId === me.id)
    && (!from || f.flightDate >= from) && (!to || f.flightDate <= to)).sort((a, b) => b.flightDate.localeCompare(a.flightDate) || b.createdAt.localeCompare(a.createdAt)), [db.flights, pilot, from, to, me, isAdmin]);
  const allActive = db.flights.filter((f) => !f.voided);
  const ch = charges(rows, s);
  const perPilot = isAdmin ? db.members.map((m) => ({ m, rows: rows.filter((f) => f.pilotId === m.id) })).filter((x) => x.rows.length) : [];

  const exportCsv = () => {
    const head = ['flight_date', 'pilot', 'route', 'booking_id', ...(s.hobbsEnabled ? ['hobbs_start', 'hobbs_end', 'hobbs_change'] : []), ...(s.tachEnabled ? ['tach_start', 'tach_end', 'tach_change'] : []), 'fuel_gallons', 'fuel_cost', 'rental_charge', 'flags', 'corrections', 'notes'];
    const lines = rows.map((f) => {
      const c = charges([f], s);
      return [f.flightDate, pilotName(db, f.pilotId), f.route, f.bookingId,
        ...(s.hobbsEnabled ? [fmtHundredths(f.hobbsStart, 2), fmtHundredths(f.hobbsEnd, 2), f.hobbsStart !== null ? fmtHundredths(f.hobbsEnd! - f.hobbsStart, 2) : ''] : []),
        ...(s.tachEnabled ? [fmtHundredths(f.tachStart, 2), fmtHundredths(f.tachEnd, 2), f.tachStart !== null ? fmtHundredths(f.tachEnd! - f.tachStart, 2) : ''] : []),
        f.fuelGallons !== null ? fmtHundredths(f.fuelGallons, 2) : '', f.fuelCostCents !== null ? (f.fuelCostCents / 100).toFixed(2) : '', (c.rentalCents / 100).toFixed(2),
        f.flags.join(' | '), f.revisions.length, f.notes].map(csvCell).join(',');
    });
    openModal({ kind: 'csv', csv: [head.join(','), ...lines].join('\n'), filename: `${s.tailNumber}-usage-records.csv` });
  };

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Flight log</h1>
        <div className="btn-row"><Button icon="download" onClick={exportCsv} disabled={!rows.length}>CSV</Button><Button variant="primary" icon="plus" onClick={() => openModal({ kind: 'flight' })}>Record flight</Button></div>
      </div>
      <p className="fine log-disclaimer">Operational usage records for scheduling and cost sharing. Not a replacement for pilot or aircraft logbooks. Hobbs, tach, and regulatory flight time are not interchangeable.</p>
      <div className="filters">
        {isAdmin && <label>Pilot<select value={pilot} onChange={(e) => setPilot(e.target.value)}><option value="all">All pilots</option>{db.members.filter((m) => !m.removed || db.flights.some((f) => f.pilotId === m.id)).map((m) => <option key={m.id} value={m.id}>{m.name}{m.removed ? ' (removed)' : ''}</option>)}</select></label>}
        <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {(from || to || (isAdmin && pilot !== 'all')) && <button className="link" onClick={() => { setFrom(''); setTo(''); setPilot(isAdmin ? 'all' : me.id); }}>Clear filters</button>}
      </div>
      <div className="totals">
        {s.hobbsEnabled && <div><p className="eyebrow">{isAdmin && pilot === 'all' ? 'Hobbs (filtered)' : 'My Hobbs'}</p><p className="reading">{fmtHundredths(sumMeter(rows, 'hobbs'))}</p></div>}
        {s.tachEnabled && <div><p className="eyebrow">{isAdmin && pilot === 'all' ? 'Tach (filtered)' : 'My tach'}</p><p className="reading">{fmtHundredths(sumMeter(rows, 'tach'))}</p></div>}
        <div><p className="eyebrow">Rental at {fmtMoney(s.rateCentsPerHour)}/h</p><p className="reading">{fmtMoney(ch.rentalCents)}</p></div>
        <div><p className="eyebrow">Fuel {s.fuelPolicy === 'pilot_pays_at_pump' ? '(paid at pump)' : '(on statement)'}</p><p className="reading">{fmtMoney(ch.fuelCents)}</p></div>
      </div>
      <p className="fine">Aircraft totals, all records: Hobbs {fmtHundredths(sumMeter(allActive, 'hobbs'))} · Tach {fmtHundredths(sumMeter(allActive, 'tach'))}. Charges are a usage statement only; 733XZ does not take payments.</p>

      {rows.length === 0 ? <Empty title="No flight records match">Records appear after a pilot returns the aircraft and enters Hobbs and tach readings.</Empty> : (
        <div className="table-wrap">
          <table className="log-table">
            <thead><tr><th>Date</th><th>Pilot</th><th>Route</th>{s.hobbsEnabled && <th className="num">Hobbs</th>}{s.tachEnabled && <th className="num">Tach</th>}<th className="num">Rental</th><th className="num">Fuel</th><th></th></tr></thead>
            <tbody>{rows.map((f) => <LogRow key={f.id} f={f} />)}</tbody>
          </table>
        </div>
      )}

      {isAdmin && perPilot.length > 0 && (
        <Section title="Usage statement by pilot">
          <div className="table-wrap"><table className="log-table">
            <thead><tr><th>Pilot</th><th className="num">Billable h</th><th className="num">Rental</th><th className="num">Fuel</th><th className="num">Owed to group</th></tr></thead>
            <tbody>{perPilot.map(({ m, rows: r }) => { const c = charges(r, s); return <tr key={m.id}><td>{m.name}</td><td className="num">{fmtHundredths(c.hours)}</td><td className="num">{fmtMoney(c.rentalCents)}</td><td className="num">{fmtMoney(c.fuelCents)}</td><td className="num strong">{fmtMoney(c.totalOwedCents)}</td></tr>; })}</tbody>
          </table></div>
          <p className="fine">Owed to group = rental{s.fuelPolicy === 'add_to_statement' ? ' + fuel' : ' only, because pilots pay for fuel at the pump'}. Statement only; no payments are processed.</p>
        </Section>
      )}
      <p className="fine">Times shown in {tz}.</p>
    </div>
  );
}

function LogRow({ f }: { f: FlightRecord }) {
  const { db, openModal } = useApp();
  const s = db.settings;
  const c = charges([f], s);
  return (
    <tr className="clickable" onClick={() => openModal({ kind: 'flightDetail', flightId: f.id })}>
      <td className="mono">{f.flightDate}</td>
      <td>{pilotName(db, f.pilotId)}</td>
      <td>{f.route}</td>
      {s.hobbsEnabled && <td className="num mono">{f.hobbsStart !== null ? fmtHundredths(f.hobbsEnd! - f.hobbsStart) : '—'}</td>}
      {s.tachEnabled && <td className="num mono">{f.tachStart !== null ? fmtHundredths(f.tachEnd! - f.tachStart) : '—'}</td>}
      <td className="num mono">{fmtMoney(c.rentalCents)}</td>
      <td className="num mono">{f.fuelCostCents !== null ? fmtMoney(f.fuelCostCents) : '—'}</td>
      <td>
        <button className="icon-btn" aria-label={`Open flight ${f.flightDate} ${f.route}`} onClick={(e) => { e.stopPropagation(); openModal({ kind: 'flightDetail', flightId: f.id }); }}>
          {f.flags.length ? <Pill tone="warn">{f.flags.length} flag{f.flags.length > 1 ? 's' : ''}</Pill> : <Icon name="chevron" size={18} />}
        </button>
      </td>
    </tr>
  );
}
