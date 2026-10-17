import { QueryClient } from '@tanstack/react-query';
import {
  cacheKeyFor,
  clearSavedQueryCaches,
  MAX_AGE_MS,
  MAX_BYTES,
  QUERY_CACHE_KEY_PREFIX,
  restoreQueryCache,
  saveQueryCache,
  type KeyValueStorage,
} from '../../../apps/web/components/query-cache-persistence';
import { MAX_TRANSIENT_RETRIES, shouldRetryTransientQuery, transientQueryRetryDelay } from '../../../shared/auth/frontend/authenticated-api-client';

// Production slowed down and restarted while every open page retried each
// failed read up to 20 times and reloaded everything on every page load.
// These pin the bounded retry policy and the per-user browser cache.

class MemoryStorage implements KeyValueStorage {
  readonly map = new Map<string, string>();
  failWrites = false;
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { if (this.failWrites) throw new Error('QuotaExceededError'); this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  get length() { return this.map.size; }
}

const NOW = Date.parse('2026-10-17T10:00:00Z');

function clientWith(entries: Array<[unknown[], unknown]>, updatedAt = NOW) {
  const c = new QueryClient();
  for (const [key, data] of entries) c.setQueryData(key, data, { updatedAt });
  return c;
}

describe('transient retry policy', () => {
  it(`retries a network failure or 5xx at most ${MAX_TRANSIENT_RETRIES} times`, () => {
    expect(MAX_TRANSIENT_RETRIES).toBe(3);
    expect(shouldRetryTransientQuery(0, { status: 503 })).toBe(true);
    expect(shouldRetryTransientQuery(2, new Error('Network Error'))).toBe(true);
    expect(shouldRetryTransientQuery(3, { status: 503 })).toBe(false);
    expect(shouldRetryTransientQuery(19, new Error('Network Error'))).toBe(false);
  });

  it('never retries authentication, permission, validation or not-found answers', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) expect(shouldRetryTransientQuery(0, { status })).toBe(false);
  });

  it('spaces retries out (2 s, 4 s, 8 s, capped at 10 s) with up to 1 s of jitter', () => {
    const at = (i: number) => Array.from({ length: 50 }, () => transientQueryRetryDelay(i));
    for (const [i, base] of [[0, 2000], [1, 4000], [2, 8000], [5, 10000]] as const) {
      for (const d of at(i)) {
        expect(d).toBeGreaterThanOrEqual(base);
        expect(d).toBeLessThan(base + 1000);
      }
    }
  });
});

describe('browser query cache', () => {
  it('restores the signed-in user\'s last successful data on the next load', () => {
    const storage = new MemoryStorage();
    expect(saveQueryCache(clientWith([[['projects'], [{ id: 'p1' }]], [['dashboard-overview'], { open: 3 }]]), storage, 'user-a', NOW)).toBe(true);

    const next = new QueryClient();
    expect(restoreQueryCache(next, storage, 'user-a', NOW + 60_000)).toBe(true);
    expect(next.getQueryData(['projects'])).toEqual([{ id: 'p1' }]);
    expect(next.getQueryData(['dashboard-overview'])).toEqual({ open: 3 });
    // Still stale after 30 s, so react-query refetches it in the background.
    expect(next.getQueryState(['projects'])!.dataUpdatedAt).toBe(NOW);
  });

  it('never restores another user\'s data', () => {
    const storage = new MemoryStorage();
    saveQueryCache(clientWith([[['projects'], ['secret']]]), storage, 'user-a', NOW);
    storage.setItem(cacheKeyFor('user-b'), storage.getItem(cacheKeyFor('user-a'))!); // copied under the wrong key
    const next = new QueryClient();
    expect(restoreQueryCache(next, storage, 'user-b', NOW)).toBe(false);
    expect(next.getQueryData(['projects'])).toBeUndefined();
    expect(storage.getItem(cacheKeyFor('user-b'))).toBeNull();
  });

  it('ignores and deletes a cache older than a day or from another version', () => {
    const storage = new MemoryStorage();
    saveQueryCache(clientWith([[['projects'], [1]]]), storage, 'user-a', NOW);
    expect(restoreQueryCache(new QueryClient(), storage, 'user-a', NOW + MAX_AGE_MS + 1)).toBe(false);
    expect(storage.getItem(cacheKeyFor('user-a'))).toBeNull();

    storage.setItem(cacheKeyFor('user-a'), JSON.stringify({ v: 999, userId: 'user-a', savedAt: NOW, state: {} }));
    expect(restoreQueryCache(new QueryClient(), storage, 'user-a', NOW)).toBe(false);
    storage.setItem(cacheKeyFor('user-a'), '{not json');
    expect(restoreQueryCache(new QueryClient(), storage, 'user-a', NOW)).toBe(false);
  });

  it('keeps only successful results, and skips queries marked persist: false', async () => {
    const c = clientWith([[['projects'], [1]]]);
    await c.prefetchQuery({ queryKey: ['private-preview'], queryFn: async () => 'bytes', meta: { persist: false } });
    await c.prefetchQuery({ queryKey: ['failing'], queryFn: async () => { throw new Error('503'); }, retry: false });
    const storage = new MemoryStorage();
    saveQueryCache(c, storage, 'user-a', NOW);
    const next = new QueryClient();
    restoreQueryCache(next, storage, 'user-a', NOW);
    expect(next.getQueryData(['projects'])).toEqual([1]);
    expect(next.getQueryData(['private-preview'])).toBeUndefined();
    expect(next.getQueryState(['failing'])).toBeUndefined();
  });

  it('never stores mutations', () => {
    const c = clientWith([[['projects'], [1]]]);
    c.getMutationCache().build(c, { mutationKey: ['save-user'], mutationFn: async () => 'ok' });
    const storage = new MemoryStorage();
    saveQueryCache(c, storage, 'user-a', NOW);
    expect(JSON.parse(storage.getItem(cacheKeyFor('user-a'))!).state.mutations).toEqual([]);
  });

  it('does not let the cache crowd out localStorage, and survives a full or blocked storage', () => {
    const storage = new MemoryStorage();
    expect(saveQueryCache(clientWith([[['huge'], 'x'.repeat(MAX_BYTES)]]), storage, 'user-a', NOW)).toBe(false);
    expect(storage.length).toBe(0);
    storage.failWrites = true;
    expect(saveQueryCache(clientWith([[['projects'], [1]]]), storage, 'user-a', NOW)).toBe(false);
  });

  it('logout clears every saved cache and nothing else', () => {
    const storage = new MemoryStorage();
    storage.setItem('apex_token', 't');
    storage.setItem(`${QUERY_CACHE_KEY_PREFIX}user-a`, '{}');
    storage.setItem(`${QUERY_CACHE_KEY_PREFIX}user-b`, '{}');
    clearSavedQueryCaches(storage);
    expect([...storage.map.keys()]).toEqual(['apex_token']);
  });
});

describe('health check under database pressure', () => {
  // Imported here so the frontend-only tests above stay independent of Nest.
  const { HealthController } = require('../../src/modules/platform/health/health.controller');
  const storage = { providerName: () => 'none', isConfigured: () => false } as any;

  it('answers within about 3 s when the database pool never hands out a connection', async () => {
    jest.useFakeTimers();
    try {
      const prisma = { $queryRaw: jest.fn(() => new Promise(() => undefined)) } as any; // never settles
      const pending = new HealthController(prisma, storage).check();
      await jest.advanceTimersByTimeAsync(3_000);
      await expect(pending).resolves.toMatchObject({ status: 'ok', database: 'error' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('still reports a connected database normally', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as any;
    await expect(new HealthController(prisma, storage).check()).resolves.toMatchObject({ status: 'ok', database: 'connected' });
  });
});
