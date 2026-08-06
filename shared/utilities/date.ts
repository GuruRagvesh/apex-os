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
