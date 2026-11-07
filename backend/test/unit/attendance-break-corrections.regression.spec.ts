import { attendanceWeek } from '../../../frontend/components/attendance-v2/home/home-week';
import {
  AUTO_CLOSE_GRACE_MINUTES,
  buildCompanyDateTimeUtc,
  shouldPolicyAutoStop,
} from '../../src/modules/platform/workday/workday.policy.helper';

function attendanceDay(date: string, overrides: Record<string, unknown> = {}) {
  return {
    date,
    isFuture: false,
    isInProgress: false,
    punchInAt: `${date}T09:30:00.000+05:30`,
    punchOutAt: `${date}T18:30:00.000+05:30`,
    presenceMinutes: 540,
    workedMinutes: 480,
    breakMinutes: 60,
    requiredMinutes: 540,
    outcome: 'PRESENT',
    modifiers: [],
    ...overrides,
  } as any;
}

function metrics(days: Array<[string, any]>) {
  const dates = days.map(([date]) => date).sort();
  return attendanceWeek(dates[0], dates[dates.length - 1], new Map(days));
}

describe('Attendance average and break corrections — 10-case regression suite', () => {
  it('1. applies exactly the same calculation to self-view and another employee', () => {
    const records: Array<[string, any]> = [
      ['2026-10-01', attendanceDay('2026-10-01')],
      ['2026-10-02', attendanceDay('2026-10-02', { presenceMinutes: 480, workedMinutes: 420 })],
    ];
    expect(metrics(records)).toEqual(metrics(records.map(([date, value]) => [date, { ...value }])));
  });

  it('2. changes only the numbers, not the formula, when employees have different attendance', () => {
    const first = metrics([
      ['2026-10-01', attendanceDay('2026-10-01', { presenceMinutes: 540 })],
      ['2026-10-02', attendanceDay('2026-10-02', { presenceMinutes: 480 })],
    ]);
    const second = metrics([
      ['2026-10-01', attendanceDay('2026-10-01', { presenceMinutes: 600 })],
      ['2026-10-02', attendanceDay('2026-10-02', { presenceMinutes: 300 })],
    ]);
    expect(first.avgWorkMinutes).toBe((540 + 480) / 2);
    expect(second.avgWorkMinutes).toBe((600 + 300) / 2);
  });

  it('3. uses gross presence consistently and does not silently deduct breaks', () => {
    const result = metrics([
      ['2026-10-01', attendanceDay('2026-10-01', { presenceMinutes: 555, workedMinutes: 480, breakMinutes: 75 })],
    ]);
    expect(result.avgWorkMinutes).toBe(555);
    expect(result.totalBreakMinutes).toBe(75);
  });

  it('4. excludes a running current day from average working hours', () => {
    const result = metrics([
      ['2026-10-01', attendanceDay('2026-10-01', { presenceMinutes: 540 })],
      ['2026-10-02', attendanceDay('2026-10-02', { isInProgress: true, punchOutAt: null, presenceMinutes: 20, workedMinutes: 20 })],
    ]);
    expect(result.daysWorked).toBe(1);
    expect(result.avgWorkMinutes).toBe(540);
  });

  it('5. returns no duration average when the only day is still in progress', () => {
    const result = metrics([
      ['2026-10-01', attendanceDay('2026-10-01', { isInProgress: true, punchOutAt: null, presenceMinutes: 15 })],
    ]);
    expect(result.daysWorked).toBe(0);
    expect(result.avgWorkMinutes).toBeNull();
    expect(result.totalWorkMinutes).toBe(0);
  });

  it('6. excludes an unfinished day from average and total break time', () => {
    const result = metrics([
      ['2026-10-01', attendanceDay('2026-10-01', { breakMinutes: 45 })],
      ['2026-10-02', attendanceDay('2026-10-02', { isInProgress: true, punchOutAt: null, presenceMinutes: 90, breakMinutes: 30 })],
    ]);
    expect(result.totalBreakMinutes).toBe(45);
  });

  it('7. includes a valid current-day punch-in in the punch-in clock average', () => {
    const result = metrics([
      ['2026-10-01', attendanceDay('2026-10-01', { punchInAt: '2026-10-01T09:30:00.000+05:30' })],
      ['2026-10-02', attendanceDay('2026-10-02', { isInProgress: true, punchInAt: '2026-10-02T10:30:00.000+05:30', punchOutAt: null })],
    ]);
    expect(result.avgPunchInMinutes).toBe((570 + 630) / 2);
  });

  it('8. calculates average punch-out from completed days only', () => {
    const result = metrics([
      ['2026-10-01', attendanceDay('2026-10-01', { punchOutAt: '2026-10-01T18:30:00.000+05:30' })],
      ['2026-10-02', attendanceDay('2026-10-02', { isInProgress: true, punchOutAt: null })],
    ]);
    expect(result.avgPunchOutMinutes).toBe(18 * 60 + 30);
  });

  it('9. ignores future attendance rows even if they accidentally contain durations', () => {
    const result = metrics([
      ['2026-10-01', attendanceDay('2026-10-01', { presenceMinutes: 540 })],
      ['2026-10-02', attendanceDay('2026-10-02', { isFuture: true, presenceMinutes: 1_000, breakMinutes: 500 })],
    ]);
    expect(result.daysWorked).toBe(1);
    expect(result.avgWorkMinutes).toBe(540);
    expect(result.totalBreakMinutes).toBe(60);
  });

  it('10. never policy-stops a same-day active break, while abandoned working sessions still close', () => {
    const policy = { autoClose: true, autoCloseTime: '20:00', timezone: 'Asia/Kolkata' };
    const cutoff = buildCompanyDateTimeUtc('2026-10-31', '20:00', 'Asia/Kolkata');
    const now = new Date(cutoff.getTime() + (AUTO_CLOSE_GRACE_MINUTES + 60) * 60_000);
    const staleUser = { role: { name: 'EMPLOYEE' }, lastActiveAt: new Date(cutoff.getTime() - 60 * 60_000) };
    expect(shouldPolicyAutoStop(
      { logoutAt: null, status: 'ON_BREAK' }, staleUser, policy, now, '2026-10-31', '2026-10-31',
    ).shouldStop).toBe(false);
    expect(shouldPolicyAutoStop(
      { logoutAt: null, status: 'WORKING' }, staleUser, policy, now, '2026-10-31', '2026-10-31',
    ).shouldStop).toBe(true);
  });
});
