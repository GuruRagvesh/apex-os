'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import toast from 'react-hot-toast';

/**
 * Where the Workday lifecycle actually happens.
 *
 * WorkdayBar is the single component allowed to execute Start Work, Break,
 * Resume and End Day. It is the one that opens PunchModal when Attendance V2
 * is on, so the punch photo and location are captured and the server starts or
 * finalises the session in the same transaction that records the evidence.
 *
 * This dock deliberately performs none of those. It is a shortcut surface on
 * every page; running the same mutations here meant two independent action
 * paths for one lifecycle, and a second place where the punch requirement
 * would have to be re-enforced correctly. It now navigates instead.
 */
const WORKDAY_SURFACE = '/dashboard';

export function QuickActionDock() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore(s => s.user);
  const role: string = (user?.role as any)?.name ?? '';
  const status: string = (user as any)?.currentStatus ?? 'OFFLINE';

  // Alt+Q shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'q') { e.preventDefault(); setOpen(prev => !prev); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const doAction = useCallback(async (action: () => void | Promise<void>) => {
    await action();
    setTimeout(() => setOpen(false), 300);
  }, []);

  /**
   * Sends the employee to the Workday controls instead of acting here.
   *
   * The toast names the destination: a button that appears to do nothing but
   * change page is worse than one that says where it went.
   */
  const goToWorkday = (what: string) => {
    if (pathname !== WORKDAY_SURFACE) {
      toast(`${what} is on your dashboard`, { icon: '\u23F1\uFE0F' });
    }
    router.push(WORKDAY_SURFACE);
  };

  const isEmployee = ['EMPLOYEE', 'INTERN'].includes(role);
  const isManagerPlus = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role);

  const actions = [
    {
      label: '+ Ticket', emoji: '🎫', color: '#3b82f6',
      onClick: () => doAction(() => router.push('/tickets/new')),
    },
    // Every entry below navigates. `status` still decides what is shown and
    // what is enabled, exactly as before -- it comes from the auth store, not
    // from a workday call.
    status === 'ON_BREAK'
      ? { label: 'Resume', emoji: '▶', color: '#10b981', onClick: () => doAction(() => goToWorkday('Resume')) }
      : { label: 'Break', emoji: '⏸', color: '#f97316', disabled: status !== 'WORKING',
          onClick: () => doAction(() => goToWorkday('Break')) },
    { label: 'Lunch', emoji: '🍽', color: '#f59e0b', disabled: status !== 'WORKING',
      onClick: () => doAction(() => goToWorkday('Lunch break')) },
    { label: 'Restroom', emoji: '🚻', color: '#6b7280', disabled: status !== 'WORKING',
      onClick: () => doAction(() => goToWorkday('Breaks')) },
    status === 'OFFLINE' || status === 'LOGGED_IN' || status === 'LOGGED_OUT'
      ? { label: 'Start Work', emoji: '🟢', color: '#10b981', onClick: () => doAction(() => goToWorkday('Start Work')) }
      : { label: 'End Day', emoji: '🔴', color: '#ef4444', onClick: () => doAction(() => goToWorkday('End Day')) },
    ...(isEmployee || role === 'TEAM_LEAD' ? [{
      label: 'Blocked', emoji: '🔒', color: '#ef4444',
      onClick: () => doAction(() => {
        const match = pathname.match(/\/tickets\/([^?/]+)/);
        if (match) router.push(`/tickets/${match[1]}`);
        else { router.push('/tickets'); toast('Open a ticket first to mark it as blocked', { icon: 'ℹ️' }); }
      }),
    }] : []),
    { label: 'Apply Leave', emoji: '📅', color: '#8b5cf6', onClick: () => doAction(() => router.push('/leave')) },
    isManagerPlus
      ? { label: 'New Project', emoji: '📁', color: '#6366f1', onClick: () => doAction(() => router.push('/projects')) }
      : { label: 'My Profile', emoji: '👤', color: '#64748b', onClick: () => doAction(() => router.push('/profile')) },
  ];

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 199,
        }} />
      )}

      {/* Expanded panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 80, right: 24, zIndex: 200,
          width: 280, background: 'var(--surface-elevated)', border: '1px solid var(--border-primary)',
          borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          padding: 12,
          animation: 'apex-modal-in 0.15s ease-out both',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {actions.map((a, i) => (
              <button key={i} onClick={a.onClick} disabled={(a as any).disabled}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  padding: 10, borderRadius: 10, border: 'none', cursor: (a as any).disabled ? 'not-allowed' : 'pointer',
                  background: 'transparent', opacity: (a as any).disabled ? 0.4 : 1,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (!(a as any).disabled) (e.currentTarget as HTMLElement).style.background = 'var(--bg-tertiary)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <span style={{ fontSize: 20 }}>{a.emoji}</span>
                <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.2 }}>{a.label}</span>
              </button>
            ))}
          </div>
          <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textAlign: 'center', margin: '8px 0 0' }}>Alt + Q to toggle</p>
        </div>
      )}

      {/* FAB button */}
      <button onClick={() => setOpen(prev => !prev)} style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 200,
        width: 44, height: 44, borderRadius: '50%', border: 'none', cursor: 'pointer',
        background: 'var(--accent)', color: '#fff',
        fontSize: 22, fontWeight: 300, lineHeight: 1,
        boxShadow: '0 4px 20px var(--accent-ring)',
        transition: 'transform 0.15s, box-shadow 0.15s',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.08)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
      >
        {open ? '✕' : '+'}
      </button>
    </>
  );
}
