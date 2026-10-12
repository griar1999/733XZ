// Monthly usage statements: what each pilot flew and owes the group for one calendar month.
import type { DbState, FlightRecord } from './types';
import { charges, sumMeter } from './rules';
import { fmtHundredths } from './decimal';

export interface StatementRow {
  memberId: string;
  name: string;
  flights: number;
  hobbs: number;       // hundredths
  tach: number;        // hundredths
  billable: number;    // hundredths, on the rate basis
  rentalCents: number;
  fuelGallons: number; // hundredths
  fuelCents: number;
  owedCents: number;   // rental (+ fuel when fuel goes on the statement)
  records: FlightRecord[];
}

export interface Statement { month: string; rows: StatementRow[]; totals: Omit<StatementRow, 'memberId' | 'name' | 'records'> }

/** month = "YYYY-MM" in the aircraft time zone (flight dates are already local dates). */
export function monthlyStatement(db: DbState, month: string): Statement {
  const inMonth = db.flights.filter((f) => !f.voided && f.flightDate.slice(0, 7) === month);
  const ids = [...new Set(inMonth.map((f) => f.pilotId))];
  const rows: StatementRow[] = ids.map((id) => {
    const recs = inMonth.filter((f) => f.pilotId === id).sort((a, b) => a.flightDate.localeCompare(b.flightDate) || a.createdAt.localeCompare(b.createdAt));
    const c = charges(recs, db.settings);
    return {
      memberId: id,
      name: db.members.find((m) => m.id === id)?.name ?? 'Former member',
      flights: recs.length,
      hobbs: sumMeter(recs, 'hobbs'),
      tach: sumMeter(recs, 'tach'),
      billable: c.hours,
      rentalCents: c.rentalCents,
      fuelGallons: recs.reduce((t, f) => t + (f.fuelGallons ?? 0), 0),
      fuelCents: c.fuelCents,
      owedCents: c.totalOwedCents,
      records: recs,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const sum = (k: keyof StatementRow) => rows.reduce((t, r) => t + (r[k] as number), 0);
  return {
    month, rows,
    totals: { flights: sum('flights'), hobbs: sum('hobbs'), tach: sum('tach'), billable: sum('billable'), rentalCents: sum('rentalCents'), fuelGallons: sum('fuelGallons'), fuelCents: sum('fuelCents'), owedCents: sum('owedCents') },
  };
}

/** Months that have flight records, newest first, plus the current month. */
export function statementMonths(db: DbState, currentMonth: string): string[] {
  const set = new Set(db.flights.filter((f) => !f.voided).map((f) => f.flightDate.slice(0, 7)));
  set.add(currentMonth);
  return [...set].sort().reverse();
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const money = (c: number) => (c / 100).toFixed(2);

/** CSV with one summary line per pilot, then every flight. */
export function statementCsv(st: Statement, db: DbState): string {
  const s = db.settings;
  const lines: string[] = [];
  lines.push(['month', 'pilot', 'flights', 'hobbs_hours', 'tach_hours', `billable_hours_(${s.rateBasis})`, 'rate_per_hour', 'rental', 'fuel_gallons', 'fuel_cost', 'owed_to_group'].join(','));
  for (const r of st.rows) {
    lines.push([st.month, r.name, r.flights, fmtHundredths(r.hobbs, 2), fmtHundredths(r.tach, 2), fmtHundredths(r.billable, 2), money(s.rateCentsPerHour), money(r.rentalCents), fmtHundredths(r.fuelGallons, 2), money(r.fuelCents), money(r.owedCents)].map(cell).join(','));
  }
  lines.push('');
  lines.push(['date', 'pilot', 'route', 'hobbs_start', 'hobbs_end', 'tach_start', 'tach_end', 'fuel_gallons', 'fuel_cost'].join(','));
  for (const r of st.rows) for (const f of r.records) {
    lines.push([f.flightDate, r.name, f.route, fmtHundredths(f.hobbsStart, 2), fmtHundredths(f.hobbsEnd, 2), fmtHundredths(f.tachStart, 2), fmtHundredths(f.tachEnd, 2), f.fuelGallons !== null ? fmtHundredths(f.fuelGallons, 2) : '', f.fuelCostCents !== null ? money(f.fuelCostCents) : ''].map(cell).join(','));
  }
  return lines.join('\n').replace(/—/g, '');
}
