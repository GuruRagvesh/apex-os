'use client';

import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useDesktopNotifications } from '@/hooks/useDesktopNotifications';
import { enablePushNotifications } from '@/lib/push-notifications';
import toast from 'react-hot-toast';

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
  const { permission, isSupported } = useDesktopNotifications();
  const [dismissed, setDismissed] = useState(true); // default hidden until we've checked localStorage

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED_KEY) === 'true');
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
      localStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      // Non-fatal — the prompt may reappear next session, which is an
      // acceptable degradation, not a broken feature.
    }
  };

  const enable = async () => {
    try {
      const result = await enablePushNotifications();
      if (result === 'enabled') toast.success('System notifications enabled on this device');
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
          <Bell size={15} style={{ color: 'var(--accent)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Turn on desktop reminders?
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            Receive break, workday, ticket, project and approval alerts on this computer or phone, including while Apex OS is in the background.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => void enable()}
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
