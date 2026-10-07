/**
 * Phase 6E: the Analytics screen's date presets and duration formatting, and
 * the backend's company-date helpers they pair with.
 */
import {
  companyToday, presetRange, shiftDate, fmtHm, groupByMonth, productiveShare,
} from '../../../platforms/intelligence/analytics/overview/frontend/lib/analytics-range';
import { TVAService } from '../../src/common/services/tva.service';
import { resolveRange, periodStart, secondsByDay } from '../../src/modules/platform/analytics/analytics-period';

describe('screen presets use the company date, not the browser date', () => {
  it('00:30 IST is already the next company day', () => {
    expect(companyToday(new Date('2026-10-06T19:00:00Z'))).toBe('2026-10-07');
    expect(companyToday(new Date('2026-10-06T18:29:00Z'))).toBe('2026-10-06');
  });

  it('presets are inclusive company-date ranges', () => {
    expect(presetRange('today', '2026-10-07')).toEqual({ from: '2026-10-07', to: '2026-10-07' });
    expect(presetRange('7d', '2026-10-07')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    expect(presetRange('30d', '2026-03-01')).toEqual({ from: '2026-01-31', to: '2026-03-01' });
    expect(presetRange('month', '2026-10-07')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('durations and derived figures', () => {
  it('formats hours and minutes, and zero as a real zero', () => {
    expect(fmtHm(0)).toBe('0m');
    expect(fmtHm(59)).toBe('0m');
    expect(fmtHm(60)).toBe('1m');
    expect(fmtHm(4200)).toBe('1h 10m');
    expect(fmtHm(28800)).toBe('8h 00m');
    expect(fmtHm(null)).toBe('—');
  });

  it('monthly view sums the daily rows', () => {
    const daily = [
      { date: '2026-09-30', productiveSeconds: 100, workdaySeconds: 200, ticketsCompleted: 1 },
      { date: '2026-10-01', productiveSeconds: 10, workdaySeconds: 20, ticketsCompleted: 0 },
      { date: '2026-10-02', productiveSeconds: 5, workdaySeconds: 0, ticketsCompleted: 2 },
    ];
    expect(groupByMonth(daily)).toEqual([
      { month: '2026-09', productiveSeconds: 100, workdaySeconds: 200, ticketsCompleted: 1 },
      { month: '2026-10', productiveSeconds: 15, workdaySeconds: 20, ticketsCompleted: 2 },
    ]);
  });

  it('productive share is unavailable without workday time, not 0%', () => {
    expect(productiveShare(100, 0)).toBeNull();
    expect(productiveShare(3600, 28800)).toBe(13);
  });
});

describe('backend company-date ranges', () => {
  const tva = new TVAService({ get: () => undefined } as any);
  beforeAll(() => jest.spyOn(tva, 'now').mockImplementation(() => new Date('2026-10-07T06:00:00Z')));

  it('a range runs from company midnight to the next company midnight', () => {
    const r = resolveRange(tva, '2026-10-05', '2026-10-05');
    expect(r.start.toISOString()).toBe('2026-10-04T18:30:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-05T18:30:00.000Z');
    expect(r.days).toEqual(['2026-10-05']);
  });

  it('defaults to the last 30 company days including today', () => {
    const r = resolveRange(tva);
    expect(r.from).toBe('2026-09-08');
    expect(r.to).toBe('2026-10-07');
    expect(r.days).toHaveLength(30);
  });

  it('rolling periods start at company midnight', () => {
    expect(periodStart(tva, 'today').toISOString()).toBe('2026-10-06T18:30:00.000Z');
    expect(periodStart(tva, 'week').toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(periodStart(tva, 'month').toISOString()).toBe('2026-09-07T18:30:00.000Z');
  });

  it('splits a segment across company midnight', () => {
    const r = resolveRange(tva, '2026-10-04', '2026-10-05');
    const m = secondsByDay(tva, r, new Date('2026-10-04T18:00:00Z'), new Date('2026-10-04T19:00:00Z'));
    expect(Object.fromEntries(m)).toEqual({ '2026-10-04': 1800, '2026-10-05': 1800 });
  });
});
