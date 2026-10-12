import type { BookingInput } from '../domain/types';
import { findConflicts } from '../domain/rules';
import type { PlaneShareApi } from './api';

export interface RaceResult {
  frontendCheckPassedForBoth: boolean;
  results: Array<{ actorId: string; ok: boolean; message: string; bookingId?: string }>;
}

/**
 * Two members submit the same slot at nearly the same moment. Both clients' local
 * (frontend) checks pass because each saw the slot free. Only the serialized write
 * on the "server" decides who wins. Production must do this atomically in D1.
 */
export async function simulateRace(api: PlaneShareApi, a: { actorId: string; input: BookingInput }, b: { actorId: string; input: BookingInput }): Promise<RaceResult> {
  const db = api.snapshot();
  const pre = (i: BookingInput) => findConflicts(db, i.startUtc, i.endUtc, db.settings.bufferMinutes).length === 0;
  const frontendCheckPassedForBoth = pre(a.input) && pre(b.input);
  const settled = await Promise.allSettled([api.createBooking(a.actorId, a.input), api.createBooking(b.actorId, b.input)]);
  return {
    frontendCheckPassedForBoth,
    results: settled.map((s, i) => {
      const actorId = i === 0 ? a.actorId : b.actorId;
      return s.status === 'fulfilled'
        ? { actorId, ok: true, message: 'Reservation confirmed', bookingId: s.value.id }
        : { actorId, ok: false, message: (s.reason as Error).message };
    }),
  };
}
