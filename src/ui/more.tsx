import React, { useState } from 'react';
import { useApp, useAction } from './context';
import { Avatar, Banner, Button, Empty, Field, GatedButton, Icon, Modal, Pill, Section } from './components';
import { activeRestrictions, aircraftOut } from '../domain/rules';
import { fmtDateTime, fmtRange, TIME_ZONES } from '../domain/time';
import { fmtMoney, parseCents } from '../domain/decimal';
import type { AircraftSettings, Member } from '../domain/types';
import { pilotName } from './bookingViews';
import { issueStatusLabel, resizeImage, urgencyTone } from './recordViews';
import type { MorePage } from './context';

/** Demo-only pages. The demo entry (main.tsx) fills these in; the live site never loads them. */
export const demoPages: { DemoTools?: React.FC; Plan?: React.FC } = {};
import { AccessScreen, AccountCard } from './live';
import { InstallCard } from './appShell';
import { ClearDataCard, StatementsScreen } from './statements';

export function MoreScreen() {
  const { more, setMore, me, live } = useApp();
  if (more === 'aircraft') return <Sub title="Aircraft status"><AircraftStatus /></Sub>;
  if (more === 'statements') return <Sub title="Monthly statements"><StatementsScreen /></Sub>;
  if (more === 'activity') return <Sub title="Activity history"><Activity /></Sub>;
  if (more === 'settings') return <Sub title={me.role === 'admin' ? 'Admin settings' : 'Aircraft settings'}><Settings /></Sub>;
  if (more === 'access' && live && me.role === 'admin') return <Sub title="Members and sign-in"><AccessScreen /></Sub>;
  if (more === 'install') return <Sub title="Add to Home Screen"><Install /></Sub>;
  if (!__LIVE__ && more === 'demo') return <Sub title="Demo tools">{demoPages.DemoTools && <demoPages.DemoTools />}</Sub>;
  if (!__LIVE__ && more === 'plan') return <Sub title="Production plan">{demoPages.Plan && <demoPages.Plan />}</Sub>;
  const items: { id: MorePage; icon: string; label: string; sub: string }[] = [
    { id: 'aircraft', icon: 'wrench', label: 'Aircraft status', sub: 'Restrictions, issues, maintenance' },
    { id: 'statements', icon: 'receipt', label: 'Monthly statements', sub: me.role === 'admin' ? 'Hours, rental and fuel by pilot' : 'Your hours, rental and fuel' },
    { id: 'activity', icon: 'history', label: 'Activity history', sub: 'Who changed what, and when' },
    { id: 'settings', icon: 'settings', label: me.role === 'admin' ? 'Admin settings' : 'Aircraft settings', sub: me.role === 'admin' ? 'Aircraft, members, time zone, rates' : 'View aircraft and group rules' },
    ...(live && me.role === 'admin' ? [{ id: 'access' as MorePage, icon: 'user', label: 'Members and sign-in', sub: 'Add members, phone numbers, codes' }] : []),
    { id: 'install', icon: 'phone', label: 'Add to Home Screen', sub: 'Install on iPhone or Android' },
    ...(__LIVE__ ? [] : [
      { id: 'demo' as MorePage, icon: 'flask', label: 'Demo tools', sub: 'Switch accounts, race test, offline, reset' },
      { id: 'plan' as MorePage, icon: 'cloud', label: 'Production plan', sub: 'What is simulated and what is ready' },
    ]),
  ];
  return (
    <div className="screen">
      <div className="screen-head"><h1>More</h1></div>
      <nav className="menu" aria-label="More">
        {items.map((i) => (
          <button key={i.id} className="menu-item" onClick={() => setMore(i.id)}>
            <Icon name={i.icon} /><span><strong>{i.label}</strong><span className="fine">{i.sub}</span></span><Icon name="chevron" size={18} />
          </button>
        ))}
      </nav>
      {live && <AccountCard />}
    </div>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  const { setMore } = useApp();
  return (
    <div className="screen">
      <div className="screen-head"><button className="back-btn" onClick={() => setMore('menu')}><Icon name="back" size={20} /> More</button></div>
      <h1>{title}</h1>
      {children}
    </div>
  );
}

// ---------------- Aircraft status ----------------
function AircraftStatus() {
  const { db, me, tz, openModal, now, offline } = useApp();
  const isAdmin = me.role === 'admin';
  const active = activeRestrictions(db);
  const cleared = db.restrictions.filter((r) => r.clearedAt).slice(-5).reverse();
  const [clearing, setClearing] = useState<string | null>(null);
  const out = aircraftOut(db);
  const offlineWhy = offline ? 'You are offline.' : null;
  return (
    <>
      <Section title="Operational restrictions" action={isAdmin ? <GatedButton icon="plus" reason={offlineWhy} onClick={() => openModal({ kind: 'restriction' })}>Add</GatedButton> : undefined}>
        <p className="fine">Restrictions are separate from the calendar. They stay until an admin clears them with a reason. Clearing records an operational decision; it is not a maintenance sign-off.</p>
        {active.length === 0 && <Empty title="No active restrictions" />}
        <div className="stack">
          {active.map((r) => (
            <div key={r.id} className={`restrict-card ${r.level}`}>
              <div className="detail-head"><Pill tone={r.level === 'grounded' ? 'danger' : 'warn'}>{r.level === 'grounded' ? 'Grounded' : 'Caution'}</Pill><span className="fine">Since {fmtDateTime(r.createdAt, tz)} · {pilotName(db, r.createdBy)}</span></div>
              <p><strong>{r.reason}</strong></p>
              {isAdmin ? (clearing === r.id ? <ClearForm id={r.id} done={() => setClearing(null)} /> : <GatedButton reason={offlineWhy} onClick={() => setClearing(r.id)}>Clear restriction…</GatedButton>)
                : <p className="fine">Only an admin can clear this.</p>}
            </div>
          ))}
        </div>
        {cleared.length > 0 && <details className="history"><summary>Recently cleared ({cleared.length})</summary><ul>{cleared.map((r) => <li key={r.id}>{r.reason} — cleared {fmtDateTime(r.clearedAt!, tz)} by {pilotName(db, r.clearedBy!)}: {r.clearReason}</li>)}</ul></details>}
      </Section>

      <Section title="Reported issues" action={<Button icon="plus" onClick={() => openModal({ kind: 'issue' })}>Report</Button>}>
        {db.issues.length === 0 ? <Empty title="No issues reported" /> : (
          <ul className="list">{db.issues.slice().sort((a, b) => (a.status === 'resolved' ? 1 : 0) - (b.status === 'resolved' ? 1 : 0) || b.reportedAt.localeCompare(a.reportedAt)).map((i) => (
            <li key={i.id}><button className="row-btn" onClick={() => openModal({ kind: 'issueDetail', issueId: i.id })}>
              <span><strong>{i.title}</strong><span className="fine block">{pilotName(db, i.reportedBy)} · {fmtDateTime(i.reportedAt, tz)}</span></span>
              <span className="pills"><Pill tone={urgencyTone(i.urgency)}>{i.urgency}</Pill><Pill tone={i.status === 'resolved' ? 'ok' : 'muted'}>{issueStatusLabel(i.status)}</Pill></span>
            </button></li>))}
          </ul>
        )}
      </Section>

      <Section title="Maintenance" action={isAdmin ? <GatedButton icon="plus" reason={offlineWhy} onClick={() => openModal({ kind: 'maintenance' })}>Schedule</GatedButton> : undefined}>
        {db.maintenance.length === 0 ? <Empty title="No maintenance scheduled" /> : (
          <ul className="list">{db.maintenance.slice().sort((a, b) => b.startUtc.localeCompare(a.startUtc)).map((m) => (
            <li key={m.id}><button className="row-btn" onClick={() => openModal({ kind: 'maintenanceDetail', id: m.id })}>
              <span><strong>{m.title}</strong><span className="fine block">{fmtRange(m.startUtc, m.endUtc, tz)}</span></span>
              <Pill tone={m.status === 'scheduled' ? (Date.parse(m.startUtc) <= now && now < Date.parse(m.endUtc) ? 'warn' : 'info') : 'muted'}>{m.status === 'scheduled' ? (Date.parse(m.startUtc) <= now && now < Date.parse(m.endUtc) ? 'In progress' : 'Scheduled') : m.status === 'ended' ? 'Ended' : 'Canceled'}</Pill>
            </button></li>))}
          </ul>
        )}
      </Section>
      {out && <p className="fine">Aircraft is currently checked out by {pilotName(db, out.pilotId)}.</p>}
    </>
  );
}

function ClearForm({ id, done }: { id: string; done: () => void }) {
  const { api, me, toast } = useApp();
  const [reason, setReason] = useState('');
  const act = useAction(() => api.clearRestriction(me.id, id, reason));
  return (
    <form className="form confirm-box" onSubmit={async (e) => { e.preventDefault(); const r = await act.run(); if (r) { toast('Restriction cleared and recorded'); done(); } }}>
      <Field id={`cr-${id}`} label="Reason for clearing (recorded)" error={act.error?.message} hint="e.g. Repair signed off by the shop, logbook entry reviewed">
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <p className="fine">You are recording an operational decision to lift this restriction. This is not a maintenance certification.</p>
      <div className="btn-row"><Button type="button" variant="ghost" onClick={done}>Cancel</Button><Button type="submit" variant="danger" pending={act.pending}>Clear restriction</Button></div>
    </form>
  );
}

export function MaintenanceDetail({ id }: { id: string }) {
  const { api, db, me, tz, closeModal, toast, openModal, offline } = useApp();
  const m = db.maintenance.find((x) => x.id === id);
  const [mode, setMode] = useState<null | 'ended' | 'canceled'>(null);
  const [note, setNote] = useState('');
  const act = useAction(() => api.endMaintenance(me.id, id, mode!, note));
  if (!m) return <Modal title="Maintenance" onClose={closeModal}><p>Not found.</p></Modal>;
  const affected = db.bookings.filter((b) => b.status === 'confirmed' && Date.parse(b.startUtc) < Date.parse(m.endUtc) && Date.parse(m.startUtc) < Date.parse(b.endUtc));
  return (
    <Modal title="Maintenance" onClose={closeModal}>
      <p className="detail-when">{m.title}</p>
      <dl className="kv"><dt>When</dt><dd>{fmtRange(m.startUtc, m.endUtc, tz)}</dd><dt>Status</dt><dd>{m.status}</dd><dt>Scheduled by</dt><dd>{pilotName(db, m.createdBy)}</dd>{m.notes && <><dt>Notes</dt><dd>{m.notes}</dd></>}</dl>
      <p className="fine">Maintenance reserves calendar time only. Ending it does not clear any restriction.</p>
      {affected.length > 0 && m.status === 'scheduled' && <Banner tone="warn" title="Reservations needing review">{affected.map((b) => <p key={b.id}><button className="link" onClick={() => openModal({ kind: 'bookingDetail', bookingId: b.id })}>{pilotName(db, b.pilotId)} · {fmtRange(b.startUtc, b.endUtc, tz)}</button></p>)}</Banner>}
      {me.role === 'admin' && m.status === 'scheduled' && (mode ? (
        <form className="form confirm-box" onSubmit={async (e) => { e.preventDefault(); const r = await act.run(); if (r) { toast(mode === 'ended' ? 'Maintenance ended. Restrictions unchanged.' : 'Maintenance canceled'); closeModal(); } }}>
          <Field id="md-note" label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {act.error && <Banner tone="danger" title={act.error.message} />}
          <div className="btn-row"><Button type="button" variant="ghost" onClick={() => setMode(null)}>Back</Button><Button type="submit" variant="primary" pending={act.pending}>{mode === 'ended' ? 'End maintenance now' : 'Cancel maintenance'}</Button></div>
        </form>
      ) : <div className="btn-row"><GatedButton reason={offline ? 'You are offline.' : null} onClick={() => setMode('ended')}>End now</GatedButton><GatedButton variant="ghost" reason={offline ? 'You are offline.' : null} onClick={() => setMode('canceled')}>Cancel block</GatedButton></div>)}
    </Modal>
  );
}

// ---------------- Activity ----------------
function Activity() {
  const { db, me, tz } = useApp();
  const [type, setType] = useState('all');
  const [n, setN] = useState(40);
  const rows = db.audit.slice().reverse().filter((a) => type === 'all' || a.entityType === type);
  return (
    <>
      <div className="filters"><label>Show<select value={type} onChange={(e) => setType(e.target.value)}>
        {['all', 'booking', 'flight', 'issue', 'restriction', 'maintenance', 'settings', 'member'].map((t) => <option key={t} value={t}>{t === 'all' ? 'Everything' : t[0].toUpperCase() + t.slice(1)}</option>)}
      </select></label></div>
      {me.role !== 'admin' && <p className="fine">In production, pilots would see activity on their own records and shared aircraft events. The demo shows everything.</p>}
      {rows.length === 0 ? <Empty title="No activity yet" /> : (
        <ul className="timeline big">{rows.slice(0, n).map((a) => (
          <li key={a.id}><Avatar m={db.members.find((m) => m.id === a.actorId)} size={28} /><span><strong>{pilotName(db, a.actorId)}</strong> {a.summary}<span className="fine block">{fmtDateTime(a.at, tz)} · {a.action}</span>
            {a.before !== undefined && a.action.endsWith('update') && <details><summary className="fine">Previous values</summary><pre className="mono small">{JSON.stringify(a.before, null, 1).slice(0, 600)}</pre></details>}</span></li>
        ))}</ul>
      )}
      {rows.length > n && <Button onClick={() => setN(n + 40)}>Show more</Button>}
    </>
  );
}

// ---------------- Settings ----------------
function Settings() {
  const { api, db, me, toast, offline, live, setMore } = useApp();
  const isAdmin = me.role === 'admin';
  const [s, setS] = useState<AircraftSettings>(db.settings);
  const [rate, setRate] = useState((db.settings.rateCentsPerHour / 100).toFixed(2));
  const [rateErr, setRateErr] = useState('');
  const act = useAction(async () => {
    const r = parseCents(rate, 'Hourly rate');
    if (!r.ok) { setRateErr(r.error); throw new Error(r.error); }
    setRateErr('');
    return api.updateSettings(me.id, { ...s, rateCentsPerHour: r.value });
  });
  const fe = act.error?.details.fieldErrors ?? {};
  const set = <K extends keyof AircraftSettings>(k: K, v: AircraftSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const dis = !isAdmin;
  return (
    <>
      {!isAdmin && <Banner tone="info" title="View only">Only an admin can change these settings.</Banner>}
      <form className="form settings" onSubmit={async (e) => { e.preventDefault(); const r = await act.run(); if (r) { toast('Settings saved'); setS(r); } }}>
        <fieldset disabled={dis}>
          <legend>App and aircraft</legend>
          <Field id="st-app" label="App name" error={fe.appName}><input value={s.appName} onChange={(e) => set('appName', e.target.value)} /></Field>
          <div className="grid2">
            <Field id="st-tail" label="Tail number" error={fe.tailNumber}><input className="mono" value={s.tailNumber} onChange={(e) => set('tailNumber', e.target.value)} /></Field>
            <Field id="st-apt" label="Home airport" error={fe.homeAirport}><input className="mono" value={s.homeAirport} onChange={(e) => set('homeAirport', e.target.value)} /></Field>
          </div>
          <Field id="st-model" label="Aircraft model" error={fe.model}><input value={s.model} onChange={(e) => set('model', e.target.value)} /></Field>
          <div className="field">
            <label htmlFor="st-photo">Aircraft photo</label>
            <div className="photo-row">
              {s.photoDataUrl ? <img src={s.photoDataUrl} alt="Aircraft" className="thumb" /> : <div className="thumb placeholder"><Icon name="plane" /></div>}
              <label className="file-btn"><Icon name="camera" size={20} /> Choose photo<input id="st-photo" type="file" accept="image/*" disabled={dis} onChange={async (e) => { const f = e.target.files?.[0]; if (f) set('photoDataUrl', await resizeImage(f)); }} /></label>
              {s.photoDataUrl && <Button type="button" variant="ghost" onClick={() => set('photoDataUrl', undefined)}>Remove</Button>}
            </div>
            <p className="hint">Stored in this browser only for the demo.</p>
            {fe.photo && <p className="field-error">{fe.photo}</p>}
          </div>
        </fieldset>
        <fieldset disabled={dis}>
          <legend>Scheduling</legend>
          <Field id="st-tz" label="Aircraft base time zone" error={fe.timeZone} hint="All booking times display in this zone. Stored times do not change.">
            <select value={s.timeZone} onChange={(e) => set('timeZone', e.target.value)}>{TIME_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}</select>
          </Field>
          <div className="grid2">
            <Field id="st-buf" label="Turnaround buffer (min)" error={fe.bufferMinutes}><input type="number" min={0} max={240} step={15} value={s.bufferMinutes} onChange={(e) => set('bufferMinutes', parseInt(e.target.value || '0', 10))} /></Field>
            <Field id="st-early" label="Early check-out (min)"><input type="number" min={0} max={240} step={15} value={s.earlyCheckoutMinutes} onChange={(e) => set('earlyCheckoutMinutes', parseInt(e.target.value || '0', 10))} /></Field>
          </div>
        </fieldset>
        <fieldset disabled={dis}>
          <legend>Meters</legend>
          <label className="check-row"><input type="checkbox" checked={s.hobbsEnabled} onChange={(e) => set('hobbsEnabled', e.target.checked)} /><span><strong>Hobbs meter</strong></span></label>
          <label className="check-row"><input type="checkbox" checked={s.tachEnabled} onChange={(e) => set('tachEnabled', e.target.checked)} /><span><strong>Tach meter</strong></span></label>
          {fe.meters && <p className="field-error">{fe.meters}</p>}
        </fieldset>
        <fieldset disabled={dis}>
          <legend>Rental and fuel</legend>
          <div className="grid2">
            <Field id="st-rate" label="Hourly rental ($)" error={rateErr || fe.rate}><input className="mono" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
            <Field id="st-basis" label="Billed on" error={fe.rateBasis}><select value={s.rateBasis} onChange={(e) => set('rateBasis', e.target.value as 'hobbs' | 'tach')}><option value="hobbs">Hobbs hours</option><option value="tach">Tach hours</option></select></Field>
          </div>
          <Field id="st-fuel" label="Fuel" hint="Pilots top off and record gallons and cost either way.">
            <select value={s.fuelPolicy} onChange={(e) => set('fuelPolicy', e.target.value as AircraftSettings['fuelPolicy'])}><option value="pilot_pays_at_pump">Pilot pays at the pump (dry rate)</option><option value="add_to_statement">Add fuel cost to pilot's statement</option></select>
          </Field>
          <label className="check-row"><input type="checkbox" checked={s.topOffRequired} onChange={(e) => set('topOffRequired', e.target.checked)} /><span><strong>Top-off required on return</strong></span></label>
          <p className="fine">Current: {fmtMoney(db.settings.rateCentsPerHour)}/hour {db.settings.rateBasis === 'hobbs' ? 'Hobbs' : 'tach'}, plus fuel. Statements only; no payments are processed.</p>
        </fieldset>
        {act.error && !act.error.details.fieldErrors && !rateErr && <Banner tone="danger" title={act.error.message} />}
        {isAdmin && (offline ? <GatedButton variant="primary" reason="You are offline.">Save settings</GatedButton> : <Button type="submit" variant="primary" size="lg" pending={act.pending}>Save settings</Button>)}
      </form>
      <Section title="Members">
        <p className="fine">{live ? 'Membership is invite-only. Add members and their phone numbers in More → Members and sign-in.' : 'Production membership is invite-only: an admin sends an invite, the member signs in, and there is no public sign-up.'}</p>
        <div className="stack">{db.members.map((m) => <MemberRow key={m.id} m={m} />)}</div>
        {live
          ? (isAdmin && <Button icon="plus" onClick={() => setMore('access')}>Add member</Button>)
          : <GatedButton icon="plus" reason="The demo uses six fixed simulated members. The live app adds members under Members and sign-in.">Invite member</GatedButton>}
      </Section>
      <ClearDataCard />
    </>
  );
}

function MemberRow({ m }: { m: Member }) {
  const { api, me, toast } = useApp();
  const [name, setName] = useState(m.name);
  const [role, setRole] = useState(m.role);
  const [active, setActive] = useState(m.active);
  const act = useAction(() => api.updateMember(me.id, m.id, { name, role, active }));
  const dirty = name !== m.name || role !== m.role || active !== m.active;
  const isAdmin = me.role === 'admin';
  return (
    <form className="member-row" onSubmit={async (e) => { e.preventDefault(); const r = await act.run(); if (r) toast(`${r.name} updated`); }}>
      <Avatar m={m} />
      <input aria-label={`Name for ${m.name}`} value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} />
      <select aria-label={`Role for ${m.name}`} value={role} onChange={(e) => setRole(e.target.value as Member['role'])} disabled={!isAdmin}><option value="admin">Admin + pilot</option><option value="pilot">Pilot</option></select>
      <label className="switch small"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={!isAdmin} /> Active</label>
      {isAdmin && <Button type="submit" disabled={!dirty} pending={act.pending}>Save</Button>}
      {act.error && <p className="field-error full">{act.error.message}</p>}
    </form>
  );
}

// ---------------- Install ----------------
function Install() {
  const { live } = useApp();
  return (
    <>
      {__LIVE__ && <InstallCard force />}
      {!live && <Banner tone="info" title="Installing needs the hosted app">The Claude preview runs inside a sandbox, so phones cannot install it from here. Once PlaneShare is deployed to its own web address, these steps put it on the Home Screen with its own icon.</Banner>}
      <Section title="iPhone or iPad (Safari)">
        <ol className="howto"><li>Open the PlaneShare link in Safari.</li><li>Tap the Share button.</li><li>Choose <strong>Add to Home Screen</strong>.</li><li>Keep the name and tap <strong>Add</strong>.</li></ol>
      </Section>
      <Section title="Android (Chrome)">
        <ol className="howto"><li>Open the PlaneShare link in Chrome.</li><li>Tap the ⋮ menu.</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li><li>Confirm.</li></ol>
      </Section>
      <Section title="What works offline">
        <p>The installed app can show the last data it downloaded, clearly marked as cached. Booking, check-out, return and flight records need a connection so nobody acts on stale availability.</p>
        {!live && <p className="fine">The source package includes the web app manifest, icon and service worker. They activate only when hosted.</p>}
      </Section>
    </>
  );
}

