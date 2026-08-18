'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { notificationsApi } from '@/lib/api';
import { ticketsApi } from '@apex/operations-tickets-lifecycle/api';
import { useAuthStore } from '@/store/auth.store';
import { useDesktopNotifications } from './useDesktopNotifications';

const POLL_INTERVAL_MS = 60_000;
const RENOTIFY_MINUTES = 45; // within the spec's suggested 30-60 minute band

function todayDateKey(d: Date): string {
  return d.toISOString().split('T')[0];
}

function readLastNotifiedAt(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}
function writeLastNotifiedAt(key: string, at: number): void {
  try {
    localStorage.setItem(key, String(at));
  } catch {
    // localStorage unavailable — falls back to in-session dedup only.
  }
}

// A notification counts as an actionable pending review only when it carries the
// exact title tickets.service.ts uses for the "ticket entered REVIEW, approver
// resolved" event — Notification has no persisted event-key column to match on
// directly. The list is already scoped server-side to the current user
// (findByUser(user.id, ...)), so this only narrows *which* of the caller's own
// unread items are review-actionable; it can never surface another user's data.
function isReviewPendingNotification(n: any): boolean {
  return !n?.isRead && n?.entityType === 'TICKET' && typeof n?.title === 'string' && n.title.startsWith('Review needed:');
}

/**
 * Desktop reminders for pending approvals owned by the current user:
 *  - TASK_CREATION sign-offs, via /tickets/pending-approvals (already scoped
 *    server-side to approverId === current user — no client-side filtering needed).
 *  - Tickets that just entered REVIEW, via the reviewPending notification.
 * Fires immediately the first time an item is seen, then at most once every
 * ~45 minutes per unresolved item until it's actioned (approved/rejected/read).
 */
export function useApprovalReminders() {
  const user = useAuthStore((s) => s.user);
  const { notify, isSupported } = useDesktopNotifications();

  const { data: pendingApprovals } = useQuery({
    queryKey: ['approval-reminders-pending-approvals'],
    queryFn: () => ticketsApi.getPendingApprovals() as Promise<any[]>,
    refetchInterval: POLL_INTERVAL_MS,
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });

  const { data: unreadNotifications } = useQuery({
    queryKey: ['approval-reminders-unread-notifications'],
    queryFn: () => notificationsApi.getAll(true) as Promise<any[]>,
    refetchInterval: POLL_INTERVAL_MS,
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (!user?.id || !isSupported) return;

    const fireIfDue = (storageKey: string, title: string, body: string, url: string) => {
      const now = Date.now();
      const lastAt = readLastNotifiedAt(storageKey);
      if (lastAt !== null && now - lastAt < RENOTIFY_MINUTES * 60_000) return;
      notify(`${storageKey}:${Math.floor(now / (RENOTIFY_MINUTES * 60_000))}`, title, { body, url });
      writeLastNotifiedAt(storageKey, now);
    };

    const evaluate = () => {
      const dateKey = todayDateKey(new Date());

      (Array.isArray(pendingApprovals) ? pendingApprovals : []).forEach((ticket: any) => {
        if (!ticket?.id) return;
        fireIfDue(
          `apex:notified-approval:${ticket.id}:${dateKey}`,
          'Approval needed',
          `${ticket.title ?? ticket.ticketId} is waiting for your sign-off`,
          `/tickets/${ticket.id}`,
        );
      });

      (Array.isArray(unreadNotifications) ? unreadNotifications : [])
        .filter(isReviewPendingNotification)
        .forEach((n: any) => {
          const key = n.entityId ?? n.id;
          if (!key) return;
          fireIfDue(`apex:notified-approval:${key}:${dateKey}`, n.title, n.message ?? '', n.link ?? '/tickets');
        });
    };

    evaluate();
    intervalRef.current = setInterval(evaluate, POLL_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, [user?.id, isSupported, pendingApprovals, unreadNotifications, notify]);
}
