// Apex OS — the application's single authenticated HTTP client.
//
// Moved here verbatim from frontend/lib/api.ts in Phase 2C. Every behaviour
// below is unchanged: the same token keys, the same one-time key migration,
// the same base-URL expression, the same interceptor order, the same 401
// redirect target and the same error shapes.
//
// WHY THIS IS ITS OWN MODULE
// -------------------------
// It used to live beside ~20 feature API groups in frontend/lib/api.ts, which
// meant any code wanting an authenticated request had to import a legacy
// frontend module. Platform slices cannot do that without carrying migration
// debt. This module owns only the transport concern, so a platform can depend
// on it without depending on frontend feature code.
//
// SINGLETON — this file must be the ONLY production call to axios.create().
// The instance carries interceptor state (auth header, 401 handling); a second
// instance would silently drop it, and a second registration would run the 401
// redirect twice. Import `api` from here; never re-create it.
//
// Must not import: platforms/**, apps/**, frontend feature code, or any store.

import axios from 'axios';

// ── One-time localStorage key migration (nexus_* → apex_*) ─────────────────
// Runs on module load in the browser. Safe to remove after all users have
// been migrated (legacy compatibility only — do not remove the comment).
if (typeof window !== 'undefined') {
  const oldToken = localStorage.getItem('nexus_token');
  if (oldToken && !localStorage.getItem('apex_token')) {
    localStorage.setItem('apex_token', oldToken);
  }
  // Clean up any legacy keys regardless
  localStorage.removeItem('nexus_token');
  localStorage.removeItem('nexus_user'); // was used in older builds
  localStorage.removeItem('nexus-auth'); // legacy zustand persist key
}

// Strip any trailing /api from the env var so we never get a double /api
// Works whether NEXT_PUBLIC_API_URL ends with /api or not
//
// Exported because a few endpoints return binary bodies (user backup, ticket
// attachment blobs, the .xlsx import template) and use raw fetch to bypass the
// JSON axios instance. They still need the same resolved base URL.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL.replace(/\/api\/?$/, '')}/api`
  : 'http://localhost:3001/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('apex_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('apex_token');
      localStorage.removeItem('apex-auth');
      // Only redirect if not already on the login page
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login?expired=true';
      }
    }
    const data = error.response?.data;
    const status = error.response?.status;
    // The header, or the 503 body's retryAfterSeconds if a proxy hid the header.
    const retryAfterMs = parseRetryAfterMs(error.response?.headers?.['retry-after'])
      ?? parseRetryAfterMs(data?.retryAfterSeconds != null ? String(data.retryAfterSeconds) : undefined);
    if (error.response?.status === 403) {
      return Promise.reject({ ...data, status, retryAfterMs, message: data?.message || 'You do not have permission to perform this action.' });
    }
    if (Array.isArray(data?.message)) {
      return Promise.reject({ ...data, status, retryAfterMs, message: data.message.join(', ') });
    }
    return Promise.reject(data ? { ...data, status, retryAfterMs } : Object.assign(error, { retryAfterMs }));
  },
);

/** Convert an HTTP Retry-After value (seconds or date) into a bounded delay. */
export function parseRetryAfterMs(value: unknown, now = Date.now()): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const text = value.trim();
  const seconds = /^\d+$/.test(text) ? Number(text) : NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(text) - now;
  if (!Number.isFinite(delay) || delay <= 0) return undefined;
  return Math.min(delay, 2 * 60_000);
}

// Typed wrappers — axios interceptor returns response.data directly.
// Callers alias this to `r` so their call sites stay unchanged.
export const unwrap = <T = any>(p: any): Promise<T> => p as unknown as Promise<T>;

/**
 * React Query retry policy for read-only application data.
 *
 * Local development can take more than a minute to compile the API. The web
 * app is usually ready first, so its initial reads used to become permanent
 * error cards until the user refreshed the page. Retry only failures that can
 * recover by themselves; authentication, permission, validation and ordinary
 * not-found responses must still fail immediately.
 *
 * At most MAX_TRANSIENT_RETRIES retries, spaced out with jitter. Every open
 * page carries many queries, so an aggressive policy (it was 20 retries at
 * most 5 s apart) multiplies the load on a backend that is already slow or
 * restarting, and keeps it from recovering. A query that still fails shows
 * its error with a Retry, and react-query refetches it on reconnect/focus.
 */
export const MAX_TRANSIENT_RETRIES = 3;

export function shouldRetryTransientQuery(failureCount: number, error: any): boolean {
  if (failureCount >= MAX_TRANSIENT_RETRIES) return false;
  return isTransientFailure(error);
}

/** A failure that can recover by itself: no answer at all, a timeout, rate limiting, or a 5xx. */
export function isTransientFailure(error: any): boolean {
  const status = Number(error?.status ?? error?.response?.status);
  if (!Number.isFinite(status) || status <= 0) return true; // network/offline/timeout

  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

/**
 * 2 s, 4 s, 8 s (capped at 10 s), with jitter. A controlled 503 can ask the
 * browser to wait longer so retries do not hit Postgres while it is recovering.
 */
export function transientQueryRetryDelay(attemptIndex: number, error?: any): number {
  const normal = Math.min(2_000 * 2 ** attemptIndex, 10_000) + Math.floor(Math.random() * 1_000);
  const requested = Number(error?.retryAfterMs);
  return Number.isFinite(requested) && requested > 0 ? Math.max(normal, Math.min(requested, 2 * 60_000)) : normal;
}
