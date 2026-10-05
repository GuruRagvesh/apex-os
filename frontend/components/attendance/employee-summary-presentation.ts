import type { CompOffCredit, LeaveBalance } from './leave-balance-rules';
import { expiringSoon } from './leave-balance-rules';
import type {
  EmployeeAttendanceSummary,
  SummaryCounts,
  SummaryDay,
  SummaryMetrics,
  SummaryToday,
} from './employee-summary-api';

/**
 * How the employee Attendance dashboard presents what the server already
 * decided.
 *
 * Pure. No React, no network, no clock of its own -- anything needing "today"
 * is handed it -- so the backend suite exercises every rule here.
 *
 * THE SCREEN DECIDES NOTHING. It formats minutes the server counted, labels
 * enums the server assigned, and where the server could not resolve something
 * it says so in words instead of substituting a plausible number. Three
 * specific temptations are refused by construction:
 *
 *   Office Presence is punch out minus punch in. Break minutes NEVER subtract
 *   from it. Effective Work is Workday's own separate measure and appears as
 *   its own row, never blended into presence and never swapped for it.
 *
 *   An unresolved day is NEVER counted as an absence. "Needs Review" and
 *   "No Record" are their own labels and their own KPI cards; nothing here
 *   folds either into the absent figure, because telling somebody they were
 *   absent is a pay-affecting claim and an unclassified day has not made it.
 *
 *   No arrival time, no completion time and no required-hours figure is
 *   written into this file. There is no 09:30 here, no 18:30 and no 540: the
 *   completion clock comes from the server's own resolver, and when the server
 *   returns null this file renders the REASON, not a guess.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Durations and clocks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minutes as "9h 02m" -- padded and spaced.
 *
 * Mirrors formatDurationMinutes in the backend's own summary module byte for
 * byte, deliberately: the same 542 minutes may be read off this screen and off
 * a server-rendered figure in the same conversation, and "9h 2m" beside
 * "9h 02m" reads as two different measurements of the same thing. It is NOT
 * the reminder alarm's formatter, which is a different, denser format for a
 * different surface.
 */
export function formatDurationMinutes(totalMinutes: number | null): string {
  if (!Number.isFinite(totalMinutes) || (totalMinutes as number) < 0) return '—';
  const whole = Math.floor(totalMinutes as number);
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Minutes since company midnight as "HH:MM". */
export function formatClockMinutes(minutesOfDay: number | null): string {
  if (minutesOfDay === null || !Number.isFinite(minutesOfDay)) return '—';
  const clamped = Math.max(0, Math.round(minutesOfDay));
  const h = Math.floor(clamped / 60) % 24;
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** An ISO instant as a local wall clock, for a punch time. */
export function formatPunchTime(iso: string | null): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  return at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─────────────────────────────────────────────────────────────────────────────
// A day's label
// ─────────────────────────────────────────────────────────────────────────────

export type DayTone = 'good' | 'warn' | 'bad' | 'muted';

export interface DayLabel {
  label: string;
  tone: DayTone;
}

const STATUS_LABEL: Record<string, DayLabel> = {
  PRESENT: { label: 'On Time', tone: 'good' },
  LATE: { label: 'Late', tone: 'warn' },
  LATE_EXEMPTED: { label: 'Late (Exempted)', tone: 'muted' },
  LEAVE: { label: 'Approved Leave', tone: 'muted' },
  HALF_DAY: { label: 'Half Day', tone: 'warn' },
  WEEKLY_OFF: { label: 'Weekly Off', tone: 'muted' },
  HOLIDAY: { label: 'Holiday', tone: 'muted' },
  LWP: { label: 'Leave Without Pay', tone: 'warn' },
  ABSENT: { label: 'Absent', tone: 'bad' },
  MISSING_PUNCH: { label: 'Missing Punch', tone: 'warn' },
  PENDING_REGULARIZATION: { label: 'Awaiting Correction', tone: 'warn' },
  GEO_MISMATCH: { label: 'Needs Review', tone: 'warn' },
  FACE_MISSING: { label: 'Needs Review', tone: 'warn' },
};

const NEEDS_REVIEW: DayLabel = { label: 'Needs Review', tone: 'warn' };
const NOT_APPLICABLE: DayLabel = { label: 'Not Applicable', tone: 'muted' };
const NO_RECORD: DayLabel = { label: 'No Record', tone: 'warn' };

/**
 * What one day's row says.
 *
 * TAKES THE WHOLE DAY, not its status and evaluationState alone. A null status
 * arrives for two completely different reasons -- the day was never an
 * attendance day for this person (exempt, before joining, after leaving), or
 * the day IS one and has no answer yet -- and only notApplicable tells them
 * apart. Labelling the first "No Record" shows a management-exempt employee a
 * month of apparent gaps; labelling the second "Not Applicable" hides a real
 * one. The two-argument form cannot get this right, which is why it is not
 * used here.
 *
 * NEEDS_REVIEW WINS over any provisional status: a day the system could not
 * classify must not read as a finished verdict, least of all "Absent".
 */
export function dayLabel(day: Pick<SummaryDay, 'status' | 'evaluationState' | 'notApplicable'>): DayLabel {
  if (day.notApplicable) return NOT_APPLICABLE;
  if (day.evaluationState === 'NEEDS_REVIEW') return NEEDS_REVIEW;
  if (day.status === null) return NO_RECORD;
  return STATUS_LABEL[day.status] ?? NEEDS_REVIEW;
}

// ─────────────────────────────────────────────────────────────────────────────
// The month's KPI cards
// ─────────────────────────────────────────────────────────────────────────────

export interface Kpi {
  key: string;
  label: string;
  value: number;
  tone: DayTone;
  /** Shown under the number. Null when the label needs no qualification. */
  hint: string | null;
}

/**
 * The cards across the top, in reading order.
 *
 * UNRESOLVED NEVER MERGES INTO ABSENCE. "Needs Review" and "No Record" are
 * separate cards from "Absent" and are counted separately by the server; a
 * screen that added them together would report an absence the company never
 * recorded against a person who may simply be waiting on a correction.
 *
 * Zero-valued cards are kept rather than hidden, except the two that only mean
 * anything when they are non-zero: a month with no gaps should show "0" under
 * Needs Review, because a missing card reads as a missing check.
 */
export function monthKpis(counts: SummaryCounts): Kpi[] {
  const cards: Kpi[] = [
    { key: 'present', label: 'On Time', value: counts.present, tone: 'good', hint: null },
    { key: 'late', label: 'Late', value: counts.late, tone: counts.late > 0 ? 'warn' : 'muted', hint: null },
    { key: 'halfDay', label: 'Half Days', value: counts.halfDay, tone: counts.halfDay > 0 ? 'warn' : 'muted', hint: null },
    {
      key: 'approvedLeave', label: 'Approved Leave', value: counts.approvedLeaveDays,
      tone: 'muted', hint: 'days taken this month',
    },
    {
      key: 'shortfall', label: 'Short Hours', value: counts.requiredHoursShortfall,
      tone: counts.requiredHoursShortfall > 0 ? 'warn' : 'muted',
      hint: 'presence under the required hours',
    },
    {
      key: 'needsReview', label: 'Needs Review', value: counts.needsReview,
      tone: counts.needsReview > 0 ? 'warn' : 'muted',
      hint: 'not counted as absence',
    },
    {
      key: 'absent', label: 'Absent', value: counts.absent,
      tone: counts.absent > 0 ? 'bad' : 'muted',
      hint: 'recorded as absent',
    },
  ];
  if (counts.noRecord > 0) {
    cards.push({
      key: 'noRecord', label: 'No Record', value: counts.noRecord, tone: 'warn',
      hint: 'no attendance recorded yet',
    });
  }
  if (counts.notApplicable > 0) {
    cards.push({
      key: 'notApplicable', label: 'Not Applicable', value: counts.notApplicable, tone: 'muted',
      hint: 'attendance tracking does not apply',
    });
  }
  return cards;
}

// ─────────────────────────────────────────────────────────────────────────────
// Time metrics
// ─────────────────────────────────────────────────────────────────────────────

export interface MetricRow {
  key: string;
  label: string;
  value: string;
  hint: string | null;
}

/**
 * The averages, with the two measures kept apart on purpose.
 *
 * Office Presence and Effective Work are different questions -- how long the
 * person was at work, and how much of it the Workday engine counted as work --
 * and they are shown as separate rows with their own wording. Subtracting
 * break from presence, or showing work where presence was asked for, is the
 * single mistake this layout exists to make impossible.
 */
export function metricRows(metrics: SummaryMetrics): MetricRow[] {
  return [
    {
      key: 'presence', label: 'Average office presence',
      value: formatDurationMinutes(metrics.averageOfficePresenceMinutes),
      hint: 'punch out minus punch in — breaks are not deducted',
    },
    {
      key: 'work', label: 'Average effective work',
      value: formatDurationMinutes(metrics.averageEffectiveWorkMinutes),
      hint: 'Workday’s own measure, shown separately',
    },
    {
      key: 'break', label: 'Average break', value: formatDurationMinutes(metrics.averageBreakMinutes),
      hint: null,
    },
    {
      key: 'in', label: 'Average punch in', value: formatClockMinutes(metrics.averagePunchInMinutes),
      hint: null,
    },
    {
      key: 'out', label: 'Average punch out', value: formatClockMinutes(metrics.averagePunchOutMinutes),
      hint: null,
    },
  ];
}

/** What the averages are actually based on, so a small sample is never read as the month. */
export function sampleNote(metrics: SummaryMetrics): string {
  if (metrics.sampleSize === 0) {
    return 'No day this month has both a punch in and a punch out yet.';
  }
  const days = metrics.sampleSize === 1 ? '1 day' : `${metrics.sampleSize} days`;
  return `Averaged over ${days} with both punches recorded. Half-punched days are excluded, not counted as zero.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Today
// ─────────────────────────────────────────────────────────────────────────────

export interface CompletionDisplay {
  value: string;
  /** Why there is no time. Null when there is one. */
  explanation: string | null;
}

const COMPLETION_REASON: Record<string, string> = {
  NO_PUNCH_IN: 'You have not punched in today, so there is nothing to count from yet.',
  NO_ARRIVAL_POLICY:
    'No shift start time is configured for you, so a completion time cannot be worked out. HR needs to set one.',
  NO_REQUIRED_PRESENCE:
    'No required hours are configured for you, so a completion time cannot be worked out. HR needs to set them.',
};

/**
 * When today is expected to be complete.
 *
 * THE NUMBER IS THE SERVER'S. It is max(punch in, shift start) plus required
 * presence, resolved by the same code the workday reminder fires from, so the
 * screen and the alarm cannot disagree about when the day ends. Where the
 * server could not resolve it, the reason is shown -- a screen that filled in
 * a default here would quietly invent a policy for whoever read it.
 */
export function completionDisplay(today: SummaryToday): CompletionDisplay {
  const { expectedCompletionMinutes, unresolvedReason } = today.completion;
  if (expectedCompletionMinutes !== null) {
    return { value: formatClockMinutes(expectedCompletionMinutes), explanation: null };
  }
  return {
    value: '—',
    explanation: unresolvedReason
      ? COMPLETION_REASON[unresolvedReason] ?? 'This could not be worked out from your current setup.'
      : 'This could not be worked out from your current setup.',
  };
}

/** Today's own row out of the month, or null when the month being viewed is not this one. */
export function todayFrom(summary: EmployeeAttendanceSummary): SummaryDay | null {
  return summary.days.find((d) => d.businessDate === summary.today.businessDate) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Needs attention
// ─────────────────────────────────────────────────────────────────────────────

export interface AttentionItem {
  key: string;
  label: string;
  detail: string;
  tone: 'warn' | 'bad';
}

/**
 * What is actually wrong, in order of who can fix it.
 *
 * DESCRIBES, NEVER OFFERS. There is no repair control anywhere in this list:
 * correcting a punch is a regularization request that goes through its own
 * reviewed workflow, and master data is HR's to set. A button here that looked
 * like it fixed something would either do nothing or do it without the review
 * the record requires.
 *
 * An empty array means nothing is wrong, and the screen says so plainly rather
 * than rendering an empty panel.
 */
export function attentionItems(summary: EmployeeAttendanceSummary): AttentionItem[] {
  const n = summary.needsAttention;
  const items: AttentionItem[] = [];

  if (n.missingPunchIn > 0) {
    items.push({
      key: 'missingPunchIn',
      label: plural(n.missingPunchIn, 'day', 'days') + ' with no punch in',
      detail: 'Ask for a correction on those dates from your attendance calendar.',
      tone: 'warn',
    });
  }
  if (n.missingPunchOut > 0) {
    items.push({
      key: 'missingPunchOut',
      label: plural(n.missingPunchOut, 'day', 'days') + ' with no punch out',
      detail: 'Presence cannot be measured without both punches, so these days stay unresolved.',
      tone: 'warn',
    });
  }
  if (n.needsReview > 0) {
    items.push({
      key: 'needsReview',
      label: plural(n.needsReview, 'day', 'days') + ' needing review',
      detail: 'Your manager or HR has to decide these. They are not counted as absence.',
      tone: 'warn',
    });
  }
  if (n.noRecord > 0) {
    items.push({
      key: 'noRecord',
      label: plural(n.noRecord, 'day', 'days') + ' with no attendance recorded',
      detail: 'No punch and no leave was recorded. Raise a correction if you worked on those dates.',
      tone: 'warn',
    });
  }
  if (n.pendingRegularizations > 0) {
    items.push({
      key: 'pendingRegularizations',
      label: plural(n.pendingRegularizations, 'correction', 'corrections') + ' awaiting a decision',
      detail: 'Already raised. Nothing further is needed from you until it is decided.',
      tone: 'warn',
    });
  }
  if (n.missingJoiningDate) {
    items.push({
      key: 'missingJoiningDate',
      label: 'Your joining date is not on record',
      detail: 'HR has to set it. Until then your tenure cannot be worked out and is not shown.',
      tone: 'bad',
    });
  }
  if (n.requiredPresenceUnconfigured) {
    items.push({
      key: 'requiredPresence',
      label: 'Your required hours are not configured',
      detail:
        'No shift or attendance policy sets them for you, so short-hours days cannot be identified. HR has to configure this.',
      tone: 'bad',
    });
  }
  return items;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Header: employment and tenure
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = {
  MANAGEMENT_EXEMPT: 'Management (attendance exempt)',
  TEAM_LEADER: 'Team Leader',
  REGULAR_EMPLOYEE: 'Regular Employee',
};

export function categoryLabel(category: string | null): string | null {
  if (!category) return null;
  return CATEGORY_LABEL[category] ?? category;
}

/**
 * Tenure in words, or null when it is not knowable.
 *
 * NEVER INVENTED. A missing joining date produces null and the header shows a
 * master-data warning instead -- "0 years" against somebody who has been here
 * four is worse than an honest blank, because it looks like an answer.
 */
export function tenureLabel(tenure: { years: number; months: number; known: boolean }): string | null {
  if (!tenure.known) return null;
  const parts: string[] = [];
  if (tenure.years > 0) parts.push(plural(tenure.years, 'year', 'years'));
  if (tenure.months > 0) parts.push(plural(tenure.months, 'month', 'months'));
  if (parts.length === 0) return 'Less than a month';
  return parts.join(' ');
}

/** A yyyy-MM-dd as "9 Nov 2023", in UTC so the stored date is not shifted a day. */
export function formatDateOnly(date: string | null): string {
  if (!date) return '—';
  const at = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(at.getTime())) return '—';
  return at.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Month selection and historical truth
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The months offered in the selector, newest first.
 *
 * NEVER A FUTURE MONTH. A month that has not happened has no attendance to
 * report, and offering it produces a screen of apparent gaps.
 */
export function monthOptions(today: string, count = 6): string[] {
  const [year, month] = today.slice(0, 7).split('-').map(Number);
  const out: string[] = [];
  for (let back = 0; back < Math.max(1, count); back += 1) {
    const at = new Date(Date.UTC(year, month - 1 - back, 1));
    out.push(`${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** A yyyy-MM as "August 2026". */
export function formatMonthLabel(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  if (!year || !mon) return month;
  const at = new Date(Date.UTC(year, mon - 1, 1));
  return at.toLocaleDateString([], { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export type MonthLockState = 'OPEN' | 'PARTIALLY_LOCKED' | 'LOCKED';

/**
 * Whether the month being shown has already been closed.
 *
 * Read from the locked flag the server put on each day, never from the date.
 * "It is last month, so it must be finalised" is a guess; a month can sit open
 * for weeks while corrections are decided, and a screen that called it closed
 * would tell somebody their correction window had shut when it had not.
 *
 * Only days that actually carry a record are considered: an exempt or
 * unrecorded day is never locked, and counting those would keep every month
 * permanently OPEN for the very people whose months are most often closed.
 */
export function monthLockState(days: SummaryDay[]): MonthLockState {
  const recorded = days.filter((d) => d.status !== null);
  if (recorded.length === 0) return 'OPEN';
  const locked = recorded.filter((d) => d.locked).length;
  if (locked === 0) return 'OPEN';
  return locked === recorded.length ? 'LOCKED' : 'PARTIALLY_LOCKED';
}

export function lockNote(state: MonthLockState): string | null {
  if (state === 'LOCKED') {
    return 'This month is closed. What it shows is what was finalised at the time, and it cannot be changed.';
  }
  if (state === 'PARTIALLY_LOCKED') {
    return 'Some days this month are already closed and can no longer be changed.';
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Leave and Comp Off, straight off their own authoritative endpoints
// ─────────────────────────────────────────────────────────────────────────────

export interface LeaveRow {
  label: string;
  accrued: number | null;
  used: number | null;
  remaining: number | null;
}

/**
 * One leave type's three figures, READ not computed.
 *
 * allocation, approved and balance all arrive from GET /leave/balance, which
 * has already applied everything taken and everything awaiting a decision.
 * This function does no arithmetic at all -- deliberately. The moment a screen
 * works out "remaining" for itself it becomes a second opinion about an
 * entitlement, and the two are only ever noticed when they disagree in front
 * of the person whose leave it is.
 */
export function leaveRow(label: string, balance: LeaveBalance | undefined): LeaveRow {
  if (!balance) return { label, accrued: null, used: null, remaining: null };
  return {
    label,
    accrued: balance.allocation,
    used: balance.approved,
    remaining: balance.balance,
  };
}

export interface CompOffBuckets {
  available: number;
  used: number;
  expired: number;
  expiringSoon: number;
}

/**
 * Comp off credits counted by the status the SERVER gave each one.
 *
 * ONE JUDGEMENT, AND IT IS NOT OPTIONAL: a credit still marked AVAILABLE whose
 * expiry has already passed is not available. Nothing sweeps that status on a
 * schedule, so counting by status alone tells somebody they hold four days
 * when two lapsed last month. This rule is also stated in the leave
 * component's own comp-off-presentation.ts, which is component-internal and
 * publishes only its screen -- so it cannot be imported here. Both copies must
 * change together until that helper is published; see the note in the report
 * for this change.
 *
 * Nothing else here interprets anything: used and expired are simply the
 * server's own statuses counted.
 */
export function compOffBuckets(credits: CompOffCredit[], now: Date): CompOffBuckets {
  const available = credits.filter(
    (c) => c.status === 'AVAILABLE' && !hasLapsed(c.expiresAt, now),
  );
  return {
    available: available.length,
    used: credits.filter((c) => c.status === 'USED').length,
    expired:
      credits.filter((c) => c.status === 'EXPIRED').length
      + credits.filter((c) => c.status === 'AVAILABLE' && hasLapsed(c.expiresAt, now)).length,
    // The window itself comes from expiringSoon(), already used by the leave
    // balance card, applied to the AVAILABLE set rather than to every credit --
    // a spent or lapsed credit is not "expiring".
    expiringSoon: expiringSoon(available, now).length,
  };
}

/**
 * Whether an expiry date is in the past.
 *
 * THE LAST DAY IS INCLUSIVE -- a credit expiring today is usable today.
 * Telling somebody their entitlement is gone while they can still spend it is
 * the more expensive of the two mistakes.
 */
function hasLapsed(expiresAt: string, now: Date): boolean {
  const expires = new Date(`${expiresAt.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(expires.getTime())) return false;
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return expires.getTime() < today.getTime();
}
