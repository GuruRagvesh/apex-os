/**
 * THE ONE PLACE A REPORTED ATTENDANCE ROW IS DECIDED.
 *
 * Two user-facing datasets, and nothing else:
 *
 *   DailyAttendanceReportRow      26 columns, one per employee-day
 *   MonthlyAttendanceSummaryRow   19 columns, one per employee
 *
 * The console, the workbook and any future surface all read these. Before this
 * module there were two independent report stacks -- a summary-only one in
 * console/ and a daily+summary one in reports/ -- producing four sheets from
 * two ExcelJS builders behind two download endpoints. See
 * docs/architecture/ATTENDANCE_CANONICALIZATION_AUDIT.md section 4.1.
 *
 * PURE. No Prisma, no clock, no services. Callers pass facts they have already
 * read; this module decides how to PRESENT them and never what a day was.
 *
 * THE MONTHLY SUMMARY IS AN AGGREGATION OF THE DAILY ROWS, not a second query.
 * buildMonthlySummary takes the rows buildDailyRow produced, so the two cannot
 * disagree -- which they previously could, and did.
 *
 * Aggregation keys on userId. Employee name is display only: two people called
 * the same thing must not merge into one summary line.
 */

import {
  completionAgainstRequirement,
  isNonWorkingStatus,
  isPresentStatus,
  lateMinutesFrom,
  presenceMinutes as presenceSpan,
} from '../shared/attendance-primitives';

// ════════════════════════════════════════════════════════════════════════════
// The contract
// ════════════════════════════════════════════════════════════════════════════

/**
 * The 26 daily columns, in the approved order.
 *
 * Exported so the workbook builder and the parity tests read the SAME list. A
 * builder with its own hardcoded headers is how a contract drifts.
 *
 * No internal ids. Rows are keyed internally by userId + date; neither reaches
 * the visible table.
 */
export const DAILY_COLUMNS = [
  'Employee Name',
  'Employee ID',
  'Department',
  'Designation',
  'Employee Type',
  'Date',
  'Attendance Status',
  'Present',
  'Absent',
  'Half Day',
  'Leave',
  'Punch In',
  'Punch Out',
  'Total Presence Time',
  'Hours Worked',
  'Break Time',
  'Late Arrival',
  '9-Hour Completion / Shortfall',
  'Leave Type',
  'Leave Deducted',
  'LWP / Unpaid Portion',
  'Comp Off',
  'Manual Correction / Regularization',
  'Missing Punch',
  'Remarks / Exception',
  'Data Source',
] as const;

/** The 19 summary columns, in the approved order. */
export const SUMMARY_COLUMNS = [
  'Employee Name',
  'Employee ID',
  'Department',
  'Designation',
  'Employee Type',
  'Working Days',
  'Present Days',
  'Absent Days',
  'Half Days',
  'Leave Days',
  'Late Days',
  'Days Below 9 Hours',
  'Total Presence Hours',
  'Total Work Hours',
  'Total Break Hours',
  'CL Used',
  'LWP / Unpaid Days',
  'Attendance Deductions',
  'Unresolved Days',
] as const;

/** Absent or unknown, said in one place so every column spells it the same. */
export const DASH = '—';

// ════════════════════════════════════════════════════════════════════════════
// Visible statuses
// ════════════════════════════════════════════════════════════════════════════

/**
 * What an employee-day is allowed to say.
 *
 * UNCERTAINTY IS NEVER COLLAPSED INTO ABSENCE. Four of these seven exist only
 * so that "we cannot say" has somewhere to go: a missing DailyAttendance row,
 * an unconfirmed calendar, an employment record with no joining date and a date
 * outside the data being reported are four different situations, and none of
 * them is evidence that somebody failed to come to work.
 */
export type VisibleAttendanceStatus =
  | 'Present'
  | 'Absent'
  | 'Weekly Off'
  | 'Calendar not confirmed'
  | 'Not yet joined'
  | 'Employment not verified'
  | 'Not in extract';

/** Human-readable provenance. Internal service names never appear here. */
export type VisibleDataSource =
  | 'Official attendance'
  | 'Raw punches'
  | 'WorkSessions'
  | 'Raw punches + WorkSessions'
  | 'Leave'
  | 'Combined evidence'
  | 'Calendar rule'
  | 'Employee record'
  | 'Extract cutoff';

// ════════════════════════════════════════════════════════════════════════════
// Inputs
// ════════════════════════════════════════════════════════════════════════════

export interface ReportEmployee {
  /** Internal key. Never displayed, never used to aggregate by name. */
  userId: string;
  name: string;
  employeeId: string | null;
  department: string | null;
  designation: string | null;
  employeeType: string | null;
}

/**
 * Everything known about one employee-day, already read.
 *
 * `official` is the stored DailyAttendance outcome when one exists. Its absence
 * is NOT absence -- see deriveStatus.
 */
export interface DayInput {
  /** yyyy-MM-dd */
  date: string;

  /** Was the employee employed on this date, and if not, why not. */
  employment: { employedOnDate: boolean; reason: string };

  /** Did the company expect work? Null means the calendar could not be confirmed. */
  workingDay: boolean | null;

  /** False when the date lies outside the data this report covers. */
  inExtract: boolean;

  /** The stored official outcome, when the day was evaluated. */
  official: {
    status: string;
    evaluationState: string;
    punchInAt: Date | string | null;
    punchOutAt: Date | string | null;
    workedMinutes: number | null;
    breakMinutes: number | null;
    lateMinutes: number | null;
    leaveDeducted: number | null;
    lwpDeducted: number | null;
    exceptionFlags: string[];
    regularizationId: string | null;
    viaManualRecovery: boolean;
  } | null;

  /** Raw punch evidence for the day, if any, oldest first. */
  rawPunches: Array<{ type: string; occurredAt: Date | string }>;

  /** Finalized work sessions. autoClosed matters: an auto-close is not a punch out. */
  workSessions: Array<{
    startWorkAt: Date | string | null;
    logoutAt: Date | string | null;
    totalWorkMinutes: number | null;
    totalBreakMinutes: number | null;
    autoClosed: boolean;
  }>;

  /** Approved leave covering the day. */
  leave: { type: string; isHalfDay: boolean } | null;

  /** Comp off consumed or credited on the day. */
  compOff: boolean;

  /** Pending or invalid corrections, which must NOT alter the facts. */
  regularization: {
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    invalid: boolean;
  } | null;

  /** The requirement that applied, resolved from the day's own provenance. */
  requiredMinutes: number | null;

  /** The shift/policy arrival threshold that applied, 'HH:mm'. */
  arrivalThreshold: string | null;
  arrivalGraceMinutes: number;

  /** Arrival in minutes past midnight, company time. Null when unknown. */
  /**
   * Arrival as SECONDS past midnight in company time.
   *
   * Seconds, not minutes, because the cutoff is inclusive to the second:
   * 10:30:00 is on time and 10:30:01 is late, and a minute figure cannot tell
   * those apart. This field held minutes and the difference was invisible.
   */
  arrivalSeconds: number | null;
}

// ════════════════════════════════════════════════════════════════════════════
// The daily row
// ════════════════════════════════════════════════════════════════════════════

export interface DailyAttendanceReportRow {
  /** Internal only. Not a visible column. */
  userId: string;

  employeeName: string;
  employeeId: string;
  department: string;
  designation: string;
  employeeType: string;
  date: string;
  attendanceStatus: VisibleAttendanceStatus;
  present: string;
  absent: string;
  halfDay: string;
  leave: string;
  punchIn: string;
  punchOut: string;
  totalPresenceTime: string;
  hoursWorked: string;
  breakTime: string;
  lateArrival: string;
  completion: string;
  leaveType: string;
  leaveDeducted: string;
  lwpUnpaid: string;
  compOff: string;
  manualCorrection: string;
  missingPunch: string;
  remarks: string;
  dataSource: VisibleDataSource;

  /** Machine-readable companions, for the summary and for parity tests. */
  raw: {
    presenceMinutes: number | null;
    workedMinutes: number | null;
    breakMinutes: number | null;
    lateMinutes: number | null;
    requiredMinutes: number | null;
    belowRequirement: boolean | null;
    leaveDeducted: number;
    lwpDeducted: number;
    unresolved: boolean;
  };
}

const toIso = (v: Date | string | null | undefined): Date | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
};

const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const duration = (minutes: number | null): string => (minutes == null ? DASH : hhmm(minutes));

const hours = (minutes: number): number => Math.round((minutes / 60) * 100) / 100;

/**
 * A punch time for display, or a dash.
 *
 * AN AUTO-CLOSED SESSION NEVER REACHES THIS. The caller supplies only real
 * punch evidence; a policy auto-stop at 20:00 is the scheduler closing a
 * session nobody ended, and printing it as the employee's punch out would put
 * a time against their name that they did not record.
 */
const clock = (v: Date | string | null, timeFormatter: (d: Date) => string): string => {
  const d = toIso(v);
  return d ? timeFormatter(d) : DASH;
};

/**
 * The visible status for one employee-day.
 *
 * THE ABSENT RULE, stated as the conjunction it is. A day is Absent only when
 * every one of these holds:
 *
 *   the employee is verified employed on the date
 *   the date is a confirmed working day
 *   the date is inside the data being reported
 *   no approved leave covers it
 *   no punch evidence exists
 *   no work-session evidence exists
 *   no stronger evidence exists
 *
 * Checked in order of certainty, most certain first, so a weaker condition can
 * never overrule a stronger one. A MISSING DailyAttendance ROW IS NOT IN THIS
 * LIST: its absence means nobody has evaluated the day, which is not evidence
 * about whether anybody came to work.
 */
export function deriveStatus(day: DayInput): VisibleAttendanceStatus {
  // Employment first: a date outside somebody's employment is not their day at
  // all, whatever else the data says about it.
  if (day.employment.reason === 'NO_JOINING_DATE' || day.employment.reason === 'USER_NOT_FOUND') {
    return 'Employment not verified';
  }
  if (day.employment.reason === 'BEFORE_JOINING') return 'Not yet joined';
  if (!day.employment.employedOnDate) {
    // After the last working day. Not absence -- they had left.
    return 'Not in extract';
  }

  // Outside the reported window: the report has nothing to say, and saying
  // "Absent" about a date it does not cover would be inventing a fact.
  if (!day.inExtract) return 'Not in extract';

  // Any credible evidence of work establishes presence, before the calendar is
  // consulted: somebody who worked on a holiday was present.
  if (hasWorkEvidence(day)) return 'Present';

  // An official row that says so.
  if (day.official && isPresentStatus(day.official.status)) return 'Present';
  if (day.official && day.official.status === 'HALF_DAY') return 'Present';

  // Leave is a stronger statement than the calendar.
  if (day.leave) return 'Present';

  if (day.workingDay === null) return 'Calendar not confirmed';
  if (day.workingDay === false) return 'Weekly Off';
  if (day.official && isNonWorkingStatus(day.official.status)) return 'Weekly Off';

  // Every condition met and nothing to the contrary.
  return 'Absent';
}

/** Punches or sessions that actually ran. An auto-close alone still counts. */
function hasWorkEvidence(day: DayInput): boolean {
  if (day.rawPunches.length > 0) return true;
  return day.workSessions.some((s) => s.startWorkAt != null);
}

/**
 * Which sources the row's figures came from, in words an HR reader can use.
 *
 * Describes the EVIDENCE, not the code. "Official attendance" means a stored
 * evaluated row backed the numbers; "Raw punches + WorkSessions" means the row
 * was assembled from evidence because no official row existed.
 */
export function deriveDataSource(day: DayInput): VisibleDataSource {
  if (day.official) return 'Official attendance';

  const punches = day.rawPunches.length > 0;
  const sessions = day.workSessions.some((s) => s.startWorkAt != null);

  if (punches && sessions) return 'Raw punches + WorkSessions';
  if (punches) return 'Raw punches';
  if (sessions) return 'WorkSessions';
  if (day.leave) return 'Leave';
  if (!day.inExtract) return 'Extract cutoff';
  if (!day.employment.employedOnDate) return 'Employee record';
  return 'Calendar rule';
}

/**
 * The effective punch pair from RAW EVIDENCE ONLY.
 *
 * First PUNCH_IN and last PUNCH_OUT. A session start is deliberately not a
 * punch in here and a session end is deliberately not a punch out: the Punch In
 * and Punch Out columns report what the employee recorded, and a session the
 * scheduler closed at 20:00 is not a departure anybody recorded.
 */
function rawPunchPair(day: DayInput): { in: Date | null; out: Date | null } {
  const ins = day.rawPunches.filter((p) => p.type === 'PUNCH_IN').map((p) => toIso(p.occurredAt));
  const outs = day.rawPunches.filter((p) => p.type === 'PUNCH_OUT').map((p) => toIso(p.occurredAt));
  return {
    in: ins.find((d) => d != null) ?? null,
    out: outs.filter((d) => d != null).pop() ?? null,
  };
}

export function buildDailyRow(
  employee: ReportEmployee,
  day: DayInput,
  timeFormatter: (d: Date) => string,
): DailyAttendanceReportRow {
  const status = deriveStatus(day);

  // Official punches when the day was evaluated, raw evidence otherwise. Either
  // way these are punches, never session boundaries.
  const pair = day.official
    ? { in: toIso(day.official.punchInAt), out: toIso(day.official.punchOutAt) }
    : rawPunchPair(day);

  const presence = presenceSpan(pair.in, pair.out);

  // Worked and break come from the workday engine, summed over sessions that
  // closed. They are SEPARATE figures from presence and are never substituted
  // for it.
  const closed = day.workSessions.filter((s) => s.logoutAt != null || s.autoClosed);
  const worked =
    day.official?.workedMinutes ??
    (closed.length ? closed.reduce((n, s) => n + (s.totalWorkMinutes ?? 0), 0) : null);
  const breaks =
    day.official?.breakMinutes ??
    (closed.length ? closed.reduce((n, s) => n + (s.totalBreakMinutes ?? 0), 0) : null);

  const late = lateMinutesFrom(day.arrivalSeconds, day.arrivalThreshold, day.arrivalGraceMinutes);
  const completion = completionAgainstRequirement({
    presenceMinutes: presence,
    workedMinutes: worked,
    requiredMinutes: day.requiredMinutes,
  });

  const isPresent = status === 'Present';
  const isHalfDay = day.official?.status === 'HALF_DAY' || day.leave?.isHalfDay === true;

  // Which punch is missing, named rather than implied by a blank.
  const missing: string[] = [];
  if (isPresent) {
    if (!pair.in) missing.push('Punch In');
    if (!pair.out) missing.push('Punch Out');
  }

  const remarks: string[] = [];
  if (day.official?.viaManualRecovery) remarks.push('Manual recovery');
  if (day.official?.evaluationState === 'NEEDS_REVIEW') remarks.push('Needs review');
  if (!day.official && status !== 'Weekly Off' && status !== 'Not in extract') {
    // Said plainly: the day has evidence but nobody has evaluated it, which is
    // not the same as the day being settled.
    remarks.push('No official attendance record');
  }
  if (presence === null && isPresent) remarks.push('Presence cannot be calculated');
  if (day.workSessions.some((s) => s.autoClosed)) {
    remarks.push('Session auto-closed by policy — not an employee punch out');
  }
  if (day.requiredMinutes == null && isPresent) remarks.push('Required minutes unresolved');
  if (day.regularization?.invalid) remarks.push('Invalid correction — not applied');
  for (const flag of day.official?.exceptionFlags ?? []) {
    if (/UNRESOLVED|BLOCKED|CONTEXT|POLICY/i.test(flag)) remarks.push(flag);
  }

  // A REQUEST IS NOT A CORRECTION. Pending says so, and nothing about the row's
  // figures changes until the approval path says it has.
  const manualCorrection = day.regularization?.invalid
    ? 'Invalid — not applied'
    : day.regularization?.status === 'PENDING'
      ? 'Pending — not applied'
      : day.official?.viaManualRecovery
        ? 'Manual recovery'
        : day.official?.regularizationId
          ? 'Applied'
          : DASH;

  return {
    userId: employee.userId,
    employeeName: employee.name,
    employeeId: employee.employeeId ?? DASH,
    department: employee.department ?? DASH,
    designation: employee.designation ?? DASH,
    employeeType: employee.employeeType ?? DASH,
    date: day.date,
    attendanceStatus: status,
    present: isPresent ? 'Yes' : '',
    absent: status === 'Absent' ? 'Yes' : '',
    halfDay: isHalfDay ? 'Yes' : '',
    leave: day.leave ? 'Yes' : '',
    punchIn: clock(pair.in, timeFormatter),
    punchOut: clock(pair.out, timeFormatter),
    totalPresenceTime: duration(presence),
    hoursWorked: duration(worked),
    breakTime: duration(breaks),
    lateArrival:
      late.lateMinutes == null
        ? DASH
        : late.lateMinutes === 0
          ? 'On time'
          : `Late by ${hhmm(late.lateMinutes)}`,
    completion: completion.label,
    leaveType: day.leave?.type ?? DASH,
    leaveDeducted: day.official?.leaveDeducted ? String(day.official.leaveDeducted) : DASH,
    lwpUnpaid: day.official?.lwpDeducted ? String(day.official.lwpDeducted) : DASH,
    compOff: day.compOff ? 'Yes' : '',
    manualCorrection,
    missingPunch: missing.length ? missing.join(' + ') : DASH,
    remarks: remarks.length ? remarks.join('; ') : DASH,
    dataSource: deriveDataSource(day),

    raw: {
      presenceMinutes: presence,
      workedMinutes: worked,
      breakMinutes: breaks,
      lateMinutes: late.lateMinutes,
      requiredMinutes: day.requiredMinutes,
      belowRequirement: completion.met == null ? null : !completion.met,
      leaveDeducted: day.official?.leaveDeducted ?? 0,
      lwpDeducted: day.official?.lwpDeducted ?? 0,
      unresolved:
        day.official?.evaluationState === 'NEEDS_REVIEW' ||
        (!day.official && status !== 'Weekly Off' && status !== 'Not in extract' &&
          status !== 'Not yet joined'),
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// The monthly summary
// ════════════════════════════════════════════════════════════════════════════

export interface MonthlyAttendanceSummaryRow {
  userId: string;

  employeeName: string;
  employeeId: string;
  department: string;
  designation: string;
  employeeType: string;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  leaveDays: number;
  lateDays: number;
  daysBelowNineHours: number;
  totalPresenceHours: number;
  totalWorkHours: number;
  totalBreakHours: number;
  clUsed: number;
  lwpUnpaidDays: number;
  attendanceDeductions: number;
  unresolvedDays: number;
}

/**
 * One employee's month, aggregated FROM THE DAILY ROWS.
 *
 * Not a second query and not a second interpretation: the argument is the exact
 * array buildDailyRow produced, so a figure here cannot contradict the day it
 * came from. The two used to be computed separately and could differ.
 *
 * Working days counts the days the company expected work -- Present, Absent and
 * anything still unresolved -- and excludes weekly offs, pre-joining dates and
 * dates outside the extract. A day nobody has judged is counted as expected and
 * reported separately as unresolved, never silently as present or absent.
 */
export function buildMonthlySummary(
  employee: ReportEmployee,
  dailyRows: DailyAttendanceReportRow[],
): MonthlyAttendanceSummaryRow {
  const mine = dailyRows.filter((r) => r.userId === employee.userId);

  const sum = (pick: (r: DailyAttendanceReportRow) => number | null) =>
    mine.reduce((n, r) => n + (pick(r) ?? 0), 0);

  const expected = mine.filter(
    (r) =>
      r.attendanceStatus !== 'Weekly Off' &&
      r.attendanceStatus !== 'Not yet joined' &&
      r.attendanceStatus !== 'Not in extract',
  );

  return {
    userId: employee.userId,
    employeeName: employee.name,
    employeeId: employee.employeeId ?? DASH,
    department: employee.department ?? DASH,
    designation: employee.designation ?? DASH,
    employeeType: employee.employeeType ?? DASH,
    workingDays: expected.length,
    presentDays: mine.filter((r) => r.attendanceStatus === 'Present').length,
    absentDays: mine.filter((r) => r.attendanceStatus === 'Absent').length,
    halfDays: mine.filter((r) => r.halfDay === 'Yes').length,
    leaveDays: mine.filter((r) => r.leave === 'Yes').length,
    // Lateness is independent of status: a late arrival is a present day.
    lateDays: mine.filter((r) => (r.raw.lateMinutes ?? 0) > 0).length,
    daysBelowNineHours: mine.filter((r) => r.raw.belowRequirement === true).length,
    totalPresenceHours: hours(sum((r) => r.raw.presenceMinutes)),
    totalWorkHours: hours(sum((r) => r.raw.workedMinutes)),
    totalBreakHours: hours(sum((r) => r.raw.breakMinutes)),
    clUsed: mine.filter((r) => r.leaveType === 'CASUAL').reduce((n, r) => n + (r.halfDay === 'Yes' ? 0.5 : 1), 0),
    lwpUnpaidDays: sum((r) => r.raw.lwpDeducted),
    attendanceDeductions: sum((r) => r.raw.leaveDeducted),
    unresolvedDays: mine.filter((r) => r.raw.unresolved).length,
  };
}

/** The whole month, both datasets, from one pass over the facts. */
export interface MonthReport {
  month: string;
  dailyRows: DailyAttendanceReportRow[];
  summaryRows: MonthlyAttendanceSummaryRow[];
  metadata: {
    generatedAt: Date;
    employees: number;
    days: number;
    unresolvedDays: number;
    employeesWithUnresolved: number;
    /**
     * The late cutoff this report was built against, and where it came from.
     *
     * REPORTED SO THE FRONTEND NEVER HAS TO KNOW IT. A console that prints
     * "late after 10:30" from its own constant is a second copy of the rule,
     * free to drift from the one the rows were actually classified with. This
     * carries the real value out with the rows it decided, so the label and the
     * data cannot disagree.
     *
     * `source` travels with it because SYSTEM_FALLBACK and
     * INVALID_CONFIGURED_VALUE are not the same news: the first is the ordinary
     * unconfigured case, the second means somebody typed something that is not
     * a time and everyone's lateness is being judged against the fallback.
     */
    lateCutoff: { clock: string; source: string };
  };
}

export function buildMonthReport(input: {
  month: string;
  generatedAt: Date;
  employees: ReportEmployee[];
  daysByUser: Map<string, DayInput[]>;
  timeFormatter: (d: Date) => string;
  lateCutoff: { clock: string; source: string };
}): MonthReport {
  const dailyRows: DailyAttendanceReportRow[] = [];
  for (const employee of input.employees) {
    for (const day of input.daysByUser.get(employee.userId) ?? []) {
      dailyRows.push(buildDailyRow(employee, day, input.timeFormatter));
    }
  }

  // Keyed on userId, so two employees with the same name stay separate.
  const summaryRows = input.employees.map((e) => buildMonthlySummary(e, dailyRows));

  return {
    month: input.month,
    dailyRows,
    summaryRows,
    metadata: {
      generatedAt: input.generatedAt,
      employees: input.employees.length,
      days: dailyRows.length,
      unresolvedDays: summaryRows.reduce((n, s) => n + s.unresolvedDays, 0),
      employeesWithUnresolved: summaryRows.filter((s) => s.unresolvedDays > 0).length,
      lateCutoff: input.lateCutoff,
    },
  };
}
