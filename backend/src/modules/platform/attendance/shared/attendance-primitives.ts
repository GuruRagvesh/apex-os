/**
 * The attendance decisions that must have exactly one implementation.
 *
 * WHY THIS FILE EXISTS. Each primitive below was independently implemented in
 * several places, and the copies had already begun to disagree:
 *
 *   presence span        5 sites, 1 of them a named function
 *   the "present" set    2 byte-identical Sets with no shared import
 *   the late threshold   4 sources, one a hardcoded '10:30:00' in the console
 *                        that applied the Team-Lead window to every employee
 *   required minutes     4 sources, one of them the evaluator re-implementing
 *                        resolveRequiredPresence inline
 *
 * See docs/architecture/ATTENDANCE_CANONICALIZATION_AUDIT.md for the grep
 * evidence behind each of those counts.
 *
 * Everything here is PURE: no Prisma, no clock, no injected services. Callers
 * pass facts they have already read, which is what lets the evaluator, the
 * console, the export and the audit tooling share one answer instead of four.
 *
 * Nothing in this file decides what a day WAS. It answers narrow questions
 * about supplied facts. The official verdict stays with the evaluator.
 */

// ════════════════════════════════════════════════════════════════════════════
// Required presence
// ════════════════════════════════════════════════════════════════════════════

/**
 * Used only when neither the shift nor the policy supplies a figure.
 *
 * It exists so the resolver can never return null and leave a caller to invent
 * a fallback of its own, which is how four different 540s appeared. The
 * `source` on the result says when this value was used, so a day running on the
 * system default is distinguishable from one running on a configured number.
 */
export const SYSTEM_FALLBACK_PRESENCE_MINUTES = 540;

export type RequiredPresenceSource = 'SHIFT_POLICY' | 'ATTENDANCE_POLICY' | 'SYSTEM_FALLBACK';

export interface ResolvedPresence {
  minutes: number;
  source: RequiredPresenceSource;
}

/**
 * The required presence SPAN for an employee-day, and which record decided it.
 *
 * Shift first, then attendance policy, then the system fallback. That order is
 * the existing rule: a shift is the more specific assignment, so when both hold
 * a figure the shift's wins.
 *
 * NEVER RETURNS NULL. A caller handed null would have to invent something, and
 * every place that did invented its own 540 -- the evaluator inline at
 * daily-attendance-evaluator.service.ts:602, the payroll register, and the
 * settings defaults. The fallback is returned explicitly and labelled instead.
 *
 * Zero and negative are treated as "not configured" rather than as a
 * requirement of no time, because a requirement of zero would make every day
 * complete.
 *
 * NOTE ON PROVENANCE. An equivalent function exists on the unmerged branch
 * `feature/attendance-settings-control-center` (added in c7f52ec) at
 * attendance/settings/attendance-policy-settings.ts. This is the canonical
 * home; when that branch merges, the settings copy should import from here
 * rather than the two coexisting.
 */
export function resolveRequiredPresence(
  shiftMinutes: number | null | undefined,
  policyMinutes: number | null | undefined,
): ResolvedPresence {
  if (typeof shiftMinutes === 'number' && shiftMinutes > 0) {
    return { minutes: shiftMinutes, source: 'SHIFT_POLICY' };
  }
  if (typeof policyMinutes === 'number' && policyMinutes > 0) {
    return { minutes: policyMinutes, source: 'ATTENDANCE_POLICY' };
  }
  return { minutes: SYSTEM_FALLBACK_PRESENCE_MINUTES, source: 'SYSTEM_FALLBACK' };
}

// ════════════════════════════════════════════════════════════════════════════
// Status
// ════════════════════════════════════════════════════════════════════════════

/**
 * The statuses that mean the employee attended.
 *
 * LATE and LATE_EXEMPTED are attendance, not absence. Lateness is a separate
 * axis -- see §12 of the brief and `lateMinutesFrom` below -- so a late arrival
 * counts as present and carries its lateness alongside.
 */
export const PRESENT_STATUSES: ReadonlySet<string> = new Set([
  'PRESENT',
  'LATE',
  'LATE_EXEMPTED',
]);

export function isPresentStatus(status: string | null | undefined): boolean {
  return status != null && PRESENT_STATUSES.has(status);
}

/** Days the company did not expect work. They are never absence. */
export const NON_WORKING_STATUSES: ReadonlySet<string> = new Set(['WEEKLY_OFF', 'HOLIDAY']);

export function isNonWorkingStatus(status: string | null | undefined): boolean {
  return status != null && NON_WORKING_STATUSES.has(status);
}

// ════════════════════════════════════════════════════════════════════════════
// Presence
// ════════════════════════════════════════════════════════════════════════════

const toTime = (value: Date | string | null | undefined): number | null => {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/**
 * Attendance presence in minutes: effective punch out minus effective punch in.
 *
 * THE INVARIANT THE WHOLE MODULE EXISTS TO HOLD.
 *
 * Breaks never reduce it -- a break happens inside the span, so subtracting it
 * would charge the employee twice for the same hour. Worked minutes and the
 * workday span are different figures, reported in their own columns, and are
 * NEVER substituted here: only presence is measured against the requirement.
 *
 * Null when either punch is missing, and null is not zero. Zero is a
 * measurement -- "they were here for no time" -- while null is "we cannot say".
 * A day with one punch is incomplete, and inventing the other end of the span
 * would fabricate presence nobody recorded.
 */
export function presenceMinutes(
  punchInAt: Date | string | null | undefined,
  punchOutAt: Date | string | null | undefined,
): number | null {
  const inMs = toTime(punchInAt);
  const outMs = toTime(punchOutAt);
  if (inMs === null || outMs === null) return null;
  // Clamped at zero rather than returning a negative span. A punch out before
  // the punch in is a contradiction the evaluator flags; it is not a negative
  // amount of time spent at work.
  return Math.max(0, Math.round((outMs - inMs) / 60_000));
}

/**
 * The earliest time work actually started among a day's sessions.
 *
 * REPLACES `sessions[0]?.startWorkAt`, which was positional and therefore wrong
 * whenever the day's earliest-created session has no start time. An ON_LEAVE
 * session is the ordinary way that happens: the leave scheduler writes one at
 * 00:01 with no startWorkAt, so it sorts first by createdAt, and a positional
 * read returned null for a day the employee then genuinely worked. Attendance
 * recorded worked minutes with no arrival, which leaves presence uncomputable
 * and flows into payroll.
 *
 * A null start is NOT corrupt data and is not treated as such. An ON_LEAVE row
 * is legitimate and stays visible everywhere else; it simply is not a statement
 * about when anybody arrived, so it cannot answer this question.
 *
 * Compared by TIMESTAMP, not by array position, so the answer does not depend
 * on how the caller's query happened to be ordered -- and a later re-login
 * cannot displace the original start, because the earliest always wins.
 *
 * An unparseable timestamp is skipped rather than poisoning the comparison with
 * NaN, which would otherwise make the result depend on iteration order.
 */
export function earliestSessionStart(
  sessions: Array<{ startWorkAt: Date | string | null | undefined }>,
): Date | null {
  return sessions.reduce<Date | null>((earliest, session) => {
    const ms = toTime(session?.startWorkAt);
    if (ms === null) return earliest;
    const value = new Date(ms);
    return !earliest || value < earliest ? value : earliest;
  }, null);
}

// ════════════════════════════════════════════════════════════════════════════
// Employment eligibility, by date
// ════════════════════════════════════════════════════════════════════════════

export type EmploymentReason =
  | 'EMPLOYED'
  | 'BEFORE_JOINING'
  | 'AFTER_LAST_WORKING_DATE'
  | 'NO_JOINING_DATE'
  | 'USER_NOT_FOUND';

export interface EmploymentOnDate {
  employedOnDate: boolean;
  reason: EmploymentReason;
}

/**
 * Was this employee employed on this business date?
 *
 * ASKED OF THE DATE, NEVER OF TODAY'S ACCOUNT FLAG. Historical attendance was
 * being filtered on `isActive: true`, so anybody who had since left vanished
 * from the month they actually worked -- and a person missing from a report
 * looks exactly like a person who never existed.
 *
 * joiningDate and lastWorkingDate are both INCLUSIVE: employed on the joining
 * date, and still employed on the last working day rather than from the day
 * after.
 *
 * A MISSING JOINING DATE IS UNRESOLVED, NOT THE EPOCH. Returning "employed"
 * for it would place every former employee in every month that ever was;
 * returning a silent false would hide a real employee behind a data gap. It
 * gets its own reason so the caller can say which of the two it is.
 *
 * All three arguments are company business dates in 'yyyy-MM-dd', which sort
 * lexicographically -- so the comparisons need no timezone and no Date parsing.
 */
export function employmentOnDate(
  joiningDate: string | null | undefined,
  lastWorkingDate: string | null | undefined,
  businessDate: string,
): EmploymentOnDate {
  if (!joiningDate) {
    return { employedOnDate: false, reason: 'NO_JOINING_DATE' };
  }
  if (businessDate < joiningDate) {
    return { employedOnDate: false, reason: 'BEFORE_JOINING' };
  }
  if (lastWorkingDate && businessDate > lastWorkingDate) {
    return { employedOnDate: false, reason: 'AFTER_LAST_WORKING_DATE' };
  }
  return { employedOnDate: true, reason: 'EMPLOYED' };
}

/**
 * Could this employee have been employed at any point in a date range?
 *
 * The range form of the question, for a month's export or a backfill. An
 * employee belongs in a month if their employment window OVERLAPS it, not if
 * it contains it: three weeks of September followed by a resignation on the
 * 25th is still a September employee.
 *
 * Deliberately permissive where the record is silent, because the two errors
 * are not symmetric. Including somebody with no activity costs one visibly
 * empty row; excluding somebody real costs them their pay.
 */
export function employmentOverlapsRange(
  joiningDate: string | null | undefined,
  lastWorkingDate: string | null | undefined,
  from: string,
  to: string,
): boolean {
  // Unknown start: cannot be proven outside the range, so it is not excluded
  // on window grounds. The caller decides what other evidence to require.
  if (!joiningDate) return true;
  if (joiningDate > to) return false;
  if (lastWorkingDate && lastWorkingDate < from) return false;
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// Lateness
// ════════════════════════════════════════════════════════════════════════════

/** 'HH:mm' or 'HH:mm:ss' to minutes past midnight, or null if unparseable. */
export function clockToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^([01][0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export interface LateResult {
  /** Minutes late, or null when it cannot be determined. Never negative. */
  lateMinutes: number | null;
  /** Why, when it could not be determined. */
  reason: 'ON_TIME' | 'LATE' | 'NO_PUNCH_IN' | 'NO_THRESHOLD';
}

/**
 * How late an arrival was, against the threshold that applied to THAT employee.
 *
 * LATE IS NOT A STATUS. An employee can be Present and late at the same time,
 * so this returns a quantity rather than a verdict, and the caller keeps the
 * two columns separate.
 *
 * The threshold is supplied, never inferred. It was hardcoded as '10:30:00' in
 * the console -- the Team-Lead entry window -- which meant that for an employee
 * on a 09:30 shift a 10:00 arrival was late to the evaluator and on time in the
 * register. The caller resolves the applicable shift or policy start by date
 * and passes it here.
 *
 * `arrivalMinutes` is minutes past midnight IN COMPANY TIME. Converting a
 * timestamp to that is a timezone concern and stays with the caller, which also
 * keeps this function pure.
 */
export function lateMinutesFrom(
  arrivalMinutes: number | null | undefined,
  thresholdClock: string | null | undefined,
  graceMinutes = 0,
): LateResult {
  if (arrivalMinutes == null) return { lateMinutes: null, reason: 'NO_PUNCH_IN' };

  const threshold = clockToMinutes(thresholdClock);
  // No proven threshold means no lateness claim. Falling back to a company
  // default here is how one team's window became everybody's.
  if (threshold === null) return { lateMinutes: null, reason: 'NO_THRESHOLD' };

  // The window is INCLUSIVE of the threshold plus its grace: arriving exactly
  // on it is on time.
  const allowed = threshold + Math.max(0, graceMinutes);
  if (arrivalMinutes <= allowed) return { lateMinutes: 0, reason: 'ON_TIME' };
  return { lateMinutes: arrivalMinutes - allowed, reason: 'LATE' };
}

// ════════════════════════════════════════════════════════════════════════════
// Nine-hour completion
// ════════════════════════════════════════════════════════════════════════════

export interface CompletionResult {
  /** Signed shortfall in minutes: negative means short, 0 or more means met. */
  deltaMinutes: number | null;
  met: boolean | null;
  /** Which figure the comparison used. */
  measuredAgainst: 'PRESENCE' | 'WORKED' | null;
  /** 'Completed - presence' | 'Short by 00:37 - presence' | 'Cannot determine' */
  label: string;
}

const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * Whether the day met its required presence, and by how much it missed.
 *
 * PRESENCE FIRST, WORKED TIME ONLY AS A FALLBACK, AND THE ANSWER SAYS WHICH.
 * The requirement is a presence SPAN, so comparing effective work against it
 * would fail everybody whose breaks sit inside their day. When presence cannot
 * be established -- one punch, or a session the scheduler auto-closed -- the
 * worked total is the best available figure, but the label names it so nobody
 * reads the two as the same measurement.
 *
 * A null requirement yields 'Cannot determine' rather than a pass. An
 * unprovable requirement is not evidence that the day was sufficient.
 */
export function completionAgainstRequirement(input: {
  presenceMinutes: number | null;
  workedMinutes: number | null;
  requiredMinutes: number | null;
}): CompletionResult {
  const { presenceMinutes: presence, workedMinutes: worked, requiredMinutes: required } = input;

  if (required == null) {
    return { deltaMinutes: null, met: null, measuredAgainst: null, label: 'Cannot determine' };
  }

  const measured = presence != null ? presence : worked;
  const against: 'PRESENCE' | 'WORKED' | null =
    presence != null ? 'PRESENCE' : worked != null ? 'WORKED' : null;

  if (measured == null || against == null) {
    return { deltaMinutes: null, met: null, measuredAgainst: null, label: 'Cannot determine' };
  }

  const delta = measured - required;
  const suffix = against === 'PRESENCE' ? 'presence' : 'worked time';
  return {
    deltaMinutes: delta,
    met: delta >= 0,
    measuredAgainst: against,
    label: delta >= 0 ? `Completed — ${suffix}` : `Short by ${hhmm(-delta)} — ${suffix}`,
  };
}
