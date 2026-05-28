/**
 * ticket-timing.ts
 *
 * Client-side ticket timer logic.
 *
 * Rules:
 *  - Execution timer  = assignee's responsibility (OPEN / IN_PROGRESS)
 *  - Review timer     = reviewer's responsibility (REVIEW)
 *  - Timers are NEVER the same timer
 *  - Execution overdue STOPS permanently once submittedAt is set
 *  - DONE / CLOSED → no active timer
 */

export type TimerPhase =
  | 'execution'   // ticket is being worked on (OPEN / IN_PROGRESS)
  | 'review'      // ticket is in REVIEW
  | 'none';       // terminal or timer not applicable

export interface TicketTimingState {
  phase: TimerPhase;
  /** The point in time the active deadline expires (or expired). */
  dueAt: Date | null;
  /** Milliseconds until due (negative = overdue). */
  msUntilDue: number | null;
  isOverdue: boolean;
  overdueMinutes: number;
  overdueDisplay: string | null;
  overdueSeverity: 'green' | 'yellow' | 'orange' | 'deep-orange' | 'red' | null;
  /** Human-readable countdown, e.g. "2h 14m left" or "3h 5m overdue" */
  countdownLabel: string | null;
}

const DONE_STATE: TicketTimingState = {
  phase: 'none',
  dueAt: null,
  msUntilDue: null,
  isOverdue: false,
  overdueMinutes: 0,
  overdueDisplay: null,
  overdueSeverity: null,
  countdownLabel: null,
};

function formatDuration(totalMinutes: number): string {
  const absMin = Math.abs(totalMinutes);
  if (absMin < 60) return `${absMin}m`;
  const h = Math.floor(absMin / 60);
  const m = absMin % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
  }
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function severityFromMinutes(overdueMins: number): TicketTimingState['overdueSeverity'] {
  if (overdueMins < 60)  return 'orange';
  if (overdueMins < 240) return 'deep-orange';
  return 'red';
}

function urgencyFromMsLeft(msUntilDue: number): TicketTimingState['overdueSeverity'] {
  const minsLeft = Math.floor(msUntilDue / 60_000);
  if (minsLeft > 120) return 'green';
  if (minsLeft > 30)  return 'yellow';
  return 'orange';
}

/**
 * Core function — compute the timing state for a ticket at the current moment.
 * `ticket` should have the shape returned by the API (all timing fields present).
 */
export function computeClientTimingState(ticket: Record<string, any>): TicketTimingState {
  const status: string = ticket.status ?? '';
  const backendTiming = ticket.timing;
  if (backendTiming) {
    if (['completed', 'cancelled', 'none'].includes(backendTiming.timerType)) return DONE_STATE;
    const dueAt = backendTiming.dueAt ? new Date(backendTiming.dueAt) : null;
    if (!dueAt) return DONE_STATE;
    const msUntilDue = dueAt.getTime() - Date.now();
    const diffMinutes = Math.floor(-msUntilDue / 60_000);
    const isOverdue = msUntilDue < 0;
    const phase = backendTiming.timerType === 'review' ? 'review' : 'execution';
    return {
      phase,
      dueAt,
      msUntilDue,
      isOverdue,
      overdueMinutes: isOverdue ? diffMinutes : 0,
      overdueDisplay: isOverdue ? `${formatDuration(diffMinutes)} overdue` : null,
      overdueSeverity: isOverdue ? severityFromMinutes(diffMinutes) : urgencyFromMsLeft(msUntilDue),
      countdownLabel: isOverdue
        ? `${formatDuration(diffMinutes)} overdue`
        : `${formatDuration(Math.floor(msUntilDue / 60_000))} left`,
    };
  }

  // ── Terminal ───────────────────────────────────────────────────────────────
  if (status === 'DONE' || status === 'CLOSED') return DONE_STATE;

  const now = Date.now();

  // ── REVIEW phase ───────────────────────────────────────────────────────────
  if (status === 'REVIEW') {
    const reviewDueAt = ticket.reviewDueAt ? new Date(ticket.reviewDueAt) : null;
    if (!reviewDueAt) return { ...DONE_STATE, phase: 'review' };

    const msUntilDue = reviewDueAt.getTime() - now;
    const diffMinutes = Math.floor(-msUntilDue / 60_000);
    const isOverdue = msUntilDue < 0;

    return {
      phase: 'review',
      dueAt: reviewDueAt,
      msUntilDue,
      isOverdue,
      overdueMinutes: isOverdue ? diffMinutes : 0,
      overdueDisplay: isOverdue ? `${formatDuration(diffMinutes)} overdue` : null,
      overdueSeverity: isOverdue ? severityFromMinutes(diffMinutes) : urgencyFromMsLeft(msUntilDue),
      countdownLabel: isOverdue
        ? `${formatDuration(diffMinutes)} overdue`
        : `${formatDuration(Math.floor(msUntilDue / 60_000))} left`,
    };
  }

  // ── Execution phase (OPEN / IN_PROGRESS) ───────────────────────────────────
  // Once submittedAt is set the execution timer is permanently stopped, even if
  // the ticket bounced back from REVIEW to IN_PROGRESS.
  if (ticket.submittedAt) {
    return { ...DONE_STATE, phase: 'execution' };
  }

  const executionDueAt = ticket.executionDueAt ? new Date(ticket.executionDueAt) : null;
  if (!executionDueAt) {
    return { ...DONE_STATE, phase: 'execution' };
  }

  const msUntilDue = executionDueAt.getTime() - now;
  const diffMinutes = Math.floor(-msUntilDue / 60_000);
  const isOverdue = msUntilDue < 0;

  return {
    phase: 'execution',
    dueAt: executionDueAt,
    msUntilDue,
    isOverdue,
    overdueMinutes: isOverdue ? diffMinutes : 0,
    overdueDisplay: isOverdue ? `${formatDuration(diffMinutes)} overdue` : null,
    overdueSeverity: isOverdue ? severityFromMinutes(diffMinutes) : urgencyFromMsLeft(msUntilDue),
    countdownLabel: isOverdue
      ? `${formatDuration(diffMinutes)} overdue`
      : `${formatDuration(Math.floor(msUntilDue / 60_000))} left`,
  };
}

/** Tailwind colour classes for each severity level */
export function getTimingColorClasses(severity: TicketTimingState['overdueSeverity'] | null) {
  switch (severity) {
    case 'green':      return { text: 'text-green-600',  bg: 'bg-green-50',  border: 'border-green-300',  badge: 'bg-green-100 text-green-700' };
    case 'yellow':     return { text: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-300', badge: 'bg-yellow-100 text-yellow-700' };
    case 'orange':     return { text: 'text-orange-500', bg: 'bg-orange-50', border: 'border-orange-300', badge: 'bg-orange-100 text-orange-600' };
    case 'deep-orange':return { text: 'text-orange-700', bg: 'bg-orange-100',border: 'border-orange-400', badge: 'bg-orange-200 text-orange-800' };
    case 'red':        return { text: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-300',    badge: 'bg-red-100 text-red-700' };
    default:           return { text: 'text-gray-400',   bg: 'bg-gray-50',   border: 'border-gray-200',   badge: 'bg-gray-100 text-gray-500' };
  }
}

export { formatDuration };
