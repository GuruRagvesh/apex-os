'use client';

import { useState } from 'react';
import { RegularizationQueue } from '@/components/attendance/RegularizationQueue';

/**
 * Correction review (AR-1).
 *
 * The minimum surface needed to decide a correction. The full HR attendance
 * console is a separate wave; this page exists so the Manager -> HR chain is
 * actually operable.
 *
 * Both tabs call the same scoped endpoint — the server decides what the caller
 * is allowed to see, so switching tabs can never widen access.
 */
export default function AttendanceReviewsPage() {
  const [mode, setMode] = useState<'manager' | 'hr'>('manager');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="apex-text text-xl font-semibold">Attendance corrections</h1>
        <p className="apex-text-muted mt-1 text-sm">
          Requests waiting for your decision.
        </p>
      </div>

      <div className="flex gap-2">
        {(['manager', 'hr'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={[
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              mode === m
                ? 'bg-[var(--accent)] text-[var(--text-inverse)]'
                : 'apex-text-muted border border-[var(--border-secondary)]',
            ].join(' ')}
          >
            {m === 'manager' ? 'My team' : 'HR final review'}
          </button>
        ))}
      </div>

      <RegularizationQueue mode={mode} />
    </div>
  );
}
