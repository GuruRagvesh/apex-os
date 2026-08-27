import { AttendanceCategory } from '@prisma/client';
import {
  AttendanceCoverageReason,
  AttendanceCoverageState,
  AttendanceProfileFacts,
  EmploymentFacts,
} from '../timeline/employee-timeline.types';

/**
 * Legacy compatibility: employees who predate the employment timeline.
 *
 * users.joiningDate is nullable and was never populated for staff who existed
 * before Attendance. The production bootstrap does not set it either -- only
 * the staging E2E bootstrap does, which is why staging never surfaced this and
 * production did, immediately, for all 36 employees.
 *
 * Without a joining date the timeline correctly answers NOT_EMPLOYED, which
 * blocks every punch. The alternative fixes are both worse than this one:
 * writing invented joining dates corrupts HR master data, and inferring one
 * from createdAt or a first WorkSession invents employment history that would
 * then be used to evaluate past days.
 *
 * So for ATTENDANCE ONLY, an employee with no joining date is treated as
 * attendance-applicable from their EmployeeAttendanceProfile's effectiveFrom
 * onward -- the date the company actually began tracking their attendance,
 * which is a real fact rather than a guessed one. No historical day becomes
 * applicable, because no profile covers those dates.
 *
 * This lives in the attendance context layer on purpose. EmployeeTimelineService
 * is also consumed by comp-off.service and leave-working-day.service, and
 * relaxing employment there would silently change leave semantics too.
 *
 * Four properties are load-bearing:
 *
 *  1. An explicit joiningDate always wins. This never runs when one exists, so
 *     a future joining date still means NOT_EMPLOYED even with a profile.
 *  2. lastWorkingDate still terminates employment. employmentOn() returns
 *     NO_JOINING_DATE *before* it ever looks at lastWorkingDate, so a leaver
 *     with no joining date reaches here looking identical to an active
 *     employee. That is checked explicitly below; missing it would make
 *     terminated staff punchable.
 *  3. No profile means fail closed. An unconfigured employee stays
 *     NOT_EMPLOYED rather than becoming silently attendance-applicable.
 *  4. The profile's own content still decides EXEMPT vs COVERED, using the
 *     same rules the timeline applies, rather than a second interpretation.
 */

export interface LegacyCoverageInput {
  coverage: AttendanceCoverageState;
  coverageReason: AttendanceCoverageReason;
  employment: EmploymentFacts;
  profile: AttendanceProfileFacts | null;
  /** Company business date, 'yyyy-MM-dd'. */
  businessDate: string;
}

export interface LegacyCoverageResult {
  coverage: AttendanceCoverageState;
  coverageReason: AttendanceCoverageReason;
  /** True when the fallback changed the answer, for reporting and tests. */
  legacyFallbackApplied: boolean;
}

/**
 * Applies the legacy fallback to an already-resolved coverage answer.
 *
 * Returns the input unchanged in every case except the one it exists for, so
 * it is safe to call unconditionally.
 */
export function applyLegacyEmploymentFallback(
  input: LegacyCoverageInput,
): LegacyCoverageResult {
  const { coverage, coverageReason, employment, profile, businessDate } = input;

  const unchanged: LegacyCoverageResult = {
    coverage,
    coverageReason,
    legacyFallbackApplied: false,
  };

  // Only the missing-joining-date case. BEFORE_JOINING, AFTER_LAST_WORKING_DATE
  // and USER_NOT_FOUND are real answers about a known employee and are kept.
  if (coverage !== 'NOT_EMPLOYED' || employment.reason !== 'NO_JOINING_DATE') {
    return unchanged;
  }

  // Fail closed: no profile in force means nobody has configured this employee
  // for this date, which is a gap to surface rather than an employment fact.
  if (!profile) return unchanged;

  // A leaver reaches here indistinguishable from an active employee, because
  // employmentOn() returns NO_JOINING_DATE before reading lastWorkingDate.
  // Both are business dates in 'yyyy-MM-dd', so string comparison is exact and
  // timezone-free -- the same comparison the timeline itself uses.
  if (employment.lastWorkingDate && businessDate > employment.lastWorkingDate) {
    return unchanged;
  }

  // The profile is in force on this date, so effectiveFrom <= businessDate is
  // already established by the query that found it. Its content decides the
  // rest, by the same rules the timeline would have applied had employment
  // resolved normally.
  if (profile.category === AttendanceCategory.MANAGEMENT_EXEMPT) {
    return {
      coverage: 'EXEMPT',
      coverageReason: 'MANAGEMENT_EXEMPT_CATEGORY',
      legacyFallbackApplied: true,
    };
  }
  if (!profile.attendanceRequired) {
    return {
      coverage: 'EXEMPT',
      coverageReason: 'ATTENDANCE_NOT_REQUIRED',
      legacyFallbackApplied: true,
    };
  }
  return { coverage: 'COVERED', coverageReason: 'COVERED', legacyFallbackApplied: true };
}
