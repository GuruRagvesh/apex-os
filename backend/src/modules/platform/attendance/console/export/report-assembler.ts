import { round } from './report-columns';
import {
  DAY_STATES,
  SCHEDULE,
  type BusinessDate,
  type CellValue,
  type DailyReportRow,
  type DayState,
  type MonthlyAttendanceReport,
  type MonthlyReportRow,
  type ReportCorrectionFacts,
  type ReportEmployeeFacts,
  type ReportLeaveFacts,
  type ReportMeetingFacts,
  type ReportOfficialDay,
  type ReportProfileFacts,
  type ReportSourceFacts,
} from './report-model';

/**
 * The canonical monthly attendance report assembler.
 *
 * The ONE place a monthly attendance file's numbers are decided. Pure: it reads
 * the facts gathered from a single database snapshot and returns the report.
 * The workbook and the CSV package only encode what this returns.
 *
 * It does not evaluate attendance. Every working-day classification comes from
 * the official DailyAttendance row the AE-1 evaluator (or an approved, applied
 * correction) wrote. What this adds is the month around those rows: calendar
 * days with no row, employment boundaries, future dates, leave and comp-off
 * labels, meeting verification, correction state, and the monthly arithmetic.
 *
 * Three rules hold throughout:
 *
 *  1. Nothing missing becomes zero. A day with no official result on a past
 *     working day is NEEDS REVIEW, never Absent; a figure that could not be
 *     measured is blank, never 0.
 *  2. A correction never changes a number here. Applied corrections are already
 *     in the official row; pending, held, stale and rejected ones change only
 *     the dispute columns and the provisional flag.
 *  3. Monthly figures are derived from the daily rows exactly as they are
 *     printed (rounded), so the Monthly Summary formulas in the workbook
 *     reproduce the cached values the backend wrote.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  const name = MONTHS[Number(m) - 1];
  return name && y ? `${name} ${y}` : month;
}

export function monthDates(month: string): BusinessDate[] {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

const LEAVE_LABEL: Record<string, string> = {
  ANNUAL: 'Annual Leave',
  SICK: 'Sick Leave',
  EMERGENCY: 'Emergency Leave',
  CASUAL: 'Casual Leave',
  COMP_OFF: 'Comp Off Leave',
  UNPAID: 'Unpaid Leave',
  OTHER: 'Other Leave',
};

export const CASUAL_LEAVE_LABEL = LEAVE_LABEL.CASUAL;

export function leaveTypeLabel(type: string | null | undefined): string | null {
  if (!type) return null;
  return LEAVE_LABEL[type] ?? type;
}

/** Exception flags worth a sentence in the remarks column. */
const FLAG_REMARK: Record<string, string> = {
  LOCATION_OUTSIDE_GEOFENCE: 'Punch outside the office geofence',
  LOCATION_LOW_ACCURACY: 'Low location accuracy on punch',
  LOCATION_UNAVAILABLE: 'Location unavailable on punch',
  PHOTO_MISSING: 'Punch photo missing',
  WORKDAY_STILL_OPEN: 'Workday was not closed',
  PARTIALLY_FUNDED_LEAVE: 'Leave partially funded; settlement pending',
  LEAVE_SETTLEMENT_PENDING: 'Leave settlement pending',
  EMERGENCY_LEAVE_PROVISIONAL: 'Emergency leave awaiting approval',
  AMBIGUOUS_APPROVED_LEAVE: 'Two approved leaves cover this day',
  UNREPORTED_ABSENCE_3_DAYS: 'Unreported absence (three-day rule)',
  APPROVED_CORRECTION_WITHOUT_DECISION_TIME: 'Approved correction has no decision time',
  BREAK_EXCEEDS_ALLOWANCE: 'Break exceeded the allowance',
  INSUFFICIENT_EFFECTIVE_WORK: 'Effective work below the minimum',
  HALF_DAY_SESSION_UNRESOLVED: 'Half-day session could not be resolved',
  HALF_DAY_PUNCH_IN_OUTSIDE_WINDOW: 'Half-day punch in outside its window',
  HALF_DAY_INSUFFICIENT_PRESENCE: 'Half-day presence below the requirement',
  HALF_DAY_EARLY_PUNCH_OUT: 'Half-day punch out before the required time',
};

const UNRESOLVED_CORRECTION = new Set(['PENDING', 'MANAGER_APPROVED', 'STALE_REVIEW_REQUIRED']);

/** The dispute a day carries, as HR reads it. */
export function disputeOf(corrections: ReportCorrectionFacts[]): {
  label: string;
  /** Pending, stale or held: keeps the report provisional. */
  open: boolean;
  held: boolean;
  stale: boolean;
  pending: boolean;
  reason: string | null;
} {
  if (corrections.length === 0) {
    return { label: 'None', open: false, held: false, stale: false, pending: false, reason: null };
  }
  const ordered = [...corrections].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  // Only one request per day may be open, so an open one always governs.
  const primary = ordered.find((c) => UNRESOLVED_CORRECTION.has(c.status)) ?? ordered[0];
  const reason = primary.reason?.trim() || null;
  const base = { held: false, stale: false, pending: false, reason };

  switch (primary.status) {
    case 'PENDING':
    case 'MANAGER_APPROVED':
      return { ...base, label: 'Pending', open: true, pending: true };
    case 'STALE_REVIEW_REQUIRED':
      return { ...base, label: 'Stale - Requires Review', open: true, stale: true };
    case 'REJECTED':
      return { ...base, label: 'Rejected', open: false };
    case 'HR_APPROVED':
      return { ...base, label: 'Approved - Applied', open: false };
    case 'APPROVED':
      if (primary.applicationStatus === 'APPLIED') return { ...base, label: 'Approved - Applied', open: false };
      if (primary.applicationStatus === 'REVIEW_REQUIRED') {
        return { ...base, label: 'Approved - Held (Not Applied)', open: true, held: true };
      }
      if (primary.applicationFailureReason === 'REVIEW_ONLY_REQUEST') {
        return { ...base, label: 'Approved - Review Only', open: false };
      }
      return { ...base, label: 'Approved - No Change Needed', open: false };
    default:
      return { ...base, label: primary.status, open: false };
  }
}

interface Interval {
  start: number;
  end: number;
}

/** Total minutes covered by a set of intervals, overlaps counted once. */
export function unionMinutes(intervals: Interval[]): number {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const i of sorted) {
    if (i.start > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = i.start;
      curEnd = i.end;
    } else if (i.end > curEnd) {
      curEnd = i.end;
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return Math.floor(total / 60_000);
}

function meetingInterval(m: ReportMeetingFacts): Interval | null {
  const start = m.startAt.getTime();
  const end = m.endAt
    ? m.endAt.getTime()
    : m.durationMinutes !== null && m.durationMinutes !== undefined
      ? start + m.durationMinutes * 60_000
      : null;
  if (end === null || end <= start) return null;
  return { start, end };
}

function clip(i: Interval, from: Date | null, to: Date | null): Interval {
  return {
    start: from ? Math.max(i.start, from.getTime()) : i.start,
    end: to ? Math.min(i.end, to.getTime()) : i.end,
  };
}

/**
 * Meeting facts for one day.
 *
 * A meeting is recorded as a MEETING break inside a work session, so its time
 * is already part of the workday engine's work total. Approved (and
 * no-approval-needed) meetings stay in it; pending ones stay visible and stay
 * in it until decided; a REJECTED meeting's minutes are removed from work -- but
 * only the minutes no eligible meeting also covers, so overlapping meetings
 * never subtract or add the same minute twice. Cancelled meetings are not
 * meetings and are ignored here (their time is whatever the workday recorded).
 */
export function meetingDay(meetings: ReportMeetingFacts[], workFrom: Date | null, workTo: Date | null) {
  const live = meetings.filter((m) => !m.cancelled);
  const withInterval = live
    .map((m) => ({ m, i: meetingInterval(m) }))
    .filter((x): x is { m: ReportMeetingFacts; i: Interval } => x.i !== null);

  const isEligible = (m: ReportMeetingFacts) => m.approvalStatus !== 'REJECTED';
  const isApproved = (m: ReportMeetingFacts) => m.approvalStatus === 'APPROVED' || m.approvalStatus === 'NOT_REQUIRED';
  const isPending = (m: ReportMeetingFacts) => m.approvalStatus === 'PENDING' || m.approvalStatus === null;

  const eligible = withInterval.filter((x) => isEligible(x.m)).map((x) => x.i);
  const approved = withInterval.filter((x) => isApproved(x.m)).map((x) => x.i);
  const all = withInterval.map((x) => clip(x.i, workFrom, workTo));
  const eligibleClipped = eligible.map((i) => clip(i, workFrom, workTo));
  const rejectedOnlyMinutes = Math.max(0, unionMinutes(all) - unionMinutes(eligibleClipped));

  let status = 'Not Applicable';
  if (live.length > 0) {
    if (live.some(isPending)) status = 'Pending';
    else if (live.every((m) => m.approvalStatus === 'REJECTED')) status = 'Rejected';
    else status = 'Approved';
  }

  return {
    recorded: live.length > 0,
    eligibleMinutes: unionMinutes(eligible),
    approvedMinutes: unionMinutes(approved),
    rejectedOnlyMinutes,
    rejectedCount: new Set(live.filter((m) => m.approvalStatus === 'REJECTED').map((m) => m.meetingId)).size,
    pendingMeetingIds: [...new Set(live.filter((m) => m.approvalStatus === 'PENDING' && m.meetingId).map((m) => m.meetingId as string))],
    status,
  };
}

const hours = (minutes: number | null): number | null => (minutes === null ? null : round(minutes / 60, 2));
const clockOf = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

/** One formatter per zone: building an Intl formatter costs far more than using one. */
const CLOCK_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** HH:mm in the company timezone. */
export function wallClock(at: Date | null, timezone: string): string | null {
  if (!at) return null;
  let formatter = CLOCK_FORMATTERS.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    CLOCK_FORMATTERS.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(at);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

function profileOn(profiles: ReportProfileFacts[], date: BusinessDate): ReportProfileFacts | null {
  let best: ReportProfileFacts | null = null;
  for (const p of profiles) {
    if (p.effectiveFrom > date) continue;
    if (p.effectiveTo !== null && p.effectiveTo < date) continue;
    if (!best || p.effectiveFrom > best.effectiveFrom) best = p;
  }
  return best;
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

const PRESENT_STATUSES = new Set(['PRESENT', 'LATE', 'LATE_EXEMPTED']);

/** The resolution of one employee-date before it is written as cells. */
interface DayResolution {
  state: DayState;
  schedule: string;
  unresolved: boolean;
  present: number;
  absent: number;
  halfDay: number;
  leave: number;
  punchInAt: Date | null;
  punchOutAt: Date | null;
  presenceMinutes: number | null;
  requiredMinutes: number | null;
  workMinutes: number | null;
  breakMinutes: number | null;
  late: boolean | null;
  lateMinutes: number;
  leaveType: string | null;
  leaveDeducted: number | null;
  lwpPortion: number | null;
  coverage: string;
  /** Counts toward the verified-coverage denominator, and whether verified. */
  coverageEligible: boolean;
  verified: boolean;
  remarks: string[];
  missingPunch: string;
}

/**
 * Assembles the report.
 *
 * Employees are ordered by name then code; each employee's days run from the
 * 1st to the last of the month, so an employee's daily rows are contiguous and
 * the Monthly Summary can reference them as one range.
 */
export function assembleMonthlyAttendanceReport(facts: ReportSourceFacts): MonthlyAttendanceReport {
  const dates = monthDates(facts.month);
  const from = dates[0];
  const to = dates[dates.length - 1];
  const monthComplete = to < facts.today;
  const warnings: string[] = [];

  if (!facts.calendarResolved) {
    warnings.push(
      'The company weekly-off policy or holiday calendar could not be resolved for this month; days without an evaluated attendance record may be classified incorrectly.',
    );
  }

  const calendarByDate = new Map(facts.calendar.map((d) => [d.businessDate, d]));
  const key = (userId: string, date: string) => `${userId}|${date}`;
  const officialByKey = new Map(facts.official.map((o) => [key(o.userId, o.businessDate), o]));
  const profilesByUser = groupBy(facts.profiles, (p) => p.userId);
  const correctionsByKey = groupBy(facts.corrections, (c) => key(c.userId, c.businessDate));
  const sessionsByKey = groupBy(facts.sessions, (s) => key(s.userId, s.businessDate));
  const meetingsByKey = groupBy(facts.meetings, (m) => key(m.userId, m.businessDate));
  const punchesByKey = groupBy(facts.punches, (p) => key(p.userId, p.businessDate));
  const leaveById = new Map(facts.leaves.map((l) => [l.id, l]));
  const compOffByKey = new Map<string, number>();
  for (const c of facts.compOff) {
    if (c.status === 'CANCELLED') continue;
    const k = key(c.userId, c.earnedFromBusinessDate);
    compOffByKey.set(k, (compOffByKey.get(k) ?? 0) + c.creditMinutes);
  }
  const approvedLeaveByKey = new Map<string, ReportLeaveFacts[]>();
  const pendingLeaveByKey = new Map<string, ReportLeaveFacts[]>();
  for (const l of facts.leaves) {
    const approved = l.status === 'APPROVED' && (l.approvalStage === null || l.approvalStage === 'COMPLETE');
    const pending = l.status === 'PENDING' || (l.status === 'APPROVED' && !approved);
    if (!approved && !pending) continue;
    const target = approved ? approvedLeaveByKey : pendingLeaveByKey;
    for (const d of l.dates) {
      const k = key(l.userId, d);
      target.set(k, [...(target.get(k) ?? []), l]);
    }
  }

  const employees = [...facts.employees].sort(
    (a, b) => a.name.localeCompare(b.name) || (a.employeeCode ?? '').localeCompare(b.employeeCode ?? '') || a.userId.localeCompare(b.userId),
  );

  const noJoining = employees.filter((e) => !e.joiningDate);
  if (noJoining.length > 0) {
    warnings.push(
      `${noJoining.length} employee(s) have no joining date on record; every day of the month is treated as within employment for them.`,
    );
  }

  const dailyRows: DailyReportRow[] = [];
  const monthlySummaryRows: MonthlyReportRow[] = [];

  for (const e of employees) {
    const first = dailyRows.length;
    const profiles = profilesByUser.get(e.userId) ?? [];
    const acc = {
      presenceCompletionNumerator: 0,
      presenceCompletionDenominator: 0,
      coverageVerified: 0,
      coverageEligible: 0,
      approvedMeetingHours: 0,
      pendingMeetingIds: new Set<string>(),
      openDisputes: 0,
      missingPunchDetails: [] as string[],
    };

    for (const date of dates) {
      const k = key(e.userId, date);
      const official = officialByKey.get(k) ?? null;
      const calendarDay = calendarByDate.get(date) ?? null;
      const profile = profileOn(profiles, date);
      const corrections = correctionsByKey.get(k) ?? [];
      const dispute = disputeOf(corrections);
      const resolution = resolveDay({
        e,
        date,
        today: facts.today,
        official,
        calendarDay,
        profile,
        sessions: sessionsByKey.get(k) ?? [],
        punches: punchesByKey.get(k) ?? [],
        approvedLeaves: approvedLeaveByKey.get(k) ?? [],
        leaveById,
      });

      // Meetings are reported on any day they were recorded; they can only
      // reduce work on a day that HAS work.
      const meeting = meetingDay(meetingsByKey.get(k) ?? [], resolution.punchInAt, resolution.punchOutAt);
      let workMinutes = resolution.workMinutes;
      if (workMinutes !== null && meeting.rejectedOnlyMinutes > 0) {
        workMinutes = Math.max(0, workMinutes - meeting.rejectedOnlyMinutes);
      }

      const compOffMinutes = compOffByKey.get(k) ?? null;
      const pendingLeaves = pendingLeaveByKey.get(k) ?? [];

      const remarks = [...resolution.remarks];
      if (meeting.rejectedCount > 0) {
        remarks.push(`${meeting.rejectedCount} rejected meeting(s) excluded from work hours`);
      }
      for (const l of pendingLeaves) {
        remarks.push(`Leave pending approval (${leaveTypeLabel(l.type)})`);
      }
      if (dispute.reason) remarks.unshift(`Correction request: ${dispute.reason}`);

      const presentLike = resolution.state === DAY_STATES.PRESENT || resolution.state === DAY_STATES.LATE || resolution.state === DAY_STATES.SHORT_HOURS;
      const measured = presentLike && resolution.presenceMinutes !== null && resolution.requiredMinutes;
      const presenceCompletion = measured
        ? round(Math.min(1, resolution.presenceMinutes! / resolution.requiredMinutes!), 4)
        : null;
      if (measured) {
        acc.presenceCompletionNumerator += Math.min(resolution.presenceMinutes!, resolution.requiredMinutes!);
        acc.presenceCompletionDenominator += resolution.requiredMinutes!;
      }

      let nineHour: string | null = null;
      if (presentLike) {
        if (resolution.presenceMinutes === null || !resolution.requiredMinutes) nineHour = 'Not Measurable';
        else if (resolution.presenceMinutes >= resolution.requiredMinutes) nineHour = 'Completed';
        else nineHour = `Shortfall ${clockOf(resolution.requiredMinutes - resolution.presenceMinutes)}`;
      }

      let punctuality = 'Not Applicable';
      let lateArrival: string | null = null;
      if (presentLike) {
        if (!resolution.punchInAt) punctuality = 'No Punch-In Recorded';
        else if (resolution.late) {
          punctuality = `Late by ${resolution.lateMinutes} min`;
          lateArrival = 'Yes';
        } else {
          punctuality = 'On Time';
          lateArrival = 'No';
        }
      }

      let hrReview = 'Not Required';
      if (dispute.held) hrReview = 'Approved Correction Held - HR to Apply';
      else if (dispute.stale) hrReview = 'Correction Stale - Re-review';
      else if (resolution.state === DAY_STATES.NEEDS_REVIEW && official) hrReview = 'Review Required';
      else if (resolution.state === DAY_STATES.NEEDS_REVIEW) hrReview = 'Not Evaluated - Review Required';
      else if (dispute.pending) hrReview = 'Correction Awaiting Decision';
      else if (official?.evaluationState === 'FINALIZED') hrReview = 'Finalized';

      if (dispute.open) acc.openDisputes += 1;
      if (resolution.coverageEligible) {
        acc.coverageEligible += 1;
        if (resolution.verified) acc.coverageVerified += 1;
      }
      if (resolution.missingPunch) {
        acc.missingPunchDetails.push(`${date.slice(8, 10)} ${MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3)} (${resolution.missingPunch})`);
      }
      const approvedMeetingHours = meeting.recorded ? hours(meeting.approvedMinutes) ?? 0 : 0;
      acc.approvedMeetingHours += approvedMeetingHours;
      for (const id of meeting.pendingMeetingIds) acc.pendingMeetingIds.add(id);

      const values: Record<string, CellValue> = {
        employeeId: e.employeeCode ?? '',
        employeeName: e.name,
        department: e.department ?? '',
        designation: e.designation ?? '',
        employeeType: e.employmentType ?? '',
        date,
        attendanceStatus: resolution.state,
        present: resolution.present,
        absent: resolution.absent,
        halfDay: resolution.halfDay,
        leave: resolution.leave,
        punchIn: wallClock(resolution.punchInAt, facts.timezone),
        punchOut: wallClock(resolution.punchOutAt, facts.timezone),
        presenceHours: hours(resolution.presenceMinutes),
        workHours: hours(workMinutes),
        breakHours: hours(resolution.breakMinutes),
        meetingHours: meeting.recorded ? hours(meeting.eligibleMinutes) : null,
        meetingVerification: meeting.status,
        lateArrival,
        nineHourCompletion: nineHour,
        leaveType: resolution.leaveType,
        leaveDeducted: resolution.leaveDeducted === null ? null : round(resolution.leaveDeducted, 2),
        lwpPortion: resolution.lwpPortion === null ? null : round(resolution.lwpPortion, 2),
        compOff: hours(compOffMinutes),
        regularized: official && official.revision > 0 && official.lastRegularizationId ? 'Yes' : 'No',
        missingPunch: resolution.missingPunch,
        schedule: resolution.schedule,
        coverage: resolution.coverage,
        presenceCompletion,
        punctuality,
        disputeStatus: dispute.label,
        hrReview,
        remarks: remarks.join('; ').slice(0, 1000),
      };

      dailyRows.push({ userId: e.userId, businessDate: date, values, unresolved: resolution.unresolved });
    }

    const last = dailyRows.length - 1;
    const rows = dailyRows.slice(first, last + 1).map((r) => r.values);
    monthlySummaryRows.push({
      userId: e.userId,
      dailyRange: { first, last },
      values: summarise(e, rows, acc, facts, monthComplete),
    });
  }

  const provisional = !monthComplete || monthlySummaryRows.some((r) => r.values.provisional === 'Yes');
  if (!monthComplete) {
    warnings.push('The month is not complete yet; every figure is provisional.');
  }

  return {
    metadata: {
      month: facts.month,
      monthLabel: monthLabel(facts.month),
      from,
      to,
      generatedAt: facts.generatedAt,
      timezone: facts.timezone,
      scope: facts.scope,
      departmentName: facts.departmentName,
      employees: employees.length,
      provisional,
      monthComplete,
    },
    dailyRows,
    monthlySummaryRows,
    warnings,
  };
}

const sum = (rows: Record<string, CellValue>[], k: string, where: (r: Record<string, CellValue>) => boolean = () => true) =>
  round(rows.filter(where).reduce((n, r) => n + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0), 2);
const count = (rows: Record<string, CellValue>[], where: (r: Record<string, CellValue>) => boolean) => rows.filter(where).length;

function summarise(
  e: ReportEmployeeFacts,
  rows: Record<string, CellValue>[],
  acc: {
    presenceCompletionNumerator: number;
    presenceCompletionDenominator: number;
    coverageVerified: number;
    coverageEligible: number;
    approvedMeetingHours: number;
    pendingMeetingIds: Set<string>;
    openDisputes: number;
    missingPunchDetails: string[];
  },
  facts: ReportSourceFacts,
  monthComplete: boolean,
): Record<string, CellValue> {
  const state = (s: string) => (r: Record<string, CellValue>) => r.attendanceStatus === s;
  const present = sum(rows, 'present');
  const absent = sum(rows, 'absent');
  const half = sum(rows, 'halfDay');
  const unresolved = count(rows, state(DAY_STATES.NEEDS_REVIEW));
  const eligible = round(present + absent + half, 2);
  const lateYes = count(rows, (r) => r.lateArrival === 'Yes');
  const lateNo = count(rows, (r) => r.lateArrival === 'No');
  const lwpDays = round(
    sum(rows, 'lwpPortion', state(DAY_STATES.LWP)) + sum(rows, 'lwpPortion', state(DAY_STATES.HALF_DAY)),
    2,
  );
  const provisional = !monthComplete || unresolved > 0 || acc.openDisputes > 0;

  return {
    employeeId: e.employeeCode ?? '',
    employeeName: e.name,
    department: e.department ?? '',
    designation: e.designation ?? '',
    employeeType: e.employmentType ?? '',
    month: monthLabel(facts.month),
    financialYear: facts.financialYear,
    workingDays: count(
      rows,
      (r) => r.schedule === SCHEDULE.WORKDAY && r.attendanceStatus !== DAY_STATES.NOT_YET_JOINED && r.attendanceStatus !== DAY_STATES.POST_EMPLOYMENT,
    ),
    presentDays: present,
    absentDays: absent,
    halfDays: half,
    leaveDays: sum(rows, 'leave'),
    weeklyOffDays: count(
      rows,
      (r) => r.schedule === SCHEDULE.WEEKLY_OFF && (r.attendanceStatus === DAY_STATES.WEEKLY_OFF || r.attendanceStatus === DAY_STATES.HOLIDAY_WORKED),
    ),
    holidayDays: count(
      rows,
      (r) => r.schedule === SCHEDULE.HOLIDAY && (r.attendanceStatus === DAY_STATES.HOLIDAY || r.attendanceStatus === DAY_STATES.HOLIDAY_WORKED),
    ),
    notYetJoinedDays: count(rows, state(DAY_STATES.NOT_YET_JOINED)),
    unresolvedDays: unresolved,
    lateDays: lateYes,
    daysBelowNineHours: count(rows, (r) => typeof r.nineHourCompletion === 'string' && r.nineHourCompletion.startsWith('Shortfall')),
    presenceHours: sum(rows, 'presenceHours'),
    workHours: sum(rows, 'workHours'),
    breakHours: sum(rows, 'breakHours'),
    meetingDays: count(rows, (r) => typeof r.meetingHours === 'number' && r.meetingHours > 0),
    meetingHours: sum(rows, 'meetingHours'),
    approvedMeetingHours: round(acc.approvedMeetingHours, 2),
    pendingMeetingApprovals: acc.pendingMeetingIds.size,
    clUsed: sum(rows, 'leave', (r) => r.leaveType === CASUAL_LEAVE_LABEL),
    lwpDays,
    attendanceDeductions: round(sum(rows, 'lwpPortion') - lwpDays, 2),
    approvedCompOff: sum(rows, 'compOff'),
    missingPunch:
      acc.missingPunchDetails.length === 0
        ? '0'
        : `${acc.missingPunchDetails.length}: ${acc.missingPunchDetails.join('; ')}`,
    eligibleWorkingDays: eligible,
    // Blank, never 0, while any eligible day is unresolved or nothing is measurable.
    attendancePercent: unresolved > 0 || eligible === 0 ? null : round((present + 0.5 * half) / eligible, 4),
    presenceCompletion:
      acc.presenceCompletionDenominator === 0
        ? null
        : round(acc.presenceCompletionNumerator / acc.presenceCompletionDenominator, 4),
    punctualityPercent: lateYes + lateNo === 0 ? null : round(lateNo / (lateYes + lateNo), 4),
    coveragePercent: acc.coverageEligible === 0 ? null : round(acc.coverageVerified / acc.coverageEligible, 4),
    provisional: provisional ? 'Yes' : 'No',
    pendingDisputes: acc.openDisputes,
  };
}

// ── Day resolution ──────────────────────────────────────────────────────────

interface DayInput {
  e: ReportEmployeeFacts;
  date: BusinessDate;
  today: BusinessDate;
  official: ReportOfficialDay | null;
  calendarDay: { isWorkingDay: boolean; reason: string; holidayName: string | null } | null;
  profile: ReportProfileFacts | null;
  sessions: { startWorkAt: Date | null; logoutAt: Date | null; totalWorkMinutes: number; totalBreakMinutes: number }[];
  punches: { type: string; at: Date }[];
  approvedLeaves: ReportLeaveFacts[];
  leaveById: Map<string, ReportLeaveFacts>;
}

function calendarSchedule(day: DayInput['calendarDay']): string {
  if (!day || day.isWorkingDay) return SCHEDULE.WORKDAY;
  return day.reason === 'HOLIDAY' || day.reason === 'COMPANY_CLOSURE' ? SCHEDULE.HOLIDAY : SCHEDULE.WEEKLY_OFF;
}

function blank(state: DayState, schedule: string, coverage: string, extra: Partial<DayResolution> = {}): DayResolution {
  return {
    state,
    schedule,
    unresolved: false,
    present: 0,
    absent: 0,
    halfDay: 0,
    leave: 0,
    punchInAt: null,
    punchOutAt: null,
    presenceMinutes: null,
    requiredMinutes: null,
    workMinutes: null,
    breakMinutes: null,
    late: null,
    lateMinutes: 0,
    leaveType: null,
    leaveDeducted: null,
    lwpPortion: null,
    coverage,
    coverageEligible: false,
    verified: false,
    remarks: [],
    missingPunch: '',
    ...extra,
  };
}

const span = (a: Date | null, b: Date | null) =>
  a && b ? Math.max(0, Math.floor((b.getTime() - a.getTime()) / 60_000)) : null;

/** Worked on a non-working day: punch evidence first, sessions second. */
function workedOff(input: DayInput) {
  const ins = input.punches.filter((p) => p.type === 'PUNCH_IN').sort((a, b) => a.at.getTime() - b.at.getTime());
  const outs = input.punches.filter((p) => p.type === 'PUNCH_OUT').sort((a, b) => a.at.getTime() - b.at.getTime());
  const started = input.sessions.filter((s) => s.startWorkAt).sort((a, b) => a.startWorkAt!.getTime() - b.startWorkAt!.getTime());
  const closed = input.sessions.filter((s) => s.logoutAt);
  if (ins.length === 0 && started.length === 0) return null;
  const punchInAt = ins[0]?.at ?? started[0]?.startWorkAt ?? null;
  const lastLogout = closed.map((s) => s.logoutAt!).sort((a, b) => a.getTime() - b.getTime()).pop() ?? null;
  const punchOutAt = outs[outs.length - 1]?.at ?? lastLogout;
  return {
    punchInAt,
    punchOutAt,
    workMinutes: closed.reduce((n, s) => n + (s.totalWorkMinutes ?? 0), 0),
    breakMinutes: closed.reduce((n, s) => n + (s.totalBreakMinutes ?? 0), 0),
  };
}

function nonWorking(input: DayInput, state: DayState, schedule: string, coverage: string, remark: string | null): DayResolution {
  const worked = workedOff(input);
  const remarks = remark ? [remark] : [];
  if (!worked) return blank(state, schedule, coverage, { remarks });
  return blank(DAY_STATES.HOLIDAY_WORKED, schedule, coverage, {
    remarks,
    punchInAt: worked.punchInAt,
    punchOutAt: worked.punchOutAt,
    presenceMinutes: span(worked.punchInAt, worked.punchOutAt),
    workMinutes: worked.workMinutes,
    breakMinutes: worked.breakMinutes,
    missingPunch: worked.punchOutAt ? '' : 'Punch-out missing',
  });
}

function missingPunchOf(o: ReportOfficialDay): string {
  const flags = o.exceptionFlags ?? [];
  if (flags.includes('NO_ATTENDANCE_EVIDENCE')) return 'No punch recorded';
  if (flags.includes('MISSING_PUNCH_OUT')) return 'Punch-out missing';
  if (flags.includes('MISSING_PUNCH') && !o.punchInAt) return 'Punch-in missing';
  if (flags.includes('MISSING_PUNCH')) return 'Punch evidence missing';
  return '';
}

function resolveDay(input: DayInput): DayResolution {
  const { e, date, today, official, calendarDay, profile } = input;
  const schedule =
    official?.status === 'HOLIDAY'
      ? SCHEDULE.HOLIDAY
      : official?.status === 'WEEKLY_OFF'
        ? SCHEDULE.WEEKLY_OFF
        : official
          ? SCHEDULE.WORKDAY
          : calendarSchedule(calendarDay);
  const holidayRemark = calendarDay?.holidayName ? `Holiday: ${calendarDay.holidayName}` : null;

  // Employment boundaries first: nothing before joining or after leaving is a
  // working day for this person, whatever the calendar says.
  if (e.joiningDate && date < e.joiningDate) return blank(DAY_STATES.NOT_YET_JOINED, calendarSchedule(calendarDay), 'Not Applicable');
  if (e.lastWorkingDate && date > e.lastWorkingDate) {
    return blank(DAY_STATES.POST_EMPLOYMENT, calendarSchedule(calendarDay), 'Not Applicable');
  }

  // A day that has not happened is not a day anyone can be judged on. Today is
  // shown once its official result is settled; until then it is still future.
  const todaySettled =
    date === today &&
    !!official &&
    official.evaluationState !== 'NEEDS_REVIEW' &&
    official.calculationReason !== 'WORKDAY_IN_PROGRESS';
  if (date > today || (date === today && !todaySettled)) {
    return blank(DAY_STATES.FUTURE, calendarSchedule(calendarDay), 'Not Applicable');
  }

  const required = profile?.requiredPresenceMinutes ?? 540;

  if (!official) {
    if (calendarDay && !calendarDay.isWorkingDay) {
      const state = calendarSchedule(calendarDay) === SCHEDULE.HOLIDAY ? DAY_STATES.HOLIDAY : DAY_STATES.WEEKLY_OFF;
      return nonWorking(input, state, calendarSchedule(calendarDay), 'Calendar Only (Not Evaluated)', holidayRemark);
    }
    const exempt = profile && (!profile.attendanceRequired || profile.category === 'MANAGEMENT_EXEMPT');
    if (exempt) return blank(DAY_STATES.NOT_REQUIRED, schedule, 'Not Applicable');

    // Approved full-day leave is a decided fact even before evaluation ran.
    const leaves = input.approvedLeaves;
    if (leaves.length === 1 && !leaves[0].isHalfDay) {
      const l = leaves[0];
      return blank(l.type === 'UNPAID' ? DAY_STATES.LWP : DAY_STATES.APPROVED_LEAVE, schedule, 'Leave Record Only (Not Evaluated)', {
        leave: 1,
        leaveType: leaveTypeLabel(l.type),
        coverageEligible: true,
      });
    }
    // A past working day with no official result is UNKNOWN, never absent.
    return blank(DAY_STATES.NEEDS_REVIEW, schedule, 'Not Evaluated', {
      unresolved: true,
      coverageEligible: true,
      remarks: ['No official attendance result for this day'],
    });
  }

  const flags = official.exceptionFlags ?? [];
  const remarks = flags.map((f) => FLAG_REMARK[f]).filter((r): r is string => !!r);
  const leave = official.leaveRequestId ? input.leaveById.get(official.leaveRequestId) ?? null : null;
  const coverage =
    official.evaluationState === 'FINALIZED'
      ? 'Verified (Finalized)'
      : official.evaluationState === 'NEEDS_REVIEW'
        ? 'Needs Review'
        : 'Calculated (Not Finalized)';
  const verified = official.evaluationState !== 'NEEDS_REVIEW';
  const presence = span(official.punchInAt, official.punchOutAt);

  if (official.status === 'HOLIDAY' || official.status === 'WEEKLY_OFF') {
    return nonWorking(
      input,
      official.status === 'HOLIDAY' ? DAY_STATES.HOLIDAY : DAY_STATES.WEEKLY_OFF,
      schedule,
      coverage,
      official.status === 'HOLIDAY' ? holidayRemark : null,
    );
  }

  const base: Partial<DayResolution> = {
    punchInAt: official.punchInAt,
    punchOutAt: official.punchOutAt,
    presenceMinutes: presence,
    requiredMinutes: required,
    workMinutes: official.workedMinutes,
    breakMinutes: official.breakMinutes,
    lateMinutes: official.lateMinutes,
    late: official.punchInAt ? official.lateMinutes > 0 : null,
    leaveType: leaveTypeLabel(leave?.type),
    leaveDeducted: official.leaveDeducted,
    lwpPortion: official.lwpDeducted,
    coverageEligible: true,
    verified,
    remarks,
    missingPunch: missingPunchOf(official),
  };

  if (official.evaluationState === 'NEEDS_REVIEW') {
    // Official values stay visible; the day is simply not a settled outcome.
    return blank(DAY_STATES.NEEDS_REVIEW, schedule, coverage, { ...base, unresolved: true });
  }

  // An absence stored on a day the business calendar does not schedule is a
  // conflict between two authorities, not a fact. Charging it would put a
  // false absence against a real name, so it is held for review instead.
  const absenceOutcome =
    official.status === 'ABSENT' || (official.status === 'LWP' && official.calculationReason !== 'APPROVED_UNPAID_LEAVE');
  if (absenceOutcome && calendarDay && !calendarDay.isWorkingDay) {
    return blank(DAY_STATES.NEEDS_REVIEW, calendarSchedule(calendarDay), coverage, {
      ...base,
      unresolved: true,
      verified: false,
      remarks: [...remarks, `Official ${official.status} on a non-working calendar day; needs review`],
    });
  }

  if (PRESENT_STATUSES.has(official.status)) {
    const short =
      official.calculationReason === 'REFINED_SHORT_DAY' ||
      flags.includes('INSUFFICIENT_PRESENCE_SPAN') ||
      (presence !== null && presence < required);
    const late = official.lateMinutes > 0;
    // Short presence and lateness are independent facts. Both are reported in
    // their own columns; a day that is both carries the Short Hours status.
    const state = short ? DAY_STATES.SHORT_HOURS : late ? DAY_STATES.LATE : DAY_STATES.PRESENT;
    if (official.status === 'LATE_EXEMPTED') base.remarks = [...(base.remarks ?? []), 'Late arrival exempted by policy'];
    return blank(state, schedule, coverage, { ...base, present: 1 });
  }

  switch (official.status) {
    case 'HALF_DAY': {
      const halfLeave = official.calculationReason === 'APPROVED_HALF_DAY_LEAVE';
      return blank(DAY_STATES.HALF_DAY, schedule, coverage, { ...base, halfDay: 1, leave: halfLeave ? 0.5 : 0 });
    }
    case 'ABSENT':
      return blank(DAY_STATES.ABSENT, schedule, coverage, { ...base, absent: 1 });
    case 'LEAVE':
      return blank(DAY_STATES.APPROVED_LEAVE, schedule, coverage, { ...base, leave: 1, late: null });
    case 'LWP': {
      // LWP granted as approved unpaid LEAVE is leave. Any other LWP (the
      // three-day unreported-absence rule, a policy action) is an absence.
      const fromLeave = official.calculationReason === 'APPROVED_UNPAID_LEAVE';
      return blank(DAY_STATES.LWP, schedule, coverage, {
        ...base,
        late: null,
        leave: fromLeave ? 1 : 0,
        absent: fromLeave ? 0 : 1,
        leaveType: fromLeave ? base.leaveType ?? leaveTypeLabel('UNPAID') : null,
      });
    }
    default:
      // MISSING_PUNCH, PENDING_REGULARIZATION, GEO_MISMATCH, FACE_MISSING are
      // review states, not outcomes.
      return blank(DAY_STATES.NEEDS_REVIEW, schedule, coverage, { ...base, unresolved: true, verified: false });
  }
}
