import { DailyAttendanceEvaluatorService } from '../../src/modules/platform/attendance/evaluation/daily-attendance-evaluator.service';
import { LeaveFactsService } from '../../src/modules/platform/attendance/evaluation/leave-facts.service';
import { TVAService } from '../../src/common/services/tva.service';
import { ConfigService } from '@nestjs/config';

// AE-1. Real TVAService and a real LeaveFactsService, so leave-window matching
// and company-time arithmetic are genuinely exercised. Prisma and the BL-5
// context resolver are mocked. No database.

const DATE = '2026-08-20'; // a Thursday
const ist = (hhmm: string) => new Date(`${DATE}T${hhmm}:00.000+05:30`);

const BASE_SOURCES = {
  assignedHolidayCalendarId: 'hc-1',
  assignedWeeklyOffPolicyId: 'wo-1',
  assignedAttendanceLocationId: null,
  resolvedHolidayCalendarId: 'hc-1',
  resolvedWeeklyOffPolicyId: 'wo-1',
  holidayCalendarResolution: 'ASSIGNED',
  weeklyOffPolicyResolution: 'ASSIGNED',
  weeklyOffPolicyId: 'wo-1',
  holidayCalendarId: 'hc-1',
  holidayId: null,
  businessDayOverrideId: null,
  employeeProfileId: 'prof-1',
  shiftPolicyId: 'shift-1',
  shiftPolicyVersion: 2,
  attendancePolicyId: 'ap-1',
  attendancePolicyVersion: 3,
  leavePolicyId: 'lp-1',
  leavePolicyVersion: 1,
};

// Shift starts 10:00 with 30 minutes grace, so "late" means after 10:30 —
// the exact rule management has not yet decided the consequence for.
const BASE_SHIFT = {
  policyId: 'shift-1',
  policyKey: 'shift-regular',
  version: 2,
  name: 'Regular',
  category: 'REGULAR_EMPLOYEE',
  startTime: '10:00',
  endTime: '19:00',
  graceMinutes: 30,
  minimumWorkingMinutes: 540,
};

const BASE_POLICY = {
  policyId: 'ap-1',
  policyKey: 'ap-regular',
  version: 3,
  minimumWorkingMinutes: 540,
  lateExemptionEnabled: false,
  regularizationEnabled: true,
  geoFenceEnabled: false,
  // Both default to REQUIRE_REVIEW in the schema: undecided means ask a human.
  afterPunchWindowAction: 'REQUIRE_REVIEW',
  insufficientHoursAction: 'REQUIRE_REVIEW',
  automaticHalfDayEnabled: false,
};

function context(overrides: any = {}) {
  return {
    employeeId: 'emp-1',
    businessDate: DATE,
    employment: { isEmployed: true },
    coverage: 'COVERED',
    coverageReason: 'PROFILE_COVERS_DATE',
    calendar: {
      businessDate: DATE,
      dayOfWeek: 4,
      weekdayOrdinal: 3,
      weeklyOff: { isWeeklyOff: false, reasons: [], policyId: 'wo-1' },
      holiday: { isHoliday: false, holidayId: null, calendarId: 'hc-1', name: null, optional: false },
      override: null,
      expectedCompanyWorkingDay: true,
      resolution: { holidayCalendar: 'ASSIGNED', weeklyOffPolicy: 'ASSIGNED' },
      sources: {},
      ...(overrides.calendar ?? {}),
    },
    profile: { profileId: 'prof-1', category: 'REGULAR_EMPLOYEE', effectiveFrom: '2026-01-01', effectiveTo: null },
    shift: { ...BASE_SHIFT, ...(overrides.shift ?? {}) },
    attendancePolicy: overrides.attendancePolicy === null
      ? null
      : { ...BASE_POLICY, ...(overrides.attendancePolicy ?? {}) },
    leavePolicy: { policyId: 'lp-1', policyKey: 'lp', version: 1 },
    contextResolved: true,
    attendanceApplicability: 'REQUIRED',
    requiresHrReview: false,
    blockingReasons: [],
    sources: { ...BASE_SOURCES, ...(overrides.sources ?? {}) },
    resolverVersion: 1,
    resolvedAt: new Date().toISOString(),
    ...(overrides.top ?? {}),
  };
}

/**
 * A complete, unremarkable working day: in at 10:00, out at 19:30, half an hour
 * of break, leaving a full 540 working minutes. The span is deliberately longer
 * than the 9-hour minimum so that meeting the requirement does not depend on
 * how breaks are treated.
 */
const COMPLETE_SESSION = {
  id: 'ws-1',
  userId: 'emp-1',
  startWorkAt: ist('10:00'),
  logoutAt: ist('19:30'),
  status: 'LOGGED_OUT',
  totalWorkMinutes: 540,
  totalBreakMinutes: 30,
};

const punch = (type: string, at: Date, extra: any = {}) => ({
  id: `ev-${type}`,
  userId: 'emp-1',
  type,
  serverOccurredAt: at,
  locationVerification: 'NOT_ENFORCED',
  photoVerification: 'CAPTURED',
  ...extra,
});

interface RigOptions {
  ctx?: any;
  leaves?: any[];
  evidence?: any[];
  sessions?: any[];
  existingRecord?: any;
  correction?: any;
}

function rig(opts: RigOptions = {}) {
  const prisma: any = {
    leaveRequest: {
      findMany: jest.fn().mockResolvedValue(opts.leaves ?? []),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    attendancePunchEvidence: {
      findMany: jest.fn().mockResolvedValue(opts.evidence ?? []),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    workSession: {
      findMany: jest.fn().mockResolvedValue(opts.sessions ?? []),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    // AR-1 added an approved-correction lookup to the evaluator. Null here, so
    // every AE-1 case below describes an UNCORRECTED day, exactly as before.
    attendanceRegularization: {
      findFirst: jest.fn().mockResolvedValue(opts.correction ?? null),
    },
    dailyAttendance: {
      findUnique: jest.fn().mockResolvedValue(opts.existingRecord ?? null),
      upsert: jest.fn(({ create, update }: any) =>
        Promise.resolve({ id: 'da-1', ...(create ?? update) }),
      ),
    },
    user: { update: jest.fn() },
  };

  const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);
  const dailyContext = {
    resolveDailyContext: jest.fn().mockResolvedValue(opts.ctx ?? context()),
  };
  const leaveFacts = new LeaveFactsService(prisma, tva);
  const service = new DailyAttendanceEvaluatorService(
    prisma,
    tva,
    dailyContext as any,
    leaveFacts,
  );

  return { service, prisma, dailyContext, tva };
}

describe('AE-1 working days', () => {
  it('1. a covered complete workday is PRESENT', async () => {
    const { service } = rig({
      evidence: [punch('PUNCH_IN', ist('10:00')), punch('PUNCH_OUT', ist('19:30'))],
      sessions: [COMPLETE_SESSION],
    });

    const r = await service.evaluate('emp-1', DATE);

    expect(r.official).toBe(true);
    expect(r.status).toBe('PRESENT');
    expect(r.evaluationState).toBe('CALCULATED');
    expect(r.calculationReason).toBe('COMPLETE_WORKDAY');
    expect(r.exceptionFlags).toEqual([]);
    expect(r.requiresReview).toBe(false);
  });

  it('2. a holiday is HOLIDAY', async () => {
    const { service } = rig({
      ctx: context({
        calendar: {
          expectedCompanyWorkingDay: false,
          holiday: { isHoliday: true, holidayId: 'hol-1', calendarId: 'hc-1', name: 'Independence Day', optional: false },
        },
        sources: { holidayId: 'hol-1' },
      }),
    });

    const r = await service.evaluate('emp-1', DATE);

    expect(r.status).toBe('HOLIDAY');
    expect(r.calculationReason).toBe('HOLIDAY');
    expect(r.provenance.holidayId).toBe('hol-1');
  });

  it('3. a weekly off is WEEKLY_OFF', async () => {
    const { service } = rig({
      ctx: context({
        calendar: {
          expectedCompanyWorkingDay: false,
          weeklyOff: { isWeeklyOff: true, reasons: ['EVERY_SUNDAY'], policyId: 'wo-1' },
        },
      }),
    });

    const r = await service.evaluate('emp-1', DATE);

    expect(r.status).toBe('WEEKLY_OFF');
    expect(r.calculationReason).toBe('WEEKLY_OFF');
  });

  it('4. a SPECIAL_WORKING_DAY override is evaluated as a working day', async () => {
    const { service } = rig({
      ctx: context({
        calendar: {
          // The override is what makes an otherwise-off day expected.
          expectedCompanyWorkingDay: true,
          weeklyOff: { isWeeklyOff: true, reasons: ['EVERY_SUNDAY'], policyId: 'wo-1' },
          override: { id: 'ov-1', type: 'SPECIAL_WORKING_DAY', reason: 'Release weekend', approvedById: 'u-1' },
        },
        sources: { businessDayOverrideId: 'ov-1' },
      }),
      evidence: [punch('PUNCH_IN', ist('10:00')), punch('PUNCH_OUT', ist('19:30'))],
      sessions: [COMPLETE_SESSION],
    });

    const r = await service.evaluate('emp-1', DATE);

    expect(r.status).toBe('PRESENT');
    expect(r.calculationReason).toBe('SPECIAL_WORKING_DAY_WORKED');
    expect(r.provenance.businessDayOverrideId).toBe('ov-1');
  });

  it('5. a company closure is HOLIDAY with a closure reason', async () => {
    const { service } = rig({
      ctx: context({
        calendar: {
          expectedCompanyWorkingDay: false,
          override: { id: 'ov-2', type: 'COMPANY_CLOSURE', reason: 'Office shutdown', approvedById: 'u-1' },
        },
      }),
    });

    const r = await service.evaluate('emp-1', DATE);
    expect(r.status).toBe('HOLIDAY');
    expect(r.calculationReason).toBe('COMPANY_CLOSURE');
  });
});

describe('AE-1 leave integration', () => {
  const approved = (extra: any = {}) => ({
    id: 'lv-1',
    userId: 'emp-1',
    type: 'ANNUAL',
    status: 'APPROVED',
    startDate: ist('09:30'),
    endDate: ist('18:00'),
    isHalfDay: false,
    halfDayType: null,
    createdAt: new Date('2026-08-01'),
    ...extra,
  });

  it('6. fully approved paid leave is LEAVE', async () => {
    const { service } = rig({ leaves: [approved()] });

    const r = await service.evaluate('emp-1', DATE);

    expect(r.status).toBe('LEAVE');
    expect(r.calculationReason).toBe('APPROVED_PAID_LEAVE');
    expect(r.leaveDeducted).toBe(1);
    expect(r.lwpDeducted).toBe(0);
    expect(r.provenance.leaveRequestId).toBe('lv-1');
  });

  it('7. pending leave is ignored', async () => {
    // The rig returns rows only for the APPROVED query; a PENDING row simply
    // does not match, so the day falls through to the punch path.
    const { service, prisma } = rig({ leaves: [], sessions: [], evidence: [] });

    const r = await service.evaluate('emp-1', DATE);

    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'APPROVED' }) }),
    );
    expect(r.status).not.toBe('LEAVE');
  });

  it('8. only APPROVED status is ever queried, so rejected leave cannot apply', async () => {
    const { service, prisma } = rig();
    await service.evaluate('emp-1', DATE);

    const where = prisma.leaveRequest.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('APPROVED');
    // Not an "in" list that could quietly grow to include PENDING/REJECTED.
    expect(typeof where.status).toBe('string');
  });

  it('9. LWP is produced only when the leave record itself proves it', async () => {
    const unpaid = rig({ leaves: [approved({ type: 'UNPAID' })] });
    const r1 = await unpaid.service.evaluate('emp-1', DATE);
    expect(r1.status).toBe('LWP');
    expect(r1.lwpDeducted).toBe(1);
    expect(r1.leaveDeducted).toBe(0);

    // An ordinary approved leave never becomes LWP, whatever a balance might
    // say — no balance is consulted at all.
    const paid = rig({ leaves: [approved()] });
    const r2 = await paid.service.evaluate('emp-1', DATE);
    expect(r2.status).toBe('LEAVE');
    expect(r2.lwpDeducted).toBe(0);
  });

  it('10. an approved half-day leave is HALF_DAY even with automatic half-day off', async () => {
    const { service } = rig({ leaves: [approved({ isHalfDay: true, halfDayType: 'FIRST_HALF' })] });

    const r = await service.evaluate('emp-1', DATE);

    // Proven by an approval, not manufactured from a threshold.
    expect(r.status).toBe('HALF_DAY');
    expect(r.leaveDeducted).toBe(0.5);
  });

  it('11. approved leave on a non-working day deducts nothing', async () => {
    const { service } = rig({
      ctx: context({
        calendar: {
          expectedCompanyWorkingDay: false,
          holiday: { isHoliday: true, holidayId: 'hol-1', calendarId: 'hc-1', name: 'Diwali', optional: false },
        },
      }),
      leaves: [approved()],
    });

    const r = await service.evaluate('emp-1', DATE);

    expect(r.status).toBe('HOLIDAY');
    expect(r.leaveDeducted).toBe(0);
    expect(r.lwpDeducted).toBe(0);
    expect(r.exceptionFlags).toContain('LEAVE_ON_NON_WORKING_DAY');
  });

  it('12. two approved leaves covering one date go to review, not a guess', async () => {
    const { service } = rig({
      leaves: [approved(), approved({ id: 'lv-2' })],
      evidence: [punch('PUNCH_IN', ist('10:00')), punch('PUNCH_OUT', ist('19:30'))],
      sessions: [COMPLETE_SESSION],
    });

    const r = await service.evaluate('emp-1', DATE);

    expect(r.exceptionFlags).toContain('AMBIGUOUS_APPROVED_LEAVE');
    expect(r.evaluationState).toBe('NEEDS_REVIEW');
    // The day worked is not thrown away just because the leave data is messy.
    expect(r.status).toBe('PRESENT');
    expect(r.leaveDeducted).toBe(0);
  });
});

describe('AE-1 missing evidence', () => {
  it('13. a working day with no punch and no leave needs review, not ABSENT', async () => {
    const { service } = rig({ evidence: [], sessions: [] });

    const r = await service.evaluate('emp-1', DATE);

    expect(r.status).toBe('MISSING_PUNCH');
    expect(r.status).not.toBe('ABSENT');
    expect(r.evaluationState).toBe('NEEDS_REVIEW');
    expect(r.calculationReason).toBe('NO_EVIDENCE_ON_WORKING_DAY');
    expect(r.exceptionFlags).toContain('NO_ATTENDANCE_EVIDENCE');
    expect(r.leaveDeducted).toBe(0);
    expect(r.lwpDeducted).toBe(0);
  });

  it('14. a punch in with no punch out needs review and fabricates no end time', async () => {
    const { service } = rig({
      evidence: [punch('PUNCH_IN', ist('10:00'))],
      sessions: [{ ...COMPLETE_SESSION, logoutAt: ist('23:59'), status: 'AUTO_CLOSED' }],
    });

    const r = await service.evaluate('emp-1', DATE);

    expect(r.status).toBe('MISSING_PUNCH');
    expect(r.evaluationState).toBe('NEEDS_REVIEW');
    expect(r.calculationReason).toBe('INCOMPLETE_PUNCH_PAIR');
    expect(r.exceptionFlags).toContain('MISSING_PUNCH_OUT');
    expect(r.punchOutAt).toBeNull();
  });

  it('15. a still-open workday is provisional, never finalized', async () => {
    const { service } = rig({
      evidence: [punch('PUNCH_IN', ist('10:00'))],
      sessions: [{ ...COMPLETE_SESSION, logoutAt: null, status: 'WORKING' }],
    });

    const r = await service.evaluate('emp-1', DATE);

    expect(r.calculationReason).toBe('WORKDAY_IN_PROGRESS');
    expect(r.exceptionFlags).toContain('WORKDAY_STILL_OPEN');
    expect(r.evaluationState).not.toBe('FINALIZED');
    expect(r.punchOutAt).toBeNull();
  });
});

describe('AE-1 location and photo exceptions', () => {
  const withVerification = (v: string) =>
    rig({
      evidence: [
        punch('PUNCH_IN', ist('10:00'), { locationVerification: v }),
        punch('PUNCH_OUT', ist('19:00'), { locationVerification: v }),
      ],
      sessions: [COMPLETE_SESSION],
    });

  it('16. OUTSIDE_GEOFENCE is an exception, never automatic absence', async () => {
    const r = await withVerification('OUTSIDE_GEOFENCE').service.evaluate('emp-1', DATE);

    expect(r.exceptionFlags).toContain('LOCATION_OUTSIDE_GEOFENCE');
    expect(r.evaluationState).toBe('NEEDS_REVIEW');
    expect(r.status).toBe('PRESENT');
    expect(r.status).not.toBe('ABSENT');
    expect(r.lwpDeducted).toBe(0);
    expect(r.leaveDeducted).toBe(0);
  });

  it('17. LOW_ACCURACY is an exception', async () => {
    const r = await withVerification('LOW_ACCURACY').service.evaluate('emp-1', DATE);

    expect(r.exceptionFlags).toContain('LOCATION_LOW_ACCURACY');
    expect(r.evaluationState).toBe('NEEDS_REVIEW');
    expect(r.status).toBe('PRESENT');
  });

  it('18. NOT_ENFORCED creates no location exception', async () => {
    const r = await withVerification('NOT_ENFORCED').service.evaluate('emp-1', DATE);

    expect(r.exceptionFlags.filter((f) => f.startsWith('LOCATION_'))).toEqual([]);
    expect(r.evaluationState).toBe('CALCULATED');
    expect(r.status).toBe('PRESENT');
  });

  it('19. VERIFIED creates no location exception either', async () => {
    const r = await withVerification('VERIFIED').service.evaluate('emp-1', DATE);
    expect(r.exceptionFlags.filter((f) => f.startsWith('LOCATION_'))).toEqual([]);
  });

  it('20. a punch without a captured photo is flagged', async () => {
    const { service } = rig({
      evidence: [
        punch('PUNCH_IN', ist('10:00'), { photoVerification: 'MISSING' }),
        punch('PUNCH_OUT', ist('19:30')),
      ],
      sessions: [COMPLETE_SESSION],
    });

    const r = await service.evaluate('emp-1', DATE);
    expect(r.exceptionFlags).toContain('PHOTO_MISSING');
    expect(r.status).toBe('PRESENT');
  });
});

describe('AE-1 undecided policy rules', () => {
  it('21. a punch after the grace window defers to review, not a penalty', async () => {
    const { service } = rig({
      evidence: [punch('PUNCH_IN', ist('11:15')), punch('PUNCH_OUT', ist('20:00'))],
      sessions: [COMPLETE_SESSION],
    });

    const r = await service.evaluate('emp-1', DATE);

    expect(r.lateMinutes).toBe(45); // 11:15 against a 10:30 cutoff
    expect(r.exceptionFlags).toContain('LATE_BEYOND_PUNCH_WINDOW');
    expect(r.evaluationState).toBe('NEEDS_REVIEW');
    expect(r.calculationReason).toBe('POLICY_DECISION_DEFERRED');
    expect(['LATE', 'LATE_EXEMPTED']).toContain(r.status);
    expect(r.leaveDeducted).toBe(0);
    expect(r.lwpDeducted).toBe(0);
  });

  it('22. arriving within the grace window is not late', async () => {
    const { service } = rig({
      evidence: [punch('PUNCH_IN', ist('10:29')), punch('PUNCH_OUT', ist('19:30'))],
      sessions: [COMPLETE_SESSION],
    });

    const r = await service.evaluate('emp-1', DATE);

    expect(r.lateMinutes).toBe(0);
    expect(r.exceptionFlags).not.toContain('LATE_BEYOND_PUNCH_WINDOW');
    expect(r.status).toBe('PRESENT');
  });

  it('23. a short PRESENCE SPAN with REQUIRE_REVIEW defers to review', async () => {
    const { service } = rig({
      evidence: [punch('PUNCH_IN', ist('10:00')), punch('PUNCH_OUT', ist('15:00'))],
      sessions: [{ ...COMPLETE_SESSION, logoutAt: ist('15:00'), totalWorkMinutes: 270 }],
    });

    const r = await service.evaluate('emp-1', DATE);

    expect(r.exceptionFlags).toContain('INSUFFICIENT_PRESENCE_SPAN');
    expect(r.evaluationState).toBe('NEEDS_REVIEW');
    expect(r.status).not.toBe('HALF_DAY');
    expect(r.status).not.toBe('ABSENT');
    expect(r.leaveDeducted).toBe(0);
  });

  it('24. automaticHalfDayEnabled=false never manufactures a HALF_DAY', async () => {
    // Even with management explicitly configuring MARK_HALF_DAY, the automatic
    // half-day switch is off, so the day must go to review instead.
    const { service } = rig({
      ctx: context({
        attendancePolicy: { insufficientHoursAction: 'MARK_HALF_DAY', automaticHalfDayEnabled: false },
      }),
      evidence: [punch('PUNCH_IN', ist('10:00')), punch('PUNCH_OUT', ist('15:00'))],
      sessions: [{ ...COMPLETE_SESSION, logoutAt: ist('15:00'), totalWorkMinutes: 270 }],
    });

    const r = await service.evaluate('emp-1', DATE);

    expect(r.status).not.toBe('HALF_DAY');
    expect(r.evaluationState).toBe('NEEDS_REVIEW');
  });

  it('25. with automatic half-day enabled the configured action is honoured', async () => {
    const { service } = rig({
      ctx: context({
        attendancePolicy: { insufficientHoursAction: 'MARK_HALF_DAY', automaticHalfDayEnabled: true },
      }),
      evidence: [punch('PUNCH_IN', ist('10:00')), punch('PUNCH_OUT', ist('15:00'))],
      sessions: [{ ...COMPLETE_SESSION, logoutAt: ist('15:00'), totalWorkMinutes: 270 }],
    });

    const r = await service.evaluate('emp-1', DATE);
    expect(r.status).toBe('HALF_DAY');
  });

  it('26. a paid-leave deduction action is deferred, never executed here', async () => {
    const { service, prisma } = rig({
      ctx: context({
        attendancePolicy: { insufficientHoursAction: 'DEDUCT_FULL_PAID_LEAVE' },
      }),
      evidence: [punch('PUNCH_IN', ist('10:00')), punch('PUNCH_OUT', ist('15:00'))],
      sessions: [{ ...COMPLETE_SESSION, logoutAt: ist('15:00'), totalWorkMinutes: 270 }],
    });

    const r = await service.evaluate('emp-1', DATE);

    // Recognised, but writing to a leave balance is payroll territory.
    expect(r.evaluationState).toBe('NEEDS_REVIEW');
    expect(r.leaveDeducted).toBe(0);
    expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
  });
});

describe('AE-1 applicability gate', () => {
  const skipped = async (applicability: string, extra: any = {}) => {
    const { service, prisma } = rig({
      ctx: context({ top: { attendanceApplicability: applicability, ...extra } }),
    });
    const r = await service.evaluate('emp-1', DATE);
    return { r, prisma, service };
  };

  it('27. an EXEMPT employee gets no official classification', async () => {
    const { r } = await skipped('EXEMPT');
    expect(r.official).toBe(false);
    expect(r.status).toBeNull();
    expect(r.calculationReason).toBe('NOT_APPLICABLE_EXEMPT');
  });

  it('28. a NOT_EMPLOYED date gets no official classification', async () => {
    const { r } = await skipped('NOT_EMPLOYED');
    expect(r.official).toBe(false);
    expect(r.status).toBeNull();
    expect(r.calculationReason).toBe('NOT_APPLICABLE_NOT_EMPLOYED');
  });

  it('29. a BLOCKED context produces no classification and is never persisted', async () => {
    const { service, prisma } = rig({
      ctx: context({
        top: {
          attendanceApplicability: 'BLOCKED',
          contextResolved: false,
          blockingReasons: ['MISSING_SHIFT_ASSIGNMENT'],
        },
      }),
    });

    const out = await service.evaluateAndPersist('emp-1', DATE);

    expect(out.result.official).toBe(false);
    expect(out.result.status).toBeNull();
    expect(out.result.calculationReason).toBe('CONTEXT_BLOCKED');
    expect(out.result.requiresReview).toBe(true);
    expect(out.persisted).toBe(false);
    expect(prisma.dailyAttendance.upsert).not.toHaveBeenCalled();
  });
});

describe('AE-1 persistence, provenance and safety', () => {
  const completeDay = () => ({
    evidence: [punch('PUNCH_IN', ist('10:00')), punch('PUNCH_OUT', ist('19:30'))],
    sessions: [COMPLETE_SESSION],
  });

  it('30. repeated evaluation with identical facts writes once', async () => {
    const first = rig(completeDay());
    const written = await first.service.evaluateAndPersist('emp-1', DATE);
    expect(written.persisted).toBe(true);
    expect(first.prisma.dailyAttendance.upsert).toHaveBeenCalledTimes(1);

    // Second pass, same facts, with the row now present.
    const second = rig({
      ...completeDay(),
      existingRecord: {
        id: 'da-1',
        locked: false,
        evaluationState: 'CALCULATED',
        sourceFingerprint: written.result.sourceFingerprint,
      },
    });
    const again = await second.service.evaluateAndPersist('emp-1', DATE);

    expect(again.persisted).toBe(false);
    expect(again.reason).toBe('UNCHANGED');
    expect(second.prisma.dailyAttendance.upsert).not.toHaveBeenCalled();
  });

  it('31. changed source facts produce a controlled update, not a duplicate', async () => {
    const { service, prisma } = rig({
      ...completeDay(),
      existingRecord: {
        id: 'da-1',
        locked: false,
        evaluationState: 'CALCULATED',
        sourceFingerprint: 'a-stale-digest',
      },
    });

    const out = await service.evaluateAndPersist('emp-1', DATE);

    expect(out.persisted).toBe(true);
    // upsert on the unique (userId, date) key: one row, updated in place.
    expect(prisma.dailyAttendance.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.dailyAttendance.upsert.mock.calls[0][0].where).toEqual({
      userId_date: expect.objectContaining({ userId: 'emp-1' }),
    });
  });

  it('32. a locked or finalized day is never recalculated over', async () => {
    for (const existing of [
      { id: 'da-1', locked: true, evaluationState: 'CALCULATED', sourceFingerprint: 'x' },
      { id: 'da-1', locked: false, evaluationState: 'FINALIZED', sourceFingerprint: 'x' },
    ]) {
      const { service, prisma } = rig({ ...completeDay(), existingRecord: existing });
      const out = await service.evaluateAndPersist('emp-1', DATE);

      expect(out.persisted).toBe(false);
      expect(out.reason).toBe('LOCKED');
      expect(prisma.dailyAttendance.upsert).not.toHaveBeenCalled();
    }
  });

  it('33. full source provenance is retained on the result and the row', async () => {
    const { service, prisma } = rig(completeDay());
    const out = await service.evaluateAndPersist('emp-1', DATE);

    expect(out.result.provenance).toMatchObject({
      resolverVersion: 1,
      evaluatorVersion: 1,
      employeeProfileId: 'prof-1',
      attendancePolicyId: 'ap-1',
      attendancePolicyVersion: 3,
      shiftPolicyId: 'shift-1',
      shiftPolicyVersion: 2,
      holidayCalendarId: 'hc-1',
      weeklyOffPolicyId: 'wo-1',
      punchInEvidenceId: 'ev-PUNCH_IN',
      punchOutEvidenceId: 'ev-PUNCH_OUT',
      workSessionIds: ['ws-1'],
    });

    const row = prisma.dailyAttendance.upsert.mock.calls[0][0].create;
    expect(row.attendancePolicyVersion).toBe(3);
    expect(row.shiftPolicyId).toBe('shift-1');
    expect(row.workSessionIds).toEqual(['ws-1']);
    expect(row.evaluatorVersion).toBe(1);
    expect(row.sourceFingerprint).toEqual(expect.any(String));
    expect(row.calculationReason).toBe('COMPLETE_WORKDAY');
  });

  it('34. punch evidence is never updated or deleted', async () => {
    const { service, prisma } = rig(completeDay());
    await service.evaluateAndPersist('emp-1', DATE);

    expect(prisma.attendancePunchEvidence.update).not.toHaveBeenCalled();
    expect(prisma.attendancePunchEvidence.updateMany).not.toHaveBeenCalled();
    expect(prisma.attendancePunchEvidence.delete).not.toHaveBeenCalled();
    expect(prisma.attendancePunchEvidence.deleteMany).not.toHaveBeenCalled();
    expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
  });

  it('35. workday totals are read, not recomputed', async () => {
    // The punch span is 570 minutes (10:00 to 19:30). The session says 540
    // worked and 30 break. Reading 540 proves the evaluator trusts the workday
    // engine's totals instead of re-deriving them from the punch timestamps.
    const { service } = rig(completeDay());
    const r = await service.evaluate('emp-1', DATE);

    expect(r.workedMinutes).toBe(540);
    expect(r.breakMinutes).toBe(30);
    const spanMinutes =
      (ist('19:30').getTime() - ist('10:00').getTime()) / 60_000;
    expect(spanMinutes).toBe(570);
    expect(r.workedMinutes).not.toBe(spanMinutes);
  });

  it('36. no work session or leave record is ever mutated', async () => {
    const { service, prisma } = rig(completeDay());
    await service.evaluateAndPersist('emp-1', DATE);

    expect(prisma.workSession.update).not.toHaveBeenCalled();
    expect(prisma.workSession.updateMany).not.toHaveBeenCalled();
    expect(prisma.workSession.create).not.toHaveBeenCalled();
    expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(prisma.leaveRequest.updateMany).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('37. the fingerprint ignores evaluation time so idempotency holds', async () => {
    const a = rig(completeDay());
    const b = rig(completeDay());

    const r1 = await a.service.evaluate('emp-1', DATE);
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await b.service.evaluate('emp-1', DATE);

    expect(r1.evaluatedAt.getTime()).not.toBe(0);
    expect(r1.sourceFingerprint).toBe(r2.sourceFingerprint);
  });
});
