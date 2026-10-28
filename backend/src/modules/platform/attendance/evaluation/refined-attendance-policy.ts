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
export type RefinedAttendanceOutcome = 'FULL_DAY' | 'SHORT_DAY';

/** Pure, effective-policy-friendly classification from Policies_Refined.docx. */
export function classifyRefinedAttendance(input: RefinedAttendanceInput): RefinedAttendanceOutcome {
  const required = input.requiredMinutes ?? 540;
  if (input.presenceMinutes >= required) return 'FULL_DAY';
  return 'SHORT_DAY';
}
