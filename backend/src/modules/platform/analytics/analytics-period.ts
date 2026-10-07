import { BadRequestException } from '@nestjs/common';
import { TVAService } from '../../../common/services/tva.service';

/**
 * Analytics date ranges, always in the company timezone.
 *
 * A business date ('yyyy-MM-dd') runs from company midnight to the next
 * company midnight. Ranges are inclusive of both dates. Every bucket key is a
 * company business date, never a UTC date: on an IST company, 00:00-05:30 IST
 * used to be filed under the previous (UTC) day.
 */

export const MAX_RANGE_DAYS = 366;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface AnalyticsRange {
  from: string;
  to: string;
  /** Company midnight starting `from`. */
  start: Date;
  /** Company midnight after `to` (exclusive). */
  end: Date;
  /** Every business date from `from` to `to`, inclusive. */
  days: string[];
  timezone: string;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isRealDate(date: string): boolean {
  return DATE_RE.test(date) && new Date(`${date}T12:00:00.000Z`).toISOString().slice(0, 10) === date;
}

export function resolveRange(tva: TVAService, from?: string, to?: string, defaultDays = 30): AnalyticsRange {
  const today = tva.companyBusinessDate();
  const toDate = to || today;
  const fromDate = from || addDays(toDate, -(defaultDays - 1));
  if (!isRealDate(fromDate) || !isRealDate(toDate)) {
    throw new BadRequestException('Dates must be real calendar dates in YYYY-MM-DD form');
  }
  if (fromDate > toDate) throw new BadRequestException('The start date must not be after the end date');
  const days: string[] = [];
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
    days.push(d);
    if (days.length > MAX_RANGE_DAYS) {
      throw new BadRequestException(`A range can cover at most ${MAX_RANGE_DAYS} days`);
    }
  }
  const start = tva.companyInstantAt(fromDate, '00:00') as Date;
  const end = tva.companyInstantAt(addDays(toDate, 1), '00:00') as Date;
  return { from: fromDate, to: toDate, start, end, days, timezone: tva.companyTimezone() };
}

/** Start of a rolling period, at company midnight. Week = last 7 days, month = last 30, both including today. */
export function periodStart(tva: TVAService, period: 'today' | 'week' | 'month'): Date {
  const today = tva.companyBusinessDate();
  const back = period === 'week' ? 6 : period === 'month' ? 29 : 0;
  return tva.companyInstantAt(addDays(today, -back), '00:00') as Date;
}

/**
 * Splits [startedAt, endedAt) across company business dates, clipped to the
 * range. Seconds outside the range are dropped.
 */
export function secondsByDay(
  tva: TVAService,
  range: Pick<AnalyticsRange, 'start' | 'end'>,
  startedAt: Date,
  endedAt: Date,
): Map<string, number> {
  const out = new Map<string, number>();
  let from = Math.max(startedAt.getTime(), range.start.getTime());
  const to = Math.min(endedAt.getTime(), range.end.getTime());
  while (from < to) {
    const date = tva.companyBusinessDate(new Date(from));
    const nextMidnight = (tva.companyInstantAt(addDays(date, 1), '00:00') as Date).getTime();
    const sliceEnd = Math.min(to, nextMidnight);
    out.set(date, (out.get(date) ?? 0) + Math.floor((sliceEnd - from) / 1000));
    from = sliceEnd;
  }
  return out;
}
