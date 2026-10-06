// Desktop approval reminders: per-item, per-day dedup keys in localStorage.
// Pure helpers, so the bounded-storage rule is testable without a browser.

export const REMINDER_KEY_PREFIX = 'apex:notified-approval:';

/** The dedup key for one pending item on one company date ('yyyy-MM-dd'). */
export function reminderKey(itemId: string, dateKey: string): string {
  return `${REMINDER_KEY_PREFIX}${itemId}:${dateKey}`;
}

export interface ReminderStorage {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}

/**
 * Remove reminder keys from earlier days so storage stays bounded. Keeps
 * today's keys (the 45-minute repeat window) and never touches any key that
 * does not start with the reminder prefix. Returns the removed keys.
 */
export function pruneReminderKeys(storage: ReminderStorage, todayKey: string): string[] {
  const stale: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith(REMINDER_KEY_PREFIX)) continue;
    if (!key.endsWith(`:${todayKey}`)) stale.push(key);
  }
  for (const key of stale) storage.removeItem(key);
  return stale;
}
