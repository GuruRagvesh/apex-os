/**
 * Idle detection: the pure rules, separate from React so they can be tested.
 *
 * - Detection runs only while the backend reports the person WORKING in an
 *   open session (GET /workday/today). Never from ticket status or page state.
 * - Idle time is measured from timestamps (now − last activity), never from
 *   counting timer callbacks, so a sleeping laptop or a background tab still
 *   measures the real gap.
 * - Activity is shared across the person's open tabs: activity in any tab
 *   keeps every tab active.
 * - Idle is reported once per idle episode. An episode is identified by the
 *   work session and the moment activity stopped; any tab that reports it
 *   claims the episode, so other tabs do not report it again.
 */

export const IDLE_WARNING_MS = 10 * 60_000;
export const IDLE_REPORT_MS = 20 * 60_000;
export const IDLE_SUGGEST_END_MS = 45 * 60_000;
/** After a failed report, wait this long before trying again. */
export const IDLE_RETRY_MS = 60_000;
/** A shared activity time may be at most this far ahead of this tab's clock. */
export const MAX_ACTIVITY_SKEW_MS = 60_000;
/** An idle-episode claim older than this is stale and may be removed. */
export const IDLE_CLAIM_TTL_MS = 30 * 60_000;

/** localStorage: the latest activity time across all tabs (ms since epoch). */
export const LAST_ACTIVITY_STORAGE_KEY = 'apex:last-activity-at';
/** localStorage prefix: an idle episode a tab has claimed for reporting. */
export const IDLE_EPISODE_CLAIM_PREFIX = 'apex:idle-episode:';
/** BroadcastChannel shared by the person's tabs for workday changes. */
export const WORKDAY_CHANNEL = 'apex-workday';

export type IdlePhase = 'ACTIVE' | 'WARNING' | 'IDLE';

interface WorkdayToday {
  session?: { id?: string; status?: string; logoutAt?: string | null } | null;
  onLeaveToday?: boolean;
}

/**
 * Detection is allowed only while the backend says the person is WORKING in
 * an open session. Loading, failed, OFFLINE, LOGGED_OUT, AUTO_CLOSED,
 * ON_BREAK, ON_LEAVE and IDLE all disable it.
 */
export function idleDetectionEnabled(
  today: WorkdayToday | null | undefined,
  query: { isLoading: boolean; isError: boolean },
): boolean {
  if (query.isLoading || query.isError || !today) return false;
  if (today.onLeaveToday) return false;
  const session = today.session;
  return Boolean(session?.id) && session!.status === 'WORKING' && !session!.logoutAt;
}

/** The latest of two activity timestamps; invalid values are ignored. */
export function latestActivity(...values: Array<number | null | undefined>): number {
  return values.reduce<number>((max, v) => (typeof v === 'number' && Number.isFinite(v) && v > max ? v : max), 0);
}

/** Reads the shared last-activity time written by any tab (0 when unknown). */
export function parseStoredActivity(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * A shared activity timestamp (localStorage or BroadcastChannel), or 0 when it
 * must be ignored: not a finite positive number, or more than
 * MAX_ACTIVITY_SKEW_MS ahead of now. A future time would otherwise keep every
 * tab "active" and suppress idle detection; small clock differences pass.
 */
export function acceptActivityTimestamp(value: unknown, nowMs: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > nowMs + MAX_ACTIVITY_SKEW_MS ? 0 : n;
}

/**
 * The last activity to measure from: the in-memory value merged with shared
 * candidates. Rejected candidates never replace valid local activity, and an
 * in-memory value that is itself too far in the future (poisoned) is recovered
 * to now, so idle detection resumes instead of being suppressed.
 */
export function mergeActivity(currentMs: number, nowMs: number, ...shared: unknown[]): number {
  const current = currentMs > nowMs + MAX_ACTIVITY_SKEW_MS ? nowMs : currentMs;
  return latestActivity(current, ...shared.map((v) => acceptActivityTimestamp(v, nowMs)));
}

/** The localStorage surface the claim helpers need (window.localStorage fits). */
export interface ClaimStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Removes stale idle-episode claims: only keys with IDLE_EPISODE_CLAIM_PREFIX,
 * and only when older than IDLE_CLAIM_TTL_MS or unreadable. A claim in use (a
 * report in flight, or one that just succeeded) is minutes old at most and is
 * kept. Unrelated keys are never touched. Returns the keys removed.
 */
export function pruneIdleEpisodeClaims(storage: ClaimStorage, nowMs: number): string[] {
  const ours: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(IDLE_EPISODE_CLAIM_PREFIX)) ours.push(key);
  }
  const removed: string[] = [];
  for (const key of ours) {
    const at = Number(storage.getItem(key));
    const stale = !Number.isFinite(at) || at <= 0 || nowMs - at > IDLE_CLAIM_TTL_MS || at > nowMs + MAX_ACTIVITY_SKEW_MS;
    if (stale) { storage.removeItem(key); removed.push(key); }
  }
  return removed;
}

/**
 * Claims an idle episode for reporting. False when another tab (or this one)
 * already holds a live claim for it. Stale claims are pruned first, so the
 * store stays bounded. The claim stays after a successful report, so the same
 * episode is never reported twice while it is current.
 */
export function claimIdleEpisode(storage: ClaimStorage, key: string, nowMs: number): boolean {
  pruneIdleEpisodeClaims(storage, nowMs);
  if (storage.getItem(key)) return false;
  storage.setItem(key, String(nowMs));
  return true;
}

/** Releases a claim whose report failed, so it can be retried after the backoff. */
export function releaseIdleEpisode(storage: ClaimStorage, key: string): void {
  storage.removeItem(key);
}

export interface IdleState {
  phase: IdlePhase;
  idleMs: number;
  /** Whole minutes idle, the unit POST /workday/idle expects. */
  idleMinutes: number;
  /** 45 minutes or more: suggest ending the workday instead of resuming. */
  suggestEndOfDay: boolean;
}

/** Where an idle stretch stands, from real elapsed time. */
export function idleState(nowMs: number, lastActivityMs: number): IdleState {
  const idleMs = Math.max(0, nowMs - lastActivityMs);
  const phase: IdlePhase = idleMs >= IDLE_REPORT_MS ? 'IDLE' : idleMs >= IDLE_WARNING_MS ? 'WARNING' : 'ACTIVE';
  return {
    phase,
    idleMs,
    idleMinutes: Math.floor(idleMs / 60_000),
    suggestEndOfDay: idleMs >= IDLE_SUGGEST_END_MS,
  };
}

/** One key per idle episode: this work session, inactive since this moment. */
export function idleEpisodeKey(sessionId: string, lastActivityMs: number): string {
  return `${IDLE_EPISODE_CLAIM_PREFIX}${sessionId}:${lastActivityMs}`;
}

/**
 * Whether this tab should send the idle report now: detection enabled, idle
 * long enough, no report in flight, the episode not yet reported (by this tab
 * or claimed by another), and no recent failed attempt.
 */
export function shouldReportIdle(input: {
  enabled: boolean;
  phase: IdlePhase;
  inFlight: boolean;
  episodeReported: boolean;
  lastFailureAtMs: number | null;
  nowMs: number;
}): boolean {
  if (!input.enabled || input.phase !== 'IDLE' || input.inFlight || input.episodeReported) return false;
  if (input.lastFailureAtMs !== null && input.nowMs - input.lastFailureAtMs < IDLE_RETRY_MS) return false;
  return true;
}
