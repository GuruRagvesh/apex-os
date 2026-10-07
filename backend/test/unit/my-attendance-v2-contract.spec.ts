/**
 * My Attendance V2 contract — the mapping from the running evaluator's answer
 * to the target day contract.
 *
 * The mapper is pure, so this suite is a table: facts in, contract out, no
 * database and no Nest. What it protects is narrow and specific — that the
 * translation never INVENTS a verdict the evaluator did not give, and never
 * turns an absent figure into a zero.
 */

import {
  UNAVAILABLE_REASONS,
  classifyFlag,
  mapDay,
  mapToday,
  type AttendanceExceptionCode,
  type AttendanceModifier,
} from '../../src/modules/platform/attendance/v2/my-attendance-v2.contract';
import { datesInMonth } from '../../src/modules/platform/attendance/v2/my-attendance-v2.service';
import type {
  AttendanceCalculationReason,
  AttendanceExceptionFlag,
  DailyAttendanceResult,
} from '../../src/modules/platform/attendance/evaluation/daily-attendance.types';

const TODAY = '2026-10-06';

function result(over: Partial<DailyAttendanceResult> = {}): DailyAttendanceResult {
  return {
    employeeId: 'emp-1',
    businessDate: TODAY,
    official: true,
    status: 'PRESENT',
    evaluationState: 'CALCULATED',
    calculationReason: 'COMPLETE_WORKDAY' as AttendanceCalculationReason,
    exceptionFlags: [],
    punchInAt: new Date('2026-10-06T04:00:00.000Z'),
    punchOutAt: new Date('2026-10-06T13:00:00.000Z'),
    workedMinutes: 480,
    breakMinutes: 60,
    lateMinutes: 0,
    presenceMinutes: 570,
    requiredMinutes: 540,
    leaveDeducted: 0,
    lwpDeducted: 0,
    requiresReview: false,
    blockingReasons: [],
    provenance: {
      resolverVersion: 1,
      evaluatorVersion: 1,
      employeeProfileId: null,
      attendancePolicyId: null,
      attendancePolicyVersion: null,
      shiftPolicyId: null,
      shiftPolicyVersion: null,
      holidayCalendarId: null,
      weeklyOffPolicyId: null,
      holidayId: null,
      businessDayOverrideId: null,
      leaveRequestId: null,
      punchInEvidenceId: null,
      punchOutEvidenceId: null,
      workSessionIds: [],
    },
    sourceFingerprint: 'fp',
    evaluatedAt: new Date('2026-10-06T14:00:00.000Z'),
    ...over,
  } as DailyAttendanceResult;
}

function day(over: Partial<DailyAttendanceResult> = {}, date = '2026-10-05') {
  return mapDay({ result: result({ ...over, businessDate: date }), date, companyToday: TODAY });
}

describe('outcome translation', () => {
  // The four-layer model: each current status lands on exactly one outcome, and
  // the two late statuses are modifiers on a PRESENT day rather than outcomes.
  const cases: Array<[string, string, AttendanceModifier[]]> = [
    ['PRESENT', 'PRESENT', []],
    ['LATE', 'PRESENT', ['LATE']],
    ['LATE_EXEMPTED', 'PRESENT', ['LATE', 'LATE_EXEMPTED']],
    ['HALF_DAY', 'HALF_DAY', []],
    ['ABSENT', 'ABSENT', []],
    ['LEAVE', 'LEAVE', []],
    ['LWP', 'LWP', []],
    ['HOLIDAY', 'HOLIDAY', []],
    ['WEEKLY_OFF', 'WEEKLY_OFF', []],
    ['MISSING_PUNCH', 'UNRESOLVED', []],
    ['GEO_MISMATCH', 'UNRESOLVED', []],
    ['FACE_MISSING', 'UNRESOLVED', []],
    ['PENDING_REGULARIZATION', 'UNRESOLVED', []],
  ];

  it.each(cases)('status %s maps to outcome %s', (status, outcome, modifiers) => {
    const d = day({ status: status as any });
    expect(d.outcome).toBe(outcome);
    for (const m of modifiers) expect(d.modifiers).toContain(m);
    // The untranslated value always travels with the translation.
    expect(d.sourceStatus).toBe(status);
  });

  it('never reports LATE_EXEMPTED without LATE', () => {
    const d = day({ status: 'LATE_EXEMPTED' as any });
    expect(d.modifiers).toContain('LATE');
    expect(d.modifiers).toContain('LATE_EXEMPTED');
  });

  it('derives LATE from lateMinutes when the status does not carry it', () => {
    expect(day({ status: 'PRESENT' as any, lateMinutes: 12 }).modifiers).toContain('LATE');
  });
});

describe('exception and modifier translation', () => {
  const exceptions: Array<[AttendanceExceptionFlag, AttendanceExceptionCode]> = [
    ['MISSING_PUNCH', 'MISSING_IN'],
    ['MISSING_PUNCH_OUT', 'MISSING_OUT'],
    ['LOCATION_OUTSIDE_GEOFENCE', 'LOCATION_EXCEPTION'],
    ['LOCATION_LOW_ACCURACY', 'LOCATION_EXCEPTION'],
    ['LOCATION_UNAVAILABLE', 'LOCATION_EXCEPTION'],
    ['PHOTO_MISSING', 'PHOTO_EXCEPTION'],
    ['AMBIGUOUS_APPROVED_LEAVE', 'LEAVE_WORK_CONFLICT'],
  ];

  it.each(exceptions)('flag %s becomes exception %s', (flag, code) => {
    expect(day({ exceptionFlags: [flag] }).exceptions).toContain(code);
  });

  const modifiers: Array<[AttendanceExceptionFlag, AttendanceModifier]> = [
    ['INSUFFICIENT_PRESENCE_SPAN', 'INSUFFICIENT_PRESENCE'],
    ['INSUFFICIENT_EFFECTIVE_WORK', 'INSUFFICIENT_EFFECTIVE_WORK'],
    ['BREAK_EXCEEDS_ALLOWANCE', 'BREAK_EXCEEDS_ALLOWANCE'],
    ['CORRECTED_BY_REGULARIZATION', 'REGULARIZED'],
  ];

  it.each(modifiers)('flag %s becomes modifier %s, not an exception', (flag, code) => {
    const d = day({ exceptionFlags: [flag] });
    expect(d.modifiers).toContain(code);
    expect(d.exceptions).toHaveLength(0);
  });

  it('collapses three location flags into one exception', () => {
    const d = day({
      exceptionFlags: [
        'LOCATION_OUTSIDE_GEOFENCE',
        'LOCATION_LOW_ACCURACY',
        'LOCATION_UNAVAILABLE',
      ],
    });
    expect(d.exceptions.filter((e) => e === 'LOCATION_EXCEPTION')).toHaveLength(1);
  });

  // The guarantee that matters most about this table: a flag the mapper has
  // never seen is REPORTED, not silently discarded. Without this an upstream
  // flag added later would vanish from the employee's day.
  it('surfaces an unrecognised flag instead of dropping it', () => {
    const d = day({ exceptionFlags: ['SOME_FUTURE_FLAG' as AttendanceExceptionFlag] });
    expect(d.unmappedSourceFlags).toEqual(['SOME_FUTURE_FLAG']);
    expect(d.sourceFlags).toContain('SOME_FUTURE_FLAG');
  });

  it('classifies every flag into exactly one kind', () => {
    for (const [flag] of [...exceptions, ...modifiers]) {
      expect(classifyFlag(flag).kind).not.toBe('none');
    }
  });
});

describe('the canonical figures', () => {
  it('forwards presence and required from the evaluator, unchanged', () => {
    const d = day({ presenceMinutes: 512, requiredMinutes: 480 });
    expect(d.presenceMinutes).toBe(512);
    expect(d.requiredMinutes).toBe(480);
    // Nothing is listed as unavailable once both figures are present.
    expect(d.unavailable).toHaveLength(0);
  });

  it('forwards the other figures the evaluator owns', () => {
    const d = day({ workedMinutes: 437, breakMinutes: 43, lateMinutes: 7 });
    expect(d.workedMinutes).toBe(437);
    expect(d.breakMinutes).toBe(43);
    expect(d.lateMinutes).toBe(7);
  });

  // The mapper must never substitute a figure the evaluator declined to give.
  it('keeps an unmeasured presence null and says why', () => {
    const d = day({ presenceMinutes: null });
    expect(d.presenceMinutes).toBeNull();
    expect(d.unavailable).toEqual([
      { field: 'presenceMinutes', reason: UNAVAILABLE_REASONS.PRESENCE_NOT_MEASURABLE },
    ]);
  });

  it('keeps an absent requirement null and says why', () => {
    const d = day({ presenceMinutes: null, requiredMinutes: null });
    expect(d.requiredMinutes).toBeNull();
    expect(d.unavailable.map((u) => u.field)).toEqual(['presenceMinutes', 'requiredMinutes']);
    expect(d.unavailable[1].reason).toBe(UNAVAILABLE_REASONS.NO_PRESENCE_REQUIREMENT);
  });

  it('never turns an unmeasured figure into zero', () => {
    const d = day({ presenceMinutes: null, requiredMinutes: null });
    expect(d.presenceMinutes).not.toBe(0);
    expect(d.requiredMinutes).not.toBe(0);
  });

});

describe('presence remaining and presence progress', () => {
  const today = (over = {}) => mapToday({ result: result(over), date: TODAY, companyToday: TODAY });

  it('derives both from presence against the presence requirement', () => {
    const t = today({ presenceMinutes: 430, requiredMinutes: 540 });
    expect(t.presenceRemainingMinutes).toBe(110);
    expect(t.presenceProgressPercent).toBe(80);
    expect(t.unavailable.map((u) => u.field)).not.toContain('presenceRemainingMinutes');
  });

  // THE ARITHMETIC THAT MUST NOT APPEAR. The requirement is a presence span;
  // worked minutes are effective work with breaks removed. On this fixture
  // 540 - 480 would claim 60 minutes still owed by somebody who was present
  // 570 minutes — longer than required.
  it('never derives remaining from effective worked minutes', () => {
    const t = today({ presenceMinutes: 570, requiredMinutes: 540, workedMinutes: 480 });
    expect(t.presenceRemainingMinutes).not.toBe(60);
    // Present longer than required leaves nothing owed.
    expect(t.presenceRemainingMinutes).toBe(0);
  });

  it('reports presence beyond the requirement as over 100 per cent', () => {
    // Not clamped: exceeding the requirement is a real fact, and flattening it
    // to 100 would hide it. The BAR width is clamped where it is drawn.
    expect(today({ presenceMinutes: 570, requiredMinutes: 540 }).presenceProgressPercent).toBe(106);
  });

  it('withholds both when presence is not measurable', () => {
    const t = today({ presenceMinutes: null, requiredMinutes: 540 });
    expect(t.presenceRemainingMinutes).toBeNull();
    expect(t.presenceProgressPercent).toBeNull();
    const reasons = t.unavailable
      .filter((u) => u.field.startsWith('presence') && u.field !== 'presenceMinutes')
      .map((u) => u.reason);
    expect(reasons).toEqual([
      UNAVAILABLE_REASONS.PRESENCE_DERIVATION_UNAVAILABLE,
      UNAVAILABLE_REASONS.PRESENCE_DERIVATION_UNAVAILABLE,
    ]);
  });

  it('withholds both when no presence requirement applies', () => {
    const t = today({ presenceMinutes: null, requiredMinutes: null });
    expect(t.presenceRemainingMinutes).toBeNull();
    expect(t.presenceProgressPercent).toBeNull();
  });

  it('treats a zero requirement as no requirement rather than dividing by it', () => {
    const t = today({ presenceMinutes: 300, requiredMinutes: 0 });
    expect(t.presenceProgressPercent).toBeNull();
    expect(t.presenceRemainingMinutes).toBeNull();
  });

  it('withholds both on an open day, where presence has no right edge', () => {
    const t = today({
      presenceMinutes: null,
      requiredMinutes: 540,
      exceptionFlags: ['WORKDAY_STILL_OPEN'],
    });
    expect(t.isInProgress).toBe(true);
    expect(t.presenceRemainingMinutes).toBeNull();
    expect(t.presenceProgressPercent).toBeNull();
  });
});

describe('a future date', () => {
  // Document 1 §4: no row means no outcome. A future cell must be blank, and
  // must never read as absent or as zero hours.
  it('has no outcome, no figures and no state', () => {
    const d = mapDay({ result: null, date: '2026-10-20', companyToday: TODAY });
    expect(d.isFuture).toBe(true);
    expect(d.outcome).toBeNull();
    expect(d.evaluationState).toBeNull();
    expect(d.workedMinutes).toBeNull();
    expect(d.isApplicable).toBe(false);
    expect(d.unavailable[0].reason).toBe(UNAVAILABLE_REASONS.FUTURE_DATE);
  });

  it('is not evaluated even when a result is supplied', () => {
    const d = mapDay({ result: result(), date: '2026-10-20', companyToday: TODAY });
    expect(d.outcome).toBeNull();
  });
});

describe('a day with no official result', () => {
  it('reports no outcome but keeps the evaluator reason', () => {
    const d = mapDay({
      result: result({
        official: false,
        status: null,
        calculationReason: 'NOT_APPLICABLE_EXEMPT' as AttendanceCalculationReason,
      }),
      date: '2026-10-05',
      companyToday: TODAY,
    });
    expect(d.outcome).toBeNull();
    expect(d.isApplicable).toBe(false);
    expect(d.reason).toBe('NOT_APPLICABLE_EXEMPT');
    expect(d.unavailable[0].reason).toBe(UNAVAILABLE_REASONS.NO_OFFICIAL_RESULT);
  });

  it('does not blame the employee for a configuration gap', () => {
    const t = mapToday({
      result: result({
        status: 'MISSING_PUNCH' as any,
        evaluationState: 'NEEDS_REVIEW',
        exceptionFlags: ['PARTIALLY_FUNDED_LEAVE'],
        calculationReason: 'CONTEXT_BLOCKED' as AttendanceCalculationReason,
      }),
      date: TODAY,
      companyToday: TODAY,
    });
    expect(t.exceptions).toContain('POLICY_UNRESOLVED');
    expect(t.banner?.detail).toContain('No action is required from you');
  });
});

describe('an open day is never judged', () => {
  const open = { exceptionFlags: ['WORKDAY_STILL_OPEN'] as AttendanceExceptionFlag[] };

  it('is IN_PROGRESS whatever the closed-day classification would be', () => {
    expect(day({ ...open, status: 'ABSENT' as any }).outcome).toBe('IN_PROGRESS');
    expect(day({ ...open, status: 'PRESENT' as any }).isInProgress).toBe(true);
  });

  it('withholds shortfall modifiers', () => {
    const d = day({
      exceptionFlags: [
        'WORKDAY_STILL_OPEN',
        'INSUFFICIENT_PRESENCE_SPAN',
        'INSUFFICIENT_EFFECTIVE_WORK',
        'BREAK_EXCEEDS_ALLOWANCE',
      ],
    });
    expect(d.modifiers).not.toContain('INSUFFICIENT_PRESENCE');
    expect(d.modifiers).not.toContain('INSUFFICIENT_EFFECTIVE_WORK');
    expect(d.modifiers).not.toContain('BREAK_EXCEEDS_ALLOWANCE');
  });

  it('withholds MISSING_OUT, because the day has not ended', () => {
    const d = day({ exceptionFlags: ['WORKDAY_STILL_OPEN', 'MISSING_PUNCH_OUT'] });
    expect(d.exceptions).not.toContain('MISSING_OUT');
  });

  it('still reports LATE, because the arrival already happened', () => {
    expect(day({ ...open, status: 'LATE' as any, lateMinutes: 20 }).modifiers).toContain('LATE');
  });

  it('offers no correction action and no final status', () => {
    const t = mapToday({ result: result(open), date: TODAY, companyToday: TODAY });
    expect(t.finalStatusAvailable).toBe(false);
    expect(t.banner?.title).toBe('Workday still open');
  });
});

describe('calendar days', () => {
  it('keeps the calendar fact and records the work separately', () => {
    const holiday = mapDay({
      result: result({ status: 'HOLIDAY' as any }),
      date: '2026-10-02',
      companyToday: TODAY,
      hasWorkEvidence: true,
    });
    expect(holiday.outcome).toBe('HOLIDAY');
    expect(holiday.modifiers).toContain('WORKED_ON_HOLIDAY');

    const weeklyOff = mapDay({
      result: result({ status: 'WEEKLY_OFF' as any }),
      date: '2026-10-04',
      companyToday: TODAY,
      hasWorkEvidence: true,
    });
    expect(weeklyOff.outcome).toBe('WEEKLY_OFF');
    expect(weeklyOff.modifiers).toContain('WORKED_ON_WEEKLY_OFF');
  });

  it('adds no work modifier when there was no work', () => {
    const d = mapDay({
      result: result({ status: 'HOLIDAY' as any }),
      date: '2026-10-02',
      companyToday: TODAY,
      hasWorkEvidence: false,
    });
    expect(d.modifiers).not.toContain('WORKED_ON_HOLIDAY');
  });

  it('marks an auto-closed day as such without changing the outcome', () => {
    const d = mapDay({
      result: result({ exceptionFlags: ['MISSING_PUNCH_OUT'] }),
      date: '2026-10-05',
      companyToday: TODAY,
      anySessionAutoClosed: true,
    });
    expect(d.outcome).toBe('PRESENT');
    expect(d.modifiers).toContain('AUTO_CLOSED');
    expect(d.exceptions).toContain('MISSING_OUT');
  });
});

describe('evaluation state is forwarded, not re-decided', () => {
  it.each(['CALCULATED', 'NEEDS_REVIEW', 'FINALIZED'] as const)('%s passes through', (state) => {
    expect(day({ evaluationState: state }).evaluationState).toBe(state);
  });

  it('does not upgrade CALCULATED to NEEDS_REVIEW on its own', () => {
    // The derivation rule is the evaluator's. If the mapper applied it too, the
    // two would eventually disagree about the same day.
    const d = day({ evaluationState: 'CALCULATED', exceptionFlags: ['PHOTO_MISSING'] });
    expect(d.exceptions).toContain('PHOTO_EXCEPTION');
    expect(d.evaluationState).toBe('CALCULATED');
  });
});

describe('month enumeration', () => {
  it('covers a 31-day month', () => {
    const d = datesInMonth('2026-10');
    expect(d).toHaveLength(31);
    expect(d[0]).toBe('2026-10-01');
    expect(d[30]).toBe('2026-10-31');
  });

  it('covers a 28-day February and a leap February', () => {
    expect(datesInMonth('2026-02')).toHaveLength(28);
    expect(datesInMonth('2028-02')).toHaveLength(29);
  });

  it('returns nothing for an unparseable month rather than guessing', () => {
    expect(datesInMonth('not-a-month')).toEqual([]);
  });
});

describe('the explanation is backend-authored', () => {
  it('gives a sentence for every evaluator reason it knows', () => {
    const reasons: AttendanceCalculationReason[] = [
      'HOLIDAY',
      'WEEKLY_OFF',
      'APPROVED_PAID_LEAVE',
      'COMPLETE_WORKDAY',
      'WORKDAY_IN_PROGRESS',
      'NO_EVIDENCE_ON_WORKING_DAY',
      'POLICY_DECISION_DEFERRED',
      'CORRECTED_WORKDAY',
      'CONTEXT_BLOCKED',
    ];
    for (const reason of reasons) {
      expect(day({ calculationReason: reason })?.explanation).toBeTruthy();
    }
  });

  it('falls back to an unresolved sentence rather than returning nothing', () => {
    const d = day({
      status: 'MISSING_PUNCH' as any,
      calculationReason: 'UNKNOWN_REASON' as AttendanceCalculationReason,
    });
    expect(d.outcome).toBe('UNRESOLVED');
    expect(d.explanation).toContain('needs a review');
  });
});
