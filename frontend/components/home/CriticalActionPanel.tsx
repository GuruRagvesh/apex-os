'use client';
import { useRouter } from 'next/navigation';

interface CriticalAlert {
  type: string;
  severity: 'red' | 'purple' | 'amber' | 'blue';
  title: string;
  desc: string;
  actionLabel: string;
  actionUrl: string;
}

const BORDER_COLORS = { red: '#ef4444', purple: '#8b5cf6', amber: '#f59e0b', blue: '#3b82f6' };
const ICONS: Record<string, string> = {
  TICKET_OVERDUE: '⏱', REVIEW_PENDING: '👁', LEAVE_PENDING: '📅', CONFIG_WARNING: '⚙',
};

export function CriticalActionPanel({ alerts }: { alerts: CriticalAlert[] }) {
  const router = useRouter();

  if (!alerts?.length) {
    return (
      <div className="apex-card" style={{ padding: '20px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 20, marginBottom: 6, opacity: 0.35 }}>✓</div>
        <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>All clear</p>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>No urgent items. New alerts appear here instantly.</p>
      </div>
    );
  }

  return (
    <div className="apex-card" style={{ padding: 0, overflow: 'hidden' }}>
      {alerts.map((alert, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          borderBottom: i < alerts.length - 1 ? '1px solid var(--border-subtle)' : 'none',
          borderLeft: `3px solid ${BORDER_COLORS[alert.severity] ?? '#94a3b8'}`,
        }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>{ICONS[alert.type] ?? '•'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>{alert.title}</p>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{alert.desc}</p>
          </div>
          <button onClick={() => router.push(alert.actionUrl)} style={{
            fontSize: 10, fontWeight: 500, padding: '3px 10px', borderRadius: 10, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
            background: 'var(--accent-subtle)', color: 'var(--accent-text)', border: '1px solid var(--accent-border)',
          }}>
            {alert.actionLabel}
          </button>
        </div>
      ))}
    </div>
  );
}
