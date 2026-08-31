/**
 * The handoff secret's journey on the phone: fragment -> memory -> session
 * storage -> back after a login redirect -> gone.
 *
 * Dependency-free on purpose. The frontend has no test runner, so this lives
 * apart from the transport (which imports the axios client) and is exercised
 * from the backend Jest suite. It is also the part most worth testing: it
 * handles a credential.
 *
 * THE FRAGMENT PROBLEM. The secret arrives in `#token=...` because browsers
 * never send a fragment to a server, so it cannot appear in access logs, proxy
 * logs or a Referer header. But a login redirect is a navigation, and
 * navigations lose fragments. So the token is read and stashed BEFORE anything
 * can redirect, the redirect carries only the handoff id, and the secret is
 * recovered on the way back.
 */

/** Where the phone stashes the secret across a login redirect. */
export const handoffSecretKey = (handoffId: string) => `apex.punch.handoff.${handoffId}`;

/** Minimal surface of the two browser objects, so tests can supply fakes. */
export interface TokenEnv {
  hash: string;
  pathname: string;
  search: string;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  replaceUrl?: (url: string) => void;
}

/**
 * Extracts the token from a location hash.
 *
 * Accepts `#token=x` and `#a=1&token=x`, and rejects a bare `#tokenish=x` --
 * matching on `token=` alone would let a differently-named parameter be read
 * as the secret.
 */
export function parseTokenFromHash(hash: string): string | null {
  const match = /(?:^#|[?&])token=([^&]*)/.exec(hash ?? '');
  if (!match) return null;

  const raw = match[1];
  if (raw.length === 0) return null;

  try {
    const decoded = decodeURIComponent(raw);
    return decoded.length > 0 ? decoded : null;
  } catch {
    // A malformed percent-escape is not a usable token. Returning null sends
    // the page down the "this link is not valid" path rather than submitting
    // a corrupted secret the server will refuse anyway.
    return null;
  }
}

/**
 * Reads the token, stashes it, and strips it from the address bar.
 *
 * The fragment is never sent to a server, but it does persist in history and
 * in anything the employee might screenshot, so it does not linger.
 */
export function takeToken(handoffId: string, env: TokenEnv): string | null {
  const fromUrl = parseTokenFromHash(env.hash);

  if (fromUrl) {
    rememberToken(handoffId, fromUrl, env.storage);
    try {
      env.replaceUrl?.(env.pathname + env.search);
    } catch {
      /* address bar unchanged; the token is already in hand */
    }
    return fromUrl;
  }

  return recallToken(handoffId, env.storage);
}

export function rememberToken(
  handoffId: string,
  token: string,
  storage: TokenEnv['storage'],
): void {
  try {
    storage?.setItem(handoffSecretKey(handoffId), token);
  } catch {
    // Private mode or blocked storage. The punch still completes in one go;
    // only surviving a login redirect is lost.
  }
}

export function recallToken(handoffId: string, storage: TokenEnv['storage']): string | null {
  try {
    return storage?.getItem(handoffSecretKey(handoffId)) ?? null;
  } catch {
    return null;
  }
}

/** Cleared on completion, cancellation, expiry and refusal — never left behind
 *  on a shared phone. */
export function forgetToken(handoffId: string, storage: TokenEnv['storage']): void {
  try {
    storage?.removeItem(handoffSecretKey(handoffId));
  } catch {
    /* nothing to clear */
  }
}
