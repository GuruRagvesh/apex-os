'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useState } from 'react';

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
