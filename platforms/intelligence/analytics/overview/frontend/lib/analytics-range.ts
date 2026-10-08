// Intelligence Analytics — range presets and duration formatting (pure).
//
// The API owns every calculation and treats dates as company-timezone business
// dates. This file only picks which dates to ask for and formats what comes
// back. Owned by this component; not a shared utility.

export const COMPANY_TIMEZONE = 'Asia/Kolkata';

export type RangePreset = 'today' | '7d' | '30d' | 'month' | 'custom';

/** Today's company business date ('yyyy-MM-dd'), whatever the browser's zone. */
export function companyToday(now: Date = new Date(), timeZone = COMPANY_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function presetRange(preset: Exclude<RangePreset, 'custom'>, today: string): { from: string; to: string } {
  switch (preset) {
    case 'today': return { from: today, to: today };
    case '7d': return { from: shiftDate(today, -6), to: today };
    case '30d': return { from: shiftDate(today, -29), to: today };
    case 'month': return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

/** Hours and minutes. Zero is a real value ("0m"), never shown as missing. */
export function fmtHm(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.floor(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export interface DailyRow {
  date: string;
  productiveSeconds: number;
  workdaySeconds: number;
  ticketsCompleted: number;
}

/** Sums daily rows into calendar months ('yyyy-MM'), in date order. */
export function groupByMonth(daily: DailyRow[]): Array<Omit<DailyRow, 'date'> & { month: string }> {
  const out = new Map<string, Omit<DailyRow, 'date'> & { month: string }>();
  for (const d of daily) {
    const month = d.date.slice(0, 7);
    const row = out.get(month) ?? { month, productiveSeconds: 0, workdaySeconds: 0, ticketsCompleted: 0 };
    row.productiveSeconds += d.productiveSeconds;
    row.workdaySeconds += d.workdaySeconds;
    row.ticketsCompleted += d.ticketsCompleted;
    out.set(month, row);
  }
  return Array.from(out.values()).sort((a, b) => a.month.localeCompare(b.month));
}

/** Productive share of workday time, or null when there was no workday time. */
export function productiveShare(productiveSeconds: number, workdaySeconds: number): number | null {
  if (!workdaySeconds) return null;
  return Math.round((productiveSeconds / workdaySeconds) * 100);
}
