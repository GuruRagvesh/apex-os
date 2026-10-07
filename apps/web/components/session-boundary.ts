// Apex OS — session boundary decisions for the app shell (pure, no React).
//
// Two things must follow the signed-in user, and neither did before Phase 6E:
//
// 1. The TanStack Query cache. Most query keys are not user-scoped
//    (['projects'], ['dashboard-overview'], ['workload'] ...), and logout is a
//    client-side navigation, so the next person on the same browser was served
//    the previous person's cached data until each query refetched.
// 2. Other tabs. The token lives in localStorage and the HTTP client reads it
//    per request, so when one tab signs in as someone else, every other open
//    tab kept showing the old user while sending the new user's token.
//
// The token key is read, never written or renamed, here.

export const AUTH_TOKEN_KEY = 'apex_token';

/**
 * Returns a function that reports whether the signed-in user id changed since
 * the last call. The first value is the baseline (rehydration is not a change);
 * null and undefined both mean "signed out".
 */
export function createUserChangeTracker() {
  let seen = false;
  let last: string | null = null;
  return (userId: string | null | undefined): boolean => {
    const next = userId ?? null;
    if (!seen) {
      seen = true;
      last = next;
      return false;
    }
    if (next === last) return false;
    last = next;
    return true;
  };
}

export type TokenStorageAction = 'ignore' | 'sign-out' | 'reload';

/**
 * What this tab does when another tab changes localStorage. `key` is null
 * when the other tab cleared all of localStorage.
 */
export function tokenStorageAction(
  event: { key: string | null; newValue: string | null },
  currentToken: string | null,
): TokenStorageAction {
  if (event.key !== null && event.key !== AUTH_TOKEN_KEY) return 'ignore';
  const next = event.key === null ? null : event.newValue;
  if (next === currentToken) return 'ignore';
  if (!next) return currentToken ? 'sign-out' : 'ignore';
  return 'reload';
}
