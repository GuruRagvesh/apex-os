/**
 * Month arithmetic and register presentation, with no React and no imports.
 *
 * The frontend has no test runner, so anything that can be got wrong quietly
 * lives here and is exercised from the backend suite. Month rollover and
 * "nothing measured" formatting are both in that category: December + 1 and a
 * null percentage are exactly the cases that survive a click-through and fail
 * on the first of January in front of HR.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The company-local month is close enough here: this only picks a default. */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** `2026-09` -> `September 2026`. */
export function monthLabel(month: string): string {
  const [year, mon] = month.split('-');
  const name = MONTHS[Number(mon) - 1];
  return name && year ? `${name} ${year}` : month;
}

/**
 * Steps by whole months, crossing years correctly.
 *
 * Built from the numbers rather than from a Date, because Date month arithmetic
 * on the 31st lands in the wrong month.
 */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** First and last calendar date of the month, inclusive, as yyyy-MM-dd. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  // Day 0 of the next month is the last day of this one, leap years included.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/** True once the month has not started yet — there is nothing to look at. */
export function isFutureMonth(month: string, now: Date = new Date()): boolean {
  return month > currentMonth(now);
}

/**
 * `Attendance_Register_September_2026.xlsx`
 *
 * Duplicated from the backend on purpose -- the response interceptor strips
 * headers, so Content-Disposition never reaches the client. A test asserts the
 * two implementations produce the same string, so the duplication cannot drift.
 */
export function registerFileName(month: string, extension: 'xlsx' | 'csv'): string {
  return `Attendance_Register_${monthLabel(month).replace(/\s+/g, '_')}.${extension}`;
}

/**
 * A dash, not 0%.
 *
 * An employee with no eligible working days has not scored zero; nothing has
 * been measured about them. Printing 0% beside a name is an accusation the data
 * does not support. Mirrors the backend formatter so the screen, the workbook
 * and the CSV read identically.
 */
export function formatCompletion(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(2)}%`;
}

/** A missing leave balance reads as unknown rather than as none left. */
export function formatBalance(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(value);
}
