// Apex OS — keeps already-loaded data in the browser across page loads.
//
// Without this, every page load and every refresh started from an empty
// TanStack Query cache and asked the backend for everything again. Now the
// last successful answers are saved per signed-in user and shown immediately
// on the next load; react-query still refetches anything older than its
// staleTime in the background, so the screen catches up with the server
// without blocking on it.
//
// Rules:
//   - Only successful query results are kept. Mutations (saves) are never
//     stored or replayed: a save always goes to the backend.
//   - One entry per user id. It is ignored when older than MAX_AGE_MS, when it
//     was written by a different cache version, or when it belongs to anyone
//     but the user signed in now. Logout and a change of user delete it.
//   - Queries can opt out with `meta: { persist: false }` (large or sensitive
//     payloads such as file previews).
//   - Storage problems (quota, private mode, corrupt JSON) are swallowed: the
//     app then simply behaves as before, loading from the backend.

import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query';

export const QUERY_CACHE_KEY_PREFIX = 'apex-query-cache:';
/** Bump when cached shapes change incompatibly; older entries are then ignored. */
export const QUERY_CACHE_VERSION = 3;
/** Cached data older than a day is never shown. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** localStorage is ~5 MB per origin; never let the cache crowd out the token. */
export const MAX_BYTES = 1_500_000;
const SAVE_DELAY_MS = 1_000;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

interface Saved {
  v: number;
  userId: string;
  savedAt: number;
  state: unknown;
}

export const cacheKeyFor = (userId: string) => `${QUERY_CACHE_KEY_PREFIX}${userId}`;

/** Puts the saved cache for `userId` into the client. Returns true when something was restored. */
export function restoreQueryCache(client: QueryClient, storage: KeyValueStorage, userId: string, now = Date.now()): boolean {
  try {
    const raw = storage.getItem(cacheKeyFor(userId));
    if (!raw) return false;
    const saved = JSON.parse(raw) as Saved;
    if (saved?.v !== QUERY_CACHE_VERSION || saved.userId !== userId || typeof saved.savedAt !== 'number' || now - saved.savedAt > MAX_AGE_MS) {
      storage.removeItem(cacheKeyFor(userId));
      return false;
    }
    hydrate(client, saved.state as any);
    return true;
  } catch {
    try { storage.removeItem(cacheKeyFor(userId)); } catch { /* storage unavailable */ }
    return false;
  }
}

/** Writes the successful queries of `client` for `userId`. Returns false when nothing could be stored. */
export function saveQueryCache(client: QueryClient, storage: KeyValueStorage, userId: string, now = Date.now()): boolean {
  try {
    const state = dehydrate(client, {
      shouldDehydrateQuery: (q) => q.state.status === 'success' && q.meta?.persist !== false && q.state.dataUpdatedAt > now - MAX_AGE_MS,
    });
    const body = JSON.stringify({ v: QUERY_CACHE_VERSION, userId, savedAt: now, state } satisfies Saved);
    if (body.length > MAX_BYTES) {
      storage.removeItem(cacheKeyFor(userId));
      return false;
    }
    storage.setItem(cacheKeyFor(userId), body);
    return true;
  } catch {
    return false;
  }
}

/** Deletes every saved cache on this browser (logout, change of user). */
export function clearSavedQueryCaches(storage: KeyValueStorage) {
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(QUERY_CACHE_KEY_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => storage.removeItem(k));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Restores the cache for `userId` and keeps saving it (debounced) while the
 * user stays signed in. Returns the cleanup function.
 */
export function persistQueryCache(client: QueryClient, storage: KeyValueStorage, userId: string): () => void {
  restoreQueryCache(client, storage, userId);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    saveQueryCache(client, storage, userId);
  };
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' && event.type !== 'removed') return;
    if (timer) return;
    timer = setTimeout(flush, SAVE_DELAY_MS);
  });
  const onHide = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHide);
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHide);
  };
}
