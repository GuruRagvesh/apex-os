// Intelligence Dashboard — activity timestamps (pure).
//
// "5m ago" is the same in every timezone, but the exact time behind it must be
// the company's (IST), not the browser's, so two people in different zones
// read the same clock time for the same event.

export const COMPANY_TIMEZONE = 'Asia/Kolkata';

/** e.g. "7 Oct 2026, 11:30 am IST" */
export function companyTimeLabel(iso: string | Date, timeZone = COMPANY_TIMEZONE): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  const text = new Intl.DateTimeFormat('en-IN', {
    timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
  return `${text} IST`;
}
