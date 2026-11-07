import { resolveBreakWarningTransition } from '../../src/modules/platform/scheduler/scheduler.service';

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
});
