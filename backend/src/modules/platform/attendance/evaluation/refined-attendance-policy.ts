export interface RefinedAttendanceInput {
  workedMinutes: number;
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
  const lateBoundary = input.lateArrivalBoundaryMinutes ?? 13 * 60;
  const halfDayCompletion = input.fullHalfDayCompletionMinutes ?? 18 * 60 + 30;
  const earlyCheckout = input.earlyCheckoutBoundaryMinutes ?? 16 * 60;

  if (input.workedMinutes >= required) return 'FULL_DAY';
  if (input.workedMinutes <= halfDayMax) return 'HALF_DAY';
  if (input.punchInMinutes !== null && input.punchInMinutes >= lateBoundary) {
    return input.punchOutMinutes !== null && input.punchOutMinutes >= halfDayCompletion
      ? 'HALF_DAY'
      : 'SHORT_DAY';
  }
  if (input.punchOutMinutes !== null && input.punchOutMinutes <= earlyCheckout) return 'HALF_DAY';
  return 'SHORT_DAY';
}

