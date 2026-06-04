import { calculateWorkdayRuntime, WorkSessionData, BreakLogData } from './workday.calculation';

describe('Workday Runtime Calculations', () => {
  const d = (time: string) => new Date(`2026-06-04T${time}:00.000Z`);

  it('Scenario A: Simple completed day', () => {
    const session: WorkSessionData = {
      startWorkAt: d('09:30'),
      logoutAt: d('18:30'),
      totalBreakMinutes: 0,
      totalWorkMinutes: 540,
      autoClosed: false,
      continuationOfSessionId: null,
      breakLogs: [],
    };
    const res = calculateWorkdayRuntime([session], d('18:30'));
    expect(res.elapsedWorkMinutes).toBe(540);
    expect(res.totalBreakMinutes).toBe(0);
    expect(res.firstStartTime).toEqual(d('09:30'));
  });

  it('Scenario B: One break', () => {
    const session: WorkSessionData = {
      startWorkAt: d('09:30'),
      logoutAt: d('18:30'),
      totalBreakMinutes: 30,
      totalWorkMinutes: 510,
      autoClosed: false,
      continuationOfSessionId: null,
      breakLogs: [{ startAt: d('13:00'), endAt: d('13:30'), durationMinutes: 30 }],
    };
    const res = calculateWorkdayRuntime([session], d('18:30'));
    expect(res.elapsedWorkMinutes).toBe(510);
    expect(res.totalBreakMinutes).toBe(30);
  });

  it('Scenario C: Multiple breaks', () => {
    const session: WorkSessionData = {
      startWorkAt: d('09:30'),
      logoutAt: d('18:30'),
      totalBreakMinutes: 55,
      totalWorkMinutes: 485,
      autoClosed: false,
      continuationOfSessionId: null,
      breakLogs: [
        { startAt: d('11:00'), endAt: d('11:10'), durationMinutes: 10 },
        { startAt: d('13:00'), endAt: d('13:30'), durationMinutes: 30 },
        { startAt: d('16:00'), endAt: d('16:15'), durationMinutes: 15 },
      ],
    };
    const res = calculateWorkdayRuntime([session], d('18:30'));
    expect(res.elapsedWorkMinutes).toBe(485);
    expect(res.totalBreakMinutes).toBe(55);
  });

  it('Scenario D: Resume/relogin same day (Gaps do not count as work)', () => {
    const session1: WorkSessionData = {
      startWorkAt: d('09:30'),
      logoutAt: d('13:00'),
      totalBreakMinutes: 0,
      totalWorkMinutes: 210, // 3.5 hours
      autoClosed: false,
      continuationOfSessionId: null,
      breakLogs: [],
    };
    const session2: WorkSessionData = {
      startWorkAt: d('14:00'),
      logoutAt: d('18:30'),
      totalBreakMinutes: 0,
      totalWorkMinutes: 270, // 4.5 hours
      autoClosed: false,
      continuationOfSessionId: null,
      breakLogs: [],
    };
    const res = calculateWorkdayRuntime([session1, session2], d('18:30'));
    expect(res.sessionCount).toBe(2);
    expect(res.elapsedWorkMinutes).toBe(480); // 210 + 270
    expect(res.totalBreakMinutes).toBe(0);
  });

  it('Scenario E: Auto-closed then resumed', () => {
    const session1: WorkSessionData = {
      startWorkAt: d('09:30'),
      logoutAt: d('15:00'),
      totalBreakMinutes: 0,
      totalWorkMinutes: 330, // 5.5 hours
      autoClosed: true,
      continuationOfSessionId: null,
      breakLogs: [],
    };
    const session2: WorkSessionData = {
      startWorkAt: d('15:15'),
      logoutAt: d('18:30'),
      totalBreakMinutes: 0,
      totalWorkMinutes: 195, // 3.25 hours
      autoClosed: false,
      continuationOfSessionId: 'session1_id',
      breakLogs: [],
    };
    const res = calculateWorkdayRuntime([session1, session2], d('18:30'));
    expect(res.firstStartTime).toEqual(d('09:30'));
    expect(res.currentEndTime).toEqual(d('18:30'));
    expect(res.sessionCount).toBe(2);
    expect(res.autoClosedCount).toBe(1);
    expect(res.isResumed).toBe(true);
    expect(res.elapsedWorkMinutes).toBe(525);
  });

  it('Scenario F: Active current session', () => {
    const session: WorkSessionData = {
      startWorkAt: d('09:30'),
      logoutAt: null,
      totalBreakMinutes: 0,
      totalWorkMinutes: 0,
      autoClosed: false,
      continuationOfSessionId: null,
      breakLogs: [],
    };
    const res = calculateWorkdayRuntime([session], d('12:00'));
    expect(res.elapsedWorkMinutes).toBe(150); // 9:30 to 12:00
    expect(res.currentEndTime).toEqual(d('12:00'));
  });

  it('Scenario G: Active break', () => {
    const session: WorkSessionData = {
      startWorkAt: d('09:30'),
      logoutAt: null,
      totalBreakMinutes: 0,
      totalWorkMinutes: 0,
      autoClosed: false,
      continuationOfSessionId: null,
      breakLogs: [{ startAt: d('11:00'), endAt: null, durationMinutes: null }],
    };
    const res = calculateWorkdayRuntime([session], d('11:20'));
    expect(res.totalBreakMinutes).toBe(20);
    // 9:30 to 11:20 is 110 minutes total elapsed. Minus 20 min break = 90 min work.
    expect(res.elapsedWorkMinutes).toBe(90);
  });
});
