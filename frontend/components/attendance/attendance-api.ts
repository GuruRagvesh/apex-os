import { api, unwrap as r } from '@apex/shared-auth';

/**
 * Employee daily attendance transport (AE-1).
 *
 * Read-only. Every route is scoped server-side to the authenticated employee,
 * so nothing here takes a user id.
 */

export type AttendanceStatus =
  | 'PRESENT'
  | 'LATE'
  | 'LATE_EXEMPTED'
  | 'LEAVE'
  | 'HALF_DAY'
  | 'WEEKLY_OFF'
  | 'HOLIDAY'
  | 'LWP'
  | 'ABSENT'
  | 'MISSING_PUNCH'
  | 'PENDING_REGULARIZATION'
  | 'GEO_MISMATCH'
  | 'FACE_MISSING';

export type EvaluationState = 'CALCULATED' | 'NEEDS_REVIEW' | 'FINALIZED';

export interface AttendanceDay {
  businessDate: string;
  official: boolean;
  status: AttendanceStatus | null;
  evaluationState: EvaluationState;
  reason: string;
  exceptions: string[];
  requiresReview: boolean;

  punchInAt: string | null;
  punchOutAt: string | null;
  workedMinutes: number;
  /**
   * The requirement the evaluator resolved for this day, the presence it
   * measured, and its verdict. Decided server-side, beside the shortfall
   * exception that uses the same comparison.
   *
   * RENDERED, NEVER RECOMPUTED. The UI used to hold its own 540 and judge the
   * day itself, which is an official attendance decision taken in a browser.
   * Null means the server could not answer: an unfinished day, or one that is
   * not an attendance situation at all.
   */
  requiredPresenceMinutes: number | null;
  presenceMinutes: number | null;
  meetsRequirement: boolean | null;
  breakMinutes: number;
  lateMinutes: number;

  isHoliday: boolean;
  isWeeklyOff: boolean;
  isLeave: boolean;
  leaveDeducted: number;
  lwpDeducted: number;

  locationException: string | null;
  photoCaptured: boolean;
}

export async function getMyAttendanceToday(): Promise<AttendanceDay> {
  return r(api.get('/attendance/daily/today'));
}

export async function getMyAttendanceRange(
  from: string,
  to: string,
): Promise<{ from: string; to: string; days: AttendanceDay[] }> {
  return r(api.get('/attendance/daily', { params: { from, to } }));
}
