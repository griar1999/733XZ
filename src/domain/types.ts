// Core data model. All timestamps are stored as UTC ISO-8601 strings.
// Meter readings are stored as integer hundredths (123.4 -> 12340) so math is exact.
// Money is stored as integer cents.

export type Role = 'admin' | 'pilot';

export interface Member {
  id: string;
  name: string;
  initials: string;
  role: Role;
  active: boolean;
  email: string; // display only in demo; future invite target
}

export type BookingStatus = 'confirmed' | 'checked_out' | 'completed' | 'canceled' | 'no_show';

export interface Booking {
  id: string;
  pilotId: string;
  startUtc: string;
  endUtc: string;
  destination: string;
  notes: string;
  status: BookingStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  checkedOutAt?: string;
  checkedOutBy?: string;
  returnedAt?: string;
  returnedBy?: string;
  returnNote?: string;
  fuelToppedOff?: boolean;
  canceledAt?: string;
  canceledBy?: string;
  cancelReason?: string;
  noShowAt?: string;
  noShowBy?: string;
  // Set when the aircraft has been returned but no flight record exists yet.
  flightRecordNeeded?: boolean;
}

export interface MaintenanceBlock {
  id: string;
  title: string;
  startUtc: string;
  endUtc: string;
  notes: string;
  status: 'scheduled' | 'ended' | 'canceled';
  createdBy: string;
  createdAt: string;
  endedAt?: string;
  endedBy?: string;
}

export type IssueUrgency = 'low' | 'medium' | 'high' | 'grounding';
export type IssueStatus = 'open' | 'investigating' | 'deferred' | 'resolved';

export interface IssueHistory {
  at: string;
  by: string;
  status: IssueStatus;
  note: string;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  urgency: IssueUrgency;
  status: IssueStatus;
  reportedBy: string;
  reportedAt: string;
  photoDataUrl?: string; // demo only, stays in this browser
  history: IssueHistory[];
  restrictionId?: string;
}

// An operational restriction is separate from the calendar. Only an admin can clear it,
// with a recorded reason. Clearing is an operational decision, not a maintenance sign-off.
export interface Restriction {
  id: string;
  level: 'grounded' | 'caution';
  reason: string;
  createdBy: string;
  createdAt: string;
  issueId?: string;
  clearedAt?: string;
  clearedBy?: string;
  clearReason?: string;
}

export interface Revision {
  at: string;
  by: string;
  reason: string;
  previous: Partial<FlightRecord>;
}

export interface FlightRecord {
  id: string;
  bookingId: string;
  pilotId: string;
  flightDate: string; // YYYY-MM-DD in aircraft base time zone
  route: string;
  hobbsStart: number | null; // hundredths
  hobbsEnd: number | null;
  tachStart: number | null;
  tachEnd: number | null;
  fuelGallons: number | null; // hundredths of a gallon
  fuelCostCents: number | null;
  notes: string;
  flags: string[];
  submissionKey: string;
  createdAt: string;
  createdBy: string;
  revisions: Revision[];
  voided?: boolean;
}

export interface AircraftSettings {
  appName: string;
  tailNumber: string;
  model: string;
  homeAirport: string;
  photoDataUrl?: string;
  timeZone: string;
  bufferMinutes: number;
  hobbsEnabled: boolean;
  tachEnabled: boolean;
  earlyCheckoutMinutes: number;
  rateCentsPerHour: number;
  rateBasis: 'hobbs' | 'tach';
  fuelPolicy: 'pilot_pays_at_pump' | 'add_to_statement';
  topOffRequired: boolean;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string;
  action: string;
  entityType: 'booking' | 'maintenance' | 'issue' | 'restriction' | 'flight' | 'settings' | 'member' | 'demo';
  entityId?: string;
  summary: string;
  before?: unknown;
  after?: unknown;
}

export interface DbState {
  schemaVersion: number;
  members: Member[];
  bookings: Booking[];
  maintenance: MaintenanceBlock[];
  issues: Issue[];
  restrictions: Restriction[];
  flights: FlightRecord[];
  settings: AircraftSettings;
  audit: AuditEntry[];
  savedAt: string;
}

export interface BookingInput {
  pilotId: string;
  startUtc: string;
  endUtc: string;
  destination: string;
  notes: string;
}

export interface FlightInput {
  bookingId: string;
  pilotId: string;
  flightDate: string;
  route: string;
  hobbsStart: number | null;
  hobbsEnd: number | null;
  tachStart: number | null;
  tachEnd: number | null;
  fuelGallons: number | null;
  fuelCostCents: number | null;
  notes: string;
  submissionKey: string;
}
