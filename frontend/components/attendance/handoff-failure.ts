/**
 * Why the phone link could not be created, in words that name the actual fault.
 *
 * Dependency-free so the backend Jest suite can exercise it; the frontend has
 * no test runner.
 *
 * WHY THIS EXISTS. Every failure used to collapse into one sentence:
 * "The phone link could not be created." During production acceptance the
 * frontend was deployed ahead of the backend, so `POST /attendance/punch-handoff`
 * returned 404 -- and a 404 carries no `response.data.message`, so it rendered
 * as that same generic line. The message was indistinguishable from a throttled
 * burst, an expired session, or a server fault, and it cost a round of
 * production debugging to tell them apart.
 *
 * A message that cannot distinguish "this build is missing the feature" from
 * "try again in a moment" is not an error message, it is a shrug.
 */

export interface HandoffFailure {
  message: string;
  /** Whether pressing "Try again" could plausibly work. */
  retryable: boolean;
  /** Short machine tag, for the console and for tests. */
  code:
    | 'ROUTE_MISSING'
    | 'SESSION_EXPIRED'
    | 'THROTTLED'
    | 'REFUSED'
    | 'SERVER_ERROR'
    | 'NETWORK'
    | 'UNKNOWN';
}

export function classifyHandoffFailure(err: any): HandoffFailure {
  const status: number | undefined = err?.response?.status;
  const serverMessage: unknown = err?.response?.data?.message;

  // No response at all: the request never completed. Offline, DNS, CORS, a
  // proxy that dropped it. Always worth retrying.
  if (status === undefined) {
    return {
      code: 'NETWORK',
      retryable: true,
      message: 'Could not reach Apex OS to create the phone link. Check your connection.',
    };
  }

  if (status === 404) {
    return {
      code: 'ROUTE_MISSING',
      retryable: false,
      message:
        'This Apex OS server does not support the phone link yet. Ask IT to confirm the backend ' +
        'is running the current release.',
    };
  }

  if (status === 401 || status === 403) {
    return {
      code: 'SESSION_EXPIRED',
      retryable: false,
      message: 'Your session has expired. Sign in again and start the punch from the beginning.',
    };
  }

  if (status === 429) {
    return {
      code: 'THROTTLED',
      retryable: true,
      message: 'Too many phone links were requested. Wait a moment and try again.',
    };
  }

  if (status >= 500) {
    return {
      code: 'SERVER_ERROR',
      retryable: true,
      message: 'Apex OS could not create the phone link just now. Try again.',
    };
  }

  // 4xx the server chose to explain. Its wording is better than ours, because
  // it knows which rule refused.
  return {
    code: 'REFUSED',
    retryable: false,
    message:
      typeof serverMessage === 'string' && serverMessage.trim().length > 0
        ? serverMessage
        : 'The phone link was not created.',
  };
}

/** Convenience for render code that only needs the sentence. */
export function describeHandoffFailure(err: any): string {
  return classifyHandoffFailure(err).message;
}
