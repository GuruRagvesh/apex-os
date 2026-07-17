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

      {sessions.map((summary: any, i: number) => {
        const startIso = summary.firstStartTime;
        if (!startIso) return null;
        
        const sIsToday = summary.isToday;
        const [year, month, day] = summary.companyDate.split('-');
        const cDate = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
        const sShort = sIsToday ? 'Today' : cDate.toLocaleDateString([], { weekday: 'short' });
        const sDate = sIsToday ? '' : cDate.toLocaleDateString([], { day: 'numeric', month: 'short' });

        const workMins: number = summary.totalWorkMinutes ?? 0;
        const breakMins: number = summary.totalBreakMinutes ?? 0;
        const isImpossible = summary.hasSuspiciousDuration || summary.needsReview;
        const isNullDuration = summary.sessions.every((s: any) => s.totalWorkMinutes == null);

        // Status colors
        let badgeBg = 'var(--bg-tertiary)';
        let badgeColor = 'var(--text-tertiary)';
        let badgeText = summary.status;

        if (summary.status === 'ENDED') {
          badgeBg = 'rgba(16,185,129,0.1)'; badgeColor = '#059669'; badgeText = 'Complete';
        } else if (summary.status === 'AUTO_CLOSED') {
          badgeBg = 'rgba(107,114,128,0.1)'; badgeColor = '#4b5563'; badgeText = 'Auto-closed due to inactivity';
        } else if (summary.status === 'WORKING' || summary.status === 'ON_BREAK') {
          badgeBg = 'rgba(99,102,241,0.1)'; badgeColor = '#6366f1'; badgeText = summary.status === 'WORKING' ? 'Working' : 'On break';
        } else if (summary.status === 'NEEDS_REVIEW') {
          badgeBg = 'rgba(239,68,68,0.1)'; badgeColor = '#ef4444'; badgeText = 'Needs review';
        }

        return (
          <div
            key={summary.companyDate ?? i}
            className="flex items-center gap-3 px-4 py-2.5"
            style={{
              borderBottom: i < sessions.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              backgroundColor: summary.status === 'NEEDS_REVIEW' ? 'rgba(245,158,11,0.05)' : undefined,
            }}
          >
            {/* Day label */}
            <div style={{ width: 45, flexShrink: 0 }}>
              <p className="text-[11px] font-bold leading-none" style={{ color: 'var(--text-primary)' }}>
                {sShort}
              </p>
              {sDate && (
                <p className="text-[10px] mt-0.5 leading-none" style={{ color: 'var(--text-tertiary)' }}>
                  {sDate}
                </p>
              )}
            </div>

            {/* Duration */}
            <div className="flex-1 flex flex-col justify-center min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                {isImpossible ? (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" title="Session may not have been closed correctly">
                    Needs review
                  </span>
                ) : isNullDuration ? (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
                    {summary.status === 'WORKING' || summary.status === 'ON_BREAK' ? 'In progress' : 'Not calculated'}
                  </span>
                ) : (
                  <span className="text-xs font-semibold" style={{ color: workMins > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                    {fmtMins(workMins)} worked
                  </span>
                )}
                
                {breakMins > 0 && !isImpossible && (
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    · {fmtMins(breakMins)} break
                  </span>
                )}
              </div>
              
              {summary.sessionCount > 1 && (
                <p className="text-[9px] mt-0.5 font-medium" style={{ color: 'var(--text-tertiary)' }}>
                  {summary.sessionCount} sessions
                </p>
              )}
            </div>

            {/* Status badge */}
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded flex-shrink-0"
              style={{ backgroundColor: badgeBg, color: badgeColor }}
            >
              {badgeText}
            </span>
          </div>
        );
      })}
    </div>
  );
}
