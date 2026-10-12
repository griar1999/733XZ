// Demo-only screens: account switching, race test, self-tests, reset, production plan.
// Loaded only by the demo entry (src/main.tsx), never by the live site.
import React, { useState } from 'react';
import { useApp } from './context';
import { Avatar, Banner, Button, Icon, Pill, Section } from './components';
import { suggestSlot } from '../domain/rules';
import { addDays, fmtRange, localToUtc, toLocalParts } from '../domain/time';
import { pilotName } from './bookingViews';
import { simulateRace, type RaceResult } from '../services/race';
import { runAll } from '../tests/suite';
import type { MockApi } from '../services/mockApi';

// ---------------- Demo tools ----------------
export function DemoTools() {
  const { api, db, me, setMe, tz, toast, offline, now } = useApp();
  const [race, setRace] = useState<RaceResult & { slot: string } | null>(null);
  const [racing, setRacing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [tests, setTests] = useState<Awaited<ReturnType<typeof runAll>> | null>(null);
  const [testing, setTesting] = useState(false);

  const runRace = async () => {
    setRacing(true); setRace(null);
    const tomorrow = addDays(toLocalParts(now, tz).date, 1);
    const from = localToUtc(tomorrow, '14:00', tz);
    const slot = suggestSlot(db, 120, from.ok ? from.utc : new Date(now).toISOString(), db.settings.bufferMinutes);
    if (!slot) { toast('No open slot found to test with.', 'error'); setRacing(false); return; }
    const r = await simulateRace(api, { actorId: 'm2', input: { pilotId: 'm2', ...slot, destination: 'Race test', notes: 'Simulated simultaneous request' } },
      { actorId: 'm3', input: { pilotId: 'm3', ...slot, destination: 'Race test', notes: 'Simulated simultaneous request' } });
    setRace({ ...r, slot: fmtRange(slot.startUtc, slot.endUtc, tz) }); setRacing(false);
  };

  return (
    <>
      <Banner tone="info" title="Demo mode: simulated accounts and data">No real passwords, accounts or aircraft. Data is saved only in this browser{(api as MockApi).storageAvailable ? '' : ' (storage is blocked here, so changes last until you reload)'} and does not sync between the six members' devices.</Banner>

      <Section title="Switch account">
        <div className="acct-grid">{db.members.filter((m) => m.active).map((m) => (
          <button key={m.id} className={`acct ${m.id === me.id ? 'on' : ''}`} aria-pressed={m.id === me.id} onClick={() => { setMe(m.id); toast(`Now viewing as ${m.name}`, 'info'); }}>
            <Avatar m={m} /><span><strong>{m.name}</strong><span className="fine block">{m.role === 'admin' ? 'Admin + pilot' : 'Pilot'}</span></span>
          </button>))}
        </div>
      </Section>

      <Section title="Double-booking race">
        <p>Alex and Jordan both submit the same open 2-hour slot tomorrow at the same moment. Each phone's own check says the slot is free. The server-side check decides who gets it.</p>
        <Button variant="primary" pending={racing} onClick={runRace} disabled={offline}>{offline ? 'Unavailable offline' : 'Run race'}</Button>
        {race && (
          <div className="subcard" aria-live="polite">
            <p><strong>Slot:</strong> {race.slot}</p>
            <p>Frontend check passed for both: <strong>{race.frontendCheckPassedForBoth ? 'Yes' : 'No'}</strong></p>
            <ul className="plain">{race.results.map((r) => <li key={r.actorId}><Pill tone={r.ok ? 'ok' : 'danger'}>{r.ok ? 'Won' : 'Rejected'}</Pill> {pilotName(db, r.actorId)} — {r.message}</li>)}</ul>
            <p className="fine">The demo serializes writes in this browser. In production the Worker must make the check and the insert one atomic D1 operation, or two phones on different networks could both succeed. Frontend checks alone are never enough.</p>
          </div>
        )}
      </Section>

      <Section title="Offline mode">
        <label className="check-row"><input type="checkbox" checked={offline} onChange={(e) => api.setSimulatedOffline(e.target.checked)} /><span><strong>Simulate offline</strong><br /><span className="fine">Shows cached data with a warning and disables every change.</span></span></label>
      </Section>

      <Section title="Self-tests">
        <p>Runs the same {''}test suite used in development against a fresh copy of the demo data. Your data is not touched.</p>
        <Button pending={testing} onClick={async () => { setTesting(true); setTests(await runAll()); setTesting(false); }}>Run tests</Button>
        {tests && (
          <div className="subcard" aria-live="polite">
            <p><strong>{tests.filter((t) => t.ok).length} of {tests.length} passed</strong></p>
            <ul className="tests">{tests.map((t) => <li key={t.name} className={t.ok ? 'ok' : 'fail'}><Icon name={t.ok ? 'check' : 'alert'} size={16} /><span><span className="fine">{t.area}</span> {t.name}{t.error && <span className="field-error block">{t.error}</span>}</span></li>)}</ul>
          </div>
        )}
      </Section>

      <Section title="Reset demo">
        {confirmReset ? (
          <div className="confirm-box"><p className="confirm-title">Erase all demo changes?</p><p className="fine">Bookings, flights, issues and settings go back to the starting demo data.</p>
            <div className="btn-row"><Button variant="ghost" onClick={() => setConfirmReset(false)}>Keep my changes</Button><Button variant="danger" onClick={async () => { await api.resetDemo(); setConfirmReset(false); toast('Demo data reset'); }}>Reset demo</Button></div></div>
        ) : <Button variant="danger" onClick={() => setConfirmReset(true)}>Reset demo…</Button>}
      </Section>
    </>
  );
}

// ---------------- Plan ----------------
export function Plan() {
  return (
    <>
      <Banner tone="warn" title="This prototype is not production-ready">It is for reviewing the interface. Accounts, permissions, conflict prevention and storage are simulated in your browser.</Banner>
      <Section title="Simulated vs. ready">
        <div className="table-wrap"><table className="log-table plan-table">
          <thead><tr><th>Area</th><th>In this prototype</th><th>Status</th></tr></thead>
          <tbody>
            {[
              ['Screens, flows, mobile + desktop layout', 'Working React UI', 'Ready for review'],
              ['Business rules (overlap, buffer, DST, meters, charges)', 'Shared TypeScript module, tested', 'Reusable on the server'],
              ['Accounts and sign-in', 'Account switcher, no passwords', 'Simulated'],
              ['Permissions', 'Checked in the mock service', 'Simulated — must move to the Worker'],
              ['Double-booking prevention', 'Serialized in one browser', 'Simulated — needs atomic D1 write'],
              ['Shared data between six members', 'Browser storage only', 'Not built'],
              ['Activity history', 'Recorded per change', 'Simulated — needs append-only table'],
              ['Photos', 'Kept in browser storage', 'Simulated — needs private R2'],
              ['Offline', 'Read-only cached view, writes blocked', 'Pattern ready; service worker needs hosting'],
              ['Home Screen install', 'Manifest + service worker files included', 'Needs deployment'],
              ['Payments', 'Usage statement only', 'Out of scope'],
            ].map(([a, b, c]) => <tr key={a}><td>{a}</td><td>{b}</td><td><Pill tone={c.startsWith('Ready') || c.startsWith('Reusable') ? 'ok' : c.startsWith('Out') ? 'muted' : 'warn'}>{c}</Pill></td></tr>)}
          </tbody>
        </table></div>
      </Section>
      <Section title="Cloudflare target">
        <ul className="plain bullets">
          <li><strong>Workers Static Assets</strong> serves the React app.</li>
          <li><strong>Workers API</strong> owns every write: auth check, permission check, validation, conflict check, insert, audit entry.</li>
          <li><strong>D1</strong> stores members, bookings, maintenance, restrictions, issues, flight records and an append-only audit log.</li>
          <li><strong>R2 (private)</strong> holds issue and aircraft photos, served through short-lived signed URLs.</li>
        </ul>
      </Section>
      <Section title="Production requirements">
        <ul className="plain bullets">
          <li>Secure sign-in (passkeys or email magic links), invite-only, with session expiry.</li>
          <li>All permissions enforced on the server. The UI hides buttons; the server decides.</li>
          <li>Atomic conflict prevention: check and insert in one D1 transaction or a single conditional insert, with a version column for edits.</li>
          <li>Persistent shared data and an append-only audit history.</li>
          <li>Automated daily D1 exports and tested restore.</li>
          <li>Private photo access only for signed-in members.</li>
          <li>Concurrency tests that fire parallel requests at the real API.</li>
        </ul>
      </Section>
    </>
  );
}
