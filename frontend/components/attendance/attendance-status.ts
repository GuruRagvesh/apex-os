import type { AttendanceDay, AttendanceStatus } from './attendance-api';

/**
 * Presentation vocabulary for attendance (AE-1).
 *
 * The wording here is deliberately careful. A day the system could not classify
 * is "Needs review" — never "Absent", never "Leave deducted". Telling someone
 * they lost pay is a decision HR makes against policy, not something a calendar
 * cell is entitled to announce.
 */

export interface StatusPresentation {
  label: string;
  /** Tailwind classes for a filled chip. */
  chip: string;
  /** Background for a calendar cell. */
  cell: string;
}

const PRESENTATION: Record<string, StatusPresentation> = {
  PRESENT: {
    label: 'Present',
    chip: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    cell: 'bg-green-50 dark:bg-green-900/20',
  },
  LATE: {
    label: 'Late',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    cell: 'bg-amber-50 dark:bg-amber-900/20',
  },
  LATE_EXEMPTED: {
    label: 'Late (exempted)',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    cell: 'bg-amber-50 dark:bg-amber-900/20',
  },
  LEAVE: {
    label: 'Leave',
    chip: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    cell: 'bg-blue-50 dark:bg-blue-900/20',
  },
  HALF_DAY: {
    label: 'Half day',
    chip: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    cell: 'bg-indigo-50 dark:bg-indigo-900/20',
  },
  WEEKLY_OFF: {
    label: 'Weekly off',
    chip: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    cell: 'bg-gray-50 dark:bg-gray-800/40',
  },
  HOLIDAY: {
    label: 'Holiday',
    chip: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    cell: 'bg-purple-50 dark:bg-purple-900/20',
  },
  LWP: {
    label: 'Leave without pay',
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    cell: 'bg-rose-50 dark:bg-rose-900/20',
  },
  ABSENT: {
    label: 'Absent',
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    cell: 'bg-rose-50 dark:bg-rose-900/20',
  },
  MISSING_PUNCH: {
    label: 'Needs review',
    chip: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    cell: 'bg-orange-50 dark:bg-orange-900/20',
  },
  PENDING_REGULARIZATION: {
    label: 'Needs review',
    chip: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    cell: 'bg-orange-50 dark:bg-orange-900/20',
  },
};

const UNKNOWN: StatusPresentation = {
  label: 'Not applicable',
  chip: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  cell: '',
};

export function presentStatus(status: AttendanceStatus | null): StatusPresentation {
  if (!status) return UNKNOWN;
  return PRESENTATION[status] ?? UNKNOWN;
}

/** Human sentence for why a day looks the way it does. */
const REASONS: Record<string, string> = {
  COMPANY_CLOSURE: 'The office was closed.',
  HOLIDAY: 'Public holiday.',
  WEEKLY_OFF: 'Weekly off.',
  SPECIAL_WORKING_DAY_WORKED: 'Declared a special working day.',
  APPROVED_PAID_LEAVE: 'Approved leave.',
  APPROVED_UNPAID_LEAVE: 'Approved unpaid leave.',
  APPROVED_HALF_DAY_LEAVE: 'Approved half-day leave.',
  COMPLETE_WORKDAY: 'Full workday recorded.',
  WORKDAY_IN_PROGRESS: 'Your workday is still open, so this is provisional.',
  NO_EVIDENCE_ON_WORKING_DAY: 'No punch was recorded for this working day.',
  INCOMPLETE_PUNCH_PAIR: 'You punched in but never punched out.',
  POLICY_DECISION_DEFERRED: 'This day needs a manager or HR decision.',
  AMBIGUOUS_LEAVE: 'More than one approved leave covers this date.',
  NOT_APPLICABLE_EXEMPT: 'Attendance tracking does not apply to you.',
  NOT_APPLICABLE_NOT_EMPLOYED: 'You were not employed on this date.',
  CONTEXT_BLOCKED: 'Your attendance setup is incomplete. HR needs to configure it.',
};

export function reasonText(reason: string): string {
  return REASONS[reason] ?? reason.replaceAll('_', ' ').toLowerCase();
}

/** Plain-language exception lines. None of these assert a pay consequence. */
const EXCEPTIONS: Record<string, string> = {
  MISSING_PUNCH: 'No punch evidence recorded',
  MISSING_PUNCH_OUT: 'Punch out missing',
  NO_ATTENDANCE_EVIDENCE: 'No attendance evidence for this day',
  WORKDAY_STILL_OPEN: 'Workday still open',
  LOCATION_OUTSIDE_GEOFENCE: 'Location needs review — punched outside an approved location',
  LOCATION_LOW_ACCURACY: 'Location needs review — the reading was imprecise',
  LOCATION_UNAVAILABLE: 'Location needs review — no reading was available',
  PHOTO_MISSING: 'Photo evidence missing',
  LATE_BEYOND_PUNCH_WINDOW: 'Arrived after the allowed window',
  INSUFFICIENT_HOURS: 'Worked less than the required hours',
  AMBIGUOUS_APPROVED_LEAVE: 'More than one approved leave covers this date',
  LEAVE_ON_NON_WORKING_DAY: 'Approved leave fell on a non-working day',
};

export function exceptionText(flag: string): string {
  return EXCEPTIONS[flag] ?? flag.replaceAll('_', ' ').toLowerCase();
}

export function formatMinutes(minutes: number): string {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Short line for the workday bar: what today currently looks like. */
export function todaySummary(day: AttendanceDay | undefined): string | null {
  if (!day) return null;
  if (!day.official) return reasonText(day.reason);
  const base = presentStatus(day.status).label;
  return day.evaluationState === 'NEEDS_REVIEW' ? `${base} · needs review` : base;
}
