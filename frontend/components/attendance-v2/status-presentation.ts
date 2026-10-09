import type {
  AttendanceExceptionCode,
  AttendanceModifier,
  AttendanceOutcome,
  MyAttendanceDayV2,
} from './my-attendance-v2-api';

/**
 * How an attendance day LOOKS. Nothing here decides what it IS.
 *
 * Two rules govern this file, and both come from the frozen UI/UX architecture:
 *
 *  1. BRAND vs SEMANTIC COLOUR. The Apex palette dresses the interface —
 *     headers, cards, borders, chrome. Semantic colour carries business
 *     meaning, and only business meaning. Using navy to mean "present" or
 *     green to mean "primary button" collapses the distinction, and then colour
 *     stops being information.
 *
 *  2. COLOUR IS NEVER THE ONLY INDICATOR. Every status carries a label, and
 *     calendar cells carry a glyph as well as a tint. A red cell and a purple
 *     cell are indistinguishable to a large minority of readers, and a payroll
 *     surface is the wrong place to find that out.
 *
 * NO ARITHMETIC. formatMinutes formats; it does not compute. Every figure
 * arrives from the backend, and null stays null — `0h 00m` is a measurement,
 * and showing one where none exists is the specific failure the error contract
 * forbids.
 */

// ── Apex brand palette — interface only ───────────────────────────────────
export const BRAND = {
  navy: '#01266A',
  blue: '#2666C4',
  lightBlue: '#73C2FB',
  paleBlue: '#F0F7FF',
  warmNeutral: '#FEF4F1',
  black: '#000000',
  white: '#FFFFFF',
} as const;

export interface StatusPresentation {
  label: string;
  /**
   * The same meaning in one short word, for a calendar cell.
   *
   * A cell is a seventh of a card, so the full label does not fit — but the
   * approved spec requires a visible status, and a glyph alone is not one. It
   * is always a WORD, never an enum value: an employee should not be asked to
   * read POLICY_UNRESOLVED off their own calendar.
   */
  shortLabel: string;
  /** Semantic colour. Business meaning only — never interface chrome. */
  color: string;
  /** Low-opacity companion for cell and badge grounds. */
  tint: string;
  /** Text/shape indicator, so colour is never carrying the meaning alone. */
  glyph: string;
}

/**
 * One presentation per outcome.
 *
 * ABSENT and UNRESOLVED are deliberately far apart in both hue and glyph. They
 * were the pair most often confused in the current UI, and they mean opposite
 * things: one is a finding, the other is an admission that there is no finding
 * yet.
 */
const OUTCOME_PRESENTATION: Record<AttendanceOutcome, StatusPresentation> = {
  PRESENT: { label: 'Present', shortLabel: 'Present', color: '#00B954', tint: '#EFFDF4', glyph: '✓' },
  HALF_DAY: { label: 'Half day', shortLabel: 'Half', color: '#7E22CE', tint: '#F3E8FF', glyph: '◐' },
  ABSENT: { label: 'Absent', shortLabel: 'Absent', color: '#B91C1C', tint: '#FEE2E2', glyph: '✕' },
  LEAVE: { label: 'Leave', shortLabel: 'Leave', color: '#0C7FB8', tint: '#E0F2FE', glyph: '✈' },
  // Backend keeps LWP; employees should not have to decode an acronym.
  LWP: {
    label: 'Unpaid leave',
    shortLabel: 'Unpaid',
    color: '#0C7FB8',
    tint: '#E0F2FE',
    glyph: '✈',
  },
  HOLIDAY: { label: 'Holiday', shortLabel: 'Holiday', color: '#EEAF00', tint: '#FFFAEE', glyph: '★' },
  WEEKLY_OFF: { label: 'Weekly off', shortLabel: 'Off', color: '#8493B0', tint: '#F6F8FC', glyph: '⊖' },
  EXEMPT: { label: 'Not applicable', shortLabel: 'N/A', color: '#8493B0', tint: '#F6F8FC', glyph: '⊖' },
  IN_PROGRESS: {
    label: 'Working',
    shortLabel: 'Working',
    color: BRAND.blue,
    tint: BRAND.paleBlue,
    glyph: '◉',
  },
  UNRESOLVED: { label: 'Needs review', shortLabel: 'Review', color: '#1F2937', tint: '#F5F7FB', glyph: '⚠' },
};

/** A day with no evaluation. Neutral, and never mistakable for a verdict. */
export const NO_RESULT_PRESENTATION: StatusPresentation = {
  label: 'No result',
  shortLabel: '',
  color: '#71717A',
  tint: 'transparent',
  glyph: '',
};

export function presentOutcome(outcome: AttendanceOutcome | null): StatusPresentation {
  return outcome ? OUTCOME_PRESENTATION[outcome] : NO_RESULT_PRESENTATION;
}

/**
 * The calendar legend.
 *
 * Driven from the same table the cells use, so a legend entry cannot describe a
 * colour the calendar no longer renders.
 */
export const LEGEND: Array<{ outcome: AttendanceOutcome } & StatusPresentation> = (
  [
    'PRESENT',
    'IN_PROGRESS',
    'HALF_DAY',
    'ABSENT',
    'LEAVE',
    'HOLIDAY',
    'WEEKLY_OFF',
    'UNRESOLVED',
  ] as AttendanceOutcome[]
).map((outcome) => ({ outcome, ...OUTCOME_PRESENTATION[outcome] }));

const MODIFIER_LABEL: Record<AttendanceModifier, string> = {
  LATE: 'Late',
  LATE_EXEMPTED: 'Late exempted',
  INSUFFICIENT_PRESENCE: 'Short presence',
  INSUFFICIENT_EFFECTIVE_WORK: 'Short effective work',
  BREAK_EXCEEDS_ALLOWANCE: 'Break over allowance',
  AUTO_CLOSED: 'Closed by system',
  REGULARIZED: 'Regularized',
  WORKED_ON_HOLIDAY: 'Worked on holiday',
  WORKED_ON_WEEKLY_OFF: 'Worked on weekly off',
};

export function modifierLabel(m: AttendanceModifier): string {
  return MODIFIER_LABEL[m] ?? m;
}

/**
 * Late and short-hours modifiers use orange. Regularization uses a green badge;
 * it never changes the canonical outcome's base color.
 */
const MODIFIER_TONE: Partial<Record<AttendanceModifier, { color: string; tint: string }>> = {
  REGULARIZED: { color: '#098C40', tint: '#E7FFF0' },
  LATE_EXEMPTED: { color: '#E56600', tint: '#FFF7EF' },
  LATE: { color: '#C2410C', tint: '#FFEDD5' },
  INSUFFICIENT_PRESENCE: { color: '#C2410C', tint: '#FFEDD5' },
  INSUFFICIENT_EFFECTIVE_WORK: { color: '#C2410C', tint: '#FFEDD5' },
  BREAK_EXCEEDS_ALLOWANCE: { color: '#C2410C', tint: '#FFEDD5' },
};

export function modifierTone(m: AttendanceModifier): { color: string; tint: string } | null {
  return MODIFIER_TONE[m] ?? null;
}

/**
 * Exception copy for the employee, in two families.
 *
 * `actionable` exceptions are about the employee's own evidence and say what
 * they can do. The rest are about the company's configuration, and the copy
 * must not imply the employee did anything wrong or could fix it — that
 * distinction is a locked UI decision, not a wording preference.
 */
export interface ExceptionCopy {
  title: string;
  detail: string;
  actionable: boolean;
}

const EXCEPTION_COPY: Record<AttendanceExceptionCode, ExceptionCopy> = {
  MISSING_IN: {
    title: 'Punch in not confirmed',
    detail: 'We could not confirm when your day started.',
    actionable: true,
  },
  MISSING_OUT: {
    title: 'Punch out not confirmed',
    detail: 'We could not confirm when your day ended.',
    actionable: true,
  },
  LOCATION_EXCEPTION: {
    title: 'Location not confirmed',
    detail: 'Your punch location could not be verified.',
    actionable: true,
  },
  PHOTO_EXCEPTION: {
    title: 'Photo not confirmed',
    detail: 'A required punch photo is missing or could not be accepted.',
    actionable: true,
  },
  EVIDENCE_CONFLICT: {
    title: 'Records do not agree',
    detail: 'Your punches and your work sessions do not match for this day.',
    actionable: true,
  },
  LEAVE_WORK_CONFLICT: {
    title: 'Leave and work on the same day',
    detail:
      'Approved leave and recorded work both exist for this day. HR will decide which applies; your leave has not been deducted.',
    actionable: false,
  },
  CALENDAR_UNRESOLVED: {
    title: 'Calendar is being checked',
    detail: 'Apex/HR is reviewing the attendance setup. No action is required from you.',
    actionable: false,
  },
  POLICY_UNRESOLVED: {
    title: 'Attendance setup is being checked',
    detail: 'Apex/HR is reviewing the attendance setup. No action is required from you.',
    actionable: false,
  },
};

export function exceptionCopy(code: AttendanceExceptionCode): ExceptionCopy {
  return (
    EXCEPTION_COPY[code] ?? {
      title: 'Needs review',
      detail: 'This day needs a review.',
      actionable: false,
    }
  );
}

/**
 * Minutes as a duration, or null.
 *
 * Returning null rather than a fallback string is the point: the caller is
 * forced to decide what "unknown" looks like, and cannot accidentally render a
 * zero. Every call site pairs this with the `—` treatment below.
 */
export function formatMinutes(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return null;
  const whole = Math.max(0, Math.floor(minutes));
  return `${Math.floor(whole / 60)}h ${String(whole % 60).padStart(2, '0')}m`;
}

/** What an unmeasurable figure looks like. One place, so it cannot drift. */
export const UNKNOWN_FIGURE = '—';

export function formatMinutesOrUnknown(minutes: number | null | undefined): string {
  return formatMinutes(minutes) ?? UNKNOWN_FIGURE;
}

/** A time of day from an ISO instant, in the viewer's locale. */
export function formatTime(iso: string | null): string {
  if (!iso) return UNKNOWN_FIGURE;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return UNKNOWN_FIGURE;
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function formatLongDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function monthLabel(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1));
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Whether the backend declared a named field unanswerable. */
export function isUnavailable(day: MyAttendanceDayV2, field: string): boolean {
  return day.unavailable.some((u) => u.field === field);
}

/** Presentation of explicit server modifiers; never derives an attendance verdict. */
export function presentDay(day: MyAttendanceDayV2): StatusPresentation {
  if (day.isInProgress) return presentOutcome('IN_PROGRESS');
  const base = presentOutcome(day.outcome);
  if (day.outcome !== 'PRESENT') return base;
  const label = day.modifiers.includes('LATE_EXEMPTED') ? 'Late (exempted)'
    : day.modifiers.includes('LATE') ? 'Late'
    : day.modifiers.includes('INSUFFICIENT_PRESENCE') || day.modifiers.includes('INSUFFICIENT_EFFECTIVE_WORK') ? 'Short hours' : null;
  return label ? { ...base, label, shortLabel: label, color: '#F07500', tint: '#FFF7EF', glyph: '◷' } : base;
}
