/**
 * Guards the financial year the backend sends with the My Attendance overview.
 *
 * The backend is the only source of the year (April to March). An older backend does not send it at all,
 * so the yearly view is offered only when a complete, well-formed year arrived. Nothing is ever derived
 * or guessed here: no year means no yearly view, and the month view carries on unchanged.
 *
 * Deliberately free of imports so it can be unit-tested without the browser or the API client.
 */
export interface FinancialYearShape {
  label: string;
  startYear: number;
  endYear: number;
  startMonth: number;
  months: string[];
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export function usableFinancialYear(value: unknown): FinancialYearShape | null {
  if (typeof value !== 'object' || value === null) return null;
  const fy = value as Partial<FinancialYearShape>;
  if (typeof fy.label !== 'string' || fy.label.length === 0) return null;
  if (!Number.isInteger(fy.startYear) || !Number.isInteger(fy.endYear)) return null;
  if (!Number.isInteger(fy.startMonth) || (fy.startMonth as number) < 1 || (fy.startMonth as number) > 12) return null;
  if (!Array.isArray(fy.months) || fy.months.length === 0 || !fy.months.every(month => typeof month === 'string' && MONTH_KEY.test(month))) return null;
  return fy as FinancialYearShape;
}
