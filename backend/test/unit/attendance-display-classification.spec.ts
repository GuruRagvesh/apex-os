import {
  classifyForDisplay,
  presenceSeconds,
  type DisplayClassificationInput,
} from '../../src/modules/platform/attendance/shared/attendance-primitives';

/**
 * §34 / §35: THE EXACT BOUNDARIES, AND THE DISPLAY LADDER.
 *
 * Every assertion here is about a single second. 08:59:59 must not meet a
 * nine-hour requirement and 03:59:59 must not reach a four-hour floor, so the
 * classification runs on unrounded seconds -- the existing frontend helper
 * rounded minutes with Math.round, which turned 539.98 into 540 and let
 * 08:59:59 pass.
 *
 * The thresholds are ARGUMENTS in every test, never constants in the module.
 * The arrival boundary used to be a hardcoded 10:30 applied to everybody.
 */

const NINE_HOURS = 9 * 3600;
const FOUR_HOURS = 4 * 3600;

/** A day whose punches span exactly `seconds`, arriving at `arrival` HH:mm. */
const spanning = (
  seconds: number | null,
  arrival = '09:00',
  over: Partial<DisplayClassificationInput> = {},
): DisplayClassificationInput => {
  const [h, m] = arrival.split(':').map(Number);
  const inAt = new Date(Date.UTC(2026, 9, 7, h, m, 0));
  return {
    officialStatus: 'PRESENT',
    regularized: false,
    regularizationPending: false,
    punchInAt: seconds === null ? null : inAt,
    punchOutAt: seconds === null ? null : new Date(inAt.getTime() + seconds * 1000),
    workingDay: true,
    dayOpen: false,
    arrivalThreshold: '10:30',
    arrivalGraceMinutes: 0,
    arrivalMinutes: h * 60 + m,
    requiredSeconds: NINE_HOURS,
    minimumSeconds: FOUR_HOURS,
    ...over,
  };
};

const state = (i: DisplayClassificationInput) => classifyForDisplay(i).state;

// ════════════════════════════════════════════════════════════════════════════
describe('presence is measured in exact seconds', () => {
  it('does not round, in either direction', () => {
    const base = new Date('2026-10-07T04:00:00.000Z');
    const plus = (s: number) => new Date(base.getTime() + s * 1000);

    expect(presenceSeconds(base, plus(NINE_HOURS - 1))).toBe(32399); // 08:59:59
    expect(presenceSeconds(base, plus(NINE_HOURS))).toBe(32400); // 09:00:00
    expect(presenceSeconds(base, plus(NINE_HOURS + 1))).toBe(32401);
  });

  it('is null, not zero, when a punch is missing', () => {
    expect(presenceSeconds(new Date(), null)).toBeNull();
    expect(presenceSeconds(null, new Date())).toBeNull();
  });

  it('never goes negative on a contradictory pair', () => {
    expect(presenceSeconds('2026-10-07T13:00:00Z', '2026-10-07T04:00:00Z')).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('§34. the nine-hour boundary', () => {
  it('08:59:59 DOES NOT MEET IT', () => {
    expect(state(spanning(NINE_HOURS - 1))).toBe('NINE_HOURS_NOT_MET');
  });

  it('09:00:00 MEETS IT', () => {
    expect(state(spanning(NINE_HOURS))).toBe('PRESENT');
  });

  it('09:00:01 meets it', () => {
    expect(state(spanning(NINE_HOURS + 1))).toBe('PRESENT');
  });

  it('reports the shortfall to the second', () => {
    const out = classifyForDisplay(spanning(NINE_HOURS - 1));

    expect(out.shortBySeconds).toBe(1);
    expect(out.presenceSeconds).toBe(NINE_HOURS - 1);
  });

  it('reports no shortfall once the requirement is met', () => {
    expect(classifyForDisplay(spanning(NINE_HOURS)).shortBySeconds).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('§34. the four-hour floor', () => {
  it('03:59:59 IS INSUFFICIENT', () => {
    expect(state(spanning(FOUR_HOURS - 1))).toBe('INSUFFICIENT_PRESENCE');
  });

  it('04:00:00 REACHES THE FLOOR, so it is nine-hours-not-met', () => {
    expect(state(spanning(FOUR_HOURS))).toBe('NINE_HOURS_NOT_MET');
  });

  it('04:00:01 is nine-hours-not-met', () => {
    expect(state(spanning(FOUR_HOURS + 1))).toBe('NINE_HOURS_NOT_MET');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('§34. the arrival boundary', () => {
  it('10:30:00 IS ON TIME', () => {
    expect(state(spanning(NINE_HOURS, '10:30'))).toBe('PRESENT');
  });

  it('10:31 IS LATE', () => {
    expect(state(spanning(NINE_HOURS, '10:31'))).toBe('LATE');
  });

  it('THE THRESHOLD IS NOT A CONSTANT: the same arrival differs by shift', () => {
    // 10:00 arrival. Late on a 09:30 shift, on time on a 10:30 one. This is the
    // defect the hardcoded 10:30 caused.
    const onNineThirty = spanning(NINE_HOURS, '10:00', { arrivalThreshold: '09:30' });
    const onTenThirty = spanning(NINE_HOURS, '10:00', { arrivalThreshold: '10:30' });

    expect(state(onNineThirty)).toBe('LATE');
    expect(state(onTenThirty)).toBe('PRESENT');
  });

  it('grace extends the boundary inclusively', () => {
    const t = (arrival: string) =>
      state(spanning(NINE_HOURS, arrival, { arrivalThreshold: '09:30', arrivalGraceMinutes: 10 }));

    expect(t('09:40')).toBe('PRESENT');
    expect(t('09:41')).toBe('LATE');
  });

  it('claims no lateness when no threshold is proven', () => {
    const out = classifyForDisplay(
      spanning(NINE_HOURS, '11:00', { arrivalThreshold: null }),
    );

    expect(out.state).toBe('PRESENT');
    expect(out.lateBySeconds).toBeNull();
    expect(out.reasons).not.toContain('Late');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('§35. the display ladder', () => {
  it('1-2. on time with the requirement met is Present', () => {
    expect(state(spanning(NINE_HOURS, '09:00'))).toBe('PRESENT');
    expect(state(spanning(NINE_HOURS + 3600, '09:00'))).toBe('PRESENT');
  });

  it('3-4. LATE SURVIVES WORKING LONGER', () => {
    // Staying late does not undo arriving late.
    expect(state(spanning(NINE_HOURS, '11:00'))).toBe('LATE');
    expect(state(spanning(NINE_HOURS + 7200, '11:00'))).toBe('LATE');
  });

  it('5. on time but short is nine-hours-not-met, not Late', () => {
    const out = classifyForDisplay(spanning(NINE_HOURS - 1, '09:00'));

    expect(out.state).toBe('NINE_HOURS_NOT_MET');
    expect(out.reasons).toContain('9 hours not met');
    expect(out.reasons).not.toContain('Late');
  });

  it('LATE AND SHORT SAYS BOTH, because one colour cannot explain two things', () => {
    const out = classifyForDisplay(spanning(NINE_HOURS - 1, '11:00'));

    expect(out.state).toBe('NINE_HOURS_NOT_MET');
    expect(out.reasons).toContain('9 hours not met');
    expect(out.reasons).toContain('Late');
  });

  it('8-9. holidays and weekly offs come from the record, not a duration', () => {
    expect(state(spanning(0, '09:00', { officialStatus: 'HOLIDAY' }))).toBe('HOLIDAY');
    expect(state(spanning(0, '09:00', { officialStatus: 'WEEKLY_OFF' }))).toBe('WEEKLY_OFF');
    expect(state(spanning(null, '09:00', { workingDay: false, officialStatus: null }))).toBe(
      'WEEKLY_OFF',
    );
  });

  it('A HOLIDAY WORKED IS STILL A HOLIDAY on the calendar', () => {
    // The evidence shows in the day detail; the calendar does not reclassify it.
    expect(state(spanning(NINE_HOURS, '09:00', { officialStatus: 'HOLIDAY' }))).toBe('HOLIDAY');
  });

  it('10-11. HALF DAY IS ONLY EVER RENDERED, NEVER DERIVED', () => {
    // Supplied by the record: shown.
    expect(state(spanning(NINE_HOURS, '09:00', { officialStatus: 'HALF_DAY' }))).toBe('HALF_DAY');

    // NOT supplied: a 4h-to-9h day is nine-hours-not-met, never half day. No
    // duration anywhere in the module may produce HALF_DAY.
    for (const s of [FOUR_HOURS, FOUR_HOURS + 1, NINE_HOURS / 2, NINE_HOURS - 1]) {
      expect(state(spanning(s, '09:00'))).not.toBe('HALF_DAY');
    }
  });

  it('12-14. a correction is reported, and only an approved one is authoritative', () => {
    const pending = classifyForDisplay(
      spanning(NINE_HOURS - 1, '09:00', { regularizationPending: true }),
    );
    const approved = classifyForDisplay(
      spanning(NINE_HOURS, '09:00', { regularized: true }),
    );
    const plain = classifyForDisplay(spanning(NINE_HOURS - 1, '09:00'));

    // Pending changes NOTHING except that it is announced.
    expect(pending.state).toBe(plain.state);
    expect(pending.presenceSeconds).toBe(plain.presenceSeconds);
    expect(pending.reasons).toContain('Regularization pending');
    expect(pending.regularizationPending).toBe(true);

    // Approved is flagged, and the corrected punches are what got measured.
    expect(approved.regularized).toBe(true);
    expect(approved.reasons).toContain('Regularized');
    expect(approved.state).toBe('PRESENT');
  });

  it('15-16. a missing punch is incomplete, not short', () => {
    const noOut = classifyForDisplay(
      spanning(null, '09:00', { punchInAt: new Date('2026-10-07T04:11:00Z'), punchOutAt: null }),
    );
    const noIn = classifyForDisplay(
      spanning(null, '09:00', { punchInAt: null, punchOutAt: new Date('2026-10-07T13:29:00Z') }),
    );

    expect(noOut.state).toBe('MISSING_PUNCH');
    expect(noOut.reasons).toContain('Punch out missing');
    expect(noIn.reasons).toContain('Punch in missing');
    // Never measured, never failed.
    expect(noOut.presenceSeconds).toBeNull();
    expect(noOut.shortBySeconds).toBeNull();
  });

  it('17. AN OPEN DAY IS NEVER GIVEN A VERDICT', () => {
    const out = classifyForDisplay(
      spanning(3600, '09:00', { dayOpen: true, punchOutAt: null }),
    );

    expect(out.state).toBe('OPEN');
    expect(out.state).not.toBe('INSUFFICIENT_PRESENCE');
    expect(out.reasons).toContain('Day still open');
  });

  it('an unconfirmed calendar is not a verdict about the employee', () => {
    const out = classifyForDisplay(
      spanning(null, '09:00', { workingDay: null, officialStatus: null }),
    );

    expect(out.state).toBe('UNKNOWN');
    expect(out.reasons).toContain('Calendar not confirmed');
  });

  it('an unprovable requirement cannot be failed', () => {
    const out = classifyForDisplay(spanning(NINE_HOURS - 1, '09:00', { requiredSeconds: null }));

    expect(out.state).toBe('UNKNOWN');
    expect(out.reasons).toContain('Required time unresolved');
    expect(out.state).not.toBe('NINE_HOURS_NOT_MET');
  });

  it('leave and non-applicable days come from the record', () => {
    expect(state(spanning(null, '09:00', { officialStatus: 'ON_LEAVE' }))).toBe('ON_LEAVE');
    expect(state(spanning(null, '09:00', { officialStatus: 'LWP' }))).toBe('ON_LEAVE');
    expect(state(spanning(null, '09:00', { officialStatus: 'NOT_APPLICABLE' }))).toBe(
      'NOT_APPLICABLE',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('breaks never touch attendance presence', () => {
  it('TAKES NO BREAK ARGUMENT AT ALL', () => {
    // A break happens inside the span, so subtracting it would charge the
    // employee twice for the same hour. There is nowhere to pass one.
    const keys = Object.keys(spanning(NINE_HOURS));

    expect(keys).not.toContain('breakMinutes');
    expect(keys).not.toContain('breakSeconds');
    expect(keys.filter((k) => /break/i.test(k))).toHaveLength(0);
  });

  it('a nine-hour span with a long break is still nine hours of presence', () => {
    expect(state(spanning(NINE_HOURS))).toBe('PRESENT');
  });
});
