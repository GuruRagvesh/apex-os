'use client';
import { useRouter } from 'next/navigation';

interface MetricCardProps {
  label: string;
  value: number | string;
  sub?: string;
  color?: string;
  url?: string;
}

function MetricCard({ label, value, sub, color, url }: MetricCardProps) {
  const router = useRouter();
  return (
    <div className="apex-card" onClick={() => url && router.push(url)}
      style={{ padding: '14px 16px', cursor: url ? 'pointer' : 'default', transition: 'box-shadow 0.15s, border-color 0.15s' }}
      onMouseEnter={e => { if (url) { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-md)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-border)'; } }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = ''; (e.currentTarget as HTMLElement).style.borderColor = ''; }}
    >
      <p style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-tertiary)', margin: 0 }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 600, color: color ?? 'var(--text-primary)', margin: '4px 0 0', lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '3px 0 0' }}>{sub}</p>}
    </div>
  );
}

export function MetricCards({ metrics, role }: { metrics: any; role?: string }) {
  if (!metrics) return null;

  const cards: MetricCardProps[] = [];

  if (role === 'EMPLOYEE' || role === 'INTERN') {
    cards.push(
      { label: 'Open', value: metrics.open ?? 0, url: '/tickets?status=OPEN' },
      { label: 'In Progress', value: metrics.inProgress ?? 0, url: '/tickets?status=IN_PROGRESS' },
      { label: 'In Review', value: metrics.inReview ?? 0, url: '/tickets?status=REVIEW' },
      { label: 'Done This Week', value: metrics.doneThisWeek ?? 0, color: 'var(--color-success)', url: '/tickets?status=DONE' },
    );
  } else if (role === 'TEAM_LEAD') {
    cards.push(
      { label: 'Team Tickets', value: metrics.total ?? 0, url: '/tickets' },
      { label: 'Overdue', value: metrics.overdue ?? 0, color: metrics.overdue > 0 ? 'var(--color-danger)' : undefined, url: '/tickets' },
      { label: 'Pending Reviews', value: metrics.inReview ?? 0, color: 'var(--accent)', url: '/tickets?status=REVIEW' },
      { label: 'Team Online', value: metrics.teamOnline ?? 0, color: 'var(--color-success)', url: '/team' },
    );
  } else if (role === 'MANAGER') {
    cards.push(
      { label: 'Dept Tickets', value: metrics.total ?? 0, url: '/tickets' },
      { label: 'Overdue', value: metrics.overdue ?? 0, color: metrics.overdue > 0 ? 'var(--color-danger)' : undefined, url: '/tickets' },
      { label: 'Pending Leave', value: metrics.pendingLeave ?? 0, color: metrics.pendingLeave > 0 ? 'var(--color-warning)' : undefined, url: '/leave' },
      { label: 'Team Size', value: metrics.teamCount ?? 0, url: '/team' },
    );
  } else {
    // ADMIN / SUPER_ADMIN
    cards.push(
      { label: 'Active Today', value: metrics.activeToday ?? 0, color: 'var(--color-success)', url: '/team' },
      { label: 'Open Tickets', value: metrics.totalTickets ?? 0, url: '/tickets' },
      { label: 'Overdue', value: metrics.overdue ?? 0, color: metrics.overdue > 0 ? 'var(--color-danger)' : undefined, url: '/tickets' },
      { label: 'Pending Leave', value: metrics.pendingLeave ?? 0, color: metrics.pendingLeave > 0 ? 'var(--color-warning)' : undefined, url: '/leave' },
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cards.length}, 1fr)`, gap: 12 }}>
      {cards.map((c, i) => <MetricCard key={i} {...c} />)}
    </div>
  );
}
