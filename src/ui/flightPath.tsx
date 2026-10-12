// Flight path map on a flight record, from OpenSky Network ADS-B data (live app only).
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from './context';
import { Button, Icon } from './components';
import { trackStats, type TrackInfo, type TrackPoint } from '../domain/track';
import { fmtDuration } from '../domain/time';

const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
type LeafletNS = { map: (el: HTMLElement, o: object) => LMap; tileLayer: (u: string, o: object) => { addTo: (m: LMap) => void }; polyline: (p: [number, number][], o: object) => { addTo: (m: LMap) => void }; circleMarker: (p: [number, number], o: object) => { addTo: (m: LMap) => { bindTooltip: (t: string) => void } }; latLngBounds: (p: [number, number][]) => unknown };
type LMap = { fitBounds: (b: unknown, o?: object) => void; remove: () => void; invalidateSize: () => void };
let leafletP: Promise<LeafletNS> | null = null;
function loadLeaflet(): Promise<LeafletNS> {
  const w = window as unknown as { L?: LeafletNS };
  if (w.L) return Promise.resolve(w.L);
  if (!leafletP) leafletP = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = LEAFLET + 'leaflet.min.css'; document.head.appendChild(css);
    const js = document.createElement('script'); js.src = LEAFLET + 'leaflet.min.js'; js.async = true;
    js.onload = () => (w.L ? res(w.L) : rej(new Error('Map failed to load.')));
    js.onerror = () => { leafletP = null; rej(new Error('Map failed to load. Check your connection.')); };
    document.head.appendChild(js);
  });
  return leafletP;
}

/** Split into legs wherever the path has a gap of 30+ minutes (stops, or out of receiver range). */
function legs(points: TrackPoint[]): TrackPoint[][] {
  const out: TrackPoint[][] = [];
  for (const p of points) {
    const cur = out[out.length - 1];
    if (!cur || p[0] - cur[cur.length - 1][0] > 1800) out.push([p]); else cur.push(p);
  }
  return out;
}

function PathMap({ points }: { points: TrackPoint[] }) {
  const el = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let map: LMap | null = null, gone = false;
    loadLeaflet().then((L) => {
      if (gone || !el.current) return;
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#C2410C';
      map = L.map(el.current, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenStreetMap · ADS-B: OpenSky Network' }).addTo(map);
      for (const leg of legs(points)) L.polyline(leg.map((p) => [p[1], p[2]] as [number, number]), { color: accent, weight: 4, opacity: 0.9 }).addTo(map);
      const a = points[0], b = points[points.length - 1];
      L.circleMarker([a[1], a[2]], { radius: 7, color: '#fff', weight: 2, fillColor: '#1F8A4C', fillOpacity: 1 }).addTo(map).bindTooltip('Start');
      L.circleMarker([b[1], b[2]], { radius: 7, color: '#fff', weight: 2, fillColor: '#B42318', fillOpacity: 1 }).addTo(map).bindTooltip('End');
      map.fitBounds(L.latLngBounds(points.map((p) => [p[1], p[2]] as [number, number])), { padding: [24, 24] });
      setTimeout(() => map?.invalidateSize(), 250); // inside a sliding-up sheet
    }).catch((e: Error) => setErr(e.message));
    return () => { gone = true; map?.remove(); };
  }, [points]);
  return err ? <p className="fine">{err}</p> : <div ref={el} className="path-map" role="img" aria-label="Map of the flight path" />;
}

/** Altitude over time, as a small chart under the map. */
function AltitudeProfile({ points }: { points: TrackPoint[] }) {
  const pts = points.filter((p) => p[3] !== null) as [number, number, number, number][];
  if (pts.length < 2) return null;
  const W = 600, H = 90, t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  const max = Math.max(1000, ...pts.map((p) => p[3])), min = Math.min(0, ...pts.map((p) => p[3]));
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (a: number) => H - 6 - ((a - min) / (max - min)) * (H - 12);
  let d = '';
  pts.forEach((p, i) => { const gap = i > 0 && p[0] - pts[i - 1][0] > 1800; d += `${i === 0 || gap ? 'M' : 'L'}${x(p[0]).toFixed(1)},${y(p[3]).toFixed(1)}`; });
  return (
    <figure className="alt-profile">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true"><path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" /></svg>
      <figcaption className="fine">Altitude · peak {max.toLocaleString()} ft</figcaption>
    </figure>
  );
}

export function FlightPath({ flightId }: { flightId: string }) {
  const { me, live } = useApp();
  const [t, setT] = useState<TrackInfo | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async (force = false) => {
    setErr(''); if (force) setBusy(true);
    try {
      const r = await fetch(`/api/track?flight=${encodeURIComponent(flightId)}`, { method: force ? 'POST' : 'GET', credentials: 'same-origin' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load the flight path.');
      setT(d as TrackInfo);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { if (live) void load(); }, [flightId, live]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!live) return <div className="subcard"><h3>Flight path</h3><p className="fine">On the live app, the path flown shows here, from OpenSky Network ADS-B data.</p></div>;
  const st = t?.status === 'ok' ? trackStats(t.points) : null;
  return (
    <div className="subcard flight-path">
      <h3>Flight path</h3>
      {!t && !err && <p className="fine"><span className="spinner" aria-hidden="true" /> Looking up the path…</p>}
      {err && <p className="fine">{err}</p>}
      {t?.status === 'ok' && st && (
        <>
          <PathMap points={t.points} />
          <p className="path-stats"><Icon name="plane" size={16} /> {fmtDuration(st.minutes)} tracked · {st.nm} nm{st.maxAlt !== null ? ` · up to ${st.maxAlt.toLocaleString()} ft` : ''}{t.legs > 1 ? ` · ${t.legs} legs` : ''}</p>
          <AltitudeProfile points={t.points} />
          <p className="fine">ADS-B positions from the OpenSky Network. Gaps mean no receiver picked the aircraft up there. Not for navigation or logbook use.</p>
        </>
      )}
      {t && t.status !== 'ok' && <p className="fine">{t.message ?? 'No path available.'}</p>}
      {me.role === 'admin' && t && t.status !== 'ok' && t.status !== 'unavailable' && <Button pending={busy} onClick={() => load(true)}>Check OpenSky again</Button>}
    </div>
  );
}
