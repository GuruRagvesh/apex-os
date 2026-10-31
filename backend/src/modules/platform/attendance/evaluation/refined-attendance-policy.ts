export interface RefinedAttendanceInput {
  /** Punch-out minus punch-in. The nine-hour rule includes permitted breaks. */
  presenceMinutes: number;
  /** Minutes after local midnight, company timezone. */
  punchInMinutes: number | null;
  punchOutMinutes: number | null;
  requiredMinutes?: number;
  /** Presence at or below this is a half day. */
  halfDayMaximumMinutes?: number;
  /** A punch-in at or after this time of day is a half day. */
  halfDayArrivalMinutes?: number;
  /** A punch-out at or before this time of day is a half day. */
  earlyCheckoutBoundaryMinutes?: number;
  /** Kept for callers that still pass them; they no longer decide the outcome. */
  lateArrivalBoundaryMinutes?: number;
  fullHalfDayCompletionMinutes?: number;
}
export type RefinedAttendanceOutcome = 'FULL_DAY' | 'HALF_DAY' | 'SHORT_DAY';

/** 1:00 PM. Arriving at or after it is a half day whatever the hours. */
export const DEFAULT_HALF_DAY_ARRIVAL_MINUTES = 13 * 60;

/**
 * The confirmed attendance rule, in order:
 *
 *   presence >= 9h (first punch-in to final punch-out, breaks included)  FULL_DAY
 *   presence <= 5h,   or in at/after 1:00 PM, or out at/before 4:00 PM   HALF_DAY
 *   anything else under 9h                                              SHORT_DAY
 *
 * A full nine hours is never a half day, even if it started after 1:00 PM.
 */
export function classifyRefinedAttendance(input: RefinedAttendanceInput): RefinedAttendanceOutcome {
  const required = input.requiredMinutes ?? 540;
  if (input.presenceMinutes >= required) return 'FULL_DAY';

  const halfDayMaximum = input.halfDayMaximumMinutes ?? 300;
  const lateArrival = input.halfDayArrivalMinutes ?? DEFAULT_HALF_DAY_ARRIVAL_MINUTES;
  const earlyCheckout = input.earlyCheckoutBoundaryMinutes ?? 960;
  if (
    input.presenceMinutes <= halfDayMaximum ||
    (input.punchInMinutes !== null && input.punchInMinutes >= lateArrival) ||
    (input.punchOutMinutes !== null && input.punchOutMinutes <= earlyCheckout)
  ) {
    return 'HALF_DAY';
  }
  return 'SHORT_DAY';
}
