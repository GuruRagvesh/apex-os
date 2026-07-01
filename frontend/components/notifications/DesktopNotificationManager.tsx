'use client';

import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useDesktopNotifications } from '@/hooks/useDesktopNotifications';
import { useWorkdayReminders } from '@/hooks/useWorkdayReminders';
import { useApprovalReminders } from '@/hooks/useApprovalReminders';

const DISMISSED_KEY = 'apex:desktop-notif-prompt-dismissed';

/**
 * Mounted once, globally, in the dashboard layout. Runs the workday and approval
 * reminder hooks unconditionally (they safely no-op — falling back to an in-app
 * toast — until permission is granted), and shows a small, dismissible opt-in
 * card the first time this user hasn't already decided or declined. Never shows
 * the native browser permission prompt itself — that only fires on the explicit
 * "Enable" click below, per browser requirements and to avoid an aggressive popup.
 */
export function DesktopNotificationManager() {
  const { permission, isSupported, requestPermission } = useDesktopNotifications();
  const [dismissed, setDismissed] = useState(true); // default hidden until we've checked localStorage

  useWorkdayReminders();
  useApprovalReminders();

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED_KEY) === 'true');
    } catch {
      setDismissed(false);
    }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      // Non-fatal — the prompt may reappear next session, which is an
      // acceptable degradation, not a broken feature.
    }
  };

  if (!isSupported || permission !== 'default' || dismissed) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border shadow-xl p-4"
      style={{ backgroundColor: 'var(--surface-card)', borderColor: 'var(--border-primary)' }}
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg flex-shrink-0" style={{ backgroundColor: 'var(--accent-subtle)' }}>
          <Bell size={15} style={{ color: 'var(--accent)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Turn on desktop reminders?
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            Get a browser notification for workday start/end reminders and pending approvals while Apex OS is open.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => requestPermission().finally(dismiss)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Enable
            </button>
            <button
              onClick={dismiss}
              className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Not now
            </button>
          </div>
        </div>
        <button onClick={dismiss} className="flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} aria-label="Dismiss">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
