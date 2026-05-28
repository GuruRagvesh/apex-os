'use client';

import { useQuery } from '@tanstack/react-query';
import { workdayApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { AlertTriangle } from 'lucide-react';

function fmtMins(minutes: number): string {
  if (!minutes || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function sessionDay(iso: string): { short: string; date: string; isToday: boolean } {
  const d = new Date(iso);
  const isToday = d.toDateString() === new Date().toDateString();
  return {
    short: isToday ? 'Today' : d.toLocaleDateString([], { weekday: 'short' }),
    date: isToday ? '' : d.toLocaleDateString([], { day: 'numeric', month: 'short' }),
    isToday,
  };
}

export function WorkdayHistoryStrip() {
  const user = useAuthStore((s) => s.user);

  const { data: history, isLoading } = useQuery({
    queryKey: ['workday-history', user?.id],
    queryFn: () => workdayApi.getHistory(user!.id) as Promise<any[]>,
    enabled: !!user?.id,
    staleTime: 120000,
  });

  const sessions = (Array.isArray(history) ? history : []).slice(0, 7);

  if (isLoading || sessions.length === 0) return null;

  return (
    <div className="apex-card overflow-hidden" style={{ marginTop: 8 }}>
      {/* Header */}
      <div
        className="px-4 py-2 border-b"
        style={{
          borderColor: 'var(--border-subtle)',
          backgroundColor: 'var(--bg-tertiary)',
        }}
      >
        <span
          className="text-[9px] font-black uppercase tracking-widest"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Recent Sessions
        </span>
      </div>

      {sessions.map((s: any, i: number) => {
        const startIso = s.startWorkAt ?? s.loginAt;
        if (!startIso) return null;
        const { short, date, isToday } = sessionDay(startIso);
        const workMins: number = s.totalWorkMinutes ?? 0;
        const breakMins: number = s.totalBreakMinutes ?? 0;
        const breakCount: number = (s.breakLogs ?? []).filter((b: any) => b.endAt).length;
        const isComplete = s.status === 'LOGGED_OUT';
        const wasNotClosed = !isComplete && !isToday;

        return (
          <div
            key={s.id ?? i}
            className="flex items-center gap-3 px-4 py-2.5"
            style={{
              borderBottom: i < sessions.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              backgroundColor: wasNotClosed ? 'rgba(245,158,11,0.05)' : undefined,
            }}
          >
            {/* Day label */}
            <div style={{ width: 40, flexShrink: 0 }}>
              <p
                className="text-[11px] font-bold leading-none"
                style={{ color: 'var(--text-primary)' }}
              >
                {short}
              </p>
              {date && (
                <p
                  className="text-[10px] mt-0.5 leading-none"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {date}
                </p>
              )}
            </div>

            {/* Duration */}
            <div className="flex-1 flex items-center gap-3 flex-wrap min-w-0">
              <span
                className="text-xs font-semibold"
                style={{ color: workMins > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
              >
                {fmtMins(workMins)} worked
              </span>
              {breakMins > 0 && (
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {breakCount} break{breakCount !== 1 ? 's' : ''} · {fmtMins(breakMins)}
                </span>
              )}
              {wasNotClosed && (
                <span className="flex items-center gap-1 text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">
                  <AlertTriangle size={9} />
                  Not closed
                </span>
              )}
            </div>

            {/* Status badge */}
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded flex-shrink-0"
              style={
                isComplete
                  ? { backgroundColor: 'rgba(16,185,129,0.1)', color: '#059669' }
                  : isToday
                  ? { backgroundColor: 'rgba(99,102,241,0.1)', color: '#6366f1' }
                  : { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }
              }
            >
              {isComplete ? 'Complete' : isToday ? 'Today' : 'Open'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
