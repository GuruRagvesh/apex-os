/**
 * Local date utilities to avoid UTC timezone drift when handling YYYY-MM-DD boundaries.
 */

export function getLocalTodayISO(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getLocalTomorrowISO(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const day = String(tomorrow.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateStr: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const d = new Date(year, month, day);
  if (
    isNaN(d.getTime()) ||
    d.getFullYear() !== year ||
    d.getMonth() !== month ||
    d.getDate() !== day
  ) return null;
  return d;
}

export function isStrictFutureDate(dateStr: string): boolean {
  if (!dateStr) return false;
  const inputDateOnly = parseLocalDate(dateStr);
  if (!inputDateOnly) return false;

  const today = new Date();
  const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return inputDateOnly > todayDateOnly;
}

export function isTodayOrPastDate(dateStr: string): boolean {
  if (!dateStr) return false;
  const inputDateOnly = parseLocalDate(dateStr);
  if (!inputDateOnly) return false;

  const today = new Date();
  const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return inputDateOnly <= todayDateOnly;
}
