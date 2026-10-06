/**
 * My Attendance V2 — the read contract, and the pure mapping that produces it.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The target architecture (docs/architecture/attendance-target-2026-10) models a
 * day as four separate layers — OUTCOME, MODIFIERS, EXCEPTIONS, EVALUATION
 * STATE. The running evaluator predates that model: it returns one
 * `DailyAttendanceStatus` that carries all four concepts at once, plus a flag
 * array doing two jobs.
 *
 * This module translates the one into the other. It is a RE-EXPRESSION of facts
 * the evaluator already produced, never a second evaluation:
 *
 *   - no threshold is applied here
 *   - no policy is read here
 *   - no duration is computed here
 *   - nothing is inferred that the evaluator did not already assert
 *
 * Where the current result cannot answer a V2 field, the field is `null` and
 * `unavailable[]` says which ones and why. A missing figure is never rendered as
 * zero, and never guessed — that is the whole point of the error contract.
 *
 * EVERYTHING HERE IS PURE. No Prisma, no Nest, no clock, no environment. The
 * caller passes facts it has already read. That is what makes the mapping
 * table-testable without a database.
 */

import type {
  AttendanceCalculationReason,
  AttendanceExceptionFlag,
  DailyAttendanceResult,
} from '../evaluation/daily-attendance.types';

// ════════════════════════════════════════════════════════════════════════════
// Target vocabulary (Document 1 §3)
// ════════════════════════════════════════════════════════════════════════════

export type AttendanceOutcome =
  | 'PRESENT'
  | 'HALF_DAY'
  | 'ABSENT'
  | 'LEAVE'
  | 'LWP'
  | 'HOLIDAY'
  | 'WEEKLY_OFF'
  | 'EXEMPT'
  | 'IN_PROGRESS'
  | 'UNRESOLVED';

export type AttendanceModifier =
  | 'LATE'
  | 'LATE_EXEMPTED'
  | 'INSUFFICIENT_PRESENCE'
  | 'INSUFFICIENT_EFFECTIVE_WORK'
  | 'BREAK_EXCEEDS_ALLOWANCE'
  | 'AUTO_CLOSED'
  | 'REGULARIZED'
  | 'WORKED_ON_HOLIDAY'
  | 'WORKED_ON_WEEKLY_OFF';

export type AttendanceExceptionCode =
  | 'MISSING_IN'
  | 'MISSING_OUT'
  | 'LOCATION_EXCEPTION'
  | 'PHOTO_EXCEPTION'
  | 'EVIDENCE_CONFLICT'
  | 'LEAVE_WORK_CONFLICT'
  | 'CALENDAR_UNRESOLVED'
  | 'POLICY_UNRESOLVED';

export type EvaluationStateV2 = 'CALCULATED' | 'NEEDS_REVIEW' | 'FINALIZED';

/**
 * A V2 field the current backend cannot answer.
 *
 * Carried in the response so the UI can render "unavailable" deliberately
 * instead of discovering a null and defaulting it to 0.
 */
export interface UnavailableField {
  field: string;
  reason: string;
}

/**
 * Codes for the gaps this adapter knows about, so the frontend can branch on a
 * value rather than on prose.
 */
export const UNAVAILABLE_REASONS = {
  /**
   * Presence is punch out minus punch in. With an incomplete punch pair — an
   * open day, a missing punch — there is no span to measure. Not zero: zero
   * would assert a shortfall the evidence cannot support.
   */
  PRESENCE_NOT_MEASURABLE: 'PRESENCE_NOT_MEASURABLE',
  /**
   * No presence requirement governs this day: a holiday, a weekly off, a
   * full-day leave, or a date attendance does not apply to. A requirement is
   * not substituted for display convenience.
   */
  NO_PRESENCE_REQUIREMENT: 'NO_PRESENCE_REQUIREMENT',
  /**
   * A presence-derived figure needs a measured presence and a resolved
   * requirement. Where either is absent there is nothing to derive from, so the
   * figure is withheld rather than part-computed.
   */
  PRESENCE_DERIVATION_UNAVAILABLE: 'PRESENCE_DERIVATION_UNAVAILABLE',
  /** Attendance does not apply, or the day was never evaluated. */
  NO_OFFICIAL_RESULT: 'NO_OFFICIAL_RESULT',
  /** The day has not happened yet. */
  FUTURE_DATE: 'FUTURE_DATE',
} as const;

// ════════════════════════════════════════════════════════════════════════════
// Mapping tables — current vocabulary → target vocabulary
// ════════════════════════════════════════════════════════════════════════════

/**
 * Current status → target outcome.
 *
 * Four current statuses are not outcomes at all in the target model. LATE and
 * LATE_EXEMPTED are modifiers on a PRESENT day; MISSING_PUNCH, GEO_MISMATCH,
 * FACE_MISSING and PENDING_REGULARIZATION are exceptions. They are mapped to
 * the outcome the evaluator's own confidence signal implies, and the raw status
 * is always forwarded as `sourceStatus` so nothing is hidden by the rename.
 */
const OUTCOME_BY_STATUS: Record<string, AttendanceOutcome> = {
  PRESENT: 'PRESENT',
  // Carries a modifier in the target model, not an outcome of its own.
  LATE: 'PRESENT',
  LATE_EXEMPTED: 'PRESENT',
  HALF_DAY: 'HALF_DAY',
  ABSENT: 'ABSENT',
  LEAVE: 'LEAVE',
  LWP: 'LWP',
  HOLIDAY: 'HOLIDAY',
  WEEKLY_OFF: 'WEEKLY_OFF',
  // Exception-shaped statuses. The evaluator routes every one of these to
  // review, which is precisely what UNRESOLVED means in the target model:
  // the facts are insufficient to settle the day.
  MISSING_PUNCH: 'UNRESOLVED',
  GEO_MISMATCH: 'UNRESOLVED',
  FACE_MISSING: 'UNRESOLVED',
  PENDING_REGULARIZATION: 'UNRESOLVED',
};

/**
 * Current exception flag → target exception code.
 *
 * Several current flags collapse into one target code (three location flags
 * become LOCATION_EXCEPTION), and several are modifiers rather than exceptions
 * — those are absent here and handled by MODIFIER_BY_FLAG.
 *
 * A flag mapped to null is deliberately NOT an exception in the target model.
 */
const EXCEPTION_BY_FLAG: Partial<Record<AttendanceExceptionFlag, AttendanceExceptionCode>> = {
  MISSING_PUNCH: 'MISSING_IN',
  MISSING_PUNCH_OUT: 'MISSING_OUT',
  LOCATION_OUTSIDE_GEOFENCE: 'LOCATION_EXCEPTION',
  LOCATION_LOW_ACCURACY: 'LOCATION_EXCEPTION',
  LOCATION_UNAVAILABLE: 'LOCATION_EXCEPTION',
  PHOTO_MISSING: 'PHOTO_EXCEPTION',
  // Two authorities disagree about the same date.
  AMBIGUOUS_APPROVED_LEAVE: 'LEAVE_WORK_CONFLICT',
  // The evidence disagrees with itself.
  HALF_DAY_PUNCH_IN_OUTSIDE_WINDOW: 'EVIDENCE_CONFLICT',
  HALF_DAY_SESSION_UNRESOLVED: 'EVIDENCE_CONFLICT',
  APPROVED_CORRECTION_WITHOUT_DECISION_TIME: 'EVIDENCE_CONFLICT',
  // Configuration could not be resolved.
  PARTIALLY_FUNDED_LEAVE: 'POLICY_UNRESOLVED',
  LEAVE_ON_NON_WORKING_DAY: 'POLICY_UNRESOLVED',
};

/**
 * Current exception flag → target modifier.
 *
 * Document 1 §12 placed these: they are facts the system knows, not doubts
 * about whether the day is right, so they qualify the outcome instead of
 * demanding review.
 */
const MODIFIER_BY_FLAG: Partial<Record<AttendanceExceptionFlag, AttendanceModifier>> = {
  INSUFFICIENT_PRESENCE_SPAN: 'INSUFFICIENT_PRESENCE',
  INSUFFICIENT_EFFECTIVE_WORK: 'INSUFFICIENT_EFFECTIVE_WORK',
  BREAK_EXCEEDS_ALLOWANCE: 'BREAK_EXCEEDS_ALLOWANCE',
  CORRECTED_BY_REGULARIZATION: 'REGULARIZED',
};

/**
 * Flags that carry no V2 meaning of their own.
 *
 * WORKDAY_STILL_OPEN becomes the IN_PROGRESS outcome; the two half-day presence
 * flags are already represented by the shortfall modifiers; NO_ATTENDANCE_EVIDENCE
 * is what ABSENT means. Listing them explicitly is what lets the test assert
 * that every current flag is accounted for, so a new flag added upstream cannot
 * be silently dropped.
 */
const NON_V2_FLAGS: ReadonlySet<string> = new Set<AttendanceExceptionFlag>([
  'WORKDAY_STILL_OPEN',
  'NO_ATTENDANCE_EVIDENCE',
  'LATE_BEYOND_PUNCH_WINDOW',
  'HALF_DAY_INSUFFICIENT_PRESENCE',
  'HALF_DAY_EARLY_PUNCH_OUT',
]);

/** Every current flag must appear in exactly one of the three tables above. */
export function classifyFlag(
  flag: AttendanceExceptionFlag,
): { kind: 'exception'; code: AttendanceExceptionCode } | { kind: 'modifier'; code: AttendanceModifier } | { kind: 'none' } {
  const exception = EXCEPTION_BY_FLAG[flag];
  if (exception) return { kind: 'exception', code: exception };
  const modifier = MODIFIER_BY_FLAG[flag];
  if (modifier) return { kind: 'modifier', code: modifier };
  if (NON_V2_FLAGS.has(flag)) return { kind: 'none' };
  // An unmapped flag is reported, never dropped: see mapDay's unmappedFlags.
  return { kind: 'none' };
}

/** Flags the mapper did not recognise at all, surfaced rather than discarded. */
function unmappedFlags(flags: readonly AttendanceExceptionFlag[]): string[] {
  return flags.filter(
    (f) => !EXCEPTION_BY_FLAG[f] && !MODIFIER_BY_FLAG[f] && !NON_V2_FLAGS.has(f),
  );
}

// ════════════════════════════════════════════════════════════════════════════
// The day contract
// ════════════════════════════════════════════════════════════════════════════

export interface MyAttendanceDayV2 {
  date: string;

  /** Null when no official evaluation exists for the date (Document 1 §4). */
  outcome: AttendanceOutcome | null;
  modifiers: AttendanceModifier[];
  exceptions: AttendanceExceptionCode[];
  evaluationState: EvaluationStateV2 | null;

  /** True when attendance applies and the evaluator produced a result. */
  isApplicable: boolean;
  isToday: boolean;
  isFuture: boolean;
  isInProgress: boolean;

  /** Figures. Null means "cannot be measured" — never rendered as zero. */
  presenceMinutes: number | null;
  requiredMinutes: number | null;
  workedMinutes: number | null;
  breakMinutes: number | null;
  lateMinutes: number | null;

  punchInAt: string | null;
  punchOutAt: string | null;

  leaveDeducted: number | null;
  lwpDeducted: number | null;

  /** Machine reason from the evaluator, for the UI to turn into a sentence. */
  reason: AttendanceCalculationReason | null;
  /** One backend-authored sentence. The frontend never composes a verdict. */
  explanation: string | null;

  /** The untranslated evaluator values, so the rename hides nothing. */
  sourceStatus: string | null;
  sourceFlags: string[];
  unmappedSourceFlags: string[];

  unavailable: UnavailableField[];
}

export interface MyAttendanceTodayV2 extends MyAttendanceDayV2 {
  /**
   * Presence still owed against the presence requirement.
   *
   * NAMED FOR ITS MEASURE ON PURPOSE. It is derived from `presenceMinutes`, and
   * never from `workedMinutes`: the requirement is a presence span while worked
   * minutes are effective work with breaks removed, so mixing them would tell
   * somebody who finished their day that they still owed their lunch break.
   *
   * A true effective-work target would be a separate backend value, and this
   * field must not be overloaded to carry it.
   */
  presenceRemainingMinutes: number | null;
  /** Presence against the presence requirement, as a percentage. */
  presenceProgressPercent: number | null;
  firstPunchAt: string | null;
  lastPunchAt: string | null;
  correctionAllowed: boolean;
  finalStatusAvailable: boolean;
  /** Banner copy is chosen by the backend from state, never hardcoded in React. */
  banner: { tone: BannerTone; title: string; detail: string } | null;
}

export type BannerTone = 'INFO' | 'ATTENTION' | 'NEUTRAL' | 'POSITIVE';

export interface MyAttendanceMonthV2 {
  year: number;
  month: number;
  days: MyAttendanceDayV2[];
}

// ════════════════════════════════════════════════════════════════════════════
// Mapping
// ════════════════════════════════════════════════════════════════════════════

export interface MapDayInput {
  /** The evaluator's answer, or null when the date was not evaluated. */
  result: DailyAttendanceResult | null;
  date: string;
  /** Company today, supplied by the caller so this stays clock-free. */
  companyToday: string;
  /** From WorkSession.autoClosed on any session contributing to the day. */
  anySessionAutoClosed?: boolean;
  /** True when work evidence exists on a holiday or weekly off. */
  hasWorkEvidence?: boolean;
}

/**
 * Which figures this particular day could not answer, and why.
 *
 * Derived per day rather than declared once, because the answer now genuinely
 * varies: a closed working day has both figures, a holiday has neither, and an
 * open day has a requirement but no measurable presence.
 */
function figureGaps(presence: number | null, required: number | null): UnavailableField[] {
  const gaps: UnavailableField[] = [];
  if (presence === null) {
    gaps.push({ field: 'presenceMinutes', reason: UNAVAILABLE_REASONS.PRESENCE_NOT_MEASURABLE });
  }
  if (required === null) {
    gaps.push({ field: 'requiredMinutes', reason: UNAVAILABLE_REASONS.NO_PRESENCE_REQUIREMENT });
  }
  return gaps;
}

export function mapDay(input: MapDayInput): MyAttendanceDayV2 {
  const { result, date, companyToday } = input;
  const isToday = date === companyToday;
  const isFuture = date > companyToday;

  // Document 1 §4: no result means no canonical outcome. It must never read as
  // Present, Absent or anything else — least of all on a date in the future.
  if (isFuture) {
    return emptyDay(date, { isToday: false, isFuture: true }, [
      { field: 'outcome', reason: UNAVAILABLE_REASONS.FUTURE_DATE },
    ]);
  }
  if (!result || !result.official || result.status === null) {
    return {
      ...emptyDay(date, { isToday, isFuture: false }, [
        { field: 'outcome', reason: UNAVAILABLE_REASONS.NO_OFFICIAL_RESULT },
      ]),
      // The evaluator still explains WHY it declined, and that is worth showing.
      reason: result?.calculationReason ?? null,
      sourceStatus: result?.status ?? null,
      sourceFlags: result ? [...result.exceptionFlags] : [],
      evaluationState: result?.evaluationState ?? null,
    };
  }

  const flags = result.exceptionFlags;
  const isInProgress = flags.includes('WORKDAY_STILL_OPEN');

  // Precedence rule 7: an open day is IN_PROGRESS regardless of what the
  // closed-day classification would have been.
  const mappedOutcome = OUTCOME_BY_STATUS[result.status] ?? 'UNRESOLVED';
  const outcome: AttendanceOutcome = isInProgress ? 'IN_PROGRESS' : mappedOutcome;

  const exceptions = new Set<AttendanceExceptionCode>();
  const modifiers = new Set<AttendanceModifier>();

  for (const flag of flags) {
    const classified = classifyFlag(flag);
    if (classified.kind === 'exception') {
      // Document 2 §15: an open day is never judged, and MISSING_OUT on a day
      // that has not ended yet would be an accusation about the future.
      if (isInProgress && classified.code === 'MISSING_OUT') continue;
      exceptions.add(classified.code);
    } else if (classified.kind === 'modifier') {
      // Shortfall modifiers are withheld while the day is still running.
      if (isInProgress && isShortfall(classified.code)) continue;
      modifiers.add(classified.code);
    }
  }

  // LATE / LATE_EXEMPTED live in the status in the current model. Document 2
  // §12 requires LATE_EXEMPTED to always appear WITH LATE, never alone.
  if (result.status === 'LATE' || result.status === 'LATE_EXEMPTED') {
    modifiers.add('LATE');
    if (result.status === 'LATE_EXEMPTED') modifiers.add('LATE_EXEMPTED');
  } else if ((result.lateMinutes ?? 0) > 0) {
    modifiers.add('LATE');
  }

  if (input.anySessionAutoClosed) modifiers.add('AUTO_CLOSED');
  if (input.hasWorkEvidence && outcome === 'HOLIDAY') modifiers.add('WORKED_ON_HOLIDAY');
  if (input.hasWorkEvidence && outcome === 'WEEKLY_OFF') modifiers.add('WORKED_ON_WEEKLY_OFF');

  return {
    date,
    outcome,
    modifiers: [...modifiers],
    exceptions: [...exceptions],
    // Derived by the evaluator, forwarded verbatim. Document 1 §5's
    // "exceptions ⇒ NEEDS_REVIEW" is the evaluator's rule to enforce, not this
    // mapper's to re-decide.
    evaluationState: result.evaluationState,
    isApplicable: true,
    isToday,
    isFuture: false,
    isInProgress,
    // Forwarded from the evaluator, which is the only thing that measured them.
    presenceMinutes: result.presenceMinutes,
    requiredMinutes: result.requiredMinutes,
    workedMinutes: result.workedMinutes,
    breakMinutes: result.breakMinutes,
    lateMinutes: result.lateMinutes,
    punchInAt: iso(result.punchInAt),
    punchOutAt: iso(result.punchOutAt),
    leaveDeducted: result.leaveDeducted,
    lwpDeducted: result.lwpDeducted,
    reason: result.calculationReason,
    explanation: explain(result.calculationReason, outcome),
    sourceStatus: result.status,
    sourceFlags: [...flags],
    unmappedSourceFlags: unmappedFlags(flags),
    unavailable: figureGaps(result.presenceMinutes, result.requiredMinutes),
  };
}

function isShortfall(m: AttendanceModifier): boolean {
  return (
    m === 'INSUFFICIENT_PRESENCE' ||
    m === 'INSUFFICIENT_EFFECTIVE_WORK' ||
    m === 'BREAK_EXCEEDS_ALLOWANCE'
  );
}

function emptyDay(
  date: string,
  f: { isToday: boolean; isFuture: boolean },
  unavailable: UnavailableField[],
): MyAttendanceDayV2 {
  return {
    date,
    outcome: null,
    modifiers: [],
    exceptions: [],
    evaluationState: null,
    isApplicable: false,
    isToday: f.isToday,
    isFuture: f.isFuture,
    isInProgress: false,
    presenceMinutes: null,
    requiredMinutes: null,
    workedMinutes: null,
    breakMinutes: null,
    lateMinutes: null,
    punchInAt: null,
    punchOutAt: null,
    leaveDeducted: null,
    lwpDeducted: null,
    reason: null,
    explanation: null,
    sourceStatus: null,
    sourceFlags: [],
    unmappedSourceFlags: [],
    unavailable,
  };
}

function iso(d: Date | null): string | null {
  return d ? new Date(d).toISOString() : null;
}

/**
 * One backend-authored sentence per machine reason.
 *
 * It lives here rather than in React because a verdict about somebody's
 * attendance is a backend statement. The frontend renders it; it never composes
 * one from figures.
 */
const EXPLANATION: Record<string, string> = {
  COMPANY_CLOSURE: 'The company was closed on this date.',
  HOLIDAY: 'This was a company holiday.',
  WEEKLY_OFF: 'This was your weekly off.',
  SPECIAL_WORKING_DAY_WORKED: 'This was a special working day and you worked it.',
  APPROVED_PAID_LEAVE: 'You were on approved paid leave.',
  APPROVED_UNPAID_LEAVE: 'You were on approved unpaid leave.',
  APPROVED_HALF_DAY_LEAVE: 'You were on approved half-day leave.',
  APPROVED_PARTIALLY_FUNDED_LEAVE:
    'Your approved leave is partly paid and partly unpaid, so this day is being reviewed.',
  COMPLETE_WORKDAY: 'A complete workday was recorded.',
  WORKDAY_IN_PROGRESS: 'Your workday is still open.',
  NO_EVIDENCE_ON_WORKING_DAY: 'No attendance evidence was recorded for this working day.',
  INCOMPLETE_PUNCH_PAIR: 'Your punch record for this day is incomplete.',
  POLICY_DECISION_DEFERRED: 'This day needs a review before its final status is set.',
  CORRECTED_WORKDAY: 'This day was corrected by an approved request.',
  AMBIGUOUS_LEAVE: 'More than one approved leave covers this date, so it is being reviewed.',
  NOT_APPLICABLE_EXEMPT: 'Attendance tracking does not apply to you on this date.',
  NOT_APPLICABLE_NOT_EMPLOYED: 'You were not employed on this date.',
  CONTEXT_BLOCKED:
    'Apex/HR is reviewing the attendance setup for this date. No action is required from you.',
};

function explain(reason: AttendanceCalculationReason, outcome: AttendanceOutcome): string | null {
  const text = EXPLANATION[reason];
  if (text) return text;
  return outcome === 'UNRESOLVED' ? 'This day could not be settled and needs a review.' : null;
}

// ════════════════════════════════════════════════════════════════════════════
// Today
// ════════════════════════════════════════════════════════════════════════════

export interface MapTodayInput extends MapDayInput {
  /** From the employee's own punch evidence, earliest first. */
  firstPunchAt?: string | null;
  lastPunchAt?: string | null;
  /** Whether the correction route would accept a request for this date. */
  correctionAllowed?: boolean;
}

export function mapToday(input: MapTodayInput): MyAttendanceTodayV2 {
  const day = mapDay(input);

  // Derived from presence against the presence requirement, and only when both
  // are genuinely known. A requirement of zero is treated as no requirement
  // rather than as a division.
  const derivable =
    day.presenceMinutes !== null && day.requiredMinutes !== null && day.requiredMinutes > 0;

  const presenceRemainingMinutes = derivable
    ? Math.max(0, (day.requiredMinutes as number) - (day.presenceMinutes as number))
    : null;

  // Not clamped: presence beyond the requirement is a real fact and reads as
  // over 100%. The BAR is clamped where it is drawn, which is a layout concern.
  const presenceProgressPercent = derivable
    ? Math.round(((day.presenceMinutes as number) / (day.requiredMinutes as number)) * 100)
    : null;

  return {
    ...day,
    presenceRemainingMinutes,
    presenceProgressPercent,
    firstPunchAt: input.firstPunchAt ?? day.punchInAt,
    lastPunchAt: input.lastPunchAt ?? day.punchOutAt,
    correctionAllowed: input.correctionAllowed ?? false,
    finalStatusAvailable: !day.isInProgress && day.outcome !== null,
    banner: banner(day),
    unavailable: [
      ...day.unavailable,
      ...(derivable
        ? []
        : [
            {
              field: 'presenceRemainingMinutes',
              reason: UNAVAILABLE_REASONS.PRESENCE_DERIVATION_UNAVAILABLE,
            },
            {
              field: 'presenceProgressPercent',
              reason: UNAVAILABLE_REASONS.PRESENCE_DERIVATION_UNAVAILABLE,
            },
          ]),
    ],
  };
}

/**
 * The banner, chosen from state.
 *
 * Deliberately derived here and not in React: the brief's own warning is that a
 * single hardcoded message must not be shown for every state.
 */
function banner(day: MyAttendanceDayV2): MyAttendanceTodayV2['banner'] {
  if (day.isFuture) return null;
  if (day.isInProgress) {
    return {
      tone: 'INFO',
      title: 'Workday still open',
      detail: 'Your final status will be available after your last punch today.',
    };
  }
  if (day.outcome === null) {
    return {
      tone: 'NEUTRAL',
      title: 'Not evaluated yet',
      detail: 'This day has no attendance result yet.',
    };
  }
  if (day.evaluationState === 'NEEDS_REVIEW') {
    const configuration = day.exceptions.some(
      (e) => e === 'POLICY_UNRESOLVED' || e === 'CALENDAR_UNRESOLVED',
    );
    return configuration
      ? {
          tone: 'NEUTRAL',
          title: 'Attendance setup is being checked',
          detail: 'Apex/HR is reviewing the attendance setup. No action is required from you.',
        }
      : {
          tone: 'ATTENTION',
          title: 'This day needs a review',
          detail: day.explanation ?? 'Some of your attendance evidence could not be confirmed.',
        };
  }
  if (day.evaluationState === 'FINALIZED') {
    return {
      tone: 'POSITIVE',
      title: 'Settled',
      detail: 'This day has been finalized and will not change.',
    };
  }
  return null;
}
