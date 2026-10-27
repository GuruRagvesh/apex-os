'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@apex/core-identity';
import { MUTATION_DEFAULTS, READ_QUERY_DEFAULTS } from '@apex/shared-auth';
import { applyAppearanceForUser } from '@apex/shared-utilities';
import { createAppearanceSync, createUserChangeTracker, tokenStorageAction } from './session-boundary';
import { clearSavedQueryCaches, MAX_AGE_MS, persistQueryCache } from './query-cache-persistence';

// Keeps cached data and other tabs in step with who is signed in. It never
// writes or renames the token, and it never touches the workday: signing out
// here is the same store logout the sidebar uses.
function SessionBoundary({ queryClient }: { queryClient: QueryClient }) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const changed = useRef(createUserChangeTracker());
  const syncAppearance = useRef(createAppearanceSync(applyAppearanceForUser));

  // Apply the signed-in person's theme and display settings once auth has
  // hydrated, and again on login, logout or account switch.
  useEffect(() => {
    if (!hasHydrated) return;
    syncAppearance.current(userId);
  }, [hasHydrated, userId]);

  // Logout, login, or a different person: drop every cached query, in memory and saved.
  useEffect(() => {
    if (!hasHydrated) return;
    if (changed.current(userId)) {
      queryClient.clear();
      clearSavedQueryCaches(window.localStorage);
    }
  }, [hasHydrated, userId, queryClient]);

  // While someone is signed in, keep their loaded data for the next page load.
  useEffect(() => {
    if (!hasHydrated || !userId) return;
    return persistQueryCache(queryClient, window.localStorage, userId);
  }, [hasHydrated, userId, queryClient]);

  // Another tab signed out, or signed in (possibly as someone else).
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      const action = tokenStorageAction(event, useAuthStore.getState().token);
      if (action === 'sign-out') {
        queryClient.clear();
        clearSavedQueryCaches(window.localStorage);
        useAuthStore.getState().logout();
      } else if (action === 'reload') {
        window.location.reload();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [queryClient]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  // The saved cache is restored by SessionBoundary's effect, which runs
  // before the page's own queries mount (it renders first), and after React
  // hydration, so server and client first renders stay identical.
  const [queryClient] = useState(() => {
    return new QueryClient({
      defaultOptions: {
        // Shared with the request-count tests, so they measure this exact policy.
        queries: {
          ...READ_QUERY_DEFAULTS,
          // Kept for the whole day so it can be saved and shown on the next load.
          gcTime: MAX_AGE_MS,
        },
        mutations: MUTATION_DEFAULTS,
      },
    });
  });

  return (
    <QueryClientProvider client={queryClient}>
      <SessionBoundary queryClient={queryClient} />
      {children}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: 'var(--surface-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-primary)',
            borderRadius: '10px',
            padding: '10px 14px',
            fontSize: '13px',
            boxShadow: 'var(--shadow-md)',
            maxWidth: '320px',
          },
          success: {
            duration: 2000,
            style: { borderLeft: '3px solid var(--color-success)' },
          },
          error: {
            style: { borderLeft: '3px solid var(--color-danger)' },
          },
        }}
      />
    </QueryClientProvider>
  );
}
