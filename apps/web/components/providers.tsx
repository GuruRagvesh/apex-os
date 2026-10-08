'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@apex/core-identity';
import { createUserChangeTracker, tokenStorageAction } from './session-boundary';

// Keeps cached data and other tabs in step with who is signed in. It never
// writes or renames the token, and it never touches the workday: signing out
// here is the same store logout the sidebar uses.
function SessionBoundary({ queryClient }: { queryClient: QueryClient }) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const changed = useRef(createUserChangeTracker());

  // Logout, login, or a different person: drop every cached query.
  useEffect(() => {
    if (!hasHydrated) return;
    if (changed.current(userId)) queryClient.clear();
  }, [hasHydrated, userId, queryClient]);

  // Another tab signed out, or signed in (possibly as someone else).
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      const action = tokenStorageAction(event, useAuthStore.getState().token);
      if (action === 'sign-out') {
        queryClient.clear();
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
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 1000 * 30, retry: 1 },
        },
      }),
  );

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
