'use client';

import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useDesktopNotifications } from '@/hooks/useDesktopNotifications';
import { enablePushNotifications } from '@/lib/push-notifications';
import toast from 'react-hot-toast';

const SNOOZED_UNTIL_KEY = 'apex:system-notif-prompt-snoozed-until:v2';
const PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Mounted once, globally, in the dashboard layout. Runs the workday and approval
 * reminder hooks unconditionally (they safely no-op — falling back to an in-app
 * toast — until permission is granted), and shows a small, dismissible per-device
 * opt-in card. "Not now" snoozes it for seven days instead of permanently hiding
 * the only path to background break alarms. Never shows
 * the native browser permission prompt itself — that only fires on the explicit
 * "Enable" click below, per browser requirements and to avoid an aggressive popup.
 */
export function DesktopNotificationManager() {
  const { permission, isSupported } = useDesktopNotifications();
  const [dismissed, setDismissed] = useState(true); // default hidden until we've checked localStorage

  useEffect(() => {
    try {
      const snoozedUntil = Number(localStorage.getItem(SNOOZED_UNTIL_KEY) ?? 0);
      setDismissed(Number.isFinite(snoozedUntil) && snoozedUntil > Date.now());
    } catch {
      setDismissed(false);
    }
  }, []);

  useEffect(() => {
    if (permission === 'granted') {
      // Refresh the backend subscription after login, browser data changes, or
      // service-worker rotation. No permission prompt is shown here.
      void enablePushNotifications().catch(() => undefined);
    }
  }, [permission]);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(SNOOZED_UNTIL_KEY, String(Date.now() + PROMPT_SNOOZE_MS));
    } catch {
      // Non-fatal — the prompt may reappear next session, which is an
      // acceptable degradation, not a broken feature.
    }
  };

  const enable = async () => {
    try {
      const result = await enablePushNotifications();
      if (result === 'enabled') {
        try { localStorage.removeItem(SNOOZED_UNTIL_KEY); } catch { /* Permission remains authoritative. */ }
        toast.success('System notifications enabled on this device');
      }
      else if (result === 'unconfigured') toast.error('Server push is not configured yet');
      else if (result === 'denied') toast.error('Notifications are blocked in this browser');
      else toast.error('Push notifications are not supported on this device');
    } catch (error: any) {
      toast.error(error?.message ?? 'Could not enable system notifications');
    } finally {
      dismiss();
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
          <Bell size={16} style={{ color: 'var(--accent-text)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Enable system notifications?
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            Receive break alarms and Apex alerts on this laptop or phone, including when the Apex tab is closed. Enable this separately on every device you use.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => void enable()}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Enable notifications
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
