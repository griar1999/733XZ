// A recorded flight path: [unix seconds, lat, lon, altitude ft (null if unknown)]
export type TrackPoint = [number, number, number, number | null];

export interface TrackInfo {
  status: 'ok' | 'none' | 'pending' | 'unavailable';
  points: TrackPoint[];
  legs: number;
  message?: string;
  source?: string;
  fetchedAt?: string;
}

const R_NM = 3440.065;
export function distanceNm(a: TrackPoint, b: TrackPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLon = (b[2] - a[2]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function trackStats(points: TrackPoint[]) {
  let nm = 0, maxAlt: number | null = null;
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && points[i][0] - points[i - 1][0] < 1800) nm += distanceNm(points[i - 1], points[i]); // don't bridge gaps between legs
    const a = points[i][3];
    if (a !== null && (maxAlt === null || a > maxAlt)) maxAlt = a;
  }
  const minutes = points.length > 1 ? Math.round((points[points.length - 1][0] - points[0][0]) / 60) : 0;
  return { nm: Math.round(nm * 10) / 10, maxAlt, minutes };
}

/** Keep at most `max` points, always keeping the first and last. */
export function downsample(points: TrackPoint[], max = 800): TrackPoint[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: TrackPoint[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/** OpenSky waypoint [time, lat, lon, baroAltMeters, trueTrack, onGround] → TrackPoint. */
export function fromOpenSky(path: unknown[]): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (const w of path) {
    if (!Array.isArray(w)) continue;
    const [t, lat, lon, alt] = w as [number, number | null, number | null, number | null];
    if (typeof t !== 'number' || typeof lat !== 'number' || typeof lon !== 'number') continue;
    out.push([t, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, typeof alt === 'number' ? Math.round(alt * 3.28084) : null]);
  }
  return out;
}
