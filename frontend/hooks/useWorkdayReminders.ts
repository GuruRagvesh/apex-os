'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { workdayApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useDesktopNotifications } from './useDesktopNotifications';

// Confirmed company default policy (workday.service.ts getTeam() fallback when no
// AppSetting override exists): employee startTime/endTime is 09:30/18:30. No
// per-user schedule is exposed to the frontend today, and this phase intentionally
// avoids touching workday.service.ts to add one — so reminders use this default
// window, exactly the fallback the product spec itself allows ("...or user/company
// configured shift start if available").
const DEFAULT_START_MINUTES = 9 * 60 + 30;
const DEFAULT_END_MINUTES = 18 * 60 + 30;
const REMINDER_WINDOW_MINUTES = 90;
const REMINDER_INTERVAL_MINUTES = 15;
const CHECK_INTERVAL_MS = 60_000;

function minutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function todayDateKey(d: Date): string {
  return d.toISOString().split('T')[0];
}

// localStorage stores the last-notified 15-min slot index per (userId, date), so a
// page reload never re-fires a reminder that already fired, and a genuinely new
// slot always fires regardless of reload history.
function readLastSlot(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}
function writeLastSlot(key: string, slot: number): void {
  try {
    localStorage.setItem(key, String(slot));
  } catch {
    // localStorage unavailable (private mode, quota) — dedup falls back to the
    // in-memory key inside useDesktopNotifications for this page session only.
  }
}

/**
 * Desktop reminders to start/end the workday, mounted once globally. Fires at the
 * scheduled time and then every 15 minutes for up to 90 minutes, stopping the
 * moment the user actually starts (login reminder) or ends (logout reminder)
 * their workday. Read-only against workday.today — never writes, never touches
 * workday.service.ts.
 */
export function useWorkdayReminders() {
  const user = useAuthStore((s) => s.user);
  const { notify, isSupported } = useDesktopNotifications();

  const { data: today } = useQuery({
    queryKey: ['workday-reminders-today'],
    queryFn: () => workdayApi.getToday() as Promise<any>,
    refetchInterval: CHECK_INTERVAL_MS,
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (!user?.id || !isSupported) return;

    const evaluate = () => {
      const now = new Date();
      const nowMinutes = minutesSinceMidnight(now);
      const dateKey = todayDateKey(now);
      const session = (today as any)?.session;
      const hasStarted = Boolean(session?.startWorkAt);
      const hasEnded = Boolean(session?.logoutAt);

      if (!hasStarted && nowMinutes >= DEFAULT_START_MINUTES && nowMinutes <= DEFAULT_START_MINUTES + REMINDER_WINDOW_MINUTES) {
        const slot = Math.floor((nowMinutes - DEFAULT_START_MINUTES) / REMINDER_INTERVAL_MINUTES);
        const storageKey = `apex:last-login-reminder:${user.id}:${dateKey}`;
        if (readLastSlot(storageKey) !== slot) {
          notify(`${storageKey}:${slot}`, 'Start your workday', {
            body: 'Your shift has started — log in to begin tracking your workday.',
            url: '/dashboard',
          });
          writeLastSlot(storageKey, slot);
        }
      }

      // Only relevant once the user actually started work today — no point
      // reminding someone who never started to "end" their day.
      if (hasStarted && !hasEnded && nowMinutes >= DEFAULT_END_MINUTES && nowMinutes <= DEFAULT_END_MINUTES + REMINDER_WINDOW_MINUTES) {
        const slot = Math.floor((nowMinutes - DEFAULT_END_MINUTES) / REMINDER_INTERVAL_MINUTES);
        const storageKey = `apex:last-logout-reminder:${user.id}:${dateKey}`;
        if (readLastSlot(storageKey) !== slot) {
          notify(`${storageKey}:${slot}`, 'End your workday', {
            body: 'Your shift has ended — remember to end your workday.',
            url: '/dashboard',
          });
          writeLastSlot(storageKey, slot);
        }
      }
    };

    evaluate();
    intervalRef.current = setInterval(evaluate, CHECK_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, [user?.id, isSupported, today, notify]);
}
