import { api } from '@apex/shared-auth';

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
  const res = await api.get('/attendance/daily/today');
  return res.data;
}

export async function getMyAttendanceRange(
  from: string,
  to: string,
): Promise<{ from: string; to: string; days: AttendanceDay[] }> {
  const res = await api.get('/attendance/daily', { params: { from, to } });
  return res.data;
}
