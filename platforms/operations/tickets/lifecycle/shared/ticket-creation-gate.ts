/**
 * Whether the signed-in person may create tickets right now.
 *
 * The backend is the authority: POST /tickets and POST /tickets/bulk refuse
 * with 409 ACTIVE_WORKDAY_REQUIRED unless the creator is punched in, and
 * GET /workday/today reports the same rule as `ticketCreation`. The UI only
 * mirrors that answer so the controls explain themselves instead of failing.
 */

export const ACTIVE_WORKDAY_REQUIRED = 'ACTIVE_WORKDAY_REQUIRED';
export const PUNCH_IN_TO_CREATE_MESSAGE = 'Punch In before creating a ticket.';
export const WORKDAY_UNVERIFIED_MESSAGE = 'Unable to verify your workday. Refresh and try again.';
export const WORKDAY_CHECKING_MESSAGE = 'Checking your workday…';

/** React Query key every workday consumer shares; refetching it updates the gate everywhere. */
export const WORKDAY_TODAY_QUERY_KEY = ['workday-today'] as const;

export interface TicketCreationGate {
  allowed: boolean;
  /** The workday has not loaded yet. */
  pending: boolean;
  /** Why creation is unavailable; null when it is allowed. */
  reason: string | null;
}

/**
 * Fails closed: creation is enabled only when the backend has said so and its
 * latest read succeeded. While the workday is loading the controls wait; if it
 * cannot be read (even with an older answer cached), or the answer carries no
 * ticketCreation verdict, they stay disabled with a reason.
 */
export function ticketCreationGate(
  today: unknown,
  query: { isLoading: boolean; isError: boolean },
): TicketCreationGate {
  // Checked first: when a refetch fails, React Query keeps the last successful
  // answer as data. That cached "allowed" is no longer verified.
  if (query.isError) return { allowed: false, pending: false, reason: WORKDAY_UNVERIFIED_MESSAGE };
  if (!today) return { allowed: false, pending: true, reason: WORKDAY_CHECKING_MESSAGE };
  const state = (today as any)?.ticketCreation;
  if (state?.allowed === true) return { allowed: true, pending: false, reason: null };
  if (state?.allowed === false) {
    return {
      allowed: false,
      pending: false,
      reason: typeof state.message === 'string' && state.message ? state.message : PUNCH_IN_TO_CREATE_MESSAGE,
    };
  }
  return { allowed: false, pending: false, reason: WORKDAY_UNVERIFIED_MESSAGE };
}

/** True for the backend's "Punch In before creating a ticket." refusal, in any error shape the client produces. */
export function isActiveWorkdayRequiredError(err: unknown): boolean {
  const e = err as any;
  return (
    e?.code === ACTIVE_WORKDAY_REQUIRED ||
    e?.response?.data?.code === ACTIVE_WORKDAY_REQUIRED ||
    e?.message?.code === ACTIVE_WORKDAY_REQUIRED
  );
}
