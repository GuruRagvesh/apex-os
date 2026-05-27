'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const EVENT_CONFIG: Record<string, { dot: string; label: (ev: any) => string }> = {
  USER_LOGIN:                  { dot: '#3b82f6', label: () => 'Signed in' },
  USER_LOGOUT:                 { dot: '#6b7280', label: () => 'Signed out' },
  WORKDAY_STARTED:             { dot: '#10b981', label: () => 'Started workday' },
  WORKDAY_ENDED:               { dot: '#6b7280', label: () => 'Ended workday' },
  BREAK_STARTED:               { dot: '#f59e0b', label: (ev) => `Started ${ev.metadata?.breakType ?? ''} break` },
  BREAK_ENDED:                 { dot: '#f59e0b', label: (ev) => `Ended break${ev.metadata?.durationMinutes ? ` · ${ev.metadata.durationMinutes}m` : ''}` },
  IDLE_DETECTED:               { dot: '#eab308', label: () => 'Idle detected' },
  IDLE_CLASSIFIED:             { dot: '#eab308', label: (ev) => `Idle classified as ${ev.metadata?.reason ?? 'unknown'}` },
  TICKET_CREATED:              { dot: '#3b82f6', label: (ev) => `Created ticket ${ev.metadata?.ticketId ?? ''}` },
  TICKET_STARTED:              { dot: '#6366f1', label: (ev) => `Started ${ev.entityId ?? ''}` },
  TICKET_SUBMITTED_FOR_REVIEW: { dot: '#8b5cf6', label: (ev) => `Submitted ${ev.metadata?.ticketId ?? ''} for review` },
  TICKET_DONE:                 { dot: '#10b981', label: (ev) => `Completed ${ev.metadata?.ticketId ?? ''}` },
  TICKET_DELETED:              { dot: '#ef4444', label: () => 'Deleted a ticket' },
  LEAVE_REQUESTED:             { dot: '#8b5cf6', label: () => 'Requested leave' },
  LEAVE_APPROVED:              { dot: '#10b981', label: () => 'Approved leave request' },
  LEAVE_REJECTED:              { dot: '#ef4444', label: () => 'Rejected leave request' },
};

export default function ActivityLogPage() {
  const user = useAuthStore(s => s.user);
  const role: string = (user?.role as any)?.name ?? '';
  const isManagerPlus = ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'TEAM_LEAD'].includes(role);
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'last30'>('today');
  const [eventType, setEventType] = useState('');
  const token = typeof window !== 'undefined' ? localStorage.getItem('apex_token') : null;

  const buildParams = () => {
    const p = new URLSearchParams();
    p.set('limit', '100');
    if (eventType) p.set('action', eventType);
    const now = new Date();
    if (dateRange === 'today') {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      p.set('from', start.toISOString());
    } else if (dateRange === 'week') {
      // Start of current week (Monday)
      const start = new Date(now);
      const day = start.getDay();
      const diff = day === 0 ? -6 : 1 - day; // Monday of this week
      start.setDate(start.getDate() + diff);
      start.setHours(0, 0, 0, 0);
      p.set('from', start.toISOString());
    } else if (dateRange === 'last30') {
      const start = new Date(now); start.setDate(start.getDate() - 30);
      p.set('from', start.toISOString());
    }
    return p.toString();
  };

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['activity-log', dateRange, eventType],
    queryFn: async () => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/events?${buildParams()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30000,
  });

  return (
    <div id="apex-main-content">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Workday Activity Log</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
          Your personal activity timeline
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['today','week','last30'] as const).map(r => (
          <button key={r} onClick={() => setDateRange(r)} style={{
            padding: '5px 12px', borderRadius: 8, fontSize: 12, border: '1px solid', cursor: 'pointer',
            background: dateRange === r ? 'var(--accent-subtle)' : 'var(--surface-card)',
            color: dateRange === r ? 'var(--accent-text)' : 'var(--text-secondary)',
            borderColor: dateRange === r ? 'var(--accent-border)' : 'var(--border-primary)',
          }}>
            {{ today: 'Today', week: 'This Week', last30: 'Last 30 Days' }[r]}
          </button>
        ))}
        <select value={eventType} onChange={e => setEventType(e.target.value)} style={{
          padding: '5px 10px', borderRadius: 8, fontSize: 12, border: '1px solid var(--border-primary)',
          background: 'var(--surface-card)', color: 'var(--text-secondary)', cursor: 'pointer',
        }}>
          <option value="">All Events</option>
          <option value="USER_LOGIN">Login</option>
          <option value="WORKDAY_STARTED">Work Start</option>
          <option value="BREAK_STARTED">Break</option>
          <option value="TICKET_CREATED">Ticket</option>
          <option value="LEAVE_REQUESTED">Leave</option>
        </select>
      </div>

      {/* Timeline */}
      <div className="apex-card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Loading activity…</div>
        ) : (events as any[]).length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>No activity found for this period.</div>
        ) : (
          (events as any[]).map((ev: any, i: number) => {
            const cfg = EVENT_CONFIG[ev.action] ?? { dot: '#94a3b8', label: () => ev.action.replace(/_/g, ' ').toLowerCase() };
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                borderBottom: i < (events as any[]).length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.dot, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                    {ev.actor?.name ?? 'Unknown'}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 6 }}>
                    {cfg.label(ev)}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                  {timeAgo(ev.timestamp)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
