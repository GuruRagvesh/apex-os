// Polling that stops hammering a failing endpoint.
//
// About thirty screens poll with a fixed react-query `refetchInterval`. When a
// read kept answering 500, every open tab still asked again every 15-60 s, and
// each of those asks retried three more times, so a broken endpoint drew a
// steady storm that also slowed every healthy request. Wrap the interval:
//
//   refetchInterval: pollWhileHealthy(30_000)
//
// While the last fetch succeeded, the screen polls at its normal interval.
// Once a fetch has failed with a transient error (5xx, timeout, no answer)
// after its retries, the next poll waits POLL_BACKOFF_START_MS, then twice as
// long after each further failure, up to POLL_BACKOFF_MAX_MS. A non-transient
// error (400, 403, 404) stops polling: asking again gives the same answer.
// Window focus, reconnect, a Retry button or a changed filter (a new query
// key) still fetch at once, and the first success restores the normal interval.
//
// Must not import: platforms/**, apps/**, frontend feature code, or any store.

import { isTransientFailure, shouldRetryTransientQuery, transientQueryRetryDelay } from './authenticated-api-client';

/**
 * The app's read-query defaults (apps/web Providers adds gcTime). A failed
 * read makes one request plus at most three retries; refetchOnWindowFocus and
 * refetchOnReconnect stay react-query's default (on), and a fetch already in
 * flight for the same key is shared, never duplicated.
 */
export const READ_QUERY_DEFAULTS = {
  staleTime: 30_000,
  retry: shouldRetryTransientQuery,
  retryDelay: transientQueryRetryDelay,
  refetchOnReconnect: true,
} as const;

/**
 * Saves are never retried automatically: a request that timed out may still
 * have been applied, and sending it again could apply it twice.
 */
export const MUTATION_DEFAULTS = { retry: false } as const;

export const POLL_BACKOFF_START_MS = 2 * 60_000;
export const POLL_BACKOFF_MAX_MS = 15 * 60_000;

/** The parts of a react-query Query this needs (kept structural so shared/ has no react-query import). */
export interface PollableQuery {
  state: {
    status: 'pending' | 'error' | 'success';
    error: unknown;
    errorUpdatedAt: number;
    data?: unknown;
  };
}

/**
 * Retry, once each, the reads on screen whose last fetch failed. For a signal
 * that the backend is back (socket reconnect). Healthy queries are untouched.
 */
export function refetchFailedQueries(client: {
  refetchQueries(filters: { type: 'active'; predicate: (query: PollableQuery) => boolean }): Promise<unknown>;
}): Promise<unknown> {
  return client.refetchQueries({ type: 'active', predicate: (query) => query.state.status === 'error' });
}

export const RECONNECT_COOLDOWN_MS = 30_000;

/**
 * One coordinator for every socket on the page. Each useSocket() instance
 * (Tickets list, ticket detail, topbar) reports its own reconnect, often a
 * few seconds apart; only the first starts a refetch of the failed reads.
 * Later reports are dropped while that refetch is running and for
 * RECONNECT_COOLDOWN_MS after it started (longer than one failing read's
 * request + 3 retries, ~15 s), so staggered reconnects make one cycle.
 */
export function createReconnectCoordinator(cooldownMs = RECONNECT_COOLDOWN_MS, now: () => number = Date.now) {
  let running: Promise<unknown> | null = null;
  let startedAt = -Infinity;
  return (client: Parameters<typeof refetchFailedQueries>[0]): Promise<unknown> | null => {
    if (running || now() - startedAt < cooldownMs) return null;
    startedAt = now();
    running = refetchFailedQueries(client).finally(() => { running = null; });
    return running;
  };
}

/** The page-wide coordinator useSocket() reports reconnects to. */
export const onSocketReconnect = createReconnectCoordinator();

type Interval<Q> = number | false | ((query: Q) => number | false | undefined);

// Consecutive failed polls per query, keyed by the Query object so a query
// that is garbage-collected takes its count with it.
const failedPolls = new WeakMap<object, { errorUpdatedAt: number; count: number }>();

// The returned function takes `any` on purpose: a typed parameter becomes an
// inference site for useQuery's generics and turns every screen's data into
// `unknown`. Its body reads the query only through PollableQuery.
export function pollWhileHealthy(interval: Interval<PollableQuery>): (query: any) => number | false {
  return (query: PollableQuery): number | false => {
    const base = typeof interval === 'function' ? interval(query) : interval;
    const prev = failedPolls.get(query);
    if (query.state.status === 'success') {
      failedPolls.delete(query);
      return base ?? false;
    }
    if (query.state.status === 'pending') {
      // A query that never loaded goes back to 'pending' while a probe runs;
      // keep its backoff (and the count) until that probe answers.
      return prev && base ? backoffFor(base, prev.count) : base ?? false;
    }
    if (!base || !isTransientFailure(query.state.error)) return false;

    // Called on every observer update; count each failed fetch once.
    const streak = prev && prev.errorUpdatedAt === query.state.errorUpdatedAt
      ? prev
      : { errorUpdatedAt: query.state.errorUpdatedAt, count: (prev?.count ?? 0) + 1 };
    failedPolls.set(query, streak);
    return backoffFor(base, streak.count);
  };
}

function backoffFor(base: number, failedPolls: number): number {
  return Math.max(base, Math.min(POLL_BACKOFF_START_MS * 2 ** (failedPolls - 1), POLL_BACKOFF_MAX_MS));
}
