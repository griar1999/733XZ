// The UI talks only to this interface. MockApi runs it on the device (demo build);
// HttpApi runs it against the Cloudflare Pages Functions (live build).
import type { Inspection } from '../domain/types';
import type { AircraftSettings, Booking, BookingInput, DbState, FlightInput, FlightRecord, Issue, IssueStatus, MaintenanceBlock, Member, Restriction } from '../domain/types';
import type { Conflict } from '../domain/rules';
import type { IssueInput, MaintenanceInput, ReturnInput } from './actions';
export type { IssueInput, MaintenanceInput, ReturnInput } from './actions';

export type ApiErrorCode = 'validation' | 'conflict' | 'forbidden' | 'not_found' | 'offline' | 'stale' | 'duplicate' | 'needs_review' | 'auth';

export interface ApiErrorDetails {
  conflicts?: Conflict[]; suggestion?: { startUtc: string; endUtc: string } | null;
  fieldErrors?: Record<string, string>; affected?: Booking[];
}

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message: string, public details: ApiErrorDetails = {}) { super(message); this.name = 'ApiError'; }
}

/** HTTP status the server uses for each error code. */
export const STATUS_OF: Record<ApiErrorCode, number> = {
  validation: 400, duplicate: 409, conflict: 409, stale: 409, needs_review: 409, forbidden: 403, not_found: 404, offline: 503, auth: 401,
};

export interface PlaneShareApi {
  readonly mode: 'demo' | 'live';
  snapshot(): DbState;
  subscribe(fn: () => void): () => void;
  isOffline(): boolean;
  setSimulatedOffline(v: boolean): void;
  nowMs(): number;

  createBooking(actorId: string, input: BookingInput): Promise<Booking>;
  updateBooking(actorId: string, id: string, input: BookingInput, expectedVersion: number): Promise<Booking>;
  cancelBooking(actorId: string, id: string, reason: string): Promise<Booking>;
  markNoShow(actorId: string, id: string, reason: string): Promise<Booking>;
  checkOut(actorId: string, id: string): Promise<Booking>;
  returnAircraft(actorId: string, id: string, input: ReturnInput): Promise<Booking>;

  submitFlight(actorId: string, input: FlightInput): Promise<{ record: FlightRecord; flags: string[]; replayed: boolean }>;
  correctFlight(actorId: string, id: string, changes: Partial<FlightInput>, reason: string): Promise<FlightRecord>;

  reportIssue(actorId: string, input: IssueInput): Promise<Issue>;
  updateIssue(actorId: string, id: string, status: IssueStatus, note: string): Promise<Issue>;
  createMaintenance(actorId: string, input: MaintenanceInput, acknowledgeAffected: boolean): Promise<MaintenanceBlock>;
  endMaintenance(actorId: string, id: string, mode: 'ended' | 'canceled', note: string): Promise<MaintenanceBlock>;
  addRestriction(actorId: string, level: Restriction['level'], reason: string): Promise<Restriction>;
  clearRestriction(actorId: string, id: string, reason: string): Promise<Restriction>;
  restrictionToNote(actorId: string, id: string): Promise<AircraftSettings>;

  updateSettings(actorId: string, patch: Partial<AircraftSettings>): Promise<AircraftSettings>;
  updateMember(actorId: string, id: string, patch: Partial<Pick<Member, 'name' | 'role' | 'active' | 'email'>>): Promise<Member>;
  addMember(actorId: string, name: string, role: Member['role']): Promise<Member>;
  removeMember(actorId: string, id: string, reason: string): Promise<{ removed: string; canceledBookings: number; deleted: boolean }>;
  recordInspection(actorId: string, id: string, input: { date: string; tach: number | null; notes: string }): Promise<Inspection>;
  updateInspection(actorId: string, id: string, patch: Partial<Pick<Inspection, 'name' | 'kind' | 'interval' | 'active' | 'pilotsCanRecord' | 'lastDate' | 'lastTach'>>): Promise<Inspection>;
  addInspection(actorId: string, input: { name: string; kind: Inspection['kind']; interval: number; pilotsCanRecord: boolean }): Promise<Inspection>;
  clearData(actorId: string, opts: { bookings: boolean; flights: boolean; aircraft: boolean; inspections?: boolean; history: boolean; confirm: string }): Promise<{ cleared: string[] }>;
  resetDemo(): Promise<void>;
}

/** Wires every PlaneShareApi write method to one `run(name, actorId, args)` function. */
export function actionMethods(run: <T>(name: string, actorId: string, args: unknown[]) => Promise<T>) {
  return {
    createBooking: (a: string, input: BookingInput) => run<Booking>('createBooking', a, [input]),
    updateBooking: (a: string, id: string, input: BookingInput, v: number) => run<Booking>('updateBooking', a, [id, input, v]),
    cancelBooking: (a: string, id: string, reason: string) => run<Booking>('cancelBooking', a, [id, reason]),
    markNoShow: (a: string, id: string, reason: string) => run<Booking>('markNoShow', a, [id, reason]),
    checkOut: (a: string, id: string) => run<Booking>('checkOut', a, [id]),
    returnAircraft: (a: string, id: string, input: ReturnInput) => run<Booking>('returnAircraft', a, [id, input]),
    submitFlight: (a: string, input: FlightInput) => run<{ record: FlightRecord; flags: string[]; replayed: boolean }>('submitFlight', a, [input]),
    correctFlight: (a: string, id: string, changes: Partial<FlightInput>, reason: string) => run<FlightRecord>('correctFlight', a, [id, changes, reason]),
    reportIssue: (a: string, input: IssueInput) => run<Issue>('reportIssue', a, [input]),
    updateIssue: (a: string, id: string, status: IssueStatus, note: string) => run<Issue>('updateIssue', a, [id, status, note]),
    createMaintenance: (a: string, input: MaintenanceInput, ack: boolean) => run<MaintenanceBlock>('createMaintenance', a, [input, ack]),
    endMaintenance: (a: string, id: string, mode: 'ended' | 'canceled', note: string) => run<MaintenanceBlock>('endMaintenance', a, [id, mode, note]),
    addRestriction: (a: string, level: Restriction['level'], reason: string) => run<Restriction>('addRestriction', a, [level, reason]),
    clearRestriction: (a: string, id: string, reason: string) => run<Restriction>('clearRestriction', a, [id, reason]),
    restrictionToNote: (a: string, id: string) => run<AircraftSettings>('restrictionToNote', a, [id]),
    updateSettings: (a: string, patch: Partial<AircraftSettings>) => run<AircraftSettings>('updateSettings', a, [patch]),
    updateMember: (a: string, id: string, patch: Partial<Pick<Member, 'name' | 'role' | 'active' | 'email'>>) => run<Member>('updateMember', a, [id, patch]),
    addMember: (a: string, name: string, role: Member['role']) => run<Member>('addMember', a, [name, role]),
    removeMember: (a: string, id: string, reason: string) => run<{ removed: string; canceledBookings: number; deleted: boolean }>('removeMember', a, [id, reason]),
    recordInspection: (a: string, id: string, input: { date: string; tach: number | null; notes: string }) => run<Inspection>('recordInspection', a, [id, input]),
    updateInspection: (a: string, id: string, patch: Partial<Pick<Inspection, 'name' | 'kind' | 'interval' | 'active' | 'pilotsCanRecord' | 'lastDate' | 'lastTach'>>) => run<Inspection>('updateInspection', a, [id, patch]),
    addInspection: (a: string, input: { name: string; kind: Inspection['kind']; interval: number; pilotsCanRecord: boolean }) => run<Inspection>('addInspection', a, [input]),
    clearData: (a: string, opts: { bookings: boolean; flights: boolean; aircraft: boolean; inspections?: boolean; history: boolean; confirm: string }) => run<{ cleared: string[] }>('clearData', a, [opts]),
  };
}
