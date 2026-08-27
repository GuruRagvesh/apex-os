import { AttendanceCategory } from '@prisma/client';
import { BusinessDayFacts } from '../calendar/business-calendar.types';
import {
  AttendanceCoverageReason,
  AttendanceCoverageState,
  EmploymentFacts,
} from '../timeline/employee-timeline.types';

/**
 * Daily Attendance Context (Attendance Base Layer, BL-5).
 *
 * The integrity gate. Combines company time, the business calendar, the
 * employee timeline and the versioned policies into one deterministic answer to:
 *
 *     "Exactly which rules applied to this person on this business date?"
 *
 * It still does NOT look at punches, WorkSessions, breaks, or approved leave
 * instances, and it never decides Present/Absent/Half Day. It decides only
 * whether the foundation can explain the day well enough for a later engine to
 * be ALLOWED to finalize it.
 *
 * The governing rule:
 *
 *     If the foundation cannot explain exactly which rules apply to a person on
 *     a date, the attendance engine is not allowed to finalize that date.
 *
 * So every failure is explicit and blocking, never a guessed default.
 */

/** Bumped whenever the resolution logic changes in a way that could alter output. */
export const DAILY_CONTEXT_RESOLVER_VERSION = 1;

/**
 * Why a date cannot be finalized. Empty means the foundation is complete.
 *
 * NO_PROFILE_FOR_DATE and the three MISSING_* reasons are configuration gaps:
 * an employee is covered by attendance but the system cannot say under which
 * rules. Guessing a default here is exactly how a configuration mistake becomes
 * a payroll mistake, so it is refused instead.
 */
/**
 * Whether attendance applies to this employee on this date.
 *
 * Deliberately separate from contextResolved. A single "finalizable" boolean
 * conflated two different questions -- "there is nothing to attend" and "we
 * cannot tell what applies" -- and that ambiguity is precisely how a
 * configuration mistake becomes a payroll mistake.
 *
 *   REQUIRED      resolved, employed, covered, fully configured
 *   EXEMPT        resolved; deliberately outside attendance tracking
 *   NOT_EMPLOYED  resolved; outside the employment window
 *   BLOCKED       NOT resolved; the foundation cannot explain the day
 *
 * BLOCKED is the only value that permits no attendance outcome at all.
 */
export type AttendanceApplicability =
  | 'REQUIRED'
  | 'EXEMPT'
  | 'NOT_EMPLOYED'
  | 'BLOCKED';

export type ContextBlockingReason =
  | 'NO_PROFILE_FOR_DATE'
  | 'MISSING_SHIFT_ASSIGNMENT'
  | 'MISSING_SHIFT_POLICY'
  | 'MISSING_ATTENDANCE_POLICY'
  // Calendar sources. AMBIGUOUS_* is the important pair: with several active
  // candidates and no assignment, choosing one arbitrarily would silently put
  // an employee on the wrong holiday or weekly-off calendar.
  | 'MISSING_HOLIDAY_CALENDAR'
  | 'AMBIGUOUS_HOLIDAY_CALENDAR'
  | 'MISSING_WEEKLY_OFF_POLICY'
  | 'AMBIGUOUS_WEEKLY_OFF_POLICY';

export interface ShiftContext {
  policyId: string;
  policyKey: string;
  version: number;
  name: string;
  category: AttendanceCategory;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  minimumWorkingMinutes: number;
}

export interface AttendancePolicyContext {
  policyId: string;
  policyKey: string;
  version: number;
  /**
   * Required PRESENCE SPAN in minutes, despite the column's historical name.
   * The accompanying shift window (10:00-19:00) is exactly this long, which is
   * only achievable with breaks inside the span -- so it was never an
   * effective-work threshold. See permittedBreakMinutes below.
   */
  minimumWorkingMinutes: number;
  /** Break time the span may contain. */
  permittedBreakMinutes: number;
  /** Effective-work floor, checked only when explicitly configured. */
  minimumEffectiveWorkMinutes: number | null;
  lateExemptionEnabled: boolean;
  regularizationEnabled: boolean;
  /** Whether the governing policy enforces geofencing (PE-2). */
  geoFenceEnabled: boolean;
  afterPunchWindowAction: string;
  insufficientHoursAction: string;
  automaticHalfDayEnabled: boolean;
}

/**
 * Reference only. BL-5 records WHICH leave policy applied; it never reads leave
 * requests or computes balances.
 */
export interface LeavePolicyContext {
  policyId: string;
  policyKey: string;
  version: number;
  firstHalfInEarliest: string;
  firstHalfInLatest: string;
  firstHalfRequiredPresenceMinutes: number;
  secondHalfInEarliest: string;
  secondHalfInLatest: string;
  secondHalfOutTime: string;
  compOffExpiryDays: number;
}

export interface ProfileContext {
  profileId: string;
  category: AttendanceCategory;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * Every source id and version behind this answer.
 *
 * Retained so a historical attendance result can be re-explained years later
 * with the exact calendar and policy versions that produced it, even after
 * everything has been superseded.
 */
export interface DailyContextSources {
  /** What the employee's profile named, or null if it named nothing. */
  assignedHolidayCalendarId: string | null;
  assignedWeeklyOffPolicyId: string | null;
  /** The attendance location assigned for geofencing (PE-2). */
  assignedAttendanceLocationId: string | null;
  /** What was actually used, and how it was chosen. */
  resolvedHolidayCalendarId: string | null;
  resolvedWeeklyOffPolicyId: string | null;
  holidayCalendarResolution: string;
  weeklyOffPolicyResolution: string;

  weeklyOffPolicyId: string | null;
  holidayCalendarId: string | null;
  holidayId: string | null;
  businessDayOverrideId: string | null;
  employeeProfileId: string | null;
  shiftPolicyId: string | null;
  shiftPolicyVersion: number | null;
  attendancePolicyId: string | null;
  attendancePolicyVersion: number | null;
  leavePolicyId: string | null;
  leavePolicyVersion: number | null;
}

export interface DailyAttendanceContext {
  employeeId: string;
  businessDate: string;

  employment: EmploymentFacts;

  coverage: AttendanceCoverageState;
  coverageReason: AttendanceCoverageReason;

  /**
   * True when coverage came from the legacy no-joining-date fallback rather
   * than from a real employment window. Surfaced so the state is auditable:
   * an employee running on the fallback is one whose HR joining date is still
   * missing, and that should be visible rather than silently equivalent.
   */
  legacyEmploymentFallbackApplied: boolean;

  /** Company-level calendar facts. See BL-2A. */
  calendar: BusinessDayFacts;

  profile: ProfileContext | null;
  shift: ShiftContext | null;
  attendancePolicy: AttendancePolicyContext | null;
  leavePolicy: LeavePolicyContext | null;

  /**
   * Could the foundation explain this day at all? False whenever
   * blockingReasons is non-empty. A later engine may only finalize a date whose
   * context resolved.
   */
  contextResolved: boolean;

  /** Given a resolved context, does attendance apply to this person that day? */
  attendanceApplicability: AttendanceApplicability;

  requiresHrReview: boolean;
  blockingReasons: ContextBlockingReason[];

  sources: DailyContextSources;
  resolverVersion: number;
  /** ISO instant this context was computed. */
  resolvedAt: string;
}
