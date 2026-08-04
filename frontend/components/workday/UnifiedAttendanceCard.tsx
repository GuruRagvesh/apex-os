'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { workdayApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { BreakModal } from './BreakModal';
import { EndDayModal } from './EndDayModal';
import { AutoCloseConsentModal } from './AutoCloseConsentModal';

// Phase 2A-2 — unified attendance card, built on a hidden route
// (/attendance-v2). Reuses the exact query key, API methods, and modals
// WorkdayBar already uses; does not modify WorkdayBar or introduce any new
// backend contract. See ATTENDANCE_PHASE1_QA.md / the Phase 2A-1 audit for
// the source-of-truth findings this is built from.

const STATUS_COLORS: Record<string, string> = {
  WORKING: 'bg-green-500',
  ON_BREAK: 'bg-orange-400',
  IDLE: 'bg-yellow-400',
  ON_LEAVE: 'bg-blue-500',
  LOGGED_OUT: 'bg-gray-400',
  OFFLINE: 'bg-gray-400',
  LOGGED_IN: 'bg-yellow-400',
  AUTO_CLOSED: 'bg-red-500',
};

const STATUS_LABELS: Record<string, string> = {
  WORKING: 'Working',
  ON_BREAK: 'On Break',
  IDLE: 'Idle',
  ON_LEAVE: 'On Approved Leave',
  LOGGED_OUT: 'Workday Ended',
  OFFLINE: 'Not Started',
  LOGGED_IN: 'Ready to Start',
  AUTO_CLOSED: 'Auto-Closed',
};

function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getErrorMessage(err: any): string {
  const apiMessage = err?.response?.data?.message;

  if (Array.isArray(apiMessage)) {
    return apiMessage.join(', ');
  }

  return (
    apiMessage ||
    err?.message ||
    'Something went wrong. Please try again.'
  );
}

type LoadingAction = 'start' | 'resume' | 'endBreak' | null;
type SuccessMessage<T> = string | ((result: T) => string);

export function UnifiedAttendanceCard() {
  const [showBreakModal, setShowBreakModal] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [loading, setLoading] = useState<LoadingAction>(null);
  const [consentDismissed, setConsentDismissed] = useState(false);

  // Same query key, same API method, same polling/refresh config as
  // WorkdayBar — this card reads the identical source of truth.
  const {
    data: todayData,
    refetch,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['workday-today'],
    queryFn: () => workdayApi.getToday() as Promise<any>,
    refetchInterval: 60000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const session = todayData?.session;
  const status: string = session?.status ?? 'OFFLINE';
  const startWorkAt = todayData?.firstStartTime ?? session?.startWorkAt;
  const totalBreakMinutes = todayData?.totalBreakMinutes ?? session?.totalBreakMinutes ?? 0;
  const elapsedWorkMinutes = todayData?.elapsedWorkMinutes ?? 0;
  const onLeaveToday = todayData?.onLeaveToday;
  const leaveInfo = todayData?.leaveInfo;
  const isResumed = todayData?.isResumed;
  const autoClosedCount = todayData?.autoClosedCount ?? 0;
  const needsAutoCloseConsent = todayData?.needsAutoCloseConsent ?? false;
  const autoCloseTime = todayData?.autoCloseTime ?? null;

  // Stale session: started on a previous calendar day, never closed —
  // identical condition to WorkdayBar's own check.
  const today = new Date().toDateString();
  const sessionDate = startWorkAt ? new Date(startWorkAt).toDateString() : null;
  const isStaleSession =
    !!session &&
    !['LOGGED_OUT', 'OFFLINE', 'ON_LEAVE'].includes(status) &&
    sessionDate !== null &&
    sessionDate !== today;

  const runAction = async <T,>(
    action: Exclude<LoadingAction, null>,
    fn: () => Promise<T>,
    successMessage: SuccessMessage<T>,
  ) => {
    setLoading(action);

    try {
      const result = await fn();

      const message =
        typeof successMessage === 'function'
          ? successMessage(result)
          : successMessage;

      if (message) {
        toast.success(message);
      }

      // Awaited so `loading` isn't cleared — and buttons re-enabled — until
      // the refreshed state has actually landed, closing the window for a
      // second request against stale UI.
      await refetch();
      return result;
    } catch (err: any) {
      // Errors are surfaced as-is, not swallowed or converted into a
      // success path — the toast shows the real API message when present.
      toast.error(getErrorMessage(err));
      await refetch();
      return undefined;
    } finally {
      setLoading(null);
    }
  };

  const handleStartWork = () => runAction('start', () => workdayApi.startWork(), 'Workday started!');

  const handleResumeWork = () =>
    runAction(
      'resume',
      () => (status === 'AUTO_CLOSED' ? workdayApi.resumeAutoClosedWork() : workdayApi.resumeWork()),
      'Resumed!',
    );

  const handleEndBreak = () =>
    runAction(
      'endBreak',
      () => workdayApi.endBreak() as Promise<any>,
      (result) => `Break ended — ${result?.durationMinutes ?? 0} min`,
    );

  const anyActionRunning = loading !== null;
  const dotCls = `w-2.5 h-2.5 rounded-full flex-shrink-0 ${STATUS_COLORS[status] ?? 'bg-gray-400'}`;

  // ── Loading state (initial fetch only) ──────────────────────────────────
  if (isLoading) {
    return (
      <div className="rounded-2xl border p-6 animate-pulse" style={{ backgroundColor: 'var(--surface-card, #fff)', borderColor: 'var(--border-primary, #e2e8f0)' }}>
        <div className="h-4 w-40 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
        <div className="h-8 w-64 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  // ── Error state — shown distinctly, not folded into "not started" ──────
  if (isError) {
    return (
      <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">Couldn&apos;t load your workday status</p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-1 break-words">
              {(error as any)?.message || 'The request failed. Your workday state has not changed.'}
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg flex-shrink-0 transition-colors"
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border shadow-sm overflow-hidden"
      style={{ backgroundColor: 'var(--surface-card, #fff)', borderColor: 'var(--border-primary, #e2e8f0)' }}
    >
      {/* ── Stale session banner ── */}
      {isStaleSession && (
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-300 dark:border-amber-700 px-5 py-4">
          <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Workday from {startWorkAt ? new Date(startWorkAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : 'a previous day'} was never closed
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
              Your previous session is still open. End it now to keep your records accurate.
            </p>
          </div>
          <button
            onClick={() => setShowEndModal(true)}
            disabled={anyActionRunning}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg flex-shrink-0 transition-colors disabled:opacity-50"
          >
            End Session
          </button>
        </div>
      )}

      {/* ── Approved-leave banner — Start Day is gated below, not just labeled ── */}
      {onLeaveToday && !isStaleSession && (
        <div className="px-5 py-3 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
          <p className="text-sm text-blue-600 dark:text-blue-400">
            You are on approved leave today.
          </p>
        </div>
      )}

      {/* ── Header: status + live stats ── */}
      <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={dotCls} />
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary, #1e293b)' }}>
              {STATUS_LABELS[status] ?? status}
              {isResumed && <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-md align-middle">Resumed</span>}
              {onLeaveToday && leaveInfo?.type && <span className="ml-2 text-xs text-blue-500 dark:text-blue-400 font-normal">· {leaveInfo.type}</span>}
            </p>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary, #64748b)' }}>
              {status === 'WORKING' || status === 'ON_BREAK' || status === 'IDLE'
                ? [
                    formatMinutes(elapsedWorkMinutes) + ' active',
                    totalBreakMinutes > 0 ? formatMinutes(totalBreakMinutes) + ' breaks' : null,
                    autoClosedCount > 0 ? `${autoClosedCount} auto-closed` : null,
                    startWorkAt ? `first start ${new Date(startWorkAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : status === 'LOGGED_OUT' && session?.logoutAt
                ? `Ended at ${new Date(session.logoutAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${session?.totalWorkMinutes ? ` · ${formatMinutes(session.totalWorkMinutes)} worked` : ''}`
                : status === 'AUTO_CLOSED'
                ? 'Your workday was auto-closed due to inactivity.'
                : status === 'LOGGED_IN'
                ? "You're logged in — no work time is being tracked yet"
                : 'Click Start Day to begin tracking your workday'}
            </p>
          </div>
        </div>

        {/* ── Primary actions (contextual by status) ── */}
        <div className="flex items-center gap-2 flex-wrap">
          {!onLeaveToday &&
            (status === 'OFFLINE' || !session || status === 'LOGGED_IN' || status === 'LOGGED_OUT') &&
            !isStaleSession && (
            <button
              onClick={handleStartWork}
              disabled={anyActionRunning}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {loading === 'start' ? 'Starting...' : 'Start Day'}
            </button>
          )}

          {status === 'AUTO_CLOSED' && (
            <button
              onClick={handleResumeWork}
              disabled={anyActionRunning}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
            >
              {loading === 'resume' ? 'Resuming...' : 'Resume Workday'}
            </button>
          )}

          {status === 'IDLE' && !isStaleSession && (
            <>
              {/* Break/Meeting deliberately not offered here — startBreak is
                  only valid from WORKING today; offering it from IDLE would
                  repeat the known frontend/backend mismatch, or require a
                  silent Resume-then-Start-Break workflow this phase doesn't
                  implement. */}
              <button
                onClick={handleResumeWork}
                disabled={anyActionRunning}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg disabled:opacity-50"
              >
                Resume
              </button>
              <button
                onClick={() => setShowEndModal(true)}
                disabled={anyActionRunning}
                className="px-3 py-1.5 bg-gray-500 hover:bg-gray-600 text-white text-sm rounded-lg disabled:opacity-50"
              >
                End Day
              </button>
            </>
          )}

          {status === 'ON_BREAK' && !isStaleSession && (
            <button
              onClick={handleEndBreak}
              disabled={anyActionRunning}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {loading === 'endBreak' ? 'Resuming...' : 'Resume Work'}
            </button>
          )}

          {status === 'WORKING' && !isStaleSession && (
            <>
              <button
                onClick={() => setShowBreakModal(true)}
                disabled={anyActionRunning}
                className="px-3 py-1.5 text-sm font-medium border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors disabled:opacity-50"
              >
                Break / Meeting
              </button>
              <button
                onClick={() => setShowEndModal(true)}
                disabled={anyActionRunning}
                className="px-3 py-1.5 text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                End Day
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Modals — same components, same props WorkdayBar already uses ── */}
      {showBreakModal && (
        <BreakModal
          onClose={() => setShowBreakModal(false)}
          onBreakStarted={() => { setShowBreakModal(false); refetch(); }}
        />
      )}
      {showEndModal && (
        <EndDayModal
          session={session}
          elapsedWorkMinutes={elapsedWorkMinutes}
          totalBreakMinutes={totalBreakMinutes}
          onClose={() => setShowEndModal(false)}
          onEnded={() => { setShowEndModal(false); refetch(); }}
        />
      )}
      {needsAutoCloseConsent && !consentDismissed && !showEndModal && (
        <AutoCloseConsentModal
          autoCloseTime={autoCloseTime}
          onClose={() => { setConsentDismissed(true); refetch(); }}
        />
      )}
    </div>
  );
}
