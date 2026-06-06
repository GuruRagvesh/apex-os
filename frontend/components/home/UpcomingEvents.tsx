'use client';
import { useRouter } from 'next/navigation';

import { getCompanyTodayStart, getCompanyStartOfDay } from '@/lib/company-date';

const COLOR_DOTS: Record<string, string> = {
  red: 'var(--color-danger)', green: 'var(--color-success)',
  blue: 'var(--accent)', amber: 'var(--color-warning)',
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  const today = getCompanyTodayStart();
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const day = getCompanyStartOfDay(d);
  if (day.getTime() === today.getTime()) return 'Today';
  if (day.getTime() === tomorrow.getTime()) return 'Tomorrow';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function UpcomingEvents({ events }: { events: any[] }) {
  const router = useRouter();

  if (!events?.length) {
    return (
      <div className="apex-card" style={{ padding: '16px', textAlign: 'center' }}>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>Nothing scheduled for the next 3 days.</p>
      </div>
    );
  }

  return (
    <div className="apex-card" style={{ padding: 0, overflow: 'hidden' }}>
      {events.map((ev, i) => (
        <div key={i} onClick={() => ev.url && router.push(ev.url)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
            borderBottom: i < events.length - 1 ? '1px solid var(--border-subtle)' : 'none',
            cursor: ev.url ? 'pointer' : 'default',
          }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: COLOR_DOTS[ev.color] ?? 'var(--text-tertiary)', flexShrink: 0 }} />
          <p style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</p>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>{ev.time ? fmtTime(ev.time) : ''}</span>
        </div>
      ))}
    </div>
  );
}
