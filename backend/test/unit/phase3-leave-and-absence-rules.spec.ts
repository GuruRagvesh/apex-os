import {
  bucketOf,
  isLateStandardSubmission,
  isStandardScheduledWorkingDay,
  nthScheduledWorkingDayAfter,
} from '../../src/modules/operations/leave/leave-rules';
import { findUnreportedRuns, type DayFact } from '../../src/modules/platform/attendance/absence/unreported-absence';

describe('Phase 3 leave rules', () => {
  it('maps every historical paid category into the single annual pool', () => {
    expect(bucketOf({ type: 'CASUAL' })).toBe('ANNUAL');
    expect(bucketOf({ type: 'SICK' })).toBe('ANNUAL');
    expect(bucketOf({ type: 'EMERGENCY' })).toBe('ANNUAL');
    expect(bucketOf({ type: 'ANNUAL' })).toBe('ANNUAL');
    expect(bucketOf({ type: 'COMP_OFF' })).toBeNull();
    expect(bucketOf({ type: 'UNPAID' })).toBeNull();
    // Legacy funding metadata cannot split the new annual entitlement.
    expect(bucketOf({ type: 'CASUAL', fundingBucket: 'SICK' })).toBe('ANNUAL');
  });

  it('the standard week: Mon-Fri and 1st/3rd/5th Saturdays work; Sundays, 2nd/4th Saturdays and holidays do not', () => {
    // August 2026: Saturdays 1, 8, 15, 22, 29.
    expect(isStandardScheduledWorkingDay('2026-08-01')).toBe(true);
    expect(isStandardScheduledWorkingDay('2026-08-08')).toBe(false);
    expect(isStandardScheduledWorkingDay('2026-08-15')).toBe(true);
    expect(isStandardScheduledWorkingDay('2026-08-22')).toBe(false);
    expect(isStandardScheduledWorkingDay('2026-08-29')).toBe(true);
    expect(isStandardScheduledWorkingDay('2026-08-16')).toBe(false);
    expect(isStandardScheduledWorkingDay('2026-08-17', new Set(['2026-08-17']))).toBe(false);
  });

  it('Emergency evidence and review are due on the 3rd scheduled working day after submission', () => {
    // Submitted Thu 6 Aug: Fri 7, (Sat 8 = 2nd Sat off, Sun 9 off), Mon 10, Tue 11.
    expect(nthScheduledWorkingDayAfter('2026-08-06', 3, (d) => isStandardScheduledWorkingDay(d))).toBe('2026-08-11');
    // A holiday on Mon 10 moves it to Wed 12.
    const holidays = new Set(['2026-08-10']);
    expect(nthScheduledWorkingDayAfter('2026-08-06', 3, (d) => isStandardScheduledWorkingDay(d, holidays))).toBe('2026-08-12');
  });

  it('late ordinary leave is a review status by the versioned notice rule, never a penalty', () => {
    expect(isLateStandardSubmission('2026-08-10', '2026-08-12', 1)).toBe(false);
    expect(isLateStandardSubmission('2026-08-11', '2026-08-12', 1)).toBe(false);
    expect(isLateStandardSubmission('2026-08-12', '2026-08-12', 1)).toBe(true);
    expect(isLateStandardSubmission('2026-08-12', '2026-08-12', 0)).toBe(false);
  });
});

describe('Phase 3 three-day unreported absence', () => {
  const day = (businessDate: string, o: Partial<DayFact> = {}): DayFact => ({
    businessDate, isWorkingDay: isStandardScheduledWorkingDay(businessDate), covered: true, reported: false, ...o,
  });
  const range = (from: string, to: string, o: (d: string) => Partial<DayFact> = () => ({})) => {
    const out: DayFact[] = [];
    for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      const s = d.toISOString().slice(0, 10);
      out.push(day(s, o(s)));
    }
    return out;
  };

  it('three consecutive scheduled working days become one run; weekly offs are skipped, not counted', () => {
    // Fri 7, (Sat 8 off, Sun 9 off), Mon 10: three working days.
    // Fri 7 and Mon 10 are only two working days.
    expect(findUnreportedRuns(range('2026-08-07', '2026-08-10'))).toEqual([]);
    const full = findUnreportedRuns(range('2026-08-06', '2026-08-10'));
    expect(full).toEqual([{ runStartDate: '2026-08-06', days: ['2026-08-06', '2026-08-07', '2026-08-10'] }]);
  });

  it('two unreported days are not enough', () => {
    expect(findUnreportedRuns(range('2026-08-06', '2026-08-07'))).toEqual([]);
  });

  it('any report, leave application or evidence breaks the run', () => {
    const runs = findUnreportedRuns(range('2026-08-03', '2026-08-07', (d) => (d === '2026-08-05' ? { reported: true } : {})));
    expect(runs).toEqual([]);
  });

  it('an inactive employment gap (no profile) breaks the run and is never concluded', () => {
    const runs = findUnreportedRuns(range('2026-08-03', '2026-08-07', (d) => (d === '2026-08-05' ? { covered: false } : {})));
    expect(runs).toEqual([]);
  });

  it('a holiday is skipped without breaking the run', () => {
    const runs = findUnreportedRuns(range('2026-08-03', '2026-08-06', (d) => (d === '2026-08-04' ? { isWorkingDay: false } : {})));
    expect(runs).toEqual([{ runStartDate: '2026-08-03', days: ['2026-08-03', '2026-08-05', '2026-08-06'] }]);
  });
});
