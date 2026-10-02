import { api, unwrap as r } from '@apex/shared-auth';
import type { AttendanceStatus, EvaluationState } from './attendance-api';

/**
 * Transport for the employee Attendance dashboard's ONE composed read.
 *
 * GET /attendance/employee/me/summary answers for the authenticated employee;
 * GET /attendance/employee/:id/summary answers for somebody else and is
 * refused by the server unless the viewer may see that person. THE SERVER
 * DECIDES THAT, not this file and not the route that renders it -- passing an
 * id here is a request, never a grant.
 *
 * Every figure below was computed server-side. Nothing here recalculates a
 * balance, a classification or a required-hours rule; see
 * employee-summary-presentation.ts for what the screen is allowed to do with
 * these numbers, which is format and label them.
 */

export interface SummaryEmployee {
  id: string;
  name: string;
  employeeId: string | null;
  designation: string | null;
  department: { id: string; name: string } | null;
  isActive: boolean;
  /** yyyy-MM-dd, or null when master data has no joining date on record. */
  joiningDate: string | null;
  lastWorkingDate: string | null;
  employmentCategory: 'MANAGEMENT_EXEMPT' | 'TEAM_LEADER' | 'REGULAR_EMPLOYEE' | null;
  tenure: { years: number; months: number; known: boolean };
}

export interface SummaryCounts {
  present: number;
  late: number;
  halfDay: number;
  fullDay: number;
  approvedLeaveDays: number;
  missingPunchIn: number;
  missingPunchOut: number;
  requiredHoursShortfall: number;
  needsReview: number;
  absent: number;
  noRecord: number;
  notApplicable: number;
}

export interface SummaryMetrics {
  averagePunchInMinutes: number | null;
  averagePunchOutMinutes: number | null;
  averageOfficePresenceMinutes: number | null;
  averageEffectiveWorkMinutes: number | null;
  averageBreakMinutes: number | null;
  sampleSize: number;
}

export interface SummaryDay {
  businessDate: string;
  status: AttendanceStatus | null;
  evaluationState: EvaluationState | null;
  punchInAt: string | null;
  punchOutAt: string | null;
  /** Punch out minus punch in. Breaks are NOT subtracted from this. */
  officePresenceMinutes: number | null;
  /** Workday's own effective-work figure. A different measure; never mixed. */
  workedMinutes: number;
  breakMinutes: number;
  locked: boolean;
  /**
   * The day was never an attendance day for this person -- exempt category,
   * before joining, after leaving. Distinct from a missing record, which is a
   * gap; this is not.
   */
  notApplicable: boolean;
}

export interface SummaryToday {
  businessDate: string;
  completion: {
    /** Minutes since company midnight, or null with a reason below. */
    expectedCompletionMinutes: number | null;
    unresolvedReason: 'NO_PUNCH_IN' | 'NO_ARRIVAL_POLICY' | 'NO_REQUIRED_PRESENCE' | null;
  };
}

export interface SummaryNeedsAttention {
  missingPunchIn: number;
  missingPunchOut: number;
  needsReview: number;
  noRecord: number;
  pendingRegularizations: number;
  missingJoiningDate: boolean;
  requiredPresenceUnconfigured: boolean;
}

export interface EmployeeAttendanceSummary {
  employee: SummaryEmployee;
  /** yyyy-MM, echoed back by the server -- the month it actually answered for. */
  month: string;
  requiredPresenceMinutes: number | null;
  counts: SummaryCounts;
  metrics: SummaryMetrics;
  days: SummaryDay[];
  today: SummaryToday;
  needsAttention: SummaryNeedsAttention;
}

export async function getMyAttendanceSummary(month?: string): Promise<EmployeeAttendanceSummary> {
  return r(api.get('/attendance/employee/me/summary', { params: month ? { month } : {} }));
}

export async function getEmployeeAttendanceSummary(
  employeeId: string,
  month?: string,
): Promise<EmployeeAttendanceSummary> {
  return r(
    api.get(`/attendance/employee/${employeeId}/summary`, { params: month ? { month } : {} }),
  );
}
