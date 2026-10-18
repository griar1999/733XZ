import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  const [settings, setSettings] = useState(false);
  const isAdmin = me.role === 'admin';
  const canRecord = (isAdmin || insp.pilotsCanRecord) && !offline;
  const last = insp.lastDate ? `${fmtDay(insp.lastDate)}${insp.kind === 'tach' && insp.lastTach !== null ? ` · tach ${fmtHundredths(insp.lastTach)}` : ''}` : canRecord ? 'Tap to enter' : 'Not entered';
  const next = due.status === 'unset' ? '—' : due.status === 'no-meter' ? due.summary : due.nextDate ? fmtDay(due.nextDate) : due.nextTach !== null ? `Tach ${fmtHundredths(due.nextTach)}` : '—';
  const left = due.daysLeft !== null ? (due.daysLeft < 0 ? `${-due.daysLeft} day${due.daysLeft === -1 ? '' : 's'} overdue` : `${due.daysLeft} day${due.daysLeft === 1 ? '' : 's'} left`)
    : due.tachLeft !== null ? (due.tachLeft <= 0 ? `${fmtHundredths(-due.tachLeft)} h overdue` : `${fmtHundredths(due.tachLeft)} h left`) : '';
  const overridden = insp.nextDate != null || insp.nextTach != null;
  return (
    <div className={`insp-card st-${due.status}`}>
      <div className="insp-head">
        <div><p className="insp-name">{insp.name}</p><p className="fine">{intervalLabel(insp.kind, insp.interval)}</p></div>
        <div className="insp-head-right">
          <Pill tone={tone(due.status)}>{statusLabel(due.status)}</Pill>
          {isAdmin && <button type="button" className="icon-btn" aria-label={`Settings for ${insp.name}`} aria-expanded={settings} onClick={() => setSettings((x) => !x)}>⋯</button>}
        </div>
      </div>
      <dl className="insp-kv">
        <InlineBox label="Last" canEdit={canRecord} display={last} empty={!insp.lastDate} editor={(close) => <LastEditor insp={insp} close={close} />} />
        <InlineBox label="Next" canEdit={isAdmin && !offline && due.status !== 'no-meter'} display={<>{next}{left && <span className={`insp-left ${due.status}`}>{left}</span>}{overridden && <span className="insp-set fine">Set by admin</span>}</>}
          editor={(close) => <NextEditor insp={insp} due={due} close={close} />} />
      </dl>
      {settings && <EditForm insp={insp} done={() => setSettings(false)} />}
      {insp.history.length > 0 && (
        <details className="history">
          <summary>History ({insp.history.length})</summary>
          <ul>{insp.history.map((h, i) => <li key={i}><strong>{fmtDay(h.date)}</strong>{h.tach !== null ? ` · tach ${fmtHundredths(h.tach)}` : ''} · {pilotName(db, h.by)}{h.notes ? ` — ${h.notes}` : ''}<span className="fine"> (recorded {new Date(h.at).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' })})</span></li>)}</ul>
        </details>
      )}
    </div>
  );
}

/**
 * A Last/Next box that turns into inputs when tapped and saves when you tap anywhere outside it.
 * The editor gets `close`, and registers its save via the returned ref so tapping away can call it.
 */
type Saver = { save: () => Promise<boolean>; cancel: () => void };
function InlineBox({ label, display, canEdit, empty, editor }: { label: string; display: React.ReactNode; canEdit: boolean; empty?: boolean; editor: (close: () => void, reg: (s: Saver) => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const saver = useRef<Saver | null>(null);
  const busy = useRef(false);
  const close = () => { saver.current = null; setOpen(false); };
  useEffect(() => {
    if (!open) return;
    const away = async (e: Event) => {
      if (box.current && box.current.contains(e.target as Node)) return;
      if (busy.current || !saver.current) return;
      busy.current = true;
      try { if (await saver.current.save()) close(); } finally { busy.current = false; }
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);
  const onKey = async (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { saver.current?.cancel(); close(); }
    if (e.key === 'Enter' && saver.current && !busy.current) { e.preventDefault(); busy.current = true; try { if (await saver.current.save()) close(); } finally { busy.current = false; } }
  };
  if (!canEdit) return <div><dt>{label}</dt><dd>{display}</dd></div>;
  return (
    <div ref={box} className={`insp-box ${open ? 'editing' : 'tappable'} ${empty && !open ? 'is-empty' : ''}`}
      role={open ? undefined : 'button'} tabIndex={open ? undefined : 0} aria-label={open ? undefined : `Change ${label.toLowerCase()}`}
      onClick={() => { if (!open) setOpen(true); }} onKeyDown={(e) => { if (!open && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); } else if (open) void onKey(e); }}>
      <dt>{label}{!open && <span className="insp-pencil" aria-hidden="true">✎</span>}</dt>
      <dd>{open ? <EditorHost render={editor} close={close} reg={(sv) => { saver.current = sv; }} /> : display}</dd>
    </div>
  );
}
function EditorHost({ render, close, reg }: { render: (close: () => void, reg: (s: Saver) => void) => React.ReactNode; close: () => void; reg: (s: Saver) => void }) {
  return <RegContext.Provider value={reg}>{render(close, reg)}</RegContext.Provider>;
}

// The editors register their save function with the box through this context-free hook.
const RegContext = React.createContext<(s: Saver) => void>(() => {});

function LastEditor({ insp, close }: { insp: Inspection; close: () => void }) {
  const { api, db, me, tz, now, toast } = useApp();
  const reg = React.useContext(RegContext);
  const today = toLocalParts(now, tz).date;
  const cur = currentTach(db);
  const tachKind = insp.kind === 'tach';
  const [date, setDate] = useState(insp.lastDate ?? today);
  const [tach, setTach] = useState(insp.lastTach !== null ? fmtHundredths(insp.lastTach) : tachKind && cur !== null ? fmtHundredths(cur) : '');
  const [err, setErr] = useState('');
  const state = useRef({ date, tach }); state.current = { date, tach };
  useEffect(() => {
    reg({
      cancel: () => {},
      save: async () => {
        const { date: d, tach: t } = state.current;
        let tv: number | null = null;
        if (t.trim()) { const r = parseHundredths(t, 'Tach'); if (!r.ok) { setErr(r.error); return false; } tv = r.value; }
        if (!d) { setErr('Enter the date it was done.'); return false; }
        if (tachKind && tv === null) { setErr('Enter the tach reading when it was done.'); return false; }
        const same = d === insp.lastDate && (!tachKind || tv === insp.lastTach);
        if (same) return true; // nothing changed
        // later than what's on file = a new one done (kept in history); earlier = an admin correcting a mistake
        const forward = !insp.lastDate || (d >= insp.lastDate && (!tachKind || insp.lastTach === null || (tv ?? 0) >= insp.lastTach));
        try {
          if (forward) await api.recordInspection(me.id, insp.id, { date: d, tach: tv, notes: '' });
          else if (me.role === 'admin') await api.updateInspection(me.id, insp.id, { lastDate: d, lastTach: tachKind ? tv : insp.lastTach });
          else { setErr(`That's earlier than the last one recorded. Ask an admin to correct it.`); return false; }
          toast(`${insp.name} saved`);
          return true;
        } catch (e) { setErr((e as Error).message); return false; }
      },
    });
  }); // re-register each render so save sees fresh props
  return (
    <div className="insp-edit">
      <input type="date" aria-label="Date done" value={date} max={today} onChange={(e) => { setDate(e.target.value); setErr(''); }} autoFocus={!tachKind} />
      {tachKind && <input className="mono" inputMode="decimal" aria-label="Tach at inspection" placeholder="Tach" value={tach} onChange={(e) => { setTach(e.target.value); setErr(''); }} autoFocus />}
      {tachKind && cur !== null && <span className="fine">Flight log tach: {fmtHundredths(cur)}</span>}
      {err ? <span className="field-error">{err} <button type="button" className="link small" onClick={(e) => { e.stopPropagation(); close(); }}>Undo</button></span> : <span className="fine">Tap outside to save</span>}
    </div>
  );
}

function NextEditor({ insp, due, close }: { insp: Inspection; due: InspectionView['due']; close: () => void }) {
  const { api, me, toast } = useApp();
  const reg = React.useContext(RegContext);
  const tachKind = insp.kind === 'tach';
  const [val, setVal] = useState(tachKind ? (due.nextTach !== null ? fmtHundredths(due.nextTach) : '') : (due.nextDate ?? ''));
  const [err, setErr] = useState('');
  const state = useRef(val); state.current = val;
  const overridden = insp.nextDate != null || insp.nextTach != null;
  useEffect(() => {
    reg({
      cancel: () => {},
      save: async () => {
        const v = state.current.trim();
        try {
          if (tachKind) {
            let tv: number | null = null;
            if (v) { const r = parseHundredths(v, 'Next tach'); if (!r.ok) { setErr(r.error); return false; } tv = r.value; }
            if (tv === due.nextTach || (tv === null && !overridden)) return true;
            await api.updateInspection(me.id, insp.id, { nextTach: tv });
          } else {
            if ((v || null) === due.nextDate || (!v && !overridden)) return true;
            await api.updateInspection(me.id, insp.id, { nextDate: v || null });
          }
          toast(v ? `${insp.name}: next due updated` : `${insp.name}: back to the normal interval`);
          return true;
        } catch (e) { setErr((e as Error).message); return false; }
      },
    });
  });
  return (
    <div className="insp-edit">
      {tachKind
        ? <input className="mono" inputMode="decimal" aria-label="Next due tach" placeholder="Tach" value={val} onChange={(e) => { setVal(e.target.value); setErr(''); }} autoFocus />
        : <input type="date" aria-label="Next due date" value={val} onChange={(e) => { setVal(e.target.value); setErr(''); }} />}
      {overridden && <button type="button" className="link small" onClick={(e) => { e.stopPropagation(); setVal(''); }}>Use normal interval</button>}
      {err ? <span className="field-error">{err} <button type="button" className="link small" onClick={(e) => { e.stopPropagation(); close(); }}>Undo</button></span> : <span className="fine">Tap outside to save</span>}
    </div>
  );
}

const KIND_LABEL: Record<InspectionKind, string> = { tach: 'Tach hours', months: 'Calendar months', days: 'Days', yearEnd: 'Dec 31 each year' };

function EditForm({ insp, done }: { insp: Inspection; done: () => void }) {
  const { api, me, toast } = useApp();
  const [name, setName] = useState(insp.name);
  const [kind, setKind] = useState<InspectionKind>(insp.kind);
  const [interval, setInterval] = useState(String(insp.interval));
  const [pilots, setPilots] = useState(insp.pilotsCanRecord);
  const [off, setOff] = useState(false);
  const act = useAction(() => api.updateInspection(me.id, insp.id, { name, kind, interval: Number(interval), pilotsCanRecord: pilots }));
  const turnOff = useAction(() => api.updateInspection(me.id, insp.id, { active: false }));
  const fe = act.error?.details.fieldErrors ?? {};
  return (
    <form className="form confirm-box" onSubmit={async (e) => { e.preventDefault(); const r = await act.run(); if (r) { toast('Inspection updated'); done(); } }}>
      <p className="confirm-title">{insp.name} settings</p>
      <Field id={`ei-n-${insp.id}`} label="Name" error={fe.name}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid2">
        <Field id={`ei-k-${insp.id}`} label="Based on"><select value={kind} onChange={(e) => setKind(e.target.value as InspectionKind)}>{(Object.keys(KIND_LABEL) as InspectionKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
        {kind !== 'yearEnd' && <Field id={`ei-i-${insp.id}`} label="Every" error={fe.interval}><input type="number" min={1} value={interval} onChange={(e) => setInterval(e.target.value)} /></Field>}
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
