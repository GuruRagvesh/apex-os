/**
 * date-utils.ts
 *
 * IST-aware date formatting utilities.
 * All timestamps from the DB are UTC — these helpers display them in IST (UTC+5:30)
 * or in the browser's local timezone, whichever is appropriate.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +05:30

function toIST(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

/** "22 May 2026" */
export function formatDateIST(value: string | Date | null | undefined): string {
  if (!value) return '—';
  try {
    const ist = toIST(new Date(value));
    return ist.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  } catch { return '—'; }
}

/** "22 May 2026, 6:30 PM" */
export function formatDateTimeIST(value: string | Date | null | undefined): string {
  if (!value) return '—';
  try {
    const ist = toIST(new Date(value));
    return ist.toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
      timeZone: 'UTC',
    });
  } catch { return '—'; }
}

/** "6:30 PM" */
export function formatTimeIST(value: string | Date | null | undefined): string {
  if (!value) return '—';
  try {
    const ist = toIST(new Date(value));
    return ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'UTC' });
  } catch { return '—'; }
}

/** "2h ago" / "in 3d" — browser-local, not IST-specific */
export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return '—';
  try {
    const ms = Date.now() - new Date(value).getTime();
    const abs = Math.abs(ms);
    const past = ms > 0;
    if (abs < 60_000)     return past ? 'just now' : 'in a moment';
    if (abs < 3_600_000)  return past ? `${Math.floor(abs / 60_000)}m ago`  : `in ${Math.floor(abs / 60_000)}m`;
    if (abs < 86_400_000) return past ? `${Math.floor(abs / 3_600_000)}h ago` : `in ${Math.floor(abs / 3_600_000)}h`;
    if (abs < 7 * 86_400_000) return past ? `${Math.floor(abs / 86_400_000)}d ago` : `in ${Math.floor(abs / 86_400_000)}d`;
    return formatDateIST(value);
  } catch { return '—'; }
}

/**
 * Normalize a date-only HTML input value (YYYY-MM-DD) to a full ISO string
 * treated as 18:30 IST (= 13:00 UTC). Pass through unchanged if already has time component.
 *
 * Use this before sending date fields from form inputs to the backend.
 */
export function normalizeDateInput(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value.includes('T')) return value; // already full datetime
  return `${value}T13:00:00.000Z`; // 18:30 IST = 13:00 UTC
}
