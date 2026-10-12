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
  const { data, dataUpdatedAt } = useQuery({
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
  if (!session || ['OFFLINE', 'LOGGED_OUT', 'ON_LEAVE', 'LOGGED_IN', 'AUTO_CLOSED'].includes(status)) return null;

  const sinceFetch = dataUpdatedAt ? Math.max(0, (Date.now() - dataUpdatedAt) / 60000) : 0;
  const worked = ((data as any)?.elapsedWorkMinutes ?? 0) + (status === 'WORKING' ? sinceFetch : 0);
  const breaks = ((data as any)?.totalBreakMinutes ?? session?.totalBreakMinutes ?? 0) + (status === 'ON_BREAK' ? sinceFetch : 0);
  const startedAt = (data as any)?.firstStartTime ?? session?.startWorkAt;
  const onBreak = status === 'ON_BREAK';

  return (
    <div className="apex-hero-status" role="status" aria-label="Today's workday">
      <div className="flex items-center gap-2">
        <span className={`apex-hero-status-dot ${onBreak ? 'is-break' : ''}`} aria-hidden="true" />
        <span className="apex-hero-status-title">{onBreak ? 'On break' : 'Working'}</span>
        <span className="apex-hero-status-value"><Timer size={13} aria-hidden="true" />{hm(worked)}</span>
      </div>
      <div className="apex-hero-status-line"><Coffee size={12} aria-hidden="true" />Break <strong>{hm(breaks)}</strong></div>
      <div className="apex-hero-status-line"><LogIn size={12} aria-hidden="true" />Punched in at <strong>{clock(startedAt)}</strong></div>
    </div>
  );
}
