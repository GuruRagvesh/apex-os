'use client';

import { useEffect, useRef, useState } from 'react';
import { workdayApi } from '@/lib/api';
import { BreakModal } from './BreakModal';
import { EndDayModal } from './EndDayModal';
import { PunchModal } from '../attendance/PunchModal';
import { useAttendanceV2 } from '../attendance/useAttendanceV2';

interface Props {
  /** GET /workday/today as the backend reported it. */
  today: any;
  /** Idle 45 minutes or more: suggest ending the workday. */
  suggestEndOfDay?: boolean;
  /** Called after any action changed (or found changed) the workday. */
  onResolved: () => void;
}

type Pending = null | 'resume';

/**
 * Shown while the backend reports the workday IDLE. Every action goes through
 * the existing workday authority:
 *   Resume Work  → POST /workday/resume (WORKING again; only an eligible
 *                  employee ticket resumes; a review never resumes by itself)
 *   Take a Break → the existing break modal (POST /workday/break/start)
 *   End Workday  → Punch Out when punching is on, otherwise the existing End
 *                  Day modal
 * The backend decides; a stale tab's action never overwrites a newer state.
 */
export function IdlePopup({ today, suggestEndOfDay, onResolved }: Props) {
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'choose' | 'break' | 'end'>('choose');
  const { punchEnabled, isLoading: punchStatusLoading } = useAttendanceV2();
  const resumeRef = useRef<HTMLButtonElement>(null);
  const session = today?.session ?? null;

  useEffect(() => { if (mode === 'choose') resumeRef.current?.focus(); }, [mode]);

  const resume = async () => {
    if (pending) return;
    setPending('resume');
    setError(null);
    try {
      const res: any = await workdayApi.resumeWork();
      if (res && res.updated === 0) {
        // Nothing was IDLE any more: the workday changed in another window.
        setError('Your workday already changed in another window. Refreshing…');
      }
      onResolved();
    } catch (err: any) {
      setError(err?.message || 'Could not resume work. Please try again.');
    } finally {
      setPending(null);
    }
  };

  if (mode === 'break') {
    return (
      <BreakModal
        onClose={() => setMode('choose')}
        onBreakStarted={() => { setMode('choose'); onResolved(); }}
      />
    );
  }
  if (mode === 'end') {
    return punchEnabled ? (
      <PunchModal
        type="PUNCH_OUT"
        onClose={() => { setMode('choose'); onResolved(); }}
        onPunched={() => { setMode('choose'); onResolved(); }}
      />
    ) : (
      <EndDayModal
        session={session}
        elapsedWorkMinutes={today?.elapsedWorkMinutes ?? 0}
        totalBreakMinutes={today?.totalBreakMinutes ?? 0}
        onClose={() => setMode('choose')}
        onEnded={() => { setMode('choose'); onResolved(); }}
      />
    );
  }

  const busy = pending !== null;
  return (
    <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="idle-popup-title"
        aria-describedby="idle-popup-text"
        className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm shadow-xl"
      >
        <div className="text-center mb-4">
          <span className="text-3xl" aria-hidden="true">&#128564;</span>
          <h3 id="idle-popup-title" className="font-semibold text-gray-800 dark:text-gray-100 mt-2">
            You&apos;ve been inactive for a while
          </h3>
          <p id="idle-popup-text" className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Your work timer is paused from when you stopped. {suggestEndOfDay
              ? 'It has been a long time. Consider ending your workday.'
              : 'What would you like to do?'}
          </p>
        </div>
        <p role="alert" aria-live="assertive" className="min-h-[1.25rem] text-xs text-red-600 dark:text-red-400 text-center mb-2">
          {error ?? ''}
        </p>
        <div className="flex flex-col gap-2">
          <button
            ref={resumeRef}
            type="button"
            onClick={resume}
            disabled={busy}
            aria-busy={pending === 'resume'}
            className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg text-sm disabled:opacity-50"
          >
            {pending === 'resume' ? 'Resuming…' : 'Resume Work'}
          </button>
          <button
            type="button"
            onClick={() => { setError(null); setMode('break'); }}
            disabled={busy}
            className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg text-sm disabled:opacity-50"
          >
            Take a Break
          </button>
          <button
            type="button"
            onClick={() => { setError(null); setMode('end'); }}
            disabled={busy || punchStatusLoading}
            className="w-full py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-lg text-sm disabled:opacity-50"
          >
            {punchEnabled ? 'Punch Out' : 'End Workday'}
          </button>
        </div>
      </div>
    </div>
  );
}
