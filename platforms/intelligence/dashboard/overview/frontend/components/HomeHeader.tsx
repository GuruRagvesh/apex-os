'use client';
import { useAuthStore } from '@apex/core-identity';

export function HomeHeader({ summary }: { summary: any }) {
  const user = useAuthStore(s => s.user);

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const alerts = summary?.criticalAlerts?.length ?? 0;
  const subtitle = alerts === 0
    ? "You're all caught up. Here's your day."
    : alerts === 1
    ? '1 item needs your attention today.'
    : `${alerts} items need your attention today.`;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '24px 0 16px' }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.3px' }}>
          {getGreeting()}, {user?.name?.split(' ')[0]}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, margin: '4px 0 0' }}>{subtitle}</p>
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
        {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
      </span>
    </div>
  );
}
