import { api, unwrap as r } from '@apex/shared-auth';

/**
 * My Attendance V2 transport.
 *
 * Read-only, and every route is scoped server-side to the authenticated
 * employee, so nothing here takes a user id.
 *
 * The types mirror the backend contract in
 * backend/src/modules/platform/attendance/v2/my-attendance-v2.contract.ts.
 * They are deliberately a copy rather than a shared package: the backend owns
 * the contract, and a drifting copy fails loudly at the type level instead of
 * silently rendering a field the server stopped sending.
 *
 * NOTE ON NULLS. Every figure is `number | null`, and null means "cannot be
 * measured" — never zero. The UI must branch on it. See `unavailable[]` for
 * which fields the backend knows it cannot answer, and why.
 */

export type AttendanceOutcome =
  | 'PRESENT'
  | 'HALF_DAY'
  | 'ABSENT'
  | 'LEAVE'
  | 'LWP'
  | 'HOLIDAY'
  | 'WEEKLY_OFF'
  | 'EXEMPT'
  | 'IN_PROGRESS'
  | 'UNRESOLVED';

export type AttendanceModifier =
  | 'LATE'
  | 'LATE_EXEMPTED'
  | 'INSUFFICIENT_PRESENCE'
  | 'INSUFFICIENT_EFFECTIVE_WORK'
  | 'BREAK_EXCEEDS_ALLOWANCE'
  | 'AUTO_CLOSED'
  | 'REGULARIZED'
  | 'WORKED_ON_HOLIDAY'
  | 'WORKED_ON_WEEKLY_OFF';

export type AttendanceExceptionCode =
  | 'MISSING_IN'
  | 'MISSING_OUT'
  | 'LOCATION_EXCEPTION'
  | 'PHOTO_EXCEPTION'
  | 'EVIDENCE_CONFLICT'
  | 'LEAVE_WORK_CONFLICT'
  | 'CALENDAR_UNRESOLVED'
  | 'POLICY_UNRESOLVED';

export type EvaluationStateV2 = 'CALCULATED' | 'NEEDS_REVIEW' | 'FINALIZED';

export type BannerTone = 'INFO' | 'ATTENTION' | 'NEUTRAL' | 'POSITIVE';

export interface UnavailableField {
  field: string;
  reason: string;
}

export interface MyAttendanceDayV2 {
  date: string;
  outcome: AttendanceOutcome | null;
  modifiers: AttendanceModifier[];
  exceptions: AttendanceExceptionCode[];
  evaluationState: EvaluationStateV2 | null;

  isApplicable: boolean;
  isToday: boolean;
  isFuture: boolean;
  isInProgress: boolean;

  presenceMinutes: number | null;
  requiredMinutes: number | null;
  workedMinutes: number | null;
  breakMinutes: number | null;
  lateMinutes: number | null;

  punchInAt: string | null;
  punchOutAt: string | null;

  leaveDeducted: number | null;
  lwpDeducted: number | null;

  reason: string | null;
  explanation: string | null;

  sourceStatus: string | null;
  sourceFlags: string[];
  unmappedSourceFlags: string[];

  unavailable: UnavailableField[];
}

export interface MyAttendanceTodayV2 extends MyAttendanceDayV2 {
  /**
   * Presence still owed against the presence requirement — derived from
   * `presenceMinutes`, never from `workedMinutes`. The two are different
   * measures and the field is named for the one it carries.
   */
  presenceRemainingMinutes: number | null;
  /** Presence against the presence requirement, as a percentage. */
  presenceProgressPercent: number | null;
  firstPunchAt: string | null;
  lastPunchAt: string | null;
  correctionAllowed: boolean;
  finalStatusAvailable: boolean;
  banner: { tone: BannerTone; title: string; detail: string } | null;
}

export interface MyAttendanceOverviewV2 {
  today: MyAttendanceTodayV2;
  month: { year: number; month: number; days: MyAttendanceDayV2[] };
}

export async function getMyAttendanceV2(month: string): Promise<MyAttendanceOverviewV2> {
  return r(api.get('/attendance/me/v2', { params: { month } }));
}

export async function getMyAttendanceDayV2(date: string): Promise<MyAttendanceDayV2> {
  return r(api.get(`/attendance/me/v2/${date}`));
}
