import type { DailyAttendanceStatus, LeaveType } from '@prisma/client';

/**
 * Daily attendance evaluation contract (AE-1).
 *
 * The evaluator turns resolved context, approved leave and immutable punch
 * evidence into the ONE official answer to "what is my attendance for this
 * date?". Two ideas run through the whole file and are worth stating once:
 *
 *  1. Classification and trust are separate. `status` says what happened;
 *     `evaluationState` says whether a human still needs to look. A full day
 *     worked from the wrong location is PRESENT with an exception, not absent.
 *
 *  2. Nothing payroll-affecting is ever manufactured. Where policy has not
 *     decided, the result is NEEDS_REVIEW — never ABSENT, LWP, HALF_DAY or a
 *     leave deduction.
 */

/** Bumped whenever the evaluation rules change, so old rows stay explainable. */
export const EVALUATOR_VERSION = 1;

export type LeaveDayKind =
  | 'NONE'
  | 'PAID'
  | 'UNPAID'
  | 'HALF_DAY_PAID'
  | 'HALF_DAY_UNPAID'
  /**
   * LH-2: approved, but funded partly paid and partly unpaid. The model records
   * totals for the whole request, not which individual dates were unpaid, so a
   * per-date paid/unpaid answer cannot be proven here.
   */
  | 'PARTIALLY_FUNDED'
  /** More than one approved leave covers the date. A human must settle it. */
  | 'AMBIGUOUS';

export interface LeaveDayFacts {
  hasApprovedLeave: boolean;
  kind: LeaveDayKind;
  leaveRequestId: string | null;
  leaveType?: LeaveType;
  halfDayType?: string | null;
}

/**
 * Factual exceptions attached to a result.
 *
 * These are observations, not verdicts. Each one explains why a day may need
 * review; none of them decides pay.
 */
export type AttendanceExceptionFlag =
  // Evidence gaps
  | 'MISSING_PUNCH'
  | 'MISSING_PUNCH_OUT'
  | 'NO_ATTENDANCE_EVIDENCE'
  | 'WORKDAY_STILL_OPEN'
  // Location and photo (PE-2 / PE-3)
  | 'LOCATION_OUTSIDE_GEOFENCE'
  | 'LOCATION_LOW_ACCURACY'
  | 'LOCATION_UNAVAILABLE'
  | 'PHOTO_MISSING'
  // Policy questions management has not answered yet
  | 'LATE_BEYOND_PUNCH_WINDOW'
  // Three distinct duration questions. Collapsing them into one was the bug:
  // an ordinary lunch break made effective work look like a short day.
  | 'INSUFFICIENT_PRESENCE_SPAN'
  | 'BREAK_EXCEEDS_ALLOWANCE'
  | 'INSUFFICIENT_EFFECTIVE_WORK'
  // Data problems
  | 'AMBIGUOUS_APPROVED_LEAVE'
  | 'LEAVE_ON_NON_WORKING_DAY'
  | 'PARTIALLY_FUNDED_LEAVE'
  // AR-1. Informational, NOT a reason to review: an approved correction is a
  // decision that has already been made, not an open question.
  | 'CORRECTED_BY_REGULARIZATION';

/**
 * Flags that explain a result without demanding a human look at it again.
 *
 * Everything else in AttendanceExceptionFlag routes the day to NEEDS_REVIEW, so
 * this list is what stops an approved correction from re-opening the very day
 * it just settled.
 */
export const NON_REVIEW_FLAGS: AttendanceExceptionFlag[] = ['CORRECTED_BY_REGULARIZATION'];

/** Machine-readable summary of how the status was reached. */
export type AttendanceCalculationReason =
  | 'COMPANY_CLOSURE'
  | 'HOLIDAY'
  | 'WEEKLY_OFF'
  | 'SPECIAL_WORKING_DAY_WORKED'
  | 'APPROVED_PAID_LEAVE'
  | 'APPROVED_UNPAID_LEAVE'
  | 'APPROVED_HALF_DAY_LEAVE'
  | 'APPROVED_PARTIALLY_FUNDED_LEAVE'
  | 'COMPLETE_WORKDAY'
  | 'WORKDAY_IN_PROGRESS'
  | 'NO_EVIDENCE_ON_WORKING_DAY'
  | 'INCOMPLETE_PUNCH_PAIR'
  | 'POLICY_DECISION_DEFERRED'
  | 'CORRECTED_WORKDAY'
  | 'AMBIGUOUS_LEAVE'
  // Non-classifications: attendance simply does not apply.
  | 'NOT_APPLICABLE_EXEMPT'
  | 'NOT_APPLICABLE_NOT_EMPLOYED'
  | 'CONTEXT_BLOCKED';

export type EvaluationState = 'CALCULATED' | 'NEEDS_REVIEW' | 'FINALIZED';

/** Provenance: everything needed to re-explain this result years from now. */
export interface EvaluationProvenance {
  resolverVersion: number;
  evaluatorVersion: number;
  employeeProfileId: string | null;
  attendancePolicyId: string | null;
  attendancePolicyVersion: number | null;
  shiftPolicyId: string | null;
  shiftPolicyVersion: number | null;
  holidayCalendarId: string | null;
  weeklyOffPolicyId: string | null;
  holidayId: string | null;
  businessDayOverrideId: string | null;
  leaveRequestId: string | null;
  punchInEvidenceId: string | null;
  punchOutEvidenceId: string | null;
  workSessionIds: string[];
}

/**
 * The evaluator's answer.
 *
 * `official: false` means attendance does not apply to this person on this date
 * (exempt, not employed) or the foundation could not resolve the day at all.
 * Nothing is written and nothing is classified in that case — a configuration
 * gap must never silently become an attendance outcome.
 */
export interface DailyAttendanceResult {
  employeeId: string;
  businessDate: string;

  official: boolean;
  status: DailyAttendanceStatus | null;
  evaluationState: EvaluationState;
  calculationReason: AttendanceCalculationReason;
  exceptionFlags: AttendanceExceptionFlag[];

  punchInAt: Date | null;
  punchOutAt: Date | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;

  /**
   * Leave consumed by this result. AE-1 never writes a balance; these are
   * recorded so a later payroll wave has an auditable number to work from.
   */
  leaveDeducted: number;
  lwpDeducted: number;

  requiresReview: boolean;
  provenance: EvaluationProvenance;
  /** Digest of the source facts, used to make re-evaluation idempotent. */
  sourceFingerprint: string;
  evaluatedAt: Date;
}
