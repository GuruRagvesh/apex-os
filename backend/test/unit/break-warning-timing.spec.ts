import { breakAlarmRound, resolveBreakWarningTransition } from '../../src/modules/platform/scheduler/scheduler.service';

describe('break warning timing', () => {
  const end = new Date('2026-11-05T10:30:00.000Z');

  it('warns five minutes before an estimate over five minutes', () => {
    expect(resolveBreakWarningTransition(
      { warningStage: 'PENDING', estimatedMinutes: 30, plannedEndAt: end },
      new Date('2026-11-05T10:25:00.000Z'),
    )).toEqual({ phase: 'early', activeStage: 'EARLY_ACTIVE' });
  });

  it('uses the same early warning for the 60-minute fallback', () => {
    expect(resolveBreakWarningTransition(
      { warningStage: 'PENDING', estimatedMinutes: null, plannedEndAt: end },
      new Date('2026-11-05T10:25:00.000Z'),
    )).toEqual({ phase: 'early', activeStage: 'EARLY_ACTIVE' });
  });

  it('does not warn early for an estimate of five minutes or less', () => {
    expect(resolveBreakWarningTransition(
      { warningStage: 'PENDING', estimatedMinutes: 5, plannedEndAt: end },
      new Date('2026-11-05T10:29:59.000Z'),
    )).toBeNull();
    expect(resolveBreakWarningTransition(
      { warningStage: 'PENDING', estimatedMinutes: 5, plannedEndAt: end },
      end,
    )).toEqual({ phase: 'final', activeStage: 'FINAL_ACTIVE' });
  });

  it('sends the final warning only after Later arms it', () => {
    expect(resolveBreakWarningTransition(
      { warningStage: 'PENDING', estimatedMinutes: 30, plannedEndAt: end },
      end,
    )).toEqual({ phase: 'early', activeStage: 'EARLY_ACTIVE' });
    expect(resolveBreakWarningTransition(
      { warningStage: 'FINAL_PENDING', estimatedMinutes: 30, plannedEndAt: end },
      end,
    )).toEqual({ phase: 'final', activeStage: 'FINAL_ACTIVE' });
  });

  it('times three rounds of 20 plays with five-minute pauses from the chosen sound', () => {
    const start = new Date('2026-11-06T10:00:00.000Z');
    const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);
    // Apex Break: 20 x 10.1 s = 202 s ringing + 300 s pause = a 502 s cycle.
    expect(breakAlarmRound(start, 'apex-break', at(0))).toBe(0);
    expect(breakAlarmRound(start, 'apex-break', at(501))).toBe(0);
    expect(breakAlarmRound(start, 'apex-break', at(502))).toBe(1);
    expect(breakAlarmRound(start, 'apex-break', at(1004))).toBe(2);
    expect(breakAlarmRound(start, 'apex-break', at(1506))).toBeNull();
    // Unknown or missing sound falls back to Apex Break timing.
    expect(breakAlarmRound(start, undefined, at(502))).toBe(1);
    // Fahhh: 20 x 2.7 s = 54 s + 300 s = a 354 s cycle.
    expect(breakAlarmRound(start, 'fahhh', at(354))).toBe(1);
  });
});
