'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { workdayApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { AlertTriangle } from 'lucide-react';
import { BreakModal } from './BreakModal';
import { EndDayModal } from './EndDayModal';

const STATUS_COLORS: Record<string, string> = {
  WORKING: 'bg-green-500',
  ON_BREAK: 'bg-orange-400',
  IDLE: 'bg-yellow-400',
  ON_LEAVE: 'bg-blue-500',
  LOGGED_OUT: 'bg-gray-400',
  OFFLINE: 'bg-gray-400',
  LOGGED_IN: 'bg-yellow-400',
};

function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function WorkdayBar() {
  const [showBreakModal, setShowBreakModal] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [breakElapsed, setBreakElapsed] = useState(0);
  const [loading, setLoading] = useState<string | null>(null);

  const { data: todayData, refetch } = useQuery({
    queryKey: ['workday-today'],
    queryFn: () => workdayApi.getToday() as Promise<any>,
    refetchInterval: 60000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const session = (todayData as any)?.session;
  const status = session?.status ?? 'OFFLINE';
  const startWorkAt = session?.startWorkAt;
  const totalBreakMinutes = session?.totalBreakMinutes ?? 0;
  const breakLogs = session?.breakLogs ?? [];
  const onLeaveToday = (todayData as any)?.onLeaveToday;
  const leaveInfo = (todayData as any)?.leaveInfo;

  // Live elapsed time (WORKING) and live break timer (ON_BREAK)
  useEffect(() => {
    if (!startWorkAt) { 
      setElapsed(0); 
      setBreakElapsed(0);
      return; 
    }
    const calc = () => {
      const nowMs = Date.now();
      let currentBreakMins = 0;
      
      const openBreak = breakLogs.find((b: any) => !b.endAt);
      if (openBreak?.startAt) {
        currentBreakMins = Math.max(0, Math.floor((nowMs - new Date(openBreak.startAt).getTime()) / 60000));
        setBreakElapsed(currentBreakMins);
      } else {
        setBreakElapsed(0);
      }

      const diffMs = nowMs - new Date(startWorkAt).getTime();
      const diffMin = Math.max(0, Math.floor(diffMs / 60000) - totalBreakMinutes - currentBreakMins);
      setElapsed(diffMin);
    };
    calc();
    const t = setInterval(calc, 10000);
    return () => clearInterval(t);
  }, [status, startWorkAt, totalBreakMinutes, breakLogs]);

  // Stale session: session started on a previous calendar day and never closed
  const today = new Date().toDateString();
  const sessionDate = startWorkAt ? new Date(startWorkAt).toDateString() : null;
  const isStaleSession =
    !!session &&
    !['LOGGED_OUT', 'OFFLINE', 'ON_LEAVE'].includes(status) &&
    sessionDate !== null &&
    sessionDate !== today;

  const handleStartWork = async () => {
    setLoading('start');
    try {
      await workdayApi.startWork();
      toast.success('Workday started!');
      refetch();
    } catch { toast.error('Failed to start workday'); }
    finally { setLoading(null); }
  };

  const handleResumeWork = async () => {
    setLoading('resume');
    try {
      await workdayApi.resumeWork();
      toast.success('Resumed!');
      refetch();
    } catch { toast.error('Failed to resume'); }
    finally { setLoading(null); }
  };

  const handleEndBreak = async () => {
    setLoading('endBreak');
    try {
      const result = await workdayApi.endBreak() as any;
      toast.success(`Break ended — ${result?.durationMinutes ?? 0} min`);
      refetch();
    } catch { toast.error('Failed to end break'); }
    finally { setLoading(null); }
  };

  const dotCls = `w-2.5 h-2.5 rounded-full flex-shrink-0 ${STATUS_COLORS[status] ?? 'bg-gray-400'}`;

  // ── Stale session: session from a previous day never closed ──────────────────
  if (isStaleSession) {
    const sessionDay = new Date(startWorkAt!).toLocaleDateString([], {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    return (
      <>
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl px-4 py-3 mb-4">
          <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Workday from {sessionDay} was never closed
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
              Your previous session is still open. End it now to keep your records accurate.
            </p>
          </div>
          <button
            onClick={() => setShowEndModal(true)}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg flex-shrink-0 transition-colors"
          >
            End Session
          </button>
        </div>
        {showEndModal && (
          <EndDayModal
            session={session}
            onClose={() => setShowEndModal(false)}
            onEnded={() => { setShowEndModal(false); refetch(); }}
          />
        )}
      </>
    );
  }

  if (onLeaveToday && status === 'ON_LEAVE') {
    return (
      <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3 mb-4">
        <div className="flex items-center gap-2">
          <span className={dotCls} />
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
            On approved leave today
          </span>
          {leaveInfo?.type && (
            <span className="text-xs text-blue-500 dark:text-blue-400">· {leaveInfo.type}</span>
          )}
        </div>
      </div>
    );
  }

  if (status === 'LOGGED_OUT') {
    return (
      <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 mb-4">
        <div className="flex items-center gap-2">
          <span className={dotCls} />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Workday ended {session?.logoutAt && `at ${new Date(session.logoutAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
          </span>
          {session?.totalWorkMinutes > 0 && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              · {formatMinutes(session.totalWorkMinutes)} worked · {breakLogs.length} breaks
            </span>
          )}
        </div>
      </div>
    );
  }

  if (!session || status === 'OFFLINE') {
    return (
      <div className="flex items-center justify-between bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 mb-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className={dotCls} />
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Not started</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Click to begin your workday</p>
          </div>
        </div>
        <button
          onClick={handleStartWork}
          disabled={loading === 'start'}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {loading === 'start' ? 'Starting...' : 'Start Work'}
        </button>
      </div>
    );
  }

  if (status === 'LOGGED_IN') {
    return (
      <div className="flex items-center justify-between bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl px-4 py-3 mb-4">
        <div className="flex items-center gap-2">
          <span className={dotCls} />
          <div>
            <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300">Ready to start</p>
            <p className="text-xs text-yellow-600 dark:text-yellow-500">You're logged in — no work time is being tracked yet</p>
          </div>
        </div>
        <button
          onClick={handleStartWork}
          disabled={loading === 'start'}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
        >
          {loading === 'start' ? 'Starting...' : 'Start Work'}
        </button>
      </div>
    );
  }

  if (status === 'ON_BREAK') {
    const openBreak = breakLogs.find((b: any) => !b.endAt);
    const breakTypeLabel = openBreak?.breakType
      ? openBreak.breakType.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase())
      : null;
    const plannedMins = openBreak?.estimatedMinutes ?? null;
    return (
      <div className="flex items-center justify-between bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl px-4 py-3 mb-4">
        <div className="flex items-center gap-2">
          <span className={dotCls} />
          <div>
            <p className="text-sm font-medium text-orange-700 dark:text-orange-300">
              On Break{breakTypeLabel ? ` · ${breakTypeLabel}` : ''}
            </p>
            <p className="text-xs text-orange-500 dark:text-orange-400">
              {breakElapsed > 0 ? `${breakElapsed} min so far` : 'Just started'}
              {plannedMins && ` · ${plannedMins} min planned`}
              {elapsed > 0 && ` · ${formatMinutes(elapsed)} worked today`}
            </p>
          </div>
        </div>
        <button
          onClick={handleEndBreak}
          disabled={loading === 'endBreak'}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
        >
          {loading === 'endBreak' ? 'Resuming...' : 'Resume Work'}
        </button>
      </div>
    );
  }

  if (status === 'IDLE') {
    return (
      <div className="flex items-center justify-between bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl px-4 py-3 mb-4">
        <div className="flex items-center gap-2">
          <span className={dotCls} />
          <span className="text-sm font-medium text-yellow-700 dark:text-yellow-300">Idle</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleResumeWork} className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700">Resume</button>
          <button onClick={() => setShowBreakModal(true)} className="px-3 py-1.5 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600">Take Break</button>
          <button onClick={() => setShowEndModal(true)} className="px-3 py-1.5 bg-gray-500 text-white text-sm rounded-lg hover:bg-gray-600">End Day</button>
        </div>
      </div>
    );
  }

  // WORKING state
  const completedBreaks = breakLogs.filter((b: any) => b.endAt);
  return (
    <>
      <div className="flex items-center justify-between bg-white dark:bg-gray-900 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3 mb-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className={dotCls} />
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              Working · <span className="text-green-600 dark:text-green-400">{formatMinutes(elapsed)} active</span>
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {completedBreaks.length > 0
                ? `${completedBreaks.length} break${completedBreaks.length > 1 ? 's' : ''} · ${formatMinutes(totalBreakMinutes)}`
                : 'No breaks yet'}
              {startWorkAt && ` · Started ${new Date(startWorkAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBreakModal(true)}
            className="px-3 py-1.5 text-sm font-medium border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
          >
            Break
          </button>
          <button
            onClick={() => setShowEndModal(true)}
            className="px-3 py-1.5 text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            End Day
          </button>
        </div>
      </div>

      {showBreakModal && (
        <BreakModal
          onClose={() => setShowBreakModal(false)}
          onBreakStarted={() => { setShowBreakModal(false); refetch(); }}
        />
      )}
      {showEndModal && (
        <EndDayModal
          session={session}
          onClose={() => setShowEndModal(false)}
          onEnded={() => { setShowEndModal(false); refetch(); }}
        />
      )}
    </>
  );
}
