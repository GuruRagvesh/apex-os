'use client';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { useRouter } from 'next/navigation';

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

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['recent-activity'],
    queryFn: async () => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/events?limit=15`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return [];
      return res.json();
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

  if (!events.length) {
    return (
      <div className="apex-card" style={{ padding: 16, textAlign: 'center' }}>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>No recent activity.</p>
      </div>
    );
  }

  return (
    <div className="apex-card" style={{ padding: 0, overflow: 'hidden' }}>
      {events.slice(0, 10).map((ev: any, i: number) => (
        <div
          key={i}
          onClick={() => ev.entityUrl && router.push(ev.entityUrl)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
            borderBottom: i < Math.min(events.length, 10) - 1 ? '1px solid var(--border-subtle)' : 'none',
            cursor: ev.entityUrl ? 'pointer' : 'default',
          }}
          className={ev.entityUrl ? 'hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors' : ''}
        >
          <div style={{
            width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
            background: ev.actor?.avatar ?? 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700, color: '#fff',
          }}>
            {(ev.actor?.name ?? '?').charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 11, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <strong>{ev.actor?.name ?? 'Someone'}</strong> {ev.description ?? ACTION_LABELS[ev.action] ?? ev.action?.toLowerCase().replace(/_/g, ' ')}
            </p>
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>{ev.timeAgo ?? timeAgo(ev.timestamp)}</span>
        </div>
      ))}
    </div>
  );
}
