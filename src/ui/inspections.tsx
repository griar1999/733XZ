import React, { useMemo, useState } from 'react';
import { useApp, useAction } from './context';
import { Banner, Button, Empty, Field, GatedButton, Icon, Pill, Section } from './components';
import { fmtDay, intervalLabel, inspectionViews, statusLabel, currentTach, type InspectionStatus, type InspectionView } from '../domain/inspections';
import { fmtHundredths, parseHundredths } from '../domain/decimal';
import { toLocalParts } from '../domain/time';
import type { Inspection, InspectionKind } from '../domain/types';
import { pilotName } from './bookingViews';

const tone = (s: InspectionStatus) => (s === 'overdue' ? 'danger' : s === 'soon' ? 'warn' : s === 'ok' ? 'ok' : 'muted') as 'danger' | 'warn' | 'ok' | 'muted';

export function useInspectionViews(): InspectionView[] {
  const { db, now, tz } = useApp();
  const today = toLocalParts(now, tz).date;
  return useMemo(() => inspectionViews(db, today), [db, today]);
}

/** Compact list for Home: anything overdue, due soon, or not set yet. */
export function InspectionsSummary() {
  const { setTab, setMore, me } = useApp();
  const isAdmin = me.role === 'admin';
  const views = useInspectionViews();
  const attention = views.filter((v) => v.due.status === 'overdue' || v.due.status === 'soon');
  const unset = views.filter((v) => v.due.status === 'unset').length;
  const open = () => { setTab('more'); setMore('inspections'); };
  // Pilots don't see setup prompts; with nothing entered yet there's nothing useful to show them.
  if (!isAdmin && attention.length === 0 && unset === views.length) return null;
  return (
    <Section title="Inspections" action={<button className="link" onClick={open}>All inspections</button>}>
      {attention.length === 0 && unset === 0 && <p className="insp-allgood"><Icon name="check" size={18} /> All inspections current.</p>}
      {attention.length === 0 && unset > 0 && !isAdmin && <p className="insp-allgood"><Icon name="check" size={18} /> Nothing due soon.</p>}
      {attention.length > 0 && (
        <ul className="list">
          {attention.map(({ insp, due }) => (
            <li key={insp.id}><button className="row-btn" onClick={open}>
              <span><strong>{insp.name}</strong><span className="fine block">{due.summary}</span></span>
              <Pill tone={tone(due.status)}>{statusLabel(due.status)}</Pill>
            </button></li>
          ))}
        </ul>
      )}
      {unset > 0 && isAdmin && <p className="fine">{unset} inspection{unset > 1 ? 's' : ''} not set up yet. <button className="link" onClick={open}>Enter last dates</button></p>}
    </Section>
  );
}

export function InspectionsScreen() {
  const { me } = useApp();
  const views = useInspectionViews();
  const isAdmin = me.role === 'admin';
  const [adding, setAdding] = useState(false);
  const counts = { overdue: views.filter((v) => v.due.status === 'overdue').length, soon: views.filter((v) => v.due.status === 'soon').length };
  return (
    <>
      <p className="fine">Tracking only. The aircraft logbooks are the official record, and the pilot in command decides airworthiness.</p>
      {counts.overdue > 0 && <Banner tone="danger" title={`${counts.overdue} inspection${counts.overdue > 1 ? 's' : ''} overdue`}>Check with an admin before flying.</Banner>}
      {counts.overdue === 0 && counts.soon > 0 && <Banner tone="warn" title={`${counts.soon} inspection${counts.soon > 1 ? 's' : ''} due soon`} />}
      <div className="stack">{views.map((v) => <InspectionCard key={v.insp.id} v={v} />)}</div>
      {views.length === 0 && <Empty title="No inspections turned on" />}
      {isAdmin && (adding ? <AddInspection done={() => setAdding(false)} /> : <Button icon="plus" onClick={() => setAdding(true)}>Add inspection</Button>)}
      {isAdmin && <TurnedOff />}
    </>
  );
}

function InspectionCard({ v }: { v: InspectionView }) {
  const { db, me, tz, offline } = useApp();
  const { insp, due } = v;
  const [mode, setMode] = useState<null | 'record' | 'edit'>(null);
  const canRecord = me.role === 'admin' || insp.pilotsCanRecord;
  const last = insp.lastDate ? `${fmtDay(insp.lastDate)}${insp.kind === 'tach' && insp.lastTach !== null ? ` · tach ${fmtHundredths(insp.lastTach)}` : ''}` : 'Not entered';
  const next = due.status === 'unset' ? '—' : due.status === 'no-meter' ? due.summary : due.nextDate ? fmtDay(due.nextDate) : due.nextTach !== null ? `Tach ${fmtHundredths(due.nextTach)}` : '—';
  const left = due.daysLeft !== null ? (due.daysLeft < 0 ? `${-due.daysLeft} day${due.daysLeft === -1 ? '' : 's'} overdue` : `${due.daysLeft} day${due.daysLeft === 1 ? '' : 's'} left`)
    : due.tachLeft !== null ? (due.tachLeft <= 0 ? `${fmtHundredths(-due.tachLeft)} h overdue` : `${fmtHundredths(due.tachLeft)} h left`) : '';
  return (
    <div className={`insp-card st-${due.status}`}>
      <div className="insp-head">
        <div><p className="insp-name">{insp.name}</p><p className="fine">{intervalLabel(insp.kind, insp.interval)}</p></div>
        <Pill tone={tone(due.status)}>{statusLabel(due.status)}</Pill>
      </div>
      <dl className="insp-kv">
        <div><dt>Last</dt><dd>{last}</dd></div>
        <div><dt>Next</dt><dd>{next}{left && <span className={`insp-left ${due.status}`}>{left}</span>}</dd></div>
      </dl>
      {mode === 'record' && <RecordForm insp={insp} done={() => setMode(null)} />}
      {mode === 'edit' && <EditForm insp={insp} done={() => setMode(null)} />}
      {!mode && (
        <div className="btn-row">
          {canRecord && <GatedButton variant={due.status === 'overdue' || due.status === 'soon' || due.status === 'unset' ? 'primary' : 'secondary'} icon="check" reason={offline ? 'You are offline.' : null} onClick={() => setMode('record')}>{insp.lastDate ? 'Record completed' : 'Enter last done'}</GatedButton>}
          {me.role === 'admin' && <Button variant="ghost" onClick={() => setMode('edit')}>Edit</Button>}
        </div>
      )}
      {insp.history.length > 0 && (
        <details className="history">
          <summary>History ({insp.history.length})</summary>
          <ul>{insp.history.map((h, i) => <li key={i}><strong>{fmtDay(h.date)}</strong>{h.tach !== null ? ` · tach ${fmtHundredths(h.tach)}` : ''} · {pilotName(db, h.by)}{h.notes ? ` — ${h.notes}` : ''}<span className="fine"> (recorded {new Date(h.at).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' })})</span></li>)}</ul>
        </details>
      )}
    </div>
  );
}

function RecordForm({ insp, done }: { insp: Inspection; done: () => void }) {
  const { api, db, me, tz, now, toast } = useApp();
  const today = toLocalParts(now, tz).date;
  const cur = currentTach(db);
  const [date, setDate] = useState(today);
  const [tach, setTach] = useState(insp.kind === 'tach' && cur !== null ? fmtHundredths(cur) : '');
  const [notes, setNotes] = useState('');
  const [tachErr, setTachErr] = useState('');
  const act = useAction(async () => {
    let t: number | null = null;
    if (tach.trim()) {
      const r = parseHundredths(tach, 'Tach');
      if (!r.ok) { setTachErr(r.error); throw new Error(r.error); }
      t = r.value;
    }
    setTachErr('');
    return api.recordInspection(me.id, insp.id, { date, tach: t, notes });
  });
  const fe = act.error?.details.fieldErrors ?? {};
  return (
    <form className="form confirm-box" onSubmit={async (e) => { e.preventDefault(); const r = await act.run(); if (r) { toast(`${insp.name} recorded`); done(); } }}>
      <p className="confirm-title">{insp.lastDate ? 'Record completed' : 'Enter when it was last done'}</p>
      <div className="grid2">
        <Field id={`ri-d-${insp.id}`} label="Date done" error={fe.date}><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field id={`ri-t-${insp.id}`} label={insp.kind === 'tach' ? 'Tach at inspection' : 'Tach (optional)'} error={tachErr || fe.tach} hint={cur !== null ? `Latest in flight log: ${fmtHundredths(cur)}` : undefined}>
          <input className="mono" inputMode="decimal" value={tach} onChange={(e) => setTach(e.target.value)} />
        </Field>
      </div>
      <Field id={`ri-n-${insp.id}`} label="Notes (optional)"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Shop name, logbook signed" /></Field>
      {act.error && !act.error.details.fieldErrors && !tachErr && <Banner tone="danger" title={act.error.message} />}
      <div className="btn-row"><Button type="button" variant="ghost" onClick={done}>Cancel</Button><Button type="submit" variant="primary" pending={act.pending}>Save</Button></div>
    </form>
  );
}

const KIND_LABEL: Record<InspectionKind, string> = { tach: 'Tach hours', months: 'Calendar months', days: 'Days', yearEnd: 'Dec 31 each year' };

function EditForm({ insp, done }: { insp: Inspection; done: () => void }) {
  const { api, me, toast } = useApp();
  const [name, setName] = useState(insp.name);
  const [kind, setKind] = useState<InspectionKind>(insp.kind);
  const [interval, setInterval] = useState(String(insp.interval));
  const [pilots, setPilots] = useState(insp.pilotsCanRecord);
  const [lastDate, setLastDate] = useState(insp.lastDate ?? '');
  const [lastTach, setLastTach] = useState(insp.lastTach !== null ? fmtHundredths(insp.lastTach) : '');
  const [off, setOff] = useState(false);
  const act = useAction(async () => {
    let lt: number | null = null;
    if (lastTach.trim()) { const r = parseHundredths(lastTach, 'Last tach'); if (!r.ok) throw new Error(r.error); lt = r.value; }
    return api.updateInspection(me.id, insp.id, { name, kind, interval: Number(interval), pilotsCanRecord: pilots, lastDate: lastDate || null, lastTach: lt });
  });
  const turnOff = useAction(() => api.updateInspection(me.id, insp.id, { active: false }));
  const fe = act.error?.details.fieldErrors ?? {};
  return (
    <form className="form confirm-box" onSubmit={async (e) => { e.preventDefault(); const r = await act.run(); if (r) { toast('Inspection updated'); done(); } }}>
      <p className="confirm-title">Edit {insp.name}</p>
      <Field id={`ei-n-${insp.id}`} label="Name" error={fe.name}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid2">
        <Field id={`ei-k-${insp.id}`} label="Based on"><select value={kind} onChange={(e) => setKind(e.target.value as InspectionKind)}>{(Object.keys(KIND_LABEL) as InspectionKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
        {kind !== 'yearEnd' && <Field id={`ei-i-${insp.id}`} label="Every" error={fe.interval}><input type="number" min={1} value={interval} onChange={(e) => setInterval(e.target.value)} /></Field>}
      </div>
      <p className="fine">Correct the last-done values only to fix a mistake. To log a new inspection, use Record completed.</p>
      <div className="grid2">
        <Field id={`ei-ld-${insp.id}`} label="Last done" error={fe.lastDate}><input type="date" value={lastDate} onChange={(e) => setLastDate(e.target.value)} /></Field>
        <Field id={`ei-lt-${insp.id}`} label="Last tach"><input className="mono" inputMode="decimal" value={lastTach} onChange={(e) => setLastTach(e.target.value)} /></Field>
      </div>
      <label className="check-row"><input type="checkbox" checked={pilots} onChange={(e) => setPilots(e.target.checked)} /><span><strong>Pilots can record this</strong><br /><span className="fine">For checks a pilot does, like the VOR check.</span></span></label>
      {act.error && !act.error.details.fieldErrors && <Banner tone="danger" title={act.error.message} />}
      <div className="btn-row"><Button type="button" variant="ghost" onClick={done}>Cancel</Button><Button type="submit" variant="primary" pending={act.pending}>Save</Button></div>
      {!off ? <button type="button" className="link small" onClick={() => setOff(true)}>Turn this inspection off…</button> : (
        <div className="btn-row"><span className="fine">Stop tracking {insp.name}? History is kept.</span><Button type="button" variant="danger" pending={turnOff.pending} onClick={async () => { const r = await turnOff.run(); if (r) { toast(`${insp.name} turned off`); done(); } }}>Turn off</Button></div>
      )}
    </form>
  );
}

function AddInspection({ done }: { done: () => void }) {
  const { api, me, toast } = useApp();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<InspectionKind>('months');
  const [interval, setInterval] = useState('12');
  const [pilots, setPilots] = useState(false);
  const act = useAction(() => api.addInspection(me.id, { name, kind, interval: Number(interval), pilotsCanRecord: pilots }));
  const fe = act.error?.details.fieldErrors ?? {};
  return (
    <form className="form confirm-box" onSubmit={async (e) => { e.preventDefault(); const r = await act.run(); if (r) { toast(`${r.name} added`); done(); } }}>
      <p className="confirm-title">Add inspection</p>
      <Field id="ai-n" label="Name" error={fe.name}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Oil change" /></Field>
      <div className="grid2">
        <Field id="ai-k" label="Based on"><select value={kind} onChange={(e) => setKind(e.target.value as InspectionKind)}>{(Object.keys(KIND_LABEL) as InspectionKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
        {kind !== 'yearEnd' && <Field id="ai-i" label="Every" error={fe.interval}><input type="number" min={1} value={interval} onChange={(e) => setInterval(e.target.value)} /></Field>}
      </div>
      <label className="check-row"><input type="checkbox" checked={pilots} onChange={(e) => setPilots(e.target.checked)} /><span><strong>Pilots can record this</strong></span></label>
      {act.error && !act.error.details.fieldErrors && <Banner tone="danger" title={act.error.message} />}
      <div className="btn-row"><Button type="button" variant="ghost" onClick={done}>Cancel</Button><Button type="submit" variant="primary" pending={act.pending}>Add</Button></div>
    </form>
  );
}

function TurnedOff() {
  const { api, db, me, toast } = useApp();
  const off = (db.inspections ?? []).filter((i) => !i.active);
  const on = useAction((id: string) => api.updateInspection(me.id, id, { active: true }));
  if (!off.length) return null;
  return (
    <details className="history">
      <summary>Turned off ({off.length})</summary>
      <ul className="plain">{off.map((i) => <li key={i.id} className="btn-row"><span>{i.name}</span><Button pending={on.pending} onClick={async () => { const r = await on.run(i.id); if (r) toast(`${i.name} turned back on`); }}>Turn on</Button></li>)}</ul>
    </details>
  );
}

/** Overdue inspections, for warnings at check-out. */
export function OverdueInspectionsNote() {
  const views = useInspectionViews();
  const over = views.filter((v) => v.due.status === 'overdue');
  if (!over.length) return null;
  return <Banner tone="danger" title={`Overdue: ${over.map((v) => v.insp.name).join(', ')}`}>Check with an admin before flying. 733XZ doesn't decide airworthiness.</Banner>;
}
