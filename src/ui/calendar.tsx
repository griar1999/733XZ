import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from './context';
import { Button, Icon, Segmented } from './components';
import { addDays, dayOfWeek, fmtDate, fmtTime, localDayBounds, localToUtc, toLocalParts, tzAbbrev } from '../domain/time';
import { BLOCKING } from '../domain/rules';
import { pilotName } from './bookingViews';
import { statusLabel } from '../domain/rules';

type View = 'agenda' | 'week' | 'month';
interface Ev { id: string; kind: 'booking' | 'mine' | 'maintenance' | 'canceled'; startUtc: string; endUtc: string; title: string; sub: string; bookingId?: string }

const DAY_START = 6, DAY_END = 22, PX = 0.8; // px per minute in week view

function useEvents(showCanceled: boolean): Ev[] {
  const { db, me } = useApp();
  return useMemo(() => {
    const ev: Ev[] = [];
    for (const b of db.bookings) {
      const canceled = b.status === 'canceled' || b.status === 'no_show';
      if (canceled && !showCanceled) continue;
      ev.push({ id: b.id, bookingId: b.id, kind: canceled ? 'canceled' : b.pilotId === me.id ? 'mine' : 'booking', startUtc: b.startUtc, endUtc: b.endUtc,
        title: pilotName(db, b.pilotId) + (b.pilotId === me.id ? ' (you)' : ''), sub: `${statusLabel(b.status)}${b.destination ? ' · ' + b.destination : ''}` });
    }
    for (const m of db.maintenance) if (m.status !== 'canceled') ev.push({ id: m.id, kind: 'maintenance', startUtc: m.startUtc, endUtc: m.endUtc, title: m.title, sub: m.status === 'ended' ? 'Maintenance (ended)' : 'Maintenance' });
    return ev.sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
  }, [db, me, showCanceled]);
}

function eventsOnDay(ev: Ev[], date: string, tz: string) {
  const { start, end } = localDayBounds(date, tz);
  return ev.filter((e) => Date.parse(e.startUtc) < Date.parse(end) && Date.parse(e.endUtc) > Date.parse(start));
}

export function CalendarScreen() {
  const { db, tz, now, openModal } = useApp();
  const narrow = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches;
  const [view, setView] = useState<View>(narrow ? 'agenda' : 'week');
  const [anchor, setAnchor] = useState(() => toLocalParts(now, tz).date);
  const [showCanceled, setShowCanceled] = useState(false);
  const [selDay, setSelDay] = useState<string | null>(null);
  const ev = useEvents(showCanceled);
  const today = toLocalParts(now, tz).date;
  const step = view === 'month' ? 0 : view === 'week' ? 7 : 14;
  const move = (dir: number) => {
    if (view === 'month') { const [y, m] = anchor.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + dir, 1)); setAnchor(d.toISOString().slice(0, 10)); }
    else setAnchor(addDays(anchor, dir * step));
  };
  const book = (date: string, time: string, hours = 2) => {
    const s = localToUtc(date, time, tz);
    if (!s.ok) return openModal({ kind: 'booking' });
    openModal({ kind: 'booking', prefill: { startUtc: s.utc, endUtc: new Date(Date.parse(s.utc) + hours * 3600e3).toISOString() } });
  };
  const weekStart = anchor; // rolling 7 days starting at the anchor date
  const title = view === 'month' ? fmtDate(localToUtc(anchor.slice(0, 8) + '15', '12:00', tz).ok ? (localToUtc(anchor.slice(0, 8) + '15', '12:00', tz) as { utc: string }).utc : new Date().toISOString(), tz, { month: 'long', year: 'numeric' })
    : view === 'week' ? `7 days from ${fmtDate((localToUtc(weekStart, '12:00', tz) as { utc: string }).utc, tz, { month: 'short', day: 'numeric' })}`
    : `From ${fmtDate((localToUtc(anchor, '12:00', tz) as { utc: string }).utc, tz)}`;

  return (
    <div className="screen calendar">
      <div className="screen-head">
        <h1>Calendar</h1>
        <Button variant="primary" icon="plus" onClick={() => openModal({ kind: 'booking' })}>Book</Button>
      </div>
      <div className="toolbar">
        <Segmented label="Calendar view" value={view} onChange={(v) => { setView(v); setSelDay(null); }} options={[{ value: 'agenda', label: 'Agenda' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
        <div className="nav-row">
          <button className="icon-btn" aria-label="Previous" onClick={() => move(-1)}><Icon name="back" /></button>
          <button className="link" onClick={() => setAnchor(today)}>Today</button>
          <button className="icon-btn" aria-label="Next" onClick={() => move(1)}><Icon name="chevron" /></button>
          <span className="cal-title">{title}</span>
        </div>
      </div>
      <div className="legend" aria-label="Legend">
        <span><i className="sw sw-booking" />Booked</span><span><i className="sw sw-mine" />My booking</span><span><i className="sw sw-maintenance" />Maintenance</span>
        <label className="switch small"><input type="checkbox" checked={showCanceled} onChange={(e) => setShowCanceled(e.target.checked)} /><i className="sw sw-canceled" />Show canceled</label>
      </div>
      <p className="tz-note">All times {tz === 'America/Los_Angeles' ? 'Pacific' : tz} ({tzAbbrev(now, tz)}). Open time means nobody has reserved it, not that the aircraft is airworthy.{db.settings.bufferMinutes ? ` ${db.settings.bufferMinutes}-minute turnaround buffer between bookings.` : ''}</p>

      {view === 'agenda' && <Agenda ev={ev} start={anchor} days={14} book={book} />}
      {view === 'week' && <Week ev={ev} start={weekStart} book={book} />}
      {view === 'month' && <Month ev={ev} anchor={anchor} selDay={selDay} setSelDay={setSelDay} book={book} />}
    </div>
  );
}

function EventChip({ e, compact }: { e: Ev; compact?: boolean }) {
  const { tz, openModal } = useApp();
  const open = () => (e.bookingId ? openModal({ kind: 'bookingDetail', bookingId: e.bookingId }) : openModal({ kind: 'maintenanceDetail', id: e.id }));
  const label = `${e.kind === 'maintenance' ? 'Maintenance' : 'Booking'}: ${e.title}, ${fmtDate(e.startUtc, tz)} ${fmtTime(e.startUtc, tz)} to ${fmtDate(e.endUtc, tz)} ${fmtTime(e.endUtc, tz)}`;
  return (
    <button className={`ev ev-${e.kind} ${compact ? 'compact' : ''}`} onClick={open} aria-label={label}>
      <span className="ev-title">{e.title}</span>
      {!compact && <span className="ev-sub">{fmtTime(e.startUtc, tz)} – {fmtTime(e.endUtc, tz)} · {e.sub}</span>}
    </button>
  );
}

function Agenda({ ev, start, days, book }: { ev: Ev[]; start: string; days: number; book: (d: string, t: string, h?: number) => void }) {
  const { tz, now, db } = useApp();
  const out: React.ReactNode[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const dayEv = eventsOnDay(ev, date, tz);
    const { start: ds } = localDayBounds(date, tz);
    const winS = localToUtc(date, `${String(DAY_START).padStart(2, '0')}:00`, tz), winE = localToUtc(date, `${DAY_END - 1}:00`, tz);
    const gaps: { s: number; e: number }[] = [];
    if (winS.ok && winE.ok) {
      let cursor = Math.max(Date.parse(winS.utc), Math.ceil(now / 1800e3) * 1800e3);
      const end = Date.parse(winE.utc);
      const blockers = dayEv.filter((e) => e.kind !== 'canceled' && (e.kind === 'maintenance' ? db.maintenance.find((m) => m.id === e.id)?.status === 'scheduled' : BLOCKING.includes(db.bookings.find((b) => b.id === e.id)?.status ?? 'canceled')));
      for (const b of blockers) {
        const bs = Date.parse(b.startUtc), be = Date.parse(b.endUtc);
        if (bs - cursor >= 3600e3 && cursor < end) gaps.push({ s: cursor, e: Math.min(bs, end) });
        cursor = Math.max(cursor, be);
      }
      if (end - cursor >= 3600e3) gaps.push({ s: cursor, e: end });
    }
    const label = fmtDate(new Date(Date.parse(ds) + 12 * 3600e3).toISOString(), tz, { weekday: 'long', month: 'short', day: 'numeric' });
    out.push(
      <section key={date} className="ag-day" aria-label={label}>
        <h3 className={date === toLocalParts(now, tz).date ? 'today' : ''}>{label}{date === toLocalParts(now, tz).date && <span className="today-tag">Today</span>}</h3>
        <div className="ag-items">
          {[...dayEv.map((e) => ({ t: Date.parse(e.startUtc), node: <EventChip key={e.id} e={e} /> })),
            ...gaps.map((g) => ({ t: g.s, node: (
              <button key={'g' + g.s} className="ag-open" onClick={() => { const p = toLocalParts(g.s, tz); book(p.date, p.time, Math.min(2, (g.e - g.s) / 3600e3)); }}>
                <span>Open {fmtTime(new Date(g.s).toISOString(), tz)} – {fmtTime(new Date(g.e).toISOString(), tz)}</span><span className="ag-cta">Book <Icon name="plus" size={16} /></span>
              </button>) }))]
            .sort((a, b) => a.t - b.t).map((x) => x.node)}
          {dayEv.length === 0 && gaps.length === 0 && <p className="fine">No open daytime slots left.</p>}
        </div>
      </section>,
    );
  }
  return <div className="agenda">{out}</div>;
}

function Week({ ev, start, book }: { ev: Ev[]; start: string; book: (d: string, t: string, h?: number) => void }) {
  const { tz, now } = useApp();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
  const today = toLocalParts(now, tz).date;
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setNowTick((x) => x + 1), 60000); return () => clearInterval(t); }, []);
  void nowTick;
  return (
    <div className="week-wrap">
      <div className="week" style={{ ['--rows' as string]: hours.length }}>
        <div className="wk-corner" />
        {days.map((d) => <div key={d} className={`wk-head ${d === today ? 'today' : ''}`}>{fmtDate((localToUtc(d, '12:00', tz) as { utc: string }).utc, tz, { weekday: 'short', day: 'numeric' })}</div>)}
        <div className="wk-hours">{hours.map((h) => <div key={h} className="wk-hour">{h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`}</div>)}</div>
        {days.map((d) => {
          const base = localToUtc(d, `${String(DAY_START).padStart(2, '0')}:00`, tz);
          const baseMs = base.ok ? Date.parse(base.utc) : 0;
          const endMs = baseMs + (DAY_END - DAY_START) * 3600e3;
          const dayEv = eventsOnDay(ev, d, tz).filter((e) => Date.parse(e.endUtc) > baseMs && Date.parse(e.startUtc) < endMs);
          return (
            <div key={d} className={`wk-col ${d === today ? 'today' : ''}`}>
              {hours.map((h) => {
                const t = `${String(h).padStart(2, '0')}:00`;
                const r = localToUtc(d, t, tz);
                const past = r.ok && Date.parse(r.utc) + 3600e3 <= now;
                return <button key={h} className="wk-slot" disabled={past || !r.ok} aria-label={past ? undefined : `Book ${d} at ${t}`} onClick={() => book(d, t)} tabIndex={past ? -1 : 0} />;
              })}
              {dayEv.map((e) => {
                const s = Math.max(Date.parse(e.startUtc), baseMs), en = Math.min(Date.parse(e.endUtc), endMs);
                const top = ((s - baseMs) / 60000) * PX, h = Math.max(18, ((en - s) / 60000) * PX);
                return <div key={e.id} className="wk-ev" style={{ top, height: h }}><EventChip e={e} compact={h < 40} /></div>;
              })}
              {d === today && now > baseMs && now < endMs && <div className="now-line" style={{ top: ((now - baseMs) / 60000) * PX }} aria-hidden="true" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Month({ ev, anchor, selDay, setSelDay, book }: { ev: Ev[]; anchor: string; selDay: string | null; setSelDay: (d: string | null) => void; book: (d: string, t: string, h?: number) => void }) {
  const { tz, now } = useApp();
  const first = anchor.slice(0, 8) + '01';
  const gridStart = addDays(first, -dayOfWeek(first));
  const month = anchor.slice(0, 7);
  const today = toLocalParts(now, tz).date;
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const sel = selDay ? eventsOnDay(ev, selDay, tz) : [];
  return (
    <>
      <div className="month" role="grid" aria-label="Month">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="mo-dow" role="columnheader">{d}</div>)}
        {cells.map((d) => {
          const de = eventsOnDay(ev, d, tz);
          return (
            <button key={d} role="gridcell" className={`mo-cell ${d.slice(0, 7) !== month ? 'other' : ''} ${d === today ? 'today' : ''} ${d === selDay ? 'sel' : ''}`} onClick={() => setSelDay(d)}
              aria-label={`${d}, ${de.length} item${de.length === 1 ? '' : 's'}`}>
              <span className="mo-num">{+d.slice(8)}</span>
              <span className="mo-dots">{de.slice(0, 3).map((e) => <i key={e.id} className={`mo-chip ev-${e.kind}`}>{e.kind === 'maintenance' ? 'Mx' : e.title.split(' ')[0]}</i>)}{de.length > 3 && <i className="mo-more">+{de.length - 3}</i>}</span>
            </button>
          );
        })}
      </div>
      {selDay && (
        <div className="day-panel">
          <div className="section-head"><h2>{fmtDate((localToUtc(selDay, '12:00', tz) as { utc: string }).utc, tz, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
            {selDay >= today && <Button variant="primary" icon="plus" onClick={() => book(selDay, '09:00')}>Book this day</Button>}</div>
          {sel.length ? <div className="stack">{sel.map((e) => <EventChip key={e.id} e={e} />)}</div> : <p className="fine">Nothing scheduled.</p>}
        </div>
      )}
    </>
  );
}
