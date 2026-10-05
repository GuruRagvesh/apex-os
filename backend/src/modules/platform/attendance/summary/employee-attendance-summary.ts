/**
 * The employee Attendance dashboard's arithmetic — the pure part.
 *
 * Everything here is a function of facts already resolved elsewhere: no
 * Prisma, no policy lookup, no re-evaluation. This file counts and averages
 * what DailyAttendance rows and the daily context already say; it does not
 * decide what a day's status is, what required presence means, or when a
 * comp off expires. Those answers come from the evaluator, the required-
 * presence resolver, and the comp off domain respectively, and this dashboard
 * calls them -- it does not keep a second copy.
 *
 * THE INVARIANTS THIS FILE EXISTS TO PROTECT
 *
 *   OFFICE PRESENCE = effective punch out − effective punch in. Breaks never
 *   reduce it. EFFECTIVE WORK is a different number (the Workday engine's own
 *   worked-minutes figure), shown separately, never substituted for presence.
 *
 *   UNRESOLVED IS NOT ABSENT. A day with NEEDS_REVIEW, or a day with no
 *   persisted record at all, is a data-quality problem, not an attendance
 *   outcome, and is never folded into the absence count.
 *
 *   A HALF-CONFIGURED OR MISSING POLICY PRODUCES NO SHORTFALL FIGURE, rather
 *   than a shortfall computed against an invented number.
 */

export type DailyAttendanceStatus =
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

export interface AttendanceDayFacts {
  businessDate: string;
  /** Null when no record exists for this date at all -- see isUnresolved(). */
  status: DailyAttendanceStatus | null;
  evaluationState: EvaluationState | null;
  punchInAt: Date | null;
  punchOutAt: Date | null;
  /** Effective Work -- the Workday engine's figure. NOT office presence. */
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  /** True once the month/day has been finalized. Read-only, frozen truth. */
  locked: boolean;
  /**
   * Before joining, after leaving, or a management-exempt category -- a day
   * that was never an attendance day for this person at all, which is why
   * DailyAttendanceEvaluatorService.evaluateAndPersist() never writes a row
   * for it ("Non-applicable and blocked days produce no official record at
   * all"). Without this flag such a day is indistinguishable from a genuine
   * gap in the record and would inflate needs-attention for every exempt
   * employee, every day, forever.
   */
  notApplicable?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Office presence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Office presence for one day: effective punch out minus effective punch in.
 *
 * Null when either punch is missing -- there is no presence figure to show,
 * and 0 would read as "present for zero minutes" rather than "unmeasured".
 * Never reads breakMinutes; that is the whole point of this function existing
 * separately from workedMinutes.
 */
export function officePresenceMinutes(day: Pick<AttendanceDayFacts, 'punchInAt' | 'punchOutAt'>): number | null {
  if (!day.punchInAt || !day.punchOutAt) return null;
  const minutes = Math.floor((day.punchOutAt.getTime() - day.punchInAt.getTime()) / 60_000);
  return minutes >= 0 ? minutes : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unresolved vs. absent
// ─────────────────────────────────────────────────────────────────────────────

/** A data-quality gap: no record, or one still needing review. Not an outcome. */
export function isUnresolved(day: Pick<AttendanceDayFacts, 'status' | 'evaluationState' | 'notApplicable'>): boolean {
  if (day.notApplicable) return false; // Not a gap -- there was never a record to have.
  return day.status === null || day.evaluationState === 'NEEDS_REVIEW';
}

const FULL_DAY_STATUSES: DailyAttendanceStatus[] = ['PRESENT', 'LATE', 'LATE_EXEMPTED'];
const APPROVED_LEAVE_STATUSES: DailyAttendanceStatus[] = ['LEAVE', 'LWP'];

// ─────────────────────────────────────────────────────────────────────────────
// Month counts
// ─────────────────────────────────────────────────────────────────────────────

export interface MonthCounts {
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
  /** Days with no record at all -- a subset of needsReview's spirit, counted separately. */
  noRecord: number;
  /** Before joining, after leaving, or exempt. Not a problem; not a count of anything else either. */
  notApplicable: number;
}

/**
 * One month's status counts.
 *
 * `requiredPresenceMinutes` is nullable ON PURPOSE: a half-configured or
 * unassigned policy produces no shortfall count, rather than one measured
 * against a guessed number. Pass null to omit shortfall entirely (the caller
 * reports why, using the same resolver the completion trigger uses).
 */
export function summariseMonth(
  days: AttendanceDayFacts[],
  requiredPresenceMinutes: number | null,
): MonthCounts {
  const counts: MonthCounts = {
    present: 0, late: 0, halfDay: 0, fullDay: 0, approvedLeaveDays: 0,
    missingPunchIn: 0, missingPunchOut: 0, requiredHoursShortfall: 0,
    needsReview: 0, absent: 0, noRecord: 0, notApplicable: 0,
  };

  for (const day of days) {
    if (day.notApplicable) {
      counts.notApplicable += 1;
      continue; // Not a gap. Never counted as anything else, including noRecord.
    }

    // NEEDS_REVIEW IS CHECKED BEFORE "no record", not after. A context-blocked
    // day (a real configuration gap HR must fix) arrives from evaluate() with
    // status: null AND evaluationState: 'NEEDS_REVIEW' -- the same status
    // shape as a day tonight's cron simply has not reached yet. Checking
    // status first would file every context-blocked day under the generic,
    // low-urgency noRecord bucket and never surface it as needing review at
    // all, which is the one thing this count exists to catch.
    if (day.evaluationState === 'NEEDS_REVIEW') {
      counts.needsReview += 1;
    } else if (day.status === null) {
      counts.noRecord += 1;
      continue; // UNRESOLVED, and not a review case either. Never absent below.
    }

    if (day.status === null) {
      // Reached only for a NEEDS_REVIEW day with no provisional status at
      // all. Nothing further to count -- there is no status to classify by.
      continue;
    }

    // A day under review that DOES carry a provisional status (e.g. it may
    // already show MISSING_PUNCH) falls through and counts there too -- but
    // is never counted as ABSENT regardless of what that provisional status
    // says; see the ABSENT check below.
    if (day.status === 'PRESENT') counts.present += 1;
    if (day.status === 'LATE' || day.status === 'LATE_EXEMPTED') counts.late += 1;
    if (day.status === 'HALF_DAY') counts.halfDay += 1;
    if (FULL_DAY_STATUSES.includes(day.status)) counts.fullDay += 1;
    if (APPROVED_LEAVE_STATUSES.includes(day.status)) counts.approvedLeaveDays += 1;
    if (day.status === 'MISSING_PUNCH') {
      if (!day.punchInAt) counts.missingPunchIn += 1;
      if (!day.punchOutAt) counts.missingPunchOut += 1;
    }
    if (day.status === 'ABSENT' && day.evaluationState !== 'NEEDS_REVIEW') {
      counts.absent += 1;
    }

    // The `!== null` guard here is deliberately explicit rather than relying
    // on `presence < requiredPresenceMinutes` to coerce a null policy to 0:
    // presence is never negative by construction, so that coercion happens to
    // produce the same zero-shortfall answer today, but a future change to
    // officePresenceMinutes's contract (an overtime-deficit sentinel, say)
    // could silently make an unconfigured policy start counting shortfalls.
    // Explicit costs nothing and does not depend on that staying true.
    if (
      requiredPresenceMinutes !== null &&
      FULL_DAY_STATUSES.includes(day.status)
    ) {
      const presence = officePresenceMinutes(day);
      if (presence !== null && presence < requiredPresenceMinutes) {
        counts.requiredHoursShortfall += 1;
      }
    }
  }

  return counts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Time metrics: averages over the days that actually have both punches
// ─────────────────────────────────────────────────────────────────────────────

export interface TimeMetrics {
  /** Minutes since midnight, company time. Null if no day qualifies. */
  averagePunchInMinutes: number | null;
  averagePunchOutMinutes: number | null;
  averageOfficePresenceMinutes: number | null;
  averageEffectiveWorkMinutes: number | null;
  averageBreakMinutes: number | null;
  /** How many days the averages above are drawn from. */
  sampleSize: number;
}

const NO_METRICS: TimeMetrics = {
  averagePunchInMinutes: null, averagePunchOutMinutes: null,
  averageOfficePresenceMinutes: null, averageEffectiveWorkMinutes: null,
  averageBreakMinutes: null, sampleSize: 0,
};

/**
 * Averages, computed ONLY over days with both a punch in and a punch out.
 *
 * A half-punched day (one side missing) is excluded from every average here
 * rather than treated as a zero -- a single MISSING_PUNCH day would otherwise
 * drag "average punch out" toward midnight and make the whole card read as
 * nonsense.
 */
export function averageTimeMetrics(
  days: AttendanceDayFacts[],
  minutesOfDay: (at: Date) => number,
): TimeMetrics {
  const complete = days.filter((d) => d.punchInAt && d.punchOutAt);
  if (complete.length === 0) return NO_METRICS;

  const sum = (fn: (d: AttendanceDayFacts) => number) =>
    complete.reduce((total, d) => total + fn(d), 0);

  return {
    averagePunchInMinutes: Math.round(sum((d) => minutesOfDay(d.punchInAt as Date)) / complete.length),
    averagePunchOutMinutes: Math.round(sum((d) => minutesOfDay(d.punchOutAt as Date)) / complete.length),
    averageOfficePresenceMinutes: Math.round(
      sum((d) => officePresenceMinutes(d) ?? 0) / complete.length,
    ),
    averageEffectiveWorkMinutes: Math.round(sum((d) => d.workedMinutes) / complete.length),
    averageBreakMinutes: Math.round(sum((d) => d.breakMinutes) / complete.length),
    sampleSize: complete.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Presentation
// ─────────────────────────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<DailyAttendanceStatus, string> = {
  PRESENT: 'On Time',
  LATE: 'Late',
  LATE_EXEMPTED: 'Late (Exempted)',
  LEAVE: 'Approved Leave',
  HALF_DAY: 'Half Day',
  WEEKLY_OFF: 'Weekly Off',
  HOLIDAY: 'Holiday',
  LWP: 'Leave Without Pay',
  ABSENT: 'Absent',
  MISSING_PUNCH: 'Missing Punch',
  PENDING_REGULARIZATION: 'Pending Regularization',
  GEO_MISMATCH: 'Needs Review',
  FACE_MISSING: 'Needs Review',
};

/** Human wording, never the raw enum. An unresolved day says so plainly. */
export function statusLabel(status: DailyAttendanceStatus | null, evaluationState: EvaluationState | null): string {
  if (status === null) return 'Needs Review';
  if (evaluationState === 'NEEDS_REVIEW') return 'Needs Review';
  return STATUS_LABEL[status] ?? 'Needs Review';
}

/**
 * Minutes as "9h 02m" -- padded and spaced, per the format this dashboard was
 * specified in. Deliberately its OWN formatter: Reminder V2's
 * formatDuration() renders "9h2m" (no space, no padding), a different
 * decision for a different surface, and importing it here would silently
 * change this one's output.
 */
export function formatDurationMinutes(totalMinutes: number | null): string {
  // !Number.isFinite already covers null on its own -- Number.isFinite(null)
  // is false, same as NaN or Infinity -- so an explicit `=== null` check
  // beside it is dead weight that mutation testing correctly flagged as
  // unkillable: nothing can distinguish the two for this parameter's type.
  if (!Number.isFinite(totalMinutes) || (totalMinutes as number) < 0) return '—';
  const whole = Math.floor(totalMinutes);
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Minutes since midnight as "HH:MM", company time. */
export function formatClockMinutes(minutesOfDay: number | null): string {
  if (minutesOfDay === null || !Number.isFinite(minutesOfDay)) return '—';
  const clamped = Math.max(0, Math.round(minutesOfDay));
  const h = Math.floor(clamped / 60) % 24;
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenure
// ─────────────────────────────────────────────────────────────────────────────

export interface Tenure {
  years: number;
  months: number;
  /** False when joiningDate is unknown -- never fabricated. */
  known: boolean;
}

const UNKNOWN_TENURE: Tenure = { years: 0, months: 0, known: false };

/**
 * Whole years and months between joining and either today or the last
 * working date. Returns UNKNOWN rather than a guess when joiningDate is
 * absent -- a master-data gap, not a licence to assume "just joined".
 */
export function computeTenure(
  joiningDate: Date | null,
  asOf: Date,
  lastWorkingDate: Date | null,
): Tenure {
  if (!joiningDate) return UNKNOWN_TENURE;
  const end = lastWorkingDate && lastWorkingDate < asOf ? lastWorkingDate : asOf;
  if (end < joiningDate) return { years: 0, months: 0, known: true };

  let years = end.getUTCFullYear() - joiningDate.getUTCFullYear();
  let months = end.getUTCMonth() - joiningDate.getUTCMonth();
  if (end.getUTCDate() < joiningDate.getUTCDate()) months -= 1;
  if (months < 0) { years -= 1; months += 12; }

  return { years, months, known: true };
}
