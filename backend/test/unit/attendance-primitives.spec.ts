import {
  PRESENT_STATUSES,
  clockToMinutes,
  completionAgainstRequirement,
  employmentOnDate,
  employmentOverlapsRange,
  isNonWorkingStatus,
  isPresentStatus,
  lateMinutesFrom,
  presenceMinutes,
  resolveRequiredPresence,
  SYSTEM_FALLBACK_PRESENCE_MINUTES,
} from '../../src/modules/platform/attendance/shared/attendance-primitives';

/**
 * The primitives that replace five presence implementations, two status sets,
 * four late thresholds and four required-minutes sources.
 *
 * TIMES AND NUMBERS ARE DELIBERATELY ODD. 04:11, 13:29, 557, 09:37 -- nothing
 * lands on a half hour or on 540, so a function returning the wrong one of
 * several candidates cannot coincidentally match.
 */

const at = (hhmmss: string) => new Date(`2026-09-14T${hhmmss}.000Z`);

// ════════════════════════════════════════════════════════════════════════════
describe('presence is punch out minus punch in', () => {
  it('1. measures the punch pair', () => {
    // 04:11 -> 13:29 is 558 minutes.
    expect(presenceMinutes(at('04:11:00'), at('13:29:00'))).toBe(558);
  });

  it('2. BREAKS DO NOT REDUCE IT', () => {
    // There is no break argument, and that is the point: a break happens inside
    // the span, so subtracting it would charge the employee twice.
    expect((presenceMinutes as any).length).toBe(2);
  });

  it('3. is NULL, not zero, when either punch is missing', () => {
    // Zero is a measurement. Null is "we cannot say".
    expect(presenceMinutes(at('04:11:00'), null)).toBeNull();
    expect(presenceMinutes(null, at('13:29:00'))).toBeNull();
    expect(presenceMinutes(null, null)).toBeNull();
    expect(presenceMinutes(at('04:11:00'), undefined)).toBeNull();
  });

  it('4. accepts ISO strings as well as Dates, identically', () => {
    expect(presenceMinutes('2026-09-14T04:11:00.000Z', '2026-09-14T13:29:00.000Z')).toBe(558);
  });

  it('5. refuses an unparseable timestamp rather than producing NaN', () => {
    expect(presenceMinutes('not-a-date', at('13:29:00'))).toBeNull();
  });

  it('6. clamps a contradictory pair at zero rather than going negative', () => {
    // A punch out before the punch in is a contradiction the evaluator flags.
    // It is not a negative amount of time spent at work.
    expect(presenceMinutes(at('13:29:00'), at('04:11:00'))).toBe(0);
  });

  it('7. an equal pair is zero minutes, which is a real measurement', () => {
    expect(presenceMinutes(at('10:17:00'), at('10:17:00'))).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the present-status set', () => {
  it('8. LATE AND LATE_EXEMPTED ARE ATTENDANCE, not absence', () => {
    expect(isPresentStatus('PRESENT')).toBe(true);
    expect(isPresentStatus('LATE')).toBe(true);
    expect(isPresentStatus('LATE_EXEMPTED')).toBe(true);
    expect(PRESENT_STATUSES.size).toBe(3);
  });

  it('9. does not count absence, half days or unevaluated days as present', () => {
    for (const s of ['ABSENT', 'HALF_DAY', 'WEEKLY_OFF', 'HOLIDAY', 'MISSING_PUNCH', 'ON_LEAVE']) {
      expect(isPresentStatus(s)).toBe(false);
    }
  });

  it('10. treats a missing status as not-present rather than throwing', () => {
    expect(isPresentStatus(null)).toBe(false);
    expect(isPresentStatus(undefined)).toBe(false);
  });

  it('11. names the non-working days separately from the absent ones', () => {
    expect(isNonWorkingStatus('WEEKLY_OFF')).toBe(true);
    expect(isNonWorkingStatus('HOLIDAY')).toBe(true);
    // Absence is a working-day outcome, not a non-working day.
    expect(isNonWorkingStatus('ABSENT')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('employment is asked of the date, never of today', () => {
  const JOINED = '2026-03-11';
  const LEFT = '2026-09-25';

  it('12. employed on an ordinary date inside the window', () => {
    expect(employmentOnDate(JOINED, LEFT, '2026-09-14')).toEqual({
      employedOnDate: true,
      reason: 'EMPLOYED',
    });
  });

  it('13. BOTH BOUNDS ARE INCLUSIVE', () => {
    // Employed on the joining date, and still employed on the last working day
    // rather than from the day after.
    expect(employmentOnDate(JOINED, LEFT, JOINED).employedOnDate).toBe(true);
    expect(employmentOnDate(JOINED, LEFT, LEFT).employedOnDate).toBe(true);
  });

  it('14. the day after the last working day is NOT employed', () => {
    expect(employmentOnDate(JOINED, LEFT, '2026-09-26')).toEqual({
      employedOnDate: false,
      reason: 'AFTER_LAST_WORKING_DATE',
    });
  });

  it('15. before joining is its own reason, so it can read "Not yet joined"', () => {
    expect(employmentOnDate(JOINED, LEFT, '2026-03-10')).toEqual({
      employedOnDate: false,
      reason: 'BEFORE_JOINING',
    });
  });

  it('16. A MISSING JOINING DATE IS UNRESOLVED, NOT THE EPOCH', () => {
    // Treating it as "employed since forever" would place every former employee
    // in every month. It gets its own reason so the caller can say
    // "Employment not verified" rather than "Absent".
    const out = employmentOnDate(null, null, '2026-09-14');

    expect(out.employedOnDate).toBe(false);
    expect(out.reason).toBe('NO_JOINING_DATE');
  });

  it('17. an open-ended employment has no upper bound', () => {
    expect(employmentOnDate(JOINED, null, '2030-01-01').employedOnDate).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('employment overlapping a month', () => {
  const FROM = '2026-09-01';
  const TO = '2026-09-30';

  it('18. SOMEBODY WHO LEFT MID-MONTH STILL BELONGS TO THE MONTH', () => {
    // Overlap, not containment. Three weeks of September then a resignation on
    // the 25th is a September employee.
    expect(employmentOverlapsRange('2025-03-01', '2026-09-25', FROM, TO)).toBe(true);
  });

  it('19. somebody who joins after the month does not', () => {
    expect(employmentOverlapsRange('2026-10-05', null, FROM, TO)).toBe(false);
  });

  it('20. somebody who left before the month does not', () => {
    expect(employmentOverlapsRange('2024-01-01', '2026-06-30', FROM, TO)).toBe(false);
  });

  it('21. the boundary days themselves overlap', () => {
    expect(employmentOverlapsRange(TO, null, FROM, TO)).toBe(true);
    expect(employmentOverlapsRange('2024-01-01', FROM, FROM, TO)).toBe(true);
  });

  it('22. an unknown start is not provably outside, so it is not excluded', () => {
    // The two errors are not symmetric: an empty row is visible, a missing
    // person is not.
    expect(employmentOverlapsRange(null, null, FROM, TO)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('lateness is a quantity, not a status', () => {
  it('23. parses both clock forms and refuses nonsense', () => {
    expect(clockToMinutes('09:30')).toBe(570);
    expect(clockToMinutes('10:30:00')).toBe(630);
    expect(clockToMinutes('24:00')).toBeNull();
    expect(clockToMinutes('9:30')).toBeNull();
    expect(clockToMinutes('')).toBeNull();
    expect(clockToMinutes(null)).toBeNull();
  });

  it('24. THE THRESHOLD IS SUPPLIED, NOT INFERRED', () => {
    // 09:37 arrival. Against a 09:30 shift it is 7 late; against the Team-Lead
    // 10:30 window it is on time. The same arrival, two correct answers --
    // which is exactly why a hardcoded threshold was wrong.
    const arrival = 9 * 60 + 37;

    expect(lateMinutesFrom(arrival, '09:30')).toEqual({ lateMinutes: 7, reason: 'LATE' });
    expect(lateMinutesFrom(arrival, '10:30')).toEqual({ lateMinutes: 0, reason: 'ON_TIME' });
  });

  it('25. arriving exactly on the threshold is on time', () => {
    expect(lateMinutesFrom(570, '09:30').reason).toBe('ON_TIME');
  });

  it('26. grace extends the window, inclusively', () => {
    // 09:30 + 10 grace: 09:40 on time, 09:41 late by one.
    expect(lateMinutesFrom(580, '09:30', 10)).toEqual({ lateMinutes: 0, reason: 'ON_TIME' });
    expect(lateMinutesFrom(581, '09:30', 10)).toEqual({ lateMinutes: 1, reason: 'LATE' });
  });

  it('27. NO PROVEN THRESHOLD MEANS NO LATENESS CLAIM', () => {
    // Falling back to a company default here is how one team's window became
    // everybody's.
    expect(lateMinutesFrom(600, null)).toEqual({ lateMinutes: null, reason: 'NO_THRESHOLD' });
    expect(lateMinutesFrom(600, 'garbage')).toEqual({ lateMinutes: null, reason: 'NO_THRESHOLD' });
  });

  it('28. no arrival means no lateness, distinctly from no threshold', () => {
    expect(lateMinutesFrom(null, '09:30')).toEqual({ lateMinutes: null, reason: 'NO_PUNCH_IN' });
  });

  it('29. never reports negative lateness for an early arrival', () => {
    expect(lateMinutesFrom(8 * 60, '09:30').lateMinutes).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('nine-hour completion names the figure it used', () => {
  it('30. MEASURES AGAINST PRESENCE WHEN PRESENCE IS KNOWN', () => {
    // 557 presence against 540 required. Worked is deliberately lower and must
    // not be the one compared.
    const out = completionAgainstRequirement({
      presenceMinutes: 557,
      workedMinutes: 480,
      requiredMinutes: 540,
    });

    expect(out.met).toBe(true);
    expect(out.measuredAgainst).toBe('PRESENCE');
    expect(out.label).toBe('Completed — presence');
    expect(out.deltaMinutes).toBe(17);
  });

  it('31. states the shortfall as a duration, and says it was presence', () => {
    // 503 against 540 is 37 short.
    const out = completionAgainstRequirement({
      presenceMinutes: 503,
      workedMinutes: 503,
      requiredMinutes: 540,
    });

    expect(out.met).toBe(false);
    expect(out.label).toBe('Short by 00:37 — presence');
  });

  it('32. FALLS BACK TO WORKED TIME ONLY WHEN PRESENCE IS UNKNOWN, and says so', () => {
    // One punch, or a scheduler auto-close: presence cannot be established, so
    // worked time is the best available figure -- labelled, never passed off as
    // presence.
    const out = completionAgainstRequirement({
      presenceMinutes: null,
      workedMinutes: 551,
      requiredMinutes: 540,
    });

    expect(out.met).toBe(true);
    expect(out.measuredAgainst).toBe('WORKED');
    expect(out.label).toBe('Completed — worked time');
  });

  it('33. AN UNPROVABLE REQUIREMENT IS NOT A PASS', () => {
    const out = completionAgainstRequirement({
      presenceMinutes: 600,
      workedMinutes: 600,
      requiredMinutes: null,
    });

    expect(out.met).toBeNull();
    expect(out.label).toBe('Cannot determine');
    expect(out.measuredAgainst).toBeNull();
  });

  it('34. no measurement at all cannot be determined either', () => {
    const out = completionAgainstRequirement({
      presenceMinutes: null,
      workedMinutes: null,
      requiredMinutes: 540,
    });

    expect(out.met).toBeNull();
    expect(out.label).toBe('Cannot determine');
  });

  it('35. meeting the requirement exactly is completion, not a shortfall', () => {
    const out = completionAgainstRequirement({
      presenceMinutes: 540,
      workedMinutes: 540,
      requiredMinutes: 540,
    });

    expect(out.met).toBe(true);
    expect(out.deltaMinutes).toBe(0);
  });

  it('36. formats a shortfall over an hour correctly', () => {
    // 445 against 540 is 95 minutes = 01:35, not 00:95.
    expect(
      completionAgainstRequirement({
        presenceMinutes: 445,
        workedMinutes: 445,
        requiredMinutes: 540,
      }).label,
    ).toBe('Short by 01:35 — presence');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the required presence has one resolver', () => {
  it('37. THE SHIFT OUTRANKS THE POLICY', () => {
    // Two different numbers, neither of them 540, so swapping the arguments
    // changes the answer.
    expect(resolveRequiredPresence(480, 555)).toEqual({
      minutes: 480,
      source: 'SHIFT_POLICY',
    });
  });

  it('38. falls back to the policy when no shift figure exists', () => {
    expect(resolveRequiredPresence(null, 555)).toEqual({
      minutes: 555,
      source: 'ATTENDANCE_POLICY',
    });
    expect(resolveRequiredPresence(undefined, 555).source).toBe('ATTENDANCE_POLICY');
  });

  it('39. NEVER RETURNS NULL, and labels when the fallback was used', () => {
    // A caller handed null would invent its own default, which is how four
    // separate 540s appeared across the codebase.
    const out = resolveRequiredPresence(null, null);

    expect(out.minutes).toBe(SYSTEM_FALLBACK_PRESENCE_MINUTES);
    expect(out.source).toBe('SYSTEM_FALLBACK');
    expect(out.minutes).not.toBeNull();
  });

  it('40. treats zero or negative as not configured, not as "no time required"', () => {
    // A requirement of zero would make every day complete.
    expect(resolveRequiredPresence(0, 555).source).toBe('ATTENDANCE_POLICY');
    expect(resolveRequiredPresence(-60, 555).source).toBe('ATTENDANCE_POLICY');
    expect(resolveRequiredPresence(0, 0).source).toBe('SYSTEM_FALLBACK');
  });
});
