import React, { useEffect, useState } from 'react';
import { useApp, type Tab } from './context';
import { Icon, Skeleton, PlaneIcon } from './components';
import { BookingDetail, BookingForm, ReturnForm } from './bookingViews';
import { CsvModal, FlightDetail, FlightForm, IssueDetail, IssueForm, MaintenanceForm, RestrictionForm } from './recordViews';
import { FlightLog, Home, MyBookings } from './screens';
import { CalendarScreen } from './calendar';
import { MaintenanceDetail, MoreScreen } from './more';
import { fmtDateTime } from '../domain/time';
import { PullToRefresh, SyncBar } from './appShell';

const NAV: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'bookings', label: 'My Bookings', icon: 'bookings' },
  { id: 'log', label: 'Flight Log', icon: 'log' },
  { id: 'more', label: 'More', icon: 'more' },
];

export function App() {
  const { db, me, setMe, tab, setTab, modal, toasts, offline, tz, live, fromCache, refresh } = useApp();
  const [loading, setLoading] = useState(true);
  useEffect(() => { const t = setTimeout(() => setLoading(false), 350); return () => clearTimeout(t); }, []);
  useEffect(() => { document.title = db.settings.appName; }, [db.settings.appName]);

  const screen = loading ? <div className="screen"><Skeleton lines={4} /><Skeleton lines={3} /></div>
    : tab === 'home' ? <Home /> : tab === 'calendar' ? <CalendarScreen /> : tab === 'bookings' ? <MyBookings /> : tab === 'log' ? <FlightLog /> : <MoreScreen />;

  return (
    <div className="shell">
      {__LIVE__ && <><SyncBar /><PullToRefresh /></>}
      {!__LIVE__ && <div className="demo-bar" role="region" aria-label="Demo mode">
        <span className="demo-tag">Demo mode: simulated accounts and data</span>
        <label className="acct-switch">
          <span className="sr-only">Viewing as</span>
          <select value={me.id} onChange={(e) => setMe(e.target.value)} aria-label="Switch demo account">
            {db.members.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role === 'admin' ? 'Admin' : 'Pilot'}</option>)}
          </select>
        </label>
      </div>}

      <aside className="sidebar" aria-label="Main">
        <div className="brand"><span className="brand-mark" aria-hidden="true"><PlaneIcon size={26} /></span><span><strong>{db.settings.appName}</strong>{!db.settings.tailNumber.toUpperCase().includes(db.settings.appName.toUpperCase()) && <span className="brand-tail">{db.settings.tailNumber}</span>}</span></div>
        <nav>{NAV.map((n) => <button key={n.id} className={tab === n.id ? 'on' : ''} aria-current={tab === n.id ? 'page' : undefined} onClick={() => setTab(n.id)}><Icon name={n.icon} /><span>{n.label}</span></button>)}</nav>
        <p className="side-foot fine">Signed in as <strong>{me.name}</strong><br />{me.role === 'admin' ? 'Admin + pilot' : 'Pilot'}</p>
      </aside>

      <main className="main" id="main">
        <header className="topbar">
          <span className="brand-mark" aria-hidden="true"><PlaneIcon size={23} /></span>
          <strong>{db.settings.appName}</strong>
          {!db.settings.tailNumber.toUpperCase().includes(db.settings.appName.toUpperCase()) && <span className="brand-tail">{db.settings.tailNumber}</span>}
        </header>
        {offline && (
          <div className="offline-bar" role="status">
            <Icon name="cloud" size={18} />
            <span><strong>Offline — showing this phone's saved copy.</strong> Last updated {fmtDateTime(db.savedAt, tz)}. Availability may be out of date. Booking changes, check-out and flight records are disabled until you reconnect.</span>
            {live && <button className="link" onClick={refresh}>Try again</button>}
          </div>
        )}
        {!offline && fromCache && <div className="offline-bar" role="status"><Icon name="cloud" size={18} /><span>Showing saved data while reconnecting…</span></div>}
        {screen}
      </main>

      <nav className="bottom-nav" aria-label="Main">
        {NAV.map((n) => <button key={n.id} className={tab === n.id ? 'on' : ''} aria-current={tab === n.id ? 'page' : undefined} onClick={() => setTab(n.id)}><Icon name={n.icon} /><span>{n.label}</span></button>)}
      </nav>

      {modal?.kind === 'booking' && <BookingForm booking={modal.booking} prefill={modal.prefill} key={'bf' + (modal.booking?.id ?? '') + (modal.prefill?.startUtc ?? '')} />}
      {modal?.kind === 'bookingDetail' && <BookingDetail bookingId={modal.bookingId} key={modal.bookingId} />}
      {modal?.kind === 'return' && <ReturnForm bookingId={modal.bookingId} />}
      {modal?.kind === 'flight' && <FlightForm bookingId={modal.bookingId} afterReturn={modal.afterReturn} key={'ff' + modal.bookingId} />}
      {modal?.kind === 'flightDetail' && <FlightDetail flightId={modal.flightId} key={modal.flightId} />}
      {modal?.kind === 'issue' && <IssueForm />}
      {modal?.kind === 'issueDetail' && <IssueDetail issueId={modal.issueId} key={modal.issueId} />}
      {modal?.kind === 'maintenance' && <MaintenanceForm />}
      {modal?.kind === 'maintenanceDetail' && <MaintenanceDetail id={modal.id} key={modal.id} />}
      {modal?.kind === 'restriction' && <RestrictionForm />}
      {modal?.kind === 'csv' && <CsvModal csv={modal.csv} filename={modal.filename} />}

      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.tone === 'success' && <Icon name="check" size={18} />}{t.text}</div>)}</div>
    </div>
  );
}
