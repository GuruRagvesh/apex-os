'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

export type DesktopNotifPermission = 'unsupported' | 'default' | 'granted' | 'denied';

function readPermission(): DesktopNotifPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as DesktopNotifPermission;
}

interface NotifyOptions {
  body?: string;
  url?: string;
  /** Set false to suppress the in-app toast fallback when permission isn't granted. */
  toastFallback?: boolean;
}

/**
 * Low-level desktop notification primitive. Callers own *when* to notify
 * (login/logout reminders, pending-approval polling, etc.) — this hook only
 * owns *how*: checking/requesting permission, showing the native Notification
 * safely, falling back to an in-app toast when unavailable/denied, and
 * deduping repeat calls for the same key within this page session.
 *
 * Never call requestPermission() on mount — browsers require a direct user
 * gesture (click) or silently deny/ignore the request.
 */
export function useDesktopNotifications() {
  const [permission, setPermission] = useState<DesktopNotifPermission>('default');
  const notifiedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setPermission(readPermission());
  }, []);

  const requestPermission = useCallback(async (): Promise<DesktopNotifPermission> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return 'unsupported';
    }
    try {
      const result = (await Notification.requestPermission()) as DesktopNotifPermission;
      setPermission(result);
      return result;
    } catch {
      const fallback = readPermission();
      setPermission(fallback);
      return fallback;
    }
  }, []);

  // `key` is a stable, caller-chosen dedupe key (e.g. a 15-min time slot or a
  // notification id). The same key firing twice in one page session is a no-op.
  const notify = useCallback((key: string, title: string, options?: NotifyOptions) => {
    if (notifiedKeysRef.current.has(key)) return;
    notifiedKeysRef.current.add(key);

    const current = readPermission();
    if (current === 'granted') {
      try {
        const n = new Notification(title, { body: options?.body });
        if (options?.url) {
          n.onclick = () => {
            window.focus();
            window.location.href = options.url!;
          };
        }
        return;
      } catch {
        // Fall through to the in-app toast below.
      }
    }
    if (options?.toastFallback !== false) {
      toast(options?.body ? `${title} — ${options.body}` : title, { icon: '🔔', duration: 6000 });
    }
  }, []);

  return {
    permission,
    isSupported: permission !== 'unsupported',
    requestPermission,
    notify,
  };
}
