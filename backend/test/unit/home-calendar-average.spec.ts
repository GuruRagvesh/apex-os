import { attendanceWeek } from '../../../frontend/components/attendance-v2/home/home-week';

function day(overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-10-01',
    isFuture: false,
    isInProgress: false,
    punchInAt: '2026-10-01T09:30:00.000+05:30',
    punchOutAt: '2026-10-01T18:30:00.000+05:30',
    presenceMinutes: 540,
    workedMinutes: 480,
    breakMinutes: 60,
    outcome: 'PRESENT',
    modifiers: [],
    ...overrides,
  } as any;
}

describe('Home calendar attendance averages', () => {
  it('uses gross presence for working hours instead of deducting breaks', () => {
    const result = attendanceWeek('2026-10-01', '2026-10-01', new Map([['2026-10-01', day()]]));

    expect(result.avgWorkMinutes).toBe(540);
    expect(result.totalBreakMinutes).toBe(60);
  });

  it('does not let a partially elapsed current day depress duration averages', () => {
    const days = new Map([
      ['2026-10-01', day()],
      ['2026-10-02', day({
        date: '2026-10-02',
        isInProgress: true,
        punchInAt: '2026-10-02T09:30:00.000+05:30',
        punchOutAt: null,
        presenceMinutes: 30,
        workedMinutes: 20,
        breakMinutes: 10,
      })],
    ]);

    const result = attendanceWeek('2026-10-01', '2026-10-02', days);

    expect(result.daysWorked).toBe(1);
    expect(result.avgWorkMinutes).toBe(540);
    expect(result.totalBreakMinutes).toBe(60);
    expect(result.avgPunchInMinutes).toBe(570);
  });
});
