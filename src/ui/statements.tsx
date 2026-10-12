import React, { useMemo, useState } from 'react';
import { useApp, useAction } from './context';
import { Banner, Button, Empty, Field, GatedButton, Section } from './components';
import { monthLabel, monthlyStatement, statementCsv, statementMonths } from '../domain/statements';
import { fmtHundredths, fmtMoney } from '../domain/decimal';
import { toLocalParts } from '../domain/time';

/** Monthly statements. Admins see every pilot; pilots see their own. */
export function StatementsScreen() {
  const { db, me, tz, now, openModal, live } = useApp();
  const isAdmin = me.role === 'admin';
  const current = toLocalParts(now, tz).date.slice(0, 7);
  const months = statementMonths(db, current);
  const [month, setMonth] = useState(months[0]);
  const st = useMemo(() => monthlyStatement(db, month), [db, month]);
  const rows = isAdmin ? st.rows : st.rows.filter((r) => r.memberId === me.id);
  const view = isAdmin ? st : { ...st, rows };
  const s = db.settings;
  const basis = s.rateBasis === 'tach' ? 'tach' : 'Hobbs';
  const fuelOnStatement = s.fuelPolicy === 'add_to_statement';
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="statements">
      <div className="filters no-print">
        <label>Month
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <div className="btn-row">
          <Button icon="download" disabled={!rows.length} onClick={() => openModal({ kind: 'csv', csv: statementCsv(view, db), filename: `${s.tailNumber}-statement-${month}.csv` })}>CSV</Button>
          {live && <Button icon="print" disabled={!rows.length} onClick={() => window.print()}>Print / PDF</Button>}
        </div>
      </div>

      <div className="print-head">
        <h2>{s.tailNumber} usage statement · {monthLabel(month)}</h2>
        <p className="fine">Rental {fmtMoney(s.rateCentsPerHour)} per {basis} hour. Fuel: {fuelOnStatement ? 'added to the statement' : 'paid by the pilot at the pump (shown, not owed)'}. Statement only — no payments are processed in 733XZ.</p>
      </div>

      {rows.length === 0 ? (
        <Empty title={`No flights in ${monthLabel(month)}`}>{isAdmin ? 'Statements fill in as pilots record flights.' : 'You have no flight records this month.'}</Empty>
      ) : (
        <>
          <div className="stmt-cards">
            {rows.map((r) => (
              <div key={r.memberId} className="stmt-card">
                <button className="stmt-top" onClick={() => setOpen(open === r.memberId ? null : r.memberId)} aria-expanded={open === r.memberId}>
                  <span><strong>{r.name}</strong><span className="fine block">{r.flights} flight{r.flights === 1 ? '' : 's'} · {fmtHundredths(r.billable)} {basis} h</span></span>
                  <span className="stmt-owed"><span className="fine block">Owed</span><span className="mono">{fmtMoney(r.owedCents)}</span></span>
                </button>
                <dl className="stmt-kv">
                  <dt>Rental</dt><dd className="mono">{fmtHundredths(r.billable)} h × {fmtMoney(s.rateCentsPerHour)} = {fmtMoney(r.rentalCents)}</dd>
                  <dt>Fuel</dt><dd className="mono">{fmtMoney(r.fuelCents)} · {fmtHundredths(r.fuelGallons)} gal{fuelOnStatement ? '' : ' (paid at pump)'}</dd>
                </dl>
                {open === r.memberId && (
                  <ul className="stmt-flights">
                    {r.records.map((f) => {
                      const h = s.rateBasis === 'tach' ? (f.tachEnd ?? 0) - (f.tachStart ?? 0) : (f.hobbsEnd ?? 0) - (f.hobbsStart ?? 0);
                      return <li key={f.id}><span>{f.flightDate.slice(5).replace('-', '/')} · {f.route}</span><span className="mono">{fmtHundredths(h)} h · {fmtMoney(Math.floor((h * s.rateCentsPerHour + 50) / 100))}</span></li>;
                    })}
                  </ul>
                )}
                {open !== r.memberId && <button className="link small" onClick={() => setOpen(r.memberId)}>Show {r.flights} flight{r.flights === 1 ? '' : 's'}</button>}
              </div>
            ))}
            {isAdmin && rows.length > 1 && <div className="stmt-total"><span>Total · {st.totals.flights} flights · {fmtHundredths(st.totals.billable)} h</span><strong className="mono">{fmtMoney(st.totals.owedCents)}</strong></div>}
          </div>
          <div className="table-wrap stmt-table">
            <table className="log-table">
              <thead><tr><th>Pilot</th><th className="num">Flights</th><th className="num">{basis} h</th><th className="num">Rental</th><th className="num">Fuel</th><th className="num">Owed</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <React.Fragment key={r.memberId}>
                    <tr className="clickable" onClick={() => setOpen(open === r.memberId ? null : r.memberId)} aria-expanded={open === r.memberId}>
                      <td><strong>{r.name}</strong></td>
                      <td className="num">{r.flights}</td>
                      <td className="num mono">{fmtHundredths(r.billable)}</td>
                      <td className="num mono">{fmtMoney(r.rentalCents)}</td>
                      <td className="num mono">{fmtMoney(r.fuelCents)}{!fuelOnStatement && <span className="fine"> paid</span>}</td>
                      <td className="num mono strong">{fmtMoney(r.owedCents)}</td>
                    </tr>
                    {(open === r.memberId) && r.records.map((f) => (
                      <tr key={f.id} className="sub-row">
                        <td className="mono small">{f.flightDate} · {f.route}</td>
                        <td></td>
                        <td className="num mono small">{fmtHundredths((s.rateBasis === 'tach' ? (f.tachEnd ?? 0) - (f.tachStart ?? 0) : (f.hobbsEnd ?? 0) - (f.hobbsStart ?? 0)))}</td>
                        <td className="num mono small">{fmtMoney(Math.floor((((s.rateBasis === 'tach' ? (f.tachEnd ?? 0) - (f.tachStart ?? 0) : (f.hobbsEnd ?? 0) - (f.hobbsStart ?? 0))) * s.rateCentsPerHour + 50) / 100))}</td>
                        <td className="num mono small">{f.fuelCostCents !== null ? fmtMoney(f.fuelCostCents) : '—'}{f.fuelGallons !== null ? ` · ${fmtHundredths(f.fuelGallons)} gal` : ''}</td>
                        <td></td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
              {isAdmin && rows.length > 1 && (
                <tfoot><tr><td><strong>Total</strong></td><td className="num">{st.totals.flights}</td><td className="num mono">{fmtHundredths(st.totals.billable)}</td><td className="num mono">{fmtMoney(st.totals.rentalCents)}</td><td className="num mono">{fmtMoney(st.totals.fuelCents)}</td><td className="num mono strong">{fmtMoney(st.totals.owedCents)}</td></tr></tfoot>
              )}
            </table>
          </div>
          <p className="fine no-print">Tap a pilot to see each flight. Hobbs {fmtHundredths(st.totals.hobbs)} · tach {fmtHundredths(st.totals.tach)} for the month{isAdmin ? '' : ' (yours)'}.</p>
        </>
      )}
    </div>
  );
}

/** Admin: remove setup/test records. */
export function ClearDataCard() {
  const { api, me, toast, offline, db } = useApp();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState({ bookings: true, flights: true, aircraft: true, inspections: false, history: false });
  const [confirm, setConfirm] = useState('');
  const act = useAction(() => api.clearData(me.id, { ...opts, confirm }));
  if (me.role !== 'admin') return null;
  return (
    <Section title="Clear test data">
      <p className="fine">Removes records you made while setting up. Members, sign-in, settings and the aircraft photo stay. This can't be undone in the app (Cloudflare keeps 30 days of database backups).</p>
      {!open ? <GatedButton icon="trash" variant="danger" reason={offline ? 'You are offline.' : null} onClick={() => setOpen(true)}>Clear test data…</GatedButton> : (
        <form className="form confirm-box" onSubmit={async (e) => { e.preventDefault(); const r = await act.run(); if (r) { toast('Test data cleared'); setOpen(false); setConfirm(''); } }}>
          <label className="check-row"><input type="checkbox" checked={opts.bookings} onChange={(e) => setOpts({ ...opts, bookings: e.target.checked })} /><span><strong>Bookings</strong> ({db.bookings.length})</span></label>
          <label className="check-row"><input type="checkbox" checked={opts.flights} onChange={(e) => setOpts({ ...opts, flights: e.target.checked })} /><span><strong>Flight records</strong> ({db.flights.length})</span></label>
          <label className="check-row"><input type="checkbox" checked={opts.aircraft} onChange={(e) => setOpts({ ...opts, aircraft: e.target.checked })} /><span><strong>Issues, maintenance and restrictions</strong> ({db.issues.length + db.maintenance.length + db.restrictions.length})</span></label>
          <label className="check-row"><input type="checkbox" checked={opts.inspections} onChange={(e) => setOpts({ ...opts, inspections: e.target.checked })} /><span><strong>Inspection dates</strong> (last-done dates and history; the list stays)</span></label>
          <label className="check-row"><input type="checkbox" checked={opts.history} onChange={(e) => setOpts({ ...opts, history: e.target.checked })} /><span><strong>Activity history</strong> ({db.audit.length} entries)</span></label>
          <Field id="cd-confirm" label="Type CLEAR to confirm" error={act.error?.details.fieldErrors?.confirm}><input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" autoCapitalize="characters" /></Field>
          {act.error && !act.error.details.fieldErrors && <Banner tone="danger" title={act.error.message} />}
          <div className="btn-row"><Button type="button" variant="ghost" onClick={() => { setOpen(false); setConfirm(''); }}>Keep everything</Button><Button type="submit" variant="danger" pending={act.pending} disabled={confirm !== 'CLEAR'}>Clear selected</Button></div>
        </form>
      )}
    </Section>
  );
}

/** Admin: remove a member from the group (with confirmation). */
export function RemoveMemberButton({ memberId }: { memberId: string }) {
  const { api, db, me, toast, offline, now, tz } = useApp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const act = useAction(() => api.removeMember(me.id, memberId, reason));
  const m = db.members.find((x) => x.id === memberId);
  if (!m || m.removed || me.role !== 'admin') return null;
  if (m.id === me.id || m.id === 'owner') return null; // you can't remove yourself or the owner account
  const why = offline ? 'You are offline.' : null;
  const upcoming = db.bookings.filter((b) => b.pilotId === m.id && b.status === 'confirmed' && Date.parse(b.endUtc) > now);
  const out = db.bookings.some((b) => b.pilotId === m.id && b.status === 'checked_out');
  const past = db.flights.filter((f) => f.pilotId === m.id && !f.voided).length;
  if (!open) return <GatedButton type="button" variant="ghost" icon="trash" reason={why} onClick={() => setOpen(true)}>Remove…</GatedButton>;
  return (
    <form className="form confirm-box full" onSubmit={async (e) => { e.preventDefault(); const r = await act.run(); if (r) { toast(r.deleted ? `${m.name} deleted` : `${m.name} removed${r.canceledBookings ? `, ${r.canceledBookings} booking${r.canceledBookings > 1 ? 's' : ''} canceled` : ''}`); setOpen(false); } }}>
      <p className="confirm-title">Remove {m.name}?</p>
      <ul className="plain bullets fine">
        <li>They can't sign in anymore, and their phone number, codes and notifications are deleted.</li>
        <li>{upcoming.length ? `${upcoming.length} upcoming booking${upcoming.length > 1 ? 's' : ''} will be canceled and the time opened up (${upcoming.map((b) => new Date(b.startUtc).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' })).join(', ')}).` : 'They have no upcoming bookings.'}</li>
        <li>{past ? `They have ${past} past flight record${past > 1 ? 's' : ''}. Those stay in statements under their name; everything else about them is removed.` : 'They have no flight history, so they are deleted completely.'}</li>
      </ul>
      {out && <Banner tone="warn" title={`${m.name} has the aircraft checked out. Return it before removing them.`} />}
      <Field id={`rm-${m.id}`} label="Reason (optional)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Left the group" /></Field>
      {act.error && <Banner tone="danger" title={act.error.message} />}
      <div className="btn-row"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Keep member</Button><Button type="submit" variant="danger" pending={act.pending} disabled={out}>Remove member</Button></div>
    </form>
  );
}
