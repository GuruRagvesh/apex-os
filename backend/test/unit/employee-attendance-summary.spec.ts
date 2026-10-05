import {
  averageTimeMetrics,
  computeTenure,
  formatClockMinutes,
  formatDurationMinutes,
  isUnresolved,
  officePresenceMinutes,
  statusLabel,
  summariseMonth,
  type AttendanceDayFacts,
} from '../../src/modules/platform/attendance/summary/employee-attendance-summary';

/**
 * The employee Attendance dashboard's arithmetic.
 *
 * FIXTURES ARE NEVER THE APPROVED DEFAULT. Punch 10:17/19:29, presence
 * 9h12m, work 8h31m, break 41m, a joining date that is not the first of a
 * month -- a screen rendering the right-looking default numbers cannot be
 * told apart from one that hardcoded them, and that exact mistake has
 * produced findings throughout this programme already.
 */

const day = (over: Partial<AttendanceDayFacts> = {}): AttendanceDayFacts => ({
  businessDate: '2026-08-17',
  status: 'PRESENT',
  evaluationState: 'CALCULATED',
  punchInAt: new Date('2026-08-17T04:47:00.000Z'), // 10:17 IST
  punchOutAt: new Date('2026-08-17T13:59:00.000Z'), // 19:29 IST
  workedMinutes: 511, // 8h31m
  breakMinutes: 41,
  lateMinutes: 0,
  locked: false,
  ...over,
});

const minutesOfDayIST = (at: Date): number => {
  // Matches the module's own contract: caller supplies company-time minutes.
  const ist = new Date(at.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
};

// ════════════════════════════════════════════════════════════════════════════
describe('office presence', () => {
  it('1. IS PUNCH OUT MINUS PUNCH IN, and nothing else', () => {
    // 10:17 to 19:29 is 9h12m = 552 minutes.
    expect(officePresenceMinutes(day())).toBe(552);
  });

  it('2. BREAKS DO NOT REDUCE IT', () => {
    // Same punches, break minutes tripled -- presence is unchanged.
    expect(officePresenceMinutes(day({ breakMinutes: 41 })))
      .toBe(officePresenceMinutes(day({ breakMinutes: 123 })));
  });

  it('3. effective work is a DIFFERENT number, never substituted', () => {
    const d = day();
    expect(officePresenceMinutes(d)).toBe(552);
    expect(d.workedMinutes).toBe(511);
    expect(officePresenceMinutes(d)).not.toBe(d.workedMinutes);
  });

  it('4. a missing punch produces no presence figure, not zero', () => {
    expect(officePresenceMinutes(day({ punchOutAt: null }))).toBeNull();
    expect(officePresenceMinutes(day({ punchInAt: null }))).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('unresolved is not absent', () => {
  it('5. no record at all is unresolved', () => {
    expect(isUnresolved(day({ status: null, evaluationState: null }))).toBe(true);
  });

  it('6. NEEDS_REVIEW is unresolved even with a provisional status', () => {
    expect(isUnresolved(day({ status: 'ABSENT', evaluationState: 'NEEDS_REVIEW' }))).toBe(true);
  });

  it('7. an ordinary calculated day is resolved', () => {
    expect(isUnresolved(day())).toBe(false);
  });

  it('8b. A CONTEXT-BLOCKED DAY COUNTS AS NEEDS REVIEW, not swallowed by noRecord', () => {
    // status: null AND evaluationState: 'NEEDS_REVIEW' is exactly the shape a
    // real configuration gap arrives in -- the same null status a day tonight's
    // cron simply has not reached yet also has. Filing it under the generic,
    // low-urgency noRecord bucket instead would mean a real problem HR needs
    // to fix never surfaces as one.
    const days = [day({ status: null, evaluationState: 'NEEDS_REVIEW' })];
    const out = summariseMonth(days, null);
    expect(out.needsReview).toBe(1);
    expect(out.noRecord).toBe(0);
  });

  it('8. UNRESOLVED DAYS NEVER COUNT AS ABSENT IN THE MONTH SUMMARY', () => {
    const days = [
      day({ businessDate: '2026-08-01', status: 'ABSENT', evaluationState: 'NEEDS_REVIEW' }),
      day({ businessDate: '2026-08-02', status: null, evaluationState: null }),
      day({ businessDate: '2026-08-03', status: 'ABSENT', evaluationState: 'CALCULATED' }),
    ];
    const out = summariseMonth(days, null);
    expect(out.absent).toBe(1); // only the resolved one
    expect(out.needsReview).toBe(1);
    expect(out.noRecord).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('not applicable is neither a gap nor an outcome', () => {
  it('32. NOT APPLICABLE IS RESOLVED, not a data-quality gap', () => {
    // Before joining, after leaving, or management-exempt -- there was never
    // a record to have, which is a different fact from one that is missing.
    expect(isUnresolved(day({ status: null, evaluationState: null, notApplicable: true })))
      .toBe(false);
  });

  it('33. AND IT IS EXCLUDED FROM EVERY MONTH COUNT, not folded into noRecord', () => {
    // The failure this exists to prevent: a management-exempt employee's
    // dashboard reading "31 days need attention" every single month, because
    // a day nobody expected them to attend looked identical to a genuine gap.
    const days = [
      day({ businessDate: '2026-08-01', status: null, evaluationState: null, notApplicable: true }),
      day({ businessDate: '2026-08-02', status: null, evaluationState: null }), // a REAL gap, for contrast
    ];
    const out = summariseMonth(days, null);
    expect(out.notApplicable).toBe(1);
    expect(out.noRecord).toBe(1); // only the genuine gap
    expect(out.absent).toBe(0);
    expect(out.needsReview).toBe(0);
  });

  it('34. a not-applicable day carries no punches into the time averages', () => {
    const days = [
      day({ businessDate: '2026-08-01' }), // complete
      day({ businessDate: '2026-08-02', status: null, evaluationState: null, punchInAt: null, punchOutAt: null, notApplicable: true }),
    ];
    expect(averageTimeMetrics(days, minutesOfDayIST).sampleSize).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('month counts', () => {
  it('9. present, late, half-day and full-day counted correctly', () => {
    const days = [
      day({ businessDate: '2026-08-01', status: 'PRESENT' }),
      day({ businessDate: '2026-08-02', status: 'LATE' }),
      day({ businessDate: '2026-08-03', status: 'LATE_EXEMPTED' }),
      day({ businessDate: '2026-08-04', status: 'HALF_DAY' }),
      day({ businessDate: '2026-08-05', status: 'WEEKLY_OFF' }),
    ];
    const out = summariseMonth(days, null);
    expect(out.present).toBe(1);
    expect(out.late).toBe(2); // LATE + LATE_EXEMPTED
    expect(out.halfDay).toBe(1);
    // fullDay = PRESENT + LATE + LATE_EXEMPTED (worked a full day, whatever the lateness).
    expect(out.fullDay).toBe(3);
  });

  it('10. approved leave counts LEAVE and LWP, not HALF_DAY', () => {
    const days = [
      day({ businessDate: '2026-08-01', status: 'LEAVE' }),
      day({ businessDate: '2026-08-02', status: 'LWP' }),
      day({ businessDate: '2026-08-03', status: 'HALF_DAY' }),
    ];
    expect(summariseMonth(days, null).approvedLeaveDays).toBe(2);
  });

  it('11. MISSING PUNCH IN AND OUT ARE COUNTED SEPARATELY', () => {
    const days = [
      day({ businessDate: '2026-08-01', status: 'MISSING_PUNCH', punchInAt: null, punchOutAt: new Date('2026-08-01T12:00:00Z') }),
      day({ businessDate: '2026-08-02', status: 'MISSING_PUNCH', punchInAt: new Date('2026-08-02T04:00:00Z'), punchOutAt: null }),
      day({ businessDate: '2026-08-03', status: 'MISSING_PUNCH', punchInAt: null, punchOutAt: null }),
    ];
    const out = summariseMonth(days, null);
    expect(out.missingPunchIn).toBe(2);
    expect(out.missingPunchOut).toBe(2);
  });

  it('12. REQUIRED-HOURS SHORTFALL, against a NON-DEFAULT figure', () => {
    // Required 480 (8h), neither the 540 default nor Reminder V2's 400 test
    // fixture. Presence 552 (9h12m) clears it; a second day with 6h does not.
    const days = [
      day({ businessDate: '2026-08-01' }), // 552m presence
      day({
        businessDate: '2026-08-02',
        punchInAt: new Date('2026-08-02T04:00:00.000Z'),
        punchOutAt: new Date('2026-08-02T10:00:00.000Z'), // 6h = 360m
      }),
    ];
    expect(summariseMonth(days, 480).requiredHoursShortfall).toBe(1);
  });

  it('13. NULL REQUIRED PRESENCE PRODUCES NO SHORTFALL FIGURE AT ALL', () => {
    // A half-configured or unassigned policy. Not zero -- genuinely omitted.
    const days = [day({
      punchInAt: new Date('2026-08-17T04:00:00.000Z'),
      punchOutAt: new Date('2026-08-17T05:00:00.000Z'), // 1h — would shortfall under any real policy
    })];
    expect(summariseMonth(days, null).requiredHoursShortfall).toBe(0);
  });

  it('14. shortfall is only judged on full-day statuses, not half days or leave', () => {
    const days = [
      day({ businessDate: '2026-08-01', status: 'HALF_DAY', punchOutAt: new Date('2026-08-01T05:00:00.000Z') }),
      day({ businessDate: '2026-08-02', status: 'LEAVE', punchInAt: null, punchOutAt: null }),
    ];
    expect(summariseMonth(days, 480).requiredHoursShortfall).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('time metrics: averages over complete days only', () => {
  it('15. a half-punched day is EXCLUDED, not zeroed', () => {
    // One complete day, one with no punch out. The complete day alone must
    // drive the average -- folding the incomplete one in as a zero would drag
    // "average punch out" toward midnight.
    const days = [
      day({ businessDate: '2026-08-01' }), // complete, punch out 19:29 IST
      day({ businessDate: '2026-08-02', punchOutAt: null }),
    ];
    const out = averageTimeMetrics(days, minutesOfDayIST);
    expect(out.sampleSize).toBe(1);
    expect(formatClockMinutes(out.averagePunchOutMinutes)).toBe('19:29');
  });

  it('16. no complete days at all produces nulls, not a division by zero', () => {
    const out = averageTimeMetrics([day({ punchInAt: null, punchOutAt: null })], minutesOfDayIST);
    expect(out).toMatchObject({
      averagePunchInMinutes: null, averagePunchOutMinutes: null,
      averageOfficePresenceMinutes: null, averageEffectiveWorkMinutes: null,
      averageBreakMinutes: null, sampleSize: 0,
    });
  });

  it('17. presence and effective work average SEPARATELY, never mixed', () => {
    const out = averageTimeMetrics([day()], minutesOfDayIST);
    expect(out.averageOfficePresenceMinutes).toBe(552);
    expect(out.averageEffectiveWorkMinutes).toBe(511);
  });

  it('18. two distinctive days average to something neither of them is', () => {
    const days = [
      day({ businessDate: '2026-08-01' }), // presence 552
      day({
        businessDate: '2026-08-02',
        punchInAt: new Date('2026-08-02T02:30:00.000Z'), // 08:00 IST
        punchOutAt: new Date('2026-08-02T11:30:00.000Z'), // 17:00 IST -- 540m presence
      }),
    ];
    const out = averageTimeMetrics(days, minutesOfDayIST);
    expect(out.averageOfficePresenceMinutes).toBe(546); // (552+540)/2
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('duration and clock formatting', () => {
  it('19. MANAGEMENT’S OWN EXAMPLE: 542 minutes reads as "9h 02m"', () => {
    expect(formatDurationMinutes(542)).toBe('9h 02m');
  });

  it('20. NEVER "8h62m" — minutes never overflow past 59', () => {
    expect(formatDurationMinutes(8 * 60 + 62)).toBe('9h 02m');
  });

  it('21. under an hour has no hour component', () => {
    expect(formatDurationMinutes(41)).toBe('41m');
  });

  it('22. a null/negative/non-finite duration renders as an em dash, not 0m', () => {
    // "0m" would read as a measured fact. It is not one.
    expect(formatDurationMinutes(null)).toBe('—');
    expect(formatDurationMinutes(-5)).toBe('—');
    expect(formatDurationMinutes(NaN)).toBe('—');
  });

  it('23. a clock time pads to two digits', () => {
    expect(formatClockMinutes(9 * 60 + 5)).toBe('09:05');
    expect(formatClockMinutes(0)).toBe('00:00');
  });

  it('24. an unresolved clock reading is an em dash', () => {
    expect(formatClockMinutes(null)).toBe('—');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('status labels', () => {
  it('25. human wording, not the raw enum', () => {
    expect(statusLabel('PRESENT', 'CALCULATED')).toBe('On Time');
    expect(statusLabel('MISSING_PUNCH', 'CALCULATED')).toBe('Missing Punch');
    expect(statusLabel('LWP', 'CALCULATED')).toBe('Leave Without Pay');
  });

  it('26. NEEDS_REVIEW WINS OVER WHATEVER PROVISIONAL STATUS IS STORED', () => {
    expect(statusLabel('ABSENT', 'NEEDS_REVIEW')).toBe('Needs Review');
  });

  it('27. no record at all reads as Needs Review, never a blank', () => {
    expect(statusLabel(null, null)).toBe('Needs Review');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('tenure', () => {
  it('28. NOT FROM THE FIRST OF A MONTH: whole years and months, correctly', () => {
    // Joined 2024-03-17. As of 2026-08-02: 2 years, 4 months (not yet the 17th).
    const joined = new Date(Date.UTC(2024, 2, 17));
    const asOf = new Date(Date.UTC(2026, 7, 2));
    expect(computeTenure(joined, asOf, null)).toEqual({ years: 2, months: 4, known: true });
  });

  it('29. the day itself rolls the month over', () => {
    const joined = new Date(Date.UTC(2024, 2, 17));
    const asOf = new Date(Date.UTC(2026, 7, 17));
    expect(computeTenure(joined, asOf, null)).toEqual({ years: 2, months: 5, known: true });
  });

  it('30. NO JOINING DATE: unknown, never a fabricated "just joined"', () => {
    expect(computeTenure(null, new Date(), null)).toEqual({ years: 0, months: 0, known: false });
  });

  it('31. a former employee’s tenure ends at their last working date, not today', () => {
    const joined = new Date(Date.UTC(2020, 0, 1));
    const left = new Date(Date.UTC(2021, 0, 1)); // exactly 1 year
    const wayLater = new Date(Date.UTC(2026, 0, 1));
    expect(computeTenure(joined, wayLater, left)).toEqual({ years: 1, months: 0, known: true });
  });
});
