import { AttendanceCategory } from '@prisma/client';

/**
 * Employee Attendance Timeline contract (Attendance Base Layer, BL-3).
 *
 * Answers exactly one question:
 *
 *     "Who was this employee, for attendance purposes, on this business date?"
 *
 * Not who they are today. A promotion on 1 July must not retroactively make
 * June look like Team Leader time, so every lookup is point-in-time and every
 * answer carries the id and effective window of the record that produced it.
 *
 * Nothing here reads WorkSession, BreakLog, LeaveRequest or DailyAttendance,
 * and nothing here decides an attendance status.
 */

/**
 * Whether this employee is subject to attendance tracking on a business date.
 *
 * Deliberately NOT a boolean. A boolean forces "no configuration" and
 * "configured as exempt" to share the value false, which would let a missing
 * EmployeeAttendanceProfile silently grant an exemption — the employee simply
 * disappears from attendance with no signal that anything is wrong.
 * UNRESOLVED keeps that case loud and separate.
 */
export type AttendanceCoverageState =
  | 'COVERED'
  | 'EXEMPT'
  | 'UNRESOLVED'
  | 'NOT_EMPLOYED';

/** Machine-readable justification for the coverage state. */
export type AttendanceCoverageReason =
  // NOT_EMPLOYED
  | 'BEFORE_JOINING'
  | 'AFTER_LAST_WORKING_DATE'
  | 'NO_JOINING_DATE'
  | 'USER_NOT_FOUND'
  // UNRESOLVED — configuration gap, never an exemption
  | 'NO_PROFILE_FOR_DATE'
  // EXEMPT — configured, deliberate
  | 'MANAGEMENT_EXEMPT_CATEGORY'
  | 'ATTENDANCE_NOT_REQUIRED'
  // COVERED
  | 'COVERED';

export interface EmploymentFacts {
  /**
   * True between joiningDate and lastWorkingDate, both INCLUSIVE.
   * An employee is still employed on their last working day.
   */
  employedOnDate: boolean;
  joiningDate: string | null;
  lastWorkingDate: string | null;
  reason:
    | 'EMPLOYED'
    | 'BEFORE_JOINING'
    | 'AFTER_LAST_WORKING_DATE'
    | 'NO_JOINING_DATE'
    | 'USER_NOT_FOUND';
}

export interface AttendanceProfileFacts {
  profileId: string;
  category: AttendanceCategory;
  attendanceRequired: boolean;
  assignedShiftId: string | null;
  assignedLeavePolicyId: string | null;
  assignedHolidayCalendarId: string | null;
  assignedWeeklyOffPolicyId: string | null;
  reportingManagerId: string | null;
  hrReviewerId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface EmployeeTimelineFacts {
  userId: string;
  /** Company business date, 'yyyy-MM-dd', resolved through TVAService. */
  businessDate: string;

  employment: EmploymentFacts;

  /** The profile in force on this date, or null if none covers it. */
  profile: AttendanceProfileFacts | null;

  /**
   * Employee-level coverage only. Whether the COMPANY expects work that day is
   * the business calendar's answer (BL-2A); combining the two is the daily
   * context resolver's job (BL-5).
   */
  coverage: AttendanceCoverageState;
  coverageReason: AttendanceCoverageReason;

  sources: {
    profileId: string | null;
    assignedShiftId: string | null;
    assignedLeavePolicyId: string | null;
    assignedHolidayCalendarId: string | null;
    assignedWeeklyOffPolicyId: string | null;
  };
}

/** Raised when a write would leave two profiles covering the same date. */
export class OverlappingProfileError extends Error {
  constructor(userId: string, conflictingProfileId: string) {
    super(
      `Employee ${userId} already has an attendance profile (${conflictingProfileId}) ` +
        `covering part of the requested effective window`,
    );
    this.name = 'OverlappingProfileError';
  }
}
