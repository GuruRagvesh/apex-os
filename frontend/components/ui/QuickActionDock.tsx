'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { workdayApi } from '@/lib/api';
import { BreakModal } from '@/components/workday/BreakModal';
import toast from 'react-hot-toast';

export function QuickActionDock() {
  const [open, setOpen] = useState(false);
  const [showBreakModal, setShowBreakModal] = useState(false);
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

  const handleResumeWork = async () => {
    try { await workdayApi.resumeWork(); toast.success('Resumed work'); }
    catch { toast.error('Failed to resume'); }
  };

  const handleStartWork = async () => {
    try { await workdayApi.startWork(); toast.success('Workday started!'); }
    catch { toast.error('Failed to start workday'); }
  };

  const handleEndWorkday = async () => {
    if (!confirm('End your workday now?')) return;
    try { await workdayApi.endWork(); toast.success('Workday ended'); }
    catch { toast.error('Failed to end workday'); }
  };

  const handleLunchBreak = async () => {
    if (status !== 'WORKING') { toast.error('Start your workday first'); return; }
    try { await workdayApi.startBreak({ breakType: 'LUNCH' }); toast.success('Lunch break started'); }
    catch { toast.error('Failed'); }
  };

  const handleRestroomBreak = async () => {
    if (status !== 'WORKING') { toast.error('Start your workday first'); return; }
    try { await workdayApi.startBreak({ breakType: 'RESTROOM' }); toast.success('Restroom break'); }
    catch { toast.error('Failed'); }
  };

  const isEmployee = ['EMPLOYEE', 'INTERN'].includes(role);
  const isManagerPlus = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role);

  const actions = [
    {
      label: '+ Ticket', emoji: '🎫', color: '#3b82f6',
      onClick: () => doAction(() => router.push('/tickets/new')),
    },
    status === 'ON_BREAK'
      ? { label: 'Resume', emoji: '▶', color: '#10b981', onClick: () => doAction(handleResumeWork) }
      : { label: 'Break', emoji: '⏸', color: '#f97316', disabled: status !== 'WORKING',
          onClick: () => doAction(() => { setShowBreakModal(true); }) },
    { label: 'Lunch', emoji: '🍽', color: '#f59e0b', disabled: status !== 'WORKING',
      onClick: () => doAction(handleLunchBreak) },
    { label: 'Restroom', emoji: '🚻', color: '#6b7280', disabled: status !== 'WORKING',
      onClick: () => doAction(handleRestroomBreak) },
    status === 'OFFLINE' || status === 'LOGGED_IN'
      ? { label: 'Start Work', emoji: '🟢', color: '#10b981', onClick: () => doAction(handleStartWork) }
      : { label: 'End Day', emoji: '🔴', color: '#ef4444', onClick: () => doAction(handleEndWorkday) },
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

      {/* Break modal */}
      {showBreakModal && (
        <BreakModal
          onClose={() => setShowBreakModal(false)}
          onBreakStarted={() => { setShowBreakModal(false); toast.success('Break started'); }}
        />
      )}
    </>
  );
}
