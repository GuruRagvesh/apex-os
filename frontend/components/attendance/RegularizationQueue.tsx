'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPendingRegularizations,
  hrApprove,
  managerApprove,
  rejectRegularization,
  stageLabel,
} from './regularization-api';
import { formatTime } from './attendance-status';

/**
 * The correction review queue (AR-1).
 *
 * Deliberately the minimum needed to decide a correction, not an HR console.
 * The server decides whose requests appear here — a manager sees their own
 * reports, HR sees what has cleared manager review — so this component never
 * filters or scopes anything itself.
 */

export function RegularizationQueue({ mode }: { mode: 'manager' | 'hr' }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: rows, isLoading, isError } = useQuery({
    queryKey: ['regularization-queue', mode],
    queryFn: getPendingRegularizations,
    staleTime: 30_000,
    retry: false,
  });

  const settle = useMutation({
    mutationFn: async (input: { id: string; action: 'approve' | 'reject' }) => {
      if (input.action === 'reject') return rejectRegularization(input.id);
      return mode === 'hr' ? hrApprove(input.id) : managerApprove(input.id);
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['regularization-queue', mode] });
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message ?? 'The decision could not be recorded.');
    },
  });

  if (isLoading) {
    return <p className="apex-text-muted py-6 text-center text-sm">Loading requests…</p>;
  }
  if (isError) {
    return (
      <p className="apex-text-muted py-6 text-center text-sm">
        The review queue could not be loaded.
      </p>
    );
  }
  if (!rows?.length) {
    return (
      <p className="apex-text-muted py-6 text-center text-sm">
        Nothing is waiting for your review.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {rows.map((row: any) => (
        <div key={row.id} className="apex-card">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="apex-text text-sm font-semibold">
                {row.user?.name ?? 'Employee'}
                <span className="apex-text-muted font-normal">
                  {' · '}
                  {new Date(row.date).toLocaleDateString([], {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })}
                </span>
              </p>
              <p className="apex-text-muted mt-1 text-xs">{row.reason}</p>
            </div>
            <span className="apex-text-muted shrink-0 rounded-md bg-[var(--bg-tertiary)] px-2 py-1 text-[11px]">
              {stageLabel(row.status)}
            </span>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <div>
              <dt className="apex-text-subtle text-[11px] uppercase tracking-wide">Type</dt>
              <dd className="apex-text mt-0.5 text-sm">
                {String(row.requestType).replaceAll('_', ' ').toLowerCase()}
              </dd>
            </div>
            <div>
              <dt className="apex-text-subtle text-[11px] uppercase tracking-wide">
                Proposed in
              </dt>
              <dd className="apex-text mt-0.5 text-sm">{formatTime(row.requestedPunchIn)}</dd>
            </div>
            <div>
              <dt className="apex-text-subtle text-[11px] uppercase tracking-wide">
                Proposed out
              </dt>
              <dd className="apex-text mt-0.5 text-sm">{formatTime(row.requestedPunchOut)}</dd>
            </div>
            <div>
              <dt className="apex-text-subtle text-[11px] uppercase tracking-wide">
                Requested
              </dt>
              <dd className="apex-text mt-0.5 text-sm">
                {new Date(row.createdAt).toLocaleDateString()}
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => settle.mutate({ id: row.id, action: 'reject' })}
              disabled={settle.isPending}
              className="apex-text-muted rounded-lg border border-[var(--border-secondary)] px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Reject
            </button>
            <button
              onClick={() => settle.mutate({ id: row.id, action: 'approve' })}
              disabled={settle.isPending}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--text-inverse)] disabled:opacity-50"
            >
              {mode === 'hr' ? 'Final approve' : 'Approve'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
