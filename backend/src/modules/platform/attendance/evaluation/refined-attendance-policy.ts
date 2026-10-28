export interface RefinedAttendanceInput {
  /** Punch-out minus punch-in. The nine-hour rule includes permitted breaks. */
  presenceMinutes: number;
  punchInMinutes: number | null;
  punchOutMinutes: number | null;
  requiredMinutes?: number;
  halfDayMaximumMinutes?: number;
  lateArrivalBoundaryMinutes?: number;
  fullHalfDayCompletionMinutes?: number;
  earlyCheckoutBoundaryMinutes?: number;
}
export type RefinedAttendanceOutcome = 'FULL_DAY' | 'HALF_DAY' | 'SHORT_DAY';

/** Pure, effective-policy-friendly classification from Policies_Refined.docx. */
export function classifyRefinedAttendance(input: RefinedAttendanceInput): RefinedAttendanceOutcome {
  const required = input.requiredMinutes ?? 540;
  const halfDayMax = input.halfDayMaximumMinutes ?? 270;
  const earlyCheckout = input.earlyCheckoutBoundaryMinutes ?? 16 * 60;

  if (input.presenceMinutes >= required) return 'FULL_DAY';
  if (input.presenceMinutes <= halfDayMax) return 'HALF_DAY';
  if (input.punchOutMinutes !== null && input.punchOutMinutes <= earlyCheckout) return 'HALF_DAY';
  return 'SHORT_DAY';
}
