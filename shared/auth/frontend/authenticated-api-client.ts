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
    if (error.response?.status === 403) {
      return Promise.reject({ ...data, message: data?.message || 'You do not have permission to perform this action.' });
    }
    if (Array.isArray(data?.message)) {
      return Promise.reject({ ...data, message: data.message.join(', ') });
    }
    return Promise.reject(data || error);
  },
);

// Typed wrappers — axios interceptor returns response.data directly.
// Callers alias this to `r` so their call sites stay unchanged.
export const unwrap = <T = any>(p: any): Promise<T> => p as unknown as Promise<T>;
