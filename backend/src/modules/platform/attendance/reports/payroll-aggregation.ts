import { PunchSource } from '@prisma/client';

/**
 * Monthly attendance facts for payroll.
 *
 * Pure: given rows, produce rows. No Prisma, no I/O, no dates fetched from a
 * clock — so the arithmetic that will decide people's salaries is testable
 * without a database.
 *
 * IT DOES NOT CALCULATE PAY. Attendance supplies facts; Finance applies the
 * company's payroll rules to them. A deduction computed here would be an
 * attendance module quietly making a compensation decision, and the two need to
 * stay separable when a rule changes.
 *
 * Unresolved days are counted and reported rather than folded into "present" or
 * "absent". A day nobody has judged is not evidence for either, and rounding it
 * silently in one direction is how an unreviewed exception becomes a pay cut.
 */

export type PunchSourceLabel = 'Web' | 'Phone' | 'Manual' | '—';

/** How the punch was captured, in words Finance can read. */
export function sourceLabel(source: PunchSource | string | null | undefined): PunchSourceLabel {
  switch (source) {
    case 'WEB':
    case 'PWA':
      return 'Web';
    case 'MOBILE':
      return 'Phone';
    case 'MANUAL_APPROVED':
      return 'Manual';
    default:
      return '—';
  }
}

export interface DayFacts {
  userId: string;
  /** yyyy-MM-dd */
  date: string;
  status: string;
  evaluationState: string;
  punchInAt: string | null;
  punchOutAt: string | null;
  punchInSource: PunchSource | string | null;
  punchOutSource: PunchSource | string | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  leaveDeducted: number;
  lwpDeducted: number;
  /** Leave type when the day was covered by approved leave. */
  leaveType: string | null;
  exceptionFlags: string[];
  /** Set when a correction produced this result. */
  regularizationId: string | null;
  /** True when that correction was an outage recovery rather than a request. */
  viaManualRecovery: boolean;
  /** First session start and last session end, for the Workday span column. */
  sessionSpanMinutes: number | null;
}

export interface EmployeeMeta {
  id: string;
  employeeId: string | null;
  name: string;
  department: string | null;
}

export interface PayrollSummaryRow {
  employeeId: string;
  name: string;
  department: string;
  workingDays: number;
  present: number;
  absent: number;
  casualLeave: number;
  emergencyLeave: number;
  compOff: number;
  halfDays: number;
  holidays: number;
  weeklyOffs: number;
  lateDays: number;
  needsReview: number;
  manualRecoveryDays: number;
  regularizedDays: number;
  unresolvedDays: number;
}

const PRESENT_STATUSES = new Set(['PRESENT', 'LATE', 'LATE_EXEMPTED']);
const NON_WORKING_STATUSES = new Set(['WEEKLY_OFF', 'HOLIDAY']);

/**
 * Attendance presence in minutes: punch out minus punch in, or null.
 *
 * The single invariant this whole module exists to preserve. Workday span and
 * worked minutes are reported alongside as separate columns and are NEVER
 * substituted here, because only presence is measured against the requirement.
 */
export function presenceMinutes(day: DayFacts): number | null {
  if (!day.punchInAt || !day.punchOutAt) return null;
  const ms = new Date(day.punchOutAt).getTime() - new Date(day.punchInAt).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 60_000));
}

function countLeave(days: DayFacts[], type: string): number {
  return days.reduce((n, d) => {
    if (d.leaveType !== type) return n;
    // A half day consumes half an entitlement day.
    return n + (d.status === 'HALF_DAY' ? 0.5 : 1);
  }, 0);
}

export function summarise(employee: EmployeeMeta, days: DayFacts[]): PayrollSummaryRow {
  const status = (s: string) => days.filter((d) => d.status === s).length;

  const weeklyOffs = status('WEEKLY_OFF');
  const holidays = status('HOLIDAY');
  const halfDays = status('HALF_DAY');
  const present = days.filter((d) => PRESENT_STATUSES.has(d.status)).length;

  // Working days are the days the COMPANY expected work, which is every
  // evaluated day that was not a weekly off or a holiday. Days nobody
  // evaluated are reported separately rather than assumed to be either.
  const workingDays = days.filter((d) => !NON_WORKING_STATUSES.has(d.status)).length;

  return {
    employeeId: employee.employeeId ?? employee.id,
    name: employee.name,
    department: employee.department ?? '—',
    workingDays,
    present,
    absent: status('ABSENT'),
    casualLeave: countLeave(days, 'CASUAL'),
    emergencyLeave: countLeave(days, 'EMERGENCY'),
    compOff: countLeave(days, 'COMP_OFF'),
    halfDays,
    holidays,
    weeklyOffs,
    lateDays: days.filter((d) => d.lateMinutes > 0).length,
    needsReview: days.filter((d) => d.evaluationState === 'NEEDS_REVIEW').length,
    manualRecoveryDays: days.filter((d) => d.viaManualRecovery).length,
    regularizedDays: days.filter((d) => d.regularizationId !== null).length,
    // The number Finance must look at before trusting the rest of the row.
    unresolvedDays: days.filter(
      (d) => d.evaluationState === 'NEEDS_REVIEW' || d.evaluationState === 'NOT_EVALUATED',
    ).length,
  };
}

export interface RegisterRow {
  employeeId: string;
  name: string;
  date: string;
  day: string;
  classification: string;
  status: string;
  punchIn: string | null;
  punchInSource: PunchSourceLabel;
  punchOut: string | null;
  punchOutSource: PunchSourceLabel;
  presenceMinutes: number | null;
  requiredMinutes: number;
  workedMinutes: number;
  workdaySpanMinutes: number | null;
  breakMinutes: number;
  leaveType: string;
  manualEntry: boolean;
  regularized: boolean;
  needsReview: boolean;
  remarks: string;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function classify(status: string): string {
  if (status === 'HOLIDAY') return 'Company holiday';
  if (status === 'WEEKLY_OFF') return 'Weekly off';
  return 'Working day';
}

export function toRegisterRow(
  employee: EmployeeMeta,
  day: DayFacts,
  requiredMinutes: number,
): RegisterRow {
  const presence = presenceMinutes(day);

  const remarks: string[] = [];
  if (day.viaManualRecovery) remarks.push('Manual recovery');
  else if (day.regularizationId) remarks.push('Corrected');
  if (day.evaluationState === 'NEEDS_REVIEW') remarks.push('Needs review');
  if (day.evaluationState === 'NOT_EVALUATED') remarks.push('Not evaluated');
  // Stated explicitly rather than left for the reader to infer from a blank.
  if (presence === null && !NON_WORKING_STATUSES.has(day.status)) {
    remarks.push('Presence cannot be calculated');
  }
  if (day.lwpDeducted > 0) remarks.push(`${day.lwpDeducted} unpaid`);

  return {
    employeeId: employee.employeeId ?? employee.id,
    name: employee.name,
    date: day.date,
    day: WEEKDAYS[new Date(`${day.date}T00:00:00.000Z`).getUTCDay()],
    classification: classify(day.status),
    status: day.status,
    punchIn: day.punchInAt,
    punchInSource: sourceLabel(day.punchInSource),
    punchOut: day.punchOutAt,
    punchOutSource: sourceLabel(day.punchOutSource),
    presenceMinutes: presence,
    requiredMinutes,
    workedMinutes: day.workedMinutes,
    workdaySpanMinutes: day.sessionSpanMinutes,
    breakMinutes: day.breakMinutes,
    leaveType: day.leaveType ?? '—',
    manualEntry: day.viaManualRecovery,
    regularized: day.regularizationId !== null,
    needsReview: day.evaluationState === 'NEEDS_REVIEW',
    remarks: remarks.join('; '),
  };
}

export interface MonthTotals {
  employees: number;
  days: number;
  unresolvedDays: number;
  manualRecoveryDays: number;
  employeesWithUnresolved: number;
}

/**
 * What HR must look at before finalising.
 *
 * `employeesWithUnresolved` is the one that decides whether a month is ready:
 * a single unreviewed exception belongs to a real person whose pay it affects.
 */
export function monthTotals(summaries: PayrollSummaryRow[], allDays: DayFacts[]): MonthTotals {
  return {
    employees: summaries.length,
    days: allDays.length,
    unresolvedDays: summaries.reduce((n, s) => n + s.unresolvedDays, 0),
    manualRecoveryDays: summaries.reduce((n, s) => n + s.manualRecoveryDays, 0),
    employeesWithUnresolved: summaries.filter((s) => s.unresolvedDays > 0).length,
  };
}
