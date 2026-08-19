'use client';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@apex/core-identity';
import { useRouter } from 'next/navigation';
import { eventsApi } from '@apex/system-audit/api';

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const ACTION_LABELS: Record<string, string> = {
  TICKET_CREATED: 'created a ticket',
  TICKET_STARTED: 'started working on a ticket',
  TICKET_SUBMITTED_FOR_REVIEW: 'submitted ticket for review',
  TICKET_DONE: 'completed a ticket',
  TICKET_DELETED: 'deleted a ticket',
  TICKET_ASSIGNED: 'was assigned a ticket',
  LEAVE_REQUESTED: 'requested leave',
  LEAVE_APPROVED: 'approved a leave request',
  LEAVE_REJECTED: 'rejected a leave request',
  USER_LOGIN: 'signed in',
  WORKDAY_STARTED: 'started their workday',
  BREAK_STARTED: 'started a break',
  BREAK_ENDED: 'ended break',
  WORKDAY_ENDED: 'ended their workday',
};

export function RecentActivityFeed() {
  const user = useAuthStore(s => s.user);
  const router = useRouter();
  const token = typeof window !== 'undefined' ? localStorage.getItem('apex_token') : null;

  const roleName = (user?.role as any)?.name ?? user?.role ?? '';
  // EventsController scopes: ADMIN/SUPER_ADMIN see all org events;
  // MANAGER/TEAM_LEAD see their department's events; everyone else sees own.
  const scopeLabel =
    roleName === 'SUPER_ADMIN' || roleName === 'ADMIN'
      ? 'Company-wide Activity'
      : roleName === 'MANAGER' || roleName === 'TEAM_LEAD'
      ? 'Your Department Activity'
      : 'Your Activity';

  const { data: events = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['recent-activity'],
    queryFn: async () => {
      const res: any = await eventsApi.getAll({ limit: 15 });
      return res;
    },
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <div className="apex-card" style={{ padding: '12px' }}>
        {[1,2,3].map(i => (
          <div key={i} style={{ display: 'flex', gap: 8, padding: '8px 0' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-tertiary)' }} className="animate-pulse" />
            <div style={{ flex: 1 }}>
              <div style={{ height: 12, width: '70%', background: 'var(--bg-tertiary)', borderRadius: 4 }} className="animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="apex-card" style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ fontSize: 13, color: 'var(--color-danger)', fontWeight: 600, margin: 0 }}>Recent activity unavailable</p>
        <button 
          onClick={() => refetch()}
          style={{ fontSize: 11, marginTop: 8, color: 'var(--accent-text)', cursor: 'pointer', background: 'transparent', border: 'none', fontWeight: 600 }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!events.length) {
    return (
      <div className="apex-card" style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, margin: 0 }}>No activity yet today</p>
        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4, marginBottom: 0 }}>
          Activity appears here as you create tickets, start work, and take action.
        </p>
      </div>
    );
  }

  const visible = (events as any[]).slice(0, 5);

  return (
    <div className="apex-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'rgba(0,0,0,0.02)' }} className="flex justify-between items-center">
        <span className="text-[9px] uppercase tracking-wider font-extrabold text-slate-450 dark:text-slate-500">{scopeLabel}</span>
      </div>
      {visible.map((ev: any, i: number) => (
        <div
          key={i}
          onClick={() => ev.entityUrl && router.push(ev.entityUrl)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
            borderBottom: i < visible.length - 1 ? '1px solid var(--border-subtle)' : 'none',
            cursor: ev.entityUrl ? 'pointer' : 'default',
          }}
          className={ev.entityUrl ? 'hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors' : ''}
        >
          <div style={{
            width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
            background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700, color: '#fff',
          }}>
            {(ev.actor?.name ?? '?').charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 11, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <strong>{ev.actor?.name ?? 'System'}</strong>{' '}
              {ev.description ?? ACTION_LABELS[ev.action] ?? ev.action?.toLowerCase().replace(/_/g, ' ')}
              {ev.entityType === 'Ticket' && ev.metadata?.ticketId && (
                <span className="ml-1 text-blue-600 dark:text-blue-400 font-mono font-bold text-[10px]">
                  [{ev.metadata.ticketId}]
                </span>
              )}
            </p>
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {ev.timeAgo ?? timeAgo(ev.timestamp)}
          </span>
        </div>
      ))}

      {/* View all link */}
      <div
        onClick={() => router.push('/admin/activity')}
        style={{
          padding: '8px 12px', borderTop: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', gap: 4,
        }}
        className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-text)' }}>
          View all activity
        </span>
        <span style={{ fontSize: 11, color: 'var(--accent-text)' }}>→</span>
      </div>
    </div>
  );
}
