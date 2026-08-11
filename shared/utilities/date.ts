// Date presentation.
//
// Moved verbatim from frontend/lib/utils.ts. This is a display formatter, not
// business time logic: the en-IN locale and the day/month/year shape are what
// users see. Company-date, timezone and TVA rules belong to shared/time per
// architecture decision D1 — do not add them here.

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}


// Elapsed-time presentation. Moved verbatim from frontend/lib/utils.ts,
// where it already called formatDate above — that round-trip through
// @apex/shared-utilities is now gone. Still display only: no company-date,
// timezone or TVA rule belongs here.

export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(date);
}
