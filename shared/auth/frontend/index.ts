// shared/auth — browser surface.
//
// The authenticated HTTP client and its response helper. Nothing here reads
// application state or imports a store; it is transport only.

export {
  api,
  unwrap,
  API_BASE_URL,
  shouldRetryTransientQuery,
  transientQueryRetryDelay,
  isTransientFailure,
} from './authenticated-api-client';
export {
  pollWhileHealthy,
  refetchFailedQueries,
  createReconnectCoordinator,
  onSocketReconnect,
  RECONNECT_COOLDOWN_MS,
  POLL_BACKOFF_START_MS,
  POLL_BACKOFF_MAX_MS,
  READ_QUERY_DEFAULTS,
  MUTATION_DEFAULTS,
} from './query-polling';
export type { PollableQuery } from './query-polling';
