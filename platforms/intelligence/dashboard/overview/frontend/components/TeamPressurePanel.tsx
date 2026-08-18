'use client';

import { useQuery } from '@tanstack/react-query';
import { workdayApi } from '@/lib/api';
import { dashboardApi } from '../api';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Users } from 'lucide-react';

// ── Workday status dot colour ─────────────────────────────────────────────────
const STATUS_DOT: Record<string, string> = {
  WORKING:    'bg-green-500',
  ON_BREAK:   'bg-orange-400',
  IDLE:       'bg-yellow-400',
  ON_LEAVE:   'bg-blue-400',
  LOGGED_IN:  'bg-yellow-300',
  LOGGED_OUT: 'bg-gray-300',
  OFFLINE:    'bg-gray-300',
};
const STATUS_LABEL: Record<string, string> = {
  WORKING:    'Working',
  ON_BREAK:   'On Break',
  IDLE:       'Idle',
  ON_LEAVE:   'On Leave',
  LOGGED_IN:  'Not started',
  LOGGED_OUT: 'Ended day',
  OFFLINE:    'Not started',
};

export function TeamPressurePanel() {
  const router = useRouter();

  // Workload by member — existing endpoint, RBAC-scoped server-side
  const { data: workloadRaw, isLoading: workloadLoading } = useQuery({
    queryKey: ['workload'],
    queryFn: () => dashboardApi.getWorkload() as Promise<any[]>,
    staleTime: 60000,
    refetchInterval: 120000,
  });

  // Team workday status — existing endpoint, RBAC-scoped server-side
  const { data: teamStatusRaw, isLoading: teamLoading } = useQuery({
    queryKey: ['workday-team'],
    queryFn: () => workdayApi.getTeam() as Promise<any[]>,
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const workload = Array.isArray(workloadRaw) ? workloadRaw : [];
  const team     = Array.isArray(teamStatusRaw) ? teamStatusRaw : [];

  // Merge workload + workday status on user id
  const enriched = workload
    .map((m: any) => {
      const ws = team.find((t: any) => t.id === m.id);
      return {
        ...m,
        workStatus:       ws?.workStatus ?? 'OFFLINE',
        workMinutesToday: ws?.workMinutesToday ?? 0,
        onLeaveToday:     ws?.onLeaveToday ?? false,
      };
    })
    .sort((a: any, b: any) => b.totalAssigned - a.totalAssigned)
    .slice(0, 7);

  // Workday breakdown (from team data only)
  const working    = team.filter((t: any) => t.workStatus === 'WORKING').length;
  const onBreak    = team.filter((t: any) => t.workStatus === 'ON_BREAK').length;
  const idle       = team.filter((t: any) => t.workStatus === 'IDLE').length;
  const onLeave    = team.filter((t: any) => t.onLeaveToday).length;
  const notStarted = team.filter(
    (t: any) => ['OFFLINE', 'LOGGED_IN'].includes(t.workStatus) && !t.onLeaveToday,
  ).length;
  const endedDay   = team.filter((t: any) => t.workStatus === 'LOGGED_OUT').length;

  // Skeleton
  if (workloadLoading || teamLoading) {
    return (
      <div className="apex-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="h-4 w-36 rounded animate-pulse" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
          <div className="h-3 w-16 rounded animate-pulse" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        </div>
        <div className="space-y-2.5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
          ))}
        </div>
      </div>
    );
  }

  // No data yet — render nothing (don't clutter with empty state)
  if (workload.length === 0 && team.length === 0) return null;

  return (
    <div className="apex-card overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className="px-5 py-4 flex items-center justify-between border-b"
        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-secondary)' }}
      >
        <div className="flex items-center gap-2.5">
          <Users size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <div>
            <h3 className="text-sm font-bold leading-none" style={{ color: 'var(--text-primary)' }}>
              Team Pressure
            </h3>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Workload and workday status for your scope
            </p>
          </div>
        </div>
        <button
          onClick={() => router.push('/team?tab=live-status')}
          className="flex items-center gap-1 text-xs font-semibold transition-colors hover:opacity-70"
          style={{ color: 'var(--accent-text)' }}
        >
          Full view <ArrowUpRight size={12} />
        </button>
      </div>

      <div
        className="grid grid-cols-1 lg:grid-cols-3"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        {/* ── Workload by member (spans 2 cols) ──────────────────────────────── */}
        <div
          className="lg:col-span-2 p-4"
          style={{ borderRight: '1px solid var(--border-subtle)' }}
        >
          <p
            className="text-[10px] font-black uppercase tracking-widest mb-3 leading-none"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Workload by Member
          </p>

          {workload.length === 0 ? (
            <p className="text-xs py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
              No workload data in your scope yet
            </p>
          ) : (
            <div className="space-y-1">
              {enriched.map((m: any) => (
                <div
                  key={m.id}
                  onClick={() => router.push(`/tickets?assignedToId=${m.id}`)}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl cursor-pointer group transition-colors"
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-tertiary)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                >
                  {/* Avatar initial */}
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #1e40af 0%, #4f46e5 100%)' }}
                  >
                    {(m.name ?? '?').charAt(0).toUpperCase()}
                  </div>

                  {/* Name + role */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate leading-none" style={{ color: 'var(--text-primary)' }}>
                      {m.name}
                    </p>
                    <p className="text-[10px] mt-0.5 leading-none" style={{ color: 'var(--text-tertiary)' }}>
                      {m.department ? `${m.role} · ${m.department}` : m.role}
                    </p>
                  </div>

                  {/* Workday status dot */}
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[m.workStatus] ?? 'bg-gray-300'}`}
                    title={STATUS_LABEL[m.workStatus] ?? m.workStatus}
                  />

                  {/* Ticket counts */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {m.urgent > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
                        {m.urgent}U
                      </span>
                    )}
                    {m.high > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400">
                        {m.high}H
                      </span>
                    )}
                    <span
                      className="text-sm font-bold text-right min-w-[22px]"
                      style={{
                        color: m.totalAssigned >= 8
                          ? 'var(--color-danger)'
                          : m.totalAssigned >= 5
                          ? 'var(--color-warning)'
                          : 'var(--text-secondary)',
                      }}
                    >
                      {m.totalAssigned}
                    </span>
                  </div>

                  {/* Arrow affordance */}
                  <ArrowUpRight
                    size={11}
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: 'var(--accent)' }}
                  />
                </div>
              ))}

              {workload.length > 7 && (
                <button
                  onClick={() => router.push('/analytics')}
                  className="text-xs font-semibold pl-3 mt-2 transition-colors hover:opacity-70"
                  style={{ color: 'var(--accent-text)' }}
                >
                  +{workload.length - 7} more — view full workload →
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Workday status breakdown (1 col) ────────────────────────────────── */}
        <div className="p-4">
          <p
            className="text-[10px] font-black uppercase tracking-widest mb-3 leading-none"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Workday Status
          </p>

          {team.length === 0 ? (
            <p className="text-xs py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
              No workday data available
            </p>
          ) : (
            <div className="space-y-1">
              {[
                { key: 'working',    label: 'Working',     count: working,    dot: 'bg-green-500',  color: working > 0 ? 'var(--color-success)' : undefined },
                { key: 'onBreak',    label: 'On Break',    count: onBreak,    dot: 'bg-orange-400', color: undefined },
                { key: 'idle',       label: 'Idle',        count: idle,       dot: 'bg-yellow-400', color: idle > 0 ? 'var(--color-warning)' : undefined },
                { key: 'notStarted', label: 'Not started', count: notStarted, dot: 'bg-gray-300',   color: notStarted > 0 ? '#d97706' : undefined },
                { key: 'onLeave',    label: 'On Leave',    count: onLeave,    dot: 'bg-blue-400',   color: undefined },
                { key: 'endedDay',   label: 'Ended day',   count: endedDay,   dot: 'bg-gray-200',   color: undefined },
              ]
                .filter((row) => row.count > 0)
                .map((row) => (
                  <button
                    key={row.key}
                    onClick={() => router.push('/team?tab=live-status')}
                    className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl transition-colors text-left"
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-tertiary)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${row.dot}`} />
                      <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                        {row.label}
                      </span>
                    </div>
                    <span
                      className="text-sm font-bold"
                      style={{ color: row.color ?? 'var(--text-secondary)' }}
                    >
                      {row.count}
                    </span>
                  </button>
                ))}

              {/* Notstarted callout */}
              {notStarted > 0 && (
                <div
                  className="mt-2 pt-2 border-t"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                    {notStarted} member{notStarted > 1 ? 's' : ''}{' '}
                    {notStarted > 1 ? 'have' : 'has'} not started their workday
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Footer legend ───────────────────────────────────────────────────── */}
      <div
        className="px-5 py-2.5 border-t flex items-center gap-4 flex-wrap"
        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-secondary)' }}
      >
        <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          Ticket count = open + in-progress assigned to each member
        </p>
        <div className="flex items-center gap-3 ml-auto flex-wrap">
          <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            <span className="w-2 h-2 rounded inline-block bg-red-100 text-red-600 font-bold text-[9px] flex items-center justify-center">U</span>
            = Urgent
          </span>
          <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            <span className="w-2 h-2 rounded inline-block bg-orange-100 text-orange-600 font-bold text-[9px] flex items-center justify-center">H</span>
            = High
          </span>
          <button
            onClick={() => router.push('/analytics')}
            className="text-[10px] font-semibold transition-colors hover:opacity-70"
            style={{ color: 'var(--accent-text)' }}
          >
            Full analytics →
          </button>
        </div>
      </div>
    </div>
  );
}
