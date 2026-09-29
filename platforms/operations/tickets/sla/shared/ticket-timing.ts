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
  | 'blocked'     // ticket is blocked — SLA paused
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
  /** Backend's own short label for the active timer, e.g. "Due date", "Execution SLA", "Review SLA". */
  label: string | null;
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
  label: null,
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
  const backendTiming = ticket.timing;
  if (!backendTiming) return DONE_STATE;

  if (['completed', 'cancelled', 'none'].includes(backendTiming.timerType)) return DONE_STATE;

  // Blocked — SLA paused, show amber "Blocked" indicator instead of timer
  if (backendTiming.timerType === 'blocked') {
    return {
      phase: 'blocked',
      dueAt: null,
      msUntilDue: null,
      isOverdue: false,
      overdueMinutes: 0,
      overdueDisplay: null,
      overdueSeverity: 'orange',
      countdownLabel: '🚫 Blocked',
      label: backendTiming.label ?? null,
    };
  }

  const dueAt = backendTiming.dueAt ? new Date(backendTiming.dueAt) : null;
  if (!dueAt) return DONE_STATE;

  const phase = backendTiming.timerType === 'review' ? 'review' : 'execution';
  const msUntilDue = backendTiming.remainingMs ? backendTiming.remainingMs : (backendTiming.overdueMs ? -backendTiming.overdueMs : 0);
  const diffMinutes = Math.max(0, Math.floor((backendTiming.overdueMs ?? 0) / 60_000));
  const isOverdue = !!backendTiming.isOverdue;

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
    label: backendTiming.label ?? null,
  };
}

/**
 * The deadline countdown as it may be shown to people. It is wall-clock time to
 * the due / SLA time and keeps running through breaks, so it is never labelled
 * "Time left" — that name is reserved for the work budget (computeWorkBudget).
 * e.g. "Due in 33m" or "2h 5m overdue"; null when there is nothing to show.
 */
export function dueCountdownText(state: TicketTimingState): string | null {
  if (!state.countdownLabel || state.phase === 'blocked') return null;
  if (state.isOverdue) return state.countdownLabel;
  return `Due in ${formatDuration(Math.max(0, Math.floor((state.msUntilDue ?? 0) / 60_000)))}`;
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

// ── Why a waiting ticket is paused ───────────────────────────────────────────
// From `timers.pause` (ticket detail) or `workBudget.pause` (lists), which the
// backend derives from the assignee's live state. Null when the clock runs or
// the ticket is not IN_PROGRESS. e.g. "Paused · <assignee> is on TKT-123".
export function pauseLabel(ticket: Record<string, any>): string | null {
  const p = ticket?.timers?.pause ?? ticket?.workBudget?.pause;
  if (!p || ticket?.status !== 'IN_PROGRESS') return null;
  const who = ticket?.assignedTo?.name ?? 'Assignee';
  switch (p.reason) {
    case 'WORKING_ON_OTHER': return `Paused · ${who} is on ${p.otherTicketKey ?? 'another ticket'}`;
    case 'ON_BREAK':         return `Paused · ${who} is on break`;
    case 'IDLE':             return `Paused · ${who} is idle`;
    case 'PUNCHED_OUT':      return `Paused · ${who} has punched out`;
    case 'BLOCKED':          return 'Paused · blocked';
    case 'WAITING':          return 'Paused · starting next';
    default:                 return 'Paused';
  }
}

// ── List / Kanban badge for the work budget ──────────────────────────────────
// Pure description of the TimingTicker badge, so its rules are testable.
// A blocked ticket keeps its frozen work-budget Time Left; "blocked" only
// changes the state (icon, suffix, tooltip), never swaps in the SLA countdown.
export interface WorkBudgetBadge {
  icon: '⏱' | '⏳' | '⏸';
  text: string;
  tooltip: string;
  tone: 'over' | 'running' | 'paused';
}

export function workBudgetBadge(ticket: Record<string, any>, nowMs: number = Date.now()): WorkBudgetBadge | null {
  const budget = computeWorkBudget(ticket, nowMs);
  if (!budget) return null;
  const blocked = !!ticket?.isBlocked;
  const running = budget.running && !blocked;
  return {
    icon: budget.over ? '⏱' : running ? '⏳' : '⏸',
    text: `${budget.label}${running ? '' : blocked ? ' · blocked' : ' · paused'}`,
    tooltip: running ? 'Work timer running' : pauseLabel(ticket) ?? (blocked ? 'Paused · blocked' : 'Work timer paused'),
    tone: budget.over ? 'over' : running ? 'running' : 'paused',
  };
}

// ── Work budget ("Time left") ────────────────────────────────────────────────
// Time left on an OPEN / IN_PROGRESS ticket is the current cycle's estimate
// minus the assignee's productive work time, from `ticket.workBudget`, which the
// backend attaches to every ticket response (TicketLedgerService). It is not the
// SLA deadline above: breaks, end day, punch out, blocked and switched-away time
// never use it up. It only counts down while the assignee's clock is running.

export interface WorkBudgetState {
  /** e.g. "49m left" or "12m over estimate" */
  label: string;
  over: boolean;
  running: boolean;
  /** Productive minutes in the current cycle (the "Spent so far" figure). */
  workedMinutes: number;
  estimatedMinutes: number;
  cycle: 'ORIGINAL' | 'REWORK';
}

export function computeWorkBudget(ticket: Record<string, any>, nowMs: number = Date.now()): WorkBudgetState | null {
  const b = ticket?.workBudget;
  if (!b || !['OPEN', 'IN_PROGRESS'].includes(ticket?.status)) return null;
  if (!b.estimatedMinutes || b.estimatedMinutes <= 0) {
    // A rework sent back without an estimate has no budget of its own. Say so
    // rather than falling back to the SLA deadline or the original estimate.
    if (b.cycle !== 'REWORK') return null;
    const worked = Math.floor((b.workedSeconds ?? 0) / 60);
    return { label: 'No rework estimate', over: false, running: !!b.running, workedMinutes: worked, estimatedMinutes: 0, cycle: 'REWORK' };
  }
  // While running, count on from the moment the backend measured it.
  const sinceAsOf = b.running && b.asOf ? Math.max(0, (nowMs - new Date(b.asOf).getTime()) / 1000) : 0;
  const workedSeconds = (b.workedSeconds ?? 0) + sinceAsOf;
  const workedMinutes = Math.floor(workedSeconds / 60);
  const leftMinutes = b.estimatedMinutes - workedMinutes;
  return {
    label: leftMinutes >= 0 ? `${formatDuration(leftMinutes)} left` : `${formatDuration(leftMinutes)} over estimate`,
    over: leftMinutes < 0,
    running: !!b.running,
    workedMinutes,
    estimatedMinutes: b.estimatedMinutes,
    cycle: b.cycle === 'REWORK' ? 'REWORK' : 'ORIGINAL',
  };
}
