'use client';
import { useRouter } from 'next/navigation';
import { useTicketCreationGate } from '@apex/operations-tickets-lifecycle/components/ticket-creation-gate';

const ACTIONS_BY_ROLE: Record<string, Array<{ label: string; url: string; primary?: boolean }>> = {
  EMPLOYEE: [
    { label: '+ New Ticket', url: '/tickets/new', primary: true },
    { label: 'Apply Leave', url: '/leave' },
    { label: 'My Tickets', url: '/tickets' },
    { label: 'Team', url: '/team' },
  ],
  INTERN: [
    { label: '+ New Ticket', url: '/tickets/new', primary: true },
    { label: 'Apply Leave', url: '/leave' },
    { label: 'My Tickets', url: '/tickets' },
  ],
  TEAM_LEAD: [
    { label: '+ New Ticket', url: '/tickets/new', primary: true },
    { label: 'Kanban', url: '/kanban' },
    { label: 'Team', url: '/team' },
    { label: 'Leave Queue', url: '/leave' },
  ],
  MANAGER: [
    { label: 'Approve Leave', url: '/leave', primary: true },
    { label: 'Team Status', url: '/team' },
    { label: '+ New Ticket', url: '/tickets/new' },
    { label: 'Analytics', url: '/analytics' },
  ],
  ADMIN: [
    { label: 'Add User', url: '/users', primary: true },
    { label: '+ New Ticket', url: '/tickets/new' },
    { label: 'Analytics', url: '/analytics' },
    { label: 'Settings', url: '/settings' },
  ],
  SUPER_ADMIN: [
    { label: 'Analytics', url: '/analytics', primary: true },
    { label: 'Add User', url: '/users' },
    { label: 'Settings', url: '/settings' },
    { label: 'Activity Log', url: '/admin/activity' },
  ],
};

export function QuickActionStrip({ role }: { role?: string }) {
  const router = useRouter();
  const actions = ACTIONS_BY_ROLE[role ?? ''] ?? ACTIONS_BY_ROLE['EMPLOYEE'];
  const ticketGate = useTicketCreationGate();

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {actions.map((a) => {
        const disabled = a.url === '/tickets/new' && !ticketGate.allowed;
        return (
          // aria-disabled (not disabled) keeps the button focusable so the reason is reachable by keyboard.
          <button key={a.url} onClick={() => { if (!disabled) router.push(a.url); }} aria-disabled={disabled || undefined} title={disabled ? ticketGate.reason ?? undefined : undefined} aria-label={disabled ? `${a.label} — ${ticketGate.reason ?? ''}` : undefined} style={{
            fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 20, cursor: disabled ? 'not-allowed' : 'pointer', border: 'none',
            background: a.primary ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: a.primary ? '#fff' : 'var(--text-secondary)',
            opacity: disabled ? 0.5 : 1,
            transition: 'opacity 0.15s',
          }}
            onMouseEnter={e => { if (!disabled) e.currentTarget.style.opacity = '0.85'; }}
            onMouseLeave={e => { if (!disabled) e.currentTarget.style.opacity = '1'; }}
          >
            {a.label}
          </button>
        );
      })}
    </div>
  );
}
