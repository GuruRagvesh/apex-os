'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Coffee, LogIn, Timer } from 'lucide-react';
import { workdayApi } from '@/lib/api';

function hm(minutes: number): string {
  const whole = Math.max(0, Math.floor(minutes));
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function clock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Compact live workday summary for the hero's top-right corner, shown once
 * the day has started: working time, break time, and punch-in time.
 *
 * It reads the same ['workday-today'] query as WorkdayBar, so both always
 * agree and no extra request is made.
 */
export function WorkdayStatusBox() {
  const { data, dataUpdatedAt, isLoading, isError } = useQuery({
    queryKey: ['workday-today'],
    queryFn: () => workdayApi.getToday() as Promise<any>,
    refetchInterval: 60000,
    staleTime: 0,
  });
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const session = (data as any)?.session;
  const status: string = session?.status ?? 'OFFLINE';
  const sinceFetch = dataUpdatedAt ? Math.max(0, (Date.now() - dataUpdatedAt) / 60000) : 0;
  const worked = ((data as any)?.elapsedWorkMinutes ?? session?.totalWorkMinutes ?? 0) + (status === 'WORKING' ? sinceFetch : 0);
  const breaks = ((data as any)?.totalBreakMinutes ?? session?.totalBreakMinutes ?? 0) + (status === 'ON_BREAK' ? sinceFetch : 0);
  const startedAt = (data as any)?.firstStartTime ?? session?.startWorkAt;
  const onBreak = status === 'ON_BREAK';
  const statusLabel = isLoading ? 'Loading status' : isError ? 'Status unavailable' : ({
    WORKING: 'Working', ON_BREAK: 'On break', IDLE: 'Paused', ON_LEAVE: 'On leave',
    LOGGED_OUT: 'Day ended', LOGGED_IN: 'Ready to start', AUTO_CLOSED: 'Auto-closed', OFFLINE: 'Not started',
  } as Record<string, string>)[status] ?? 'Not started';

  return (
    <div className="apex-hero-status" role="status" aria-label="Today's workday">
      <div className="flex items-center gap-2">
        <span className={`apex-hero-status-dot ${onBreak ? 'is-break' : status === 'WORKING' ? '' : 'is-inactive'}`} aria-hidden="true" />
        <span className="apex-hero-status-title">{statusLabel}</span>
        <span className="apex-hero-status-value"><Timer size={15} aria-hidden="true" />{isLoading || isError ? '—' : hm(worked)}</span>
      </div>
      <div className="apex-hero-status-line"><Coffee size={14} aria-hidden="true" />Break <strong>{isLoading || isError ? '—' : hm(breaks)}</strong></div>
      <div className="apex-hero-status-line"><LogIn size={14} aria-hidden="true" />{startedAt ? <>Punched in at <strong>{clock(startedAt)}</strong></> : 'No punch-in today'}</div>
    </div>
  );
}
