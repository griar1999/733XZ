// Inspection tracking: when each recurring inspection or check was last done and when it's next due.
// Tracking only — the aircraft logbooks remain the official record.
import type { DbState, Inspection, InspectionKind } from './types';
import { addDays } from './time';
import { fmtHundredths } from './decimal';
import { lastReadings } from './rules';

export const DEFAULT_INSPECTIONS: Array<Pick<Inspection, 'id' | 'name' | 'kind' | 'interval' | 'pilotsCanRecord'>> = [
  { id: 'insp_50hr', name: '50-Hour Inspection', kind: 'tach', interval: 50, pilotsCanRecord: false },
  { id: 'insp_100hr', name: '100-Hour Inspection', kind: 'tach', interval: 100, pilotsCanRecord: false },
  { id: 'insp_elt', name: 'ELT Inspection', kind: 'months', interval: 12, pilotsCanRecord: false },
  { id: 'insp_xpdr', name: 'Transponder & Altimeter', kind: 'months', interval: 24, pilotsCanRecord: false },
  { id: 'insp_pitot', name: 'Static & Pitot System', kind: 'months', interval: 24, pilotsCanRecord: false },
  { id: 'insp_annual', name: 'Annual Inspection', kind: 'yearEnd', interval: 1, pilotsCanRecord: false },
  { id: 'insp_vor', name: 'VOR Check', kind: 'days', interval: 30, pilotsCanRecord: true },
];

export function defaultInspections(): Inspection[] {
  return DEFAULT_INSPECTIONS.map((d) => ({ ...d, active: true, builtIn: true, lastDate: null, lastTach: null, history: [], notified: null }));
}

/** Older saved data has no inspections yet: add the standard list. */
export function ensureInspections<T extends { inspections?: Inspection[] }>(s: T): T & { inspections: Inspection[] } {
  if (!Array.isArray(s.inspections)) (s as { inspections?: Inspection[] }).inspections = defaultInspections();
  return s as T & { inspections: Inspection[] };
}

export function intervalLabel(kind: InspectionKind, interval: number): string {
  switch (kind) {
    case 'tach': return `Every ${interval} tach hours`;
    case 'months': return `Every ${interval} calendar months`;
    case 'days': return `Every ${interval} days`;
    case 'yearEnd': return 'Due Dec 31 each year';
  }
}

/** Last day of the month `months` after `date` (calendar-month rule). */
export function endOfMonthAfter(date: string, months: number): string {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)); // day 0 of the following month
  return last.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
}

export type InspectionStatus = 'unset' | 'ok' | 'soon' | 'overdue' | 'no-meter';

export interface DueInfo {
  status: InspectionStatus;
  nextDate: string | null;
  nextTach: number | null;      // hundredths
  daysLeft: number | null;
  tachLeft: number | null;      // hundredths (negative = overdue)
  summary: string;              // "Due Mar 31, 2027 · 172 days" / "Due at tach 2,264.7 · 48.2 h left"
}

/** When a due date or tach reading counts as "due soon". */
function soonThreshold(kind: InspectionKind, interval: number): number {
  if (kind === 'tach') return Math.max(100, Math.round(interval * 10)); // 10% of interval, in hundredths (5 h / 10 h)
  if (kind === 'days') return 5;
  return 30;
}

export function fmtDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function dueInfo(insp: Inspection, currentTach: number | null, today: string, tachEnabled = true): DueInfo {
  const blank: DueInfo = { status: 'unset', nextDate: null, nextTach: null, daysLeft: null, tachLeft: null, summary: 'Enter the last time it was done' };
  if (insp.kind === 'tach') {
    if (!tachEnabled) return { ...blank, status: 'no-meter', summary: 'Tach meter is turned off in Settings' };
    if (insp.lastTach === null) return blank;
    const nextTach = insp.lastTach + insp.interval * 100;
    if (currentTach === null) return { ...blank, status: 'ok', nextTach, summary: `Due at tach ${fmtHundredths(nextTach)}` };
    const left = nextTach - currentTach;
    const status: InspectionStatus = left <= 0 ? 'overdue' : left <= soonThreshold('tach', insp.interval) ? 'soon' : 'ok';
    return {
      status, nextDate: null, nextTach, daysLeft: null, tachLeft: left,
      summary: left <= 0 ? `Due at tach ${fmtHundredths(nextTach)} · overdue by ${fmtHundredths(-left)} h` : `Due at tach ${fmtHundredths(nextTach)} · ${fmtHundredths(left)} h left`,
    };
  }
  if (!insp.lastDate) return blank;
  const nextDate = insp.kind === 'months' ? endOfMonthAfter(insp.lastDate, insp.interval)
    : insp.kind === 'days' ? addDays(insp.lastDate, insp.interval)
    : `${Number(insp.lastDate.slice(0, 4)) + 1}-12-31`;
  const daysLeft = daysBetween(today, nextDate);
  const status: InspectionStatus = daysLeft < 0 ? 'overdue' : daysLeft <= soonThreshold(insp.kind, insp.interval) ? 'soon' : 'ok';
  const when = daysLeft < 0 ? `overdue by ${-daysLeft} day${daysLeft === -1 ? '' : 's'}` : daysLeft === 0 ? 'due today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
  return { status, nextDate, nextTach: null, daysLeft, tachLeft: null, summary: `Due ${fmtDay(nextDate)} · ${when}` };
}

export function currentTach(db: Pick<DbState, 'flights'>): number | null {
  return lastReadings(db.flights).tach;
}

export interface InspectionView { insp: Inspection; due: DueInfo }

/** Active inspections with due info, most urgent first. */
export function inspectionViews(db: DbState, today: string): InspectionView[] {
  const tach = currentTach(db);
  const rank: Record<InspectionStatus, number> = { overdue: 0, soon: 1, unset: 2, ok: 3, 'no-meter': 4 };
  return (db.inspections ?? []).filter((i) => i.active)
    .map((insp) => ({ insp, due: dueInfo(insp, tach, today, db.settings.tachEnabled) }))
    .sort((a, b) => rank[a.due.status] - rank[b.due.status]
      || (a.due.daysLeft ?? (a.due.tachLeft !== null ? a.due.tachLeft / 10 : 9e9)) - (b.due.daysLeft ?? (b.due.tachLeft !== null ? b.due.tachLeft / 10 : 9e9)));
}

export function statusLabel(s: InspectionStatus): string {
  return { unset: 'Not set', ok: 'Current', soon: 'Due soon', overdue: 'Overdue', 'no-meter': 'No tach' }[s];
}
