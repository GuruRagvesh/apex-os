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
// The company-wide late-arrival cutoff
// ════════════════════════════════════════════════════════════════════════════

/**
 * The company-wide late cutoff: arrive after this and the day reads LATE.
 *
 * ONE COMPANY VALUE, DELIBERATELY NOT PER EMPLOYEE. This was a product
 * decision, and the alternative was explicitly rejected: deriving the cutoff
 * from each employee's own shift start made "late" mean a different wall-clock
 * time for different people, which is not what the company means by late.
 *
 * ALREADY INCLUSIVE OF GRACE. 10:30 is the cutoff, not a shift start that grace
 * is then added to -- the half hour past the 10:00 shift IS the grace, spent.
 * Adding shift grace on top would push some employees to 11:00 and quietly
 * reintroduce the per-person variation this value exists to remove.
 *
 * THE FALLBACK, NOT THE SETTING. The configured value wins; this is what the
 * company means when nothing is configured. It is named as a fallback so a
 * reader cannot mistake it for the place to change the cutoff -- that is
 * configuration, changeable without a deploy.
 */
export const COMPANY_LATE_CUTOFF_FALLBACK = '10:30';

/**
 * Where the configured cutoff lives: one AppSetting row, company-wide.
 *
 * NOT A COLUMN ON AttendancePolicy, and that was considered first. Attendance
 * policies are versioned and there are several active at once -- one series per
 * shift pattern, each with V1/V2/V3 -- so a cutoff stored there can disagree
 * with itself, and "which active policy's 10:30 is the company's 10:30" has no
 * answer. A single keyed setting cannot hold two values, which is the property
 * a company-wide figure needs. It also needs no migration, so the cutoff is
 * changeable without a deploy.
 */
export const LATE_CUTOFF_SETTING_KEY = 'attendance.lateCutoff';

/**
 * Pulls the cutoff out of whatever the Json setting column holds.
 *
 * Accepts a bare string and an object with a `clock` key, because the setting
 * is written by hand at least once before any UI exists for it, and both shapes
 * are the obvious thing to write. Anything else is not a cutoff and becomes
 * null, which resolveLateCutoff() reports as INVALID_CONFIGURED_VALUE rather
 * than passing off as "nothing configured" -- a typo and an unset value are
 * different facts and must not arrive here looking the same.
 */
export function parseConfiguredCutoff(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const clock = (value as any).clock ?? (value as any).lateCutoff;
    if (typeof clock === 'string') return clock;
  }
  // Present but not a cutoff: a number, a boolean, an array.
  //
  // null, NOT undefined, and the two are not interchangeable here. undefined
  // means nothing is configured, which is the ordinary case and resolves to the
  // company fallback quietly. null means somebody configured something that is
  // not a time, which is a mistake that has to stay visible. Collapsing them
  // would make a typo indistinguishable from an unset value -- the exact thing
  // the comment above promises not to do.
  return null;
}

export type LateCutoffSource =
  | 'CONFIGURED'
  | 'SYSTEM_FALLBACK'
  | 'INVALID_CONFIGURED_VALUE';

export interface ResolvedLateCutoff {
  /** HH:mm in company local time. Never null -- see below. */
  clock: string;
  source: LateCutoffSource;
}

/**
 * The cutoff this report runs against, and where it came from.
 *
 * NEVER RETURNS NULL, for the same reason resolveRequiredPresence does not: a
 * caller handed null has to invent something, and every caller that invented
 * one invented its own 10:30 -- the console had it hardcoded as LATE_AFTER and
 * applied it to everybody, which is the duplication this replaces.
 *
 * AN UNPARSEABLE CONFIGURED VALUE DOES NOT THROW, AND DOES NOT PASS SILENTLY.
 * Throwing would fail the whole month's report for all 56 employees over one
 * mistyped setting, and lateness is a display state -- not a reason to refuse
 * to show attendance. Falling back silently would hide the typo until somebody
 * noticed everyone's lateness had moved. So it falls back AND says
 * INVALID_CONFIGURED_VALUE, which a caller can surface.
 */
export function resolveLateCutoff(
  configured: string | null | undefined,
): ResolvedLateCutoff {
  // Nothing configured. The ordinary case, and not a problem.
  if (configured === undefined) {
    return { clock: COMPANY_LATE_CUTOFF_FALLBACK, source: 'SYSTEM_FALLBACK' };
  }
  // Configured, but not a time. Includes null from parseConfiguredCutoff (the
  // setting held a number or an array) and the empty string (somebody cleared
  // the field instead of removing the setting). Both are mistakes, and neither
  // may be reported as "nothing configured".
  if (typeof configured !== 'string' || clockToMinutes(configured) === null) {
    return { clock: COMPANY_LATE_CUTOFF_FALLBACK, source: 'INVALID_CONFIGURED_VALUE' };
  }
  return { clock: configured, source: 'CONFIGURED' };
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

// ════════════════════════════════════════════════════════════════════════════
// Second-precision presence, and the display classification
// ════════════════════════════════════════════════════════════════════════════

/**
 * Attendance presence in SECONDS. Exact, never rounded.
 *
 * presenceMinutes() rounds to the nearest minute, which is right for display
 * and wrong for classification: Math.round(539.98) is 540, so 08:59:59 would
 * satisfy a nine-hour requirement it misses by a second. Classification needs
 * the unrounded value, so it gets its own function rather than a flag on the
 * old one -- a caller cannot then forget which one it asked for.
 *
 * Null when either punch is missing, for the same reason as presenceMinutes: an
 * incomplete day has not failed the requirement, it has not answered it.
 */
export function presenceSeconds(
  punchInAt: Date | string | null | undefined,
  punchOutAt: Date | string | null | undefined,
): number | null {
  const inMs = toTime(punchInAt);
  const outMs = toTime(punchOutAt);
  if (inMs === null || outMs === null) return null;
  return Math.max(0, Math.floor((outMs - inMs) / 1000));
}

/**
 * The display states the calendar renders.
 *
 * DELIBERATELY SEPARATE FROM THE STORED STATUS. The stored status is the
 * official business outcome; this is how a day is shown to the person whose day
 * it was, and they answer different questions. A day can be officially PRESENT
 * and still need to read "9 hours not met", and collapsing the two would lose
 * that.
 *
 * No colours here. Colour is presentation and lives in the frontend's single
 * mapping. This is business state.
 */
export type DisplayAttendanceState =
  | 'PRESENT'
  | 'LATE'
  | 'NINE_HOURS_NOT_MET'
  | 'HALF_DAY'
  | 'INSUFFICIENT_PRESENCE'
  | 'ON_LEAVE'
  | 'HOLIDAY'
  | 'WEEKLY_OFF'
  | 'MISSING_PUNCH'
  | 'OPEN'
  | 'NOT_APPLICABLE'
  | 'UNKNOWN';

export interface DisplayClassification {
  state: DisplayAttendanceState;
  /** Shown beside the state, because one colour can mean several things. */
  reasons: string[];
  /** Exact and unrounded. Null when it could not be measured. */
  presenceSeconds: number | null;
  lateBySeconds: number | null;
  shortBySeconds: number | null;
  /** An approved correction produced the current values. */
  regularized: boolean;
  /** A correction is awaiting a decision. It changes nothing else. */
  regularizationPending: boolean;
}

export interface DisplayClassificationInput {
  /** The stored official status, when the day was evaluated. */
  officialStatus: string | null;
  regularized: boolean;
  regularizationPending: boolean;
  punchInAt: Date | string | null;
  punchOutAt: Date | string | null;
  /** Null when the calendar could not be confirmed. */
  workingDay: boolean | null;
  /** The day is still running, so nothing about it is final. */
  dayOpen: boolean;
  /** Arrival threshold, HH:mm. From the applicable shift, never a constant. */
  arrivalThreshold: string | null;
  arrivalGraceMinutes: number;
  /** Arrival in minutes past midnight, company time. */
  arrivalMinutes: number | null;
  /** Required presence in SECONDS, from the day's own policy provenance. */
  requiredSeconds: number | null;
  /** Presence below which the day is insufficient, in seconds. */
  minimumSeconds: number;
}

/**
 * How one employee-day should read on the calendar.
 *
 * ORDER IS THE RULE. Non-working days and leave settle before any duration is
 * considered, an open day is never given a final verdict, and a pending
 * correction is reported WITHOUT changing the state, because a request is not a
 * decision.
 *
 * Thresholds are arguments. The arrival boundary was hardcoded as 10:30 in the
 * console, which applied the Team-Lead entry window to every employee and made
 * a 10:00 arrival on a 09:30 shift read on time. The caller resolves the
 * applicable shift by date and passes it in.
 *
 * COMPARISONS USE EXACT SECONDS AND ARE INCLUSIVE AT THE BOUNDARY: 09:00:00
 * meets a nine-hour requirement and 08:59:59 does not.
 */
export function classifyForDisplay(input: DisplayClassificationInput): DisplayClassification {
  const seconds = presenceSeconds(input.punchInAt, input.punchOutAt);
  const reasons: string[] = [];

  const late = lateMinutesFrom(
    input.arrivalMinutes,
    input.arrivalThreshold,
    input.arrivalGraceMinutes,
  );
  const shortfall =
    seconds === null || input.requiredSeconds === null
      ? null
      : Math.max(0, input.requiredSeconds - seconds);

  const base = {
    presenceSeconds: seconds,
    lateBySeconds: late.lateMinutes == null ? null : late.lateMinutes * 60,
    shortBySeconds: shortfall && shortfall > 0 ? shortfall : null,
    regularized: input.regularized,
    regularizationPending: input.regularizationPending,
  };

  if (input.regularized) reasons.push('Regularized');
  // Reported, never applied.
  if (input.regularizationPending) reasons.push('Regularization pending');

  // Non-working days settle before durations: somebody who worked a holiday is
  // still on a holiday as far as the calendar is concerned, and the evidence
  // shows in the day detail.
  if (input.officialStatus === 'HOLIDAY') return { ...base, state: 'HOLIDAY', reasons };
  if (input.officialStatus === 'WEEKLY_OFF') return { ...base, state: 'WEEKLY_OFF', reasons };
  if (input.workingDay === false) return { ...base, state: 'WEEKLY_OFF', reasons };

  // HALF DAY IS NEVER DERIVED FROM A DURATION HERE.
  //
  // Rendered only when the canonical record already says so, which today means
  // an approved half-day leave. The four-to-nine-hour band is
  // NINE_HOURS_NOT_MET, and inventing a duration trigger for half day would be
  // a policy decision this layer has no authority to make.
  if (input.officialStatus === 'HALF_DAY') return { ...base, state: 'HALF_DAY', reasons };

  if (input.officialStatus === 'ON_LEAVE' || input.officialStatus === 'LWP') {
    return { ...base, state: 'ON_LEAVE', reasons };
  }
  if (input.officialStatus === 'NOT_APPLICABLE') {
    return { ...base, state: 'NOT_APPLICABLE', reasons };
  }

  // An unconfirmed calendar is not a verdict about the employee.
  if (input.workingDay === null && !input.officialStatus) {
    reasons.push('Calendar not confirmed');
    return { ...base, state: 'UNKNOWN', reasons };
  }

  // A day still running has not failed anything yet.
  if (input.dayOpen) {
    reasons.push('Day still open');
    return { ...base, state: 'OPEN', reasons };
  }

  // One punch, or none. Reported as incomplete rather than measured.
  if (seconds === null) {
    if (input.punchInAt && !input.punchOutAt) reasons.push('Punch out missing');
    else if (!input.punchInAt && input.punchOutAt) reasons.push('Punch in missing');
    else reasons.push('No punch recorded');
    return { ...base, state: 'MISSING_PUNCH', reasons };
  }

  // Below the floor: insufficient, whatever time they arrived.
  if (seconds < input.minimumSeconds) {
    reasons.push('Less than the minimum presence');
    if (late.reason === 'LATE') reasons.push('Late');
    return { ...base, state: 'INSUFFICIENT_PRESENCE', reasons };
  }

  // An unprovable requirement cannot be failed.
  if (input.requiredSeconds === null) {
    reasons.push('Required time unresolved');
    return { ...base, state: 'UNKNOWN', reasons };
  }

  // Short of the requirement. Applies even to somebody who arrived early, and
  // it is NOT half day.
  if (seconds < input.requiredSeconds) {
    reasons.push('9 hours not met');
    if (late.reason === 'LATE') reasons.push('Late');
    return { ...base, state: 'NINE_HOURS_NOT_MET', reasons };
  }

  // Requirement met. Working later does not undo a late arrival.
  if (late.reason === 'LATE') {
    reasons.push('Late');
    return { ...base, state: 'LATE', reasons };
  }

  return { ...base, state: 'PRESENT', reasons };
}
