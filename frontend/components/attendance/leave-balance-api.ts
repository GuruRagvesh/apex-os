import { api, unwrap as r } from '@apex/shared-auth';

/**
 * Personal leave entitlement, for the employee's own view.
 *
 * Company holidays and personal leave are different things and are kept apart
 * deliberately: a holiday is a date the company does not work, an entitlement
 * is days this employee may take. Calling the second "holidays available"
 * conflates them, so nothing here uses that word.
 *
 * The response interceptor in `@apex/shared-auth` already returns
 * `response.data`, so these must NOT unwrap a second `.data`.
 *
 * THE SHAPES AND THE EXPIRY WINDOW LIVE IN leave-balance-rules.ts, and are
 * re-exported here. Two reasons: a pure presentation module has to reach them
 * without importing this file's authenticated client, and every existing
 * consumer keeps importing them from here.
 *
 * They were briefly defined in BOTH files -- including two copies of
 * expiringSoon(), each with its own 30-day window, one used by the leave card
 * and the other by the dashboard presentation. Nothing linked them, so
 * narrowing the window in one place would have moved the figure on one screen
 * and not the other.
 */

export type {
  CompOffCredit,
  LeaveBalance,
  PersonalLeaveType,
} from './leave-balance-rules';
export {
  expiringSoon,
  LEAVE_TYPE_LABEL,
  PERSONAL_LEAVE_TYPES,
} from './leave-balance-rules';

import type {
  CompOffCredit,
  LeaveBalance,
  PersonalLeaveType,
} from './leave-balance-rules';

export async function getMyLeaveBalance(type: PersonalLeaveType): Promise<LeaveBalance> {
  return r(api.get('/leave/balance', { params: { type } }));
}

/**
 * Cache keys for the viewer's own comp off, owned next to the endpoint.
 *
 * THE VIEWER IS IN THE KEY, AND THAT IS NOT DECORATION. The credits endpoint
 * is scoped to whoever is signed in, so a key that did not name the viewer
 * would let one employee's cached credits be served to whoever logged in next
 * on the same browser.
 */
export const compOffKeys = {
  credits: (viewerId: string | null | undefined) =>
    ['comp-off-credits', viewerId ?? 'anonymous'] as const,
  /**
   * Another employee's credits, keyed by WHOSE they are.
   *
   * Separate from `credits` on purpose: that one is keyed by the viewer
   * because it returns the viewer's own, and reusing it here would file one
   * employee's credits under the manager who looked at them -- so the next
   * team member opened would be served the previous one's.
   */
  employeeCredits: (employeeId: string) =>
    ['comp-off-credits', 'employee', employeeId] as const,
};

export async function getMyCompOffCredits(): Promise<CompOffCredit[]> {
  const rows = await r<CompOffCredit[]>(api.get('/leave/comp-off/me'));
  return Array.isArray(rows) ? rows : [];
}



// ════════════════════════════════════════════════════════════════════════════
// Acting on somebody else's comp off
// ════════════════════════════════════════════════════════════════════════════
//
// WHETHER THE VIEWER MAY ACT IS THE SERVER'S ANSWER, NOT A ROLE CHECK HERE.
// All three calls below are authorized identically in CompOffService: HR and
// Admin anywhere, a manager inside the departments they manage. The UI decides
// what to show by whether the read SUCCEEDS, rather than re-deriving the rule
// from a role in the auth store -- a second copy of an authorization rule in a
// browser is one that can disagree with the real one, and the browser's copy
// is the one nobody can trust.

/** One employee's available credits. 403 when the caller may not act on them. */
export async function getEmployeeCompOffCredits(
  employeeId: string,
): Promise<CompOffCredit[]> {
  return r(api.get(`/leave/comp-off/employee/${employeeId}`));
}

export interface GrantCompOffInput {
  employeeId: string;
  /** The qualifying day that was worked, yyyy-MM-dd. */
  earnedFromBusinessDate: string;
  reason: string;
}

/**
 * Grants one credit.
 *
 * THE EXPIRY IS NOT SENT. It is the server's to decide from the employee's
 * policy, and a client that could name it could grant itself a longer one.
 * The resulting expiry comes back on the response.
 */
export async function grantCompOff(input: GrantCompOffInput): Promise<CompOffCredit> {
  return r(api.post('/leave/comp-off/grant', input));
}

/**
 * Moves one credit's expiry forward.
 *
 * The ceiling is re-decided server-side whatever date arrives here; a picker
 * constrained in the UI is a convenience, never the enforcement.
 */
export async function extendCompOff(
  creditId: string,
  input: { newExpiry: string; reason: string },
): Promise<CompOffCredit> {
  return r(api.post(`/leave/comp-off/${creditId}/extend`, input));
}
