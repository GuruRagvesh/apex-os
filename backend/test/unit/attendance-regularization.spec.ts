import { RegularizationService, StaleCorrectionError, RegularizationDisabledError } from '../../src/modules/platform/attendance/regularization/regularization.service';
import { RegularizationController } from '../../src/modules/platform/attendance/regularization/regularization.controller';
import { DailyAttendanceEvaluatorService } from '../../src/modules/platform/attendance/evaluation/daily-attendance-evaluator.service';
import { DailyAttendanceController } from '../../src/modules/platform/attendance/evaluation/daily-attendance.controller';
import { LeaveFactsService } from '../../src/modules/platform/attendance/evaluation/leave-facts.service';
import { TVAService } from '../../src/common/services/tva.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

// AR-1. Real TVAService, a real evaluator and a real LeaveFactsService, so a
// corrected day is genuinely re-explained by the ordinary rules. Prisma, the
// BL-5 resolver, the hierarchy and settings are mocked. No database.

const DATE = '2026-08-20';
const DATE_ONLY = new Date(`${DATE}T00:00:00.000Z`);
const ist = (hhmm: string) => new Date(`${DATE}T${hhmm}:00.000+05:30`);
const tvaOf = () => new TVAService({ get: () => undefined } as unknown as ConfigService);

const SHIFT = {
  policyId: 'shift-1', policyKey: 'sk', version: 2, name: 'Regular',
  category: 'REGULAR_EMPLOYEE', startTime: '10:00', endTime: '19:00',
  graceMinutes: 30, minimumWorkingMinutes: 540,
};
const POLICY = {
  policyId: 'ap-1', policyKey: 'apk', version: 3, minimumWorkingMinutes: 540,
  lateExemptionEnabled: false, regularizationEnabled: true, geoFenceEnabled: false,
  afterPunchWindowAction: 'REQUIRE_REVIEW', insufficientHoursAction: 'REQUIRE_REVIEW',
  automaticHalfDayEnabled: false,
};
const SOURCES = {
  assignedHolidayCalendarId: 'hc-1', assignedWeeklyOffPolicyId: 'wo-1',
  assignedAttendanceLocationId: null, resolvedHolidayCalendarId: 'hc-1',
  resolvedWeeklyOffPolicyId: 'wo-1', holidayCalendarResolution: 'ASSIGNED',
  weeklyOffPolicyResolution: 'ASSIGNED', weeklyOffPolicyId: 'wo-1',
  holidayCalendarId: 'hc-1', holidayId: null, businessDayOverrideId: null,
  employeeProfileId: 'prof-1', shiftPolicyId: 'shift-1', shiftPolicyVersion: 2,
  attendancePolicyId: 'ap-1', attendancePolicyVersion: 3, leavePolicyId: 'lp-1',
  leavePolicyVersion: 1,
};

const workingContext = (over: any = {}) => ({
  employeeId: 'emp-1', businessDate: DATE,
  employment: { isEmployed: true },
  coverage: 'COVERED', coverageReason: 'PROFILE_COVERS_DATE',
  calendar: {
    businessDate: DATE, dayOfWeek: 4, weekdayOrdinal: 3,
    weeklyOff: { isWeeklyOff: false, reasons: [], policyId: 'wo-1' },
    holiday: { isHoliday: false, holidayId: null, calendarId: 'hc-1', name: null, optional: false },
    override: null, expectedCompanyWorkingDay: true,
    resolution: { holidayCalendar: 'ASSIGNED', weeklyOffPolicy: 'ASSIGNED' }, sources: {},
  },
  profile: { profileId: 'prof-1', category: 'REGULAR_EMPLOYEE', effectiveFrom: '2026-01-01', effectiveTo: null },
  shift: SHIFT, attendancePolicy: POLICY, leavePolicy: { policyId: 'lp-1', policyKey: 'lp', version: 1 },
  contextResolved: true, attendanceApplicability: 'REQUIRED', requiresHrReview: false,
  blockingReasons: [], sources: SOURCES, resolverVersion: 1, resolvedAt: new Date().toISOString(),
  ...over,
});

const punch = (type: string, at: Date) => ({
  id: `ev-${type}`, userId: 'emp-1', type, serverOccurredAt: at,
  locationVerification: 'NOT_ENFORCED', photoVerification: 'CAPTURED',
});

interface EvalFixtures {
  context?: any;
  evidence?: any[];
  sessions?: any[];
  correction?: any;
  existingRecord?: any;
}

/** Evaluator + a prisma mock that records every write it is asked to make. */
function evaluatorRig(f: EvalFixtures = {}) {
  const writes: any[] = [];
  const raw = {
    punchUpdates: [] as any[],
    sessionUpdates: [] as any[],
    breakUpdates: [] as any[],
  };

  const prisma: any = {
    attendancePunchEvidence: {
      findMany: jest.fn().mockResolvedValue(f.evidence ?? []),
      create: jest.fn((a: any) => { raw.punchUpdates.push(a); return Promise.resolve(a); }),
      update: jest.fn((a: any) => { raw.punchUpdates.push(a); return Promise.resolve(a); }),
      updateMany: jest.fn((a: any) => { raw.punchUpdates.push(a); return Promise.resolve(a); }),
      delete: jest.fn((a: any) => { raw.punchUpdates.push(a); return Promise.resolve(a); }),
      deleteMany: jest.fn((a: any) => { raw.punchUpdates.push(a); return Promise.resolve(a); }),
    },
    workSession: {
      findMany: jest.fn().mockResolvedValue(f.sessions ?? []),
      update: jest.fn((a: any) => { raw.sessionUpdates.push(a); return Promise.resolve(a); }),
      updateMany: jest.fn((a: any) => { raw.sessionUpdates.push(a); return Promise.resolve(a); }),
      create: jest.fn((a: any) => { raw.sessionUpdates.push(a); return Promise.resolve(a); }),
    },
    breakLog: {
      update: jest.fn((a: any) => { raw.breakUpdates.push(a); return Promise.resolve(a); }),
      updateMany: jest.fn((a: any) => { raw.breakUpdates.push(a); return Promise.resolve(a); }),
      create: jest.fn((a: any) => { raw.breakUpdates.push(a); return Promise.resolve(a); }),
    },
    attendanceRegularization: {
      findFirst: jest.fn().mockResolvedValue(f.correction ?? null),
    },
    leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
    dailyAttendance: {
      findUnique: jest.fn().mockResolvedValue(f.existingRecord ?? null),
      upsert: jest.fn((args: any) => {
        writes.push(args);
        return Promise.resolve({ id: 'da-1', ...(args.create ?? args.update) });
      }),
      update: jest.fn((args: any) => {
        writes.push(args);
        return Promise.resolve({ id: 'da-1', ...(f.existingRecord ?? {}), ...args.data });
      }),
    },
  };

  const tva = tvaOf();
  const dailyContext = {
    resolveDailyContext: jest.fn().mockResolvedValue(f.context ?? workingContext()),
  };
  const service = new DailyAttendanceEvaluatorService(
    prisma, tva, dailyContext as any, new LeaveFactsService(prisma, tva),
  );
  return { service, prisma, writes, raw, tva };
}

const CLOSED_SESSION = {
  id: 'ws-1', userId: 'emp-1', startWorkAt: ist('10:00'), logoutAt: ist('23:59'),
  status: 'AUTO_CLOSED', totalWorkMinutes: 800, totalBreakMinutes: 30,
};

describe('AR-1 official persistence', () => {
  const completeDay = () => ({
    evidence: [punch('PUNCH_IN', ist('10:00')), punch('PUNCH_OUT', ist('19:30'))],
    sessions: [{ ...CLOSED_SESSION, logoutAt: ist('19:30'), status: 'LOGGED_OUT', totalWorkMinutes: 540 }],
  });

  it('1. an explicit evaluateAndPersist writes the official record', async () => {
    const { service, writes } = evaluatorRig(completeDay());
    const out = await service.evaluateAndPersist('emp-1', DATE);

    expect(out.persisted).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0].create.status).toBe('PRESENT');
  });

  it('2. neither GET route can reach the persisting path', async () => {
    const evaluator: any = { evaluate: jest.fn().mockResolvedValue({
      businessDate: DATE, official: true, status: 'PRESENT', evaluationState: 'CALCULATED',
      calculationReason: 'COMPLETE_WORKDAY', exceptionFlags: [], requiresReview: false,
      punchInAt: null, punchOutAt: null, workedMinutes: 0, breakMinutes: 0, lateMinutes: 0,
      leaveDeducted: 0, lwpDeducted: 0,
    }), evaluateAndPersist: jest.fn(), finalize: jest.fn() };

    const controller = new DailyAttendanceController(evaluator, tvaOf());
    await controller.today({ id: 'emp-1' });
    await controller.range({ id: 'emp-1' }, '2026-08-01', '2026-08-03');

    expect(evaluator.evaluateAndPersist).not.toHaveBeenCalled();
    expect(evaluator.finalize).not.toHaveBeenCalled();
  });

  it('3. an identical re-evaluation writes nothing', async () => {
    const first = evaluatorRig(completeDay());
    const written = await first.service.evaluateAndPersist('emp-1', DATE);

    const second = evaluatorRig({
      ...completeDay(),
      existingRecord: {
        id: 'da-1', locked: false, evaluationState: 'CALCULATED', revision: 0,
        sourceFingerprint: written.result.sourceFingerprint,
      },
    });
    const again = await second.service.evaluateAndPersist('emp-1', DATE);

    expect(again.persisted).toBe(false);
    expect(again.reason).toBe('UNCHANGED');
    expect(second.writes).toEqual([]);
  });

  it('4. changed sources before finalization recalculate in place', async () => {
    const { service, writes } = evaluatorRig({
      ...completeDay(),
      existingRecord: {
        id: 'da-1', locked: false, evaluationState: 'CALCULATED', revision: 0,
        sourceFingerprint: 'stale-digest',
      },
    });

    const out = await service.evaluateAndPersist('emp-1', DATE);
    expect(out.persisted).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0].where).toEqual({ userId_date: expect.objectContaining({ userId: 'emp-1' }) });
  });

  it('5. a FINALIZED record is never silently rewritten', async () => {
    const { service, writes } = evaluatorRig({
      ...completeDay(),
      existingRecord: {
        id: 'da-1', locked: false, evaluationState: 'FINALIZED', revision: 1,
        sourceFingerprint: 'anything',
      },
    });

    const out = await service.evaluateAndPersist('emp-1', DATE);
    expect(out.persisted).toBe(false);
    expect(out.reason).toBe('LOCKED');
    expect(writes).toEqual([]);
  });

  it('6. a BLOCKED context creates no official record at all', async () => {
    const { service, writes } = evaluatorRig({
      context: workingContext({
        attendanceApplicability: 'BLOCKED',
        contextResolved: false,
        blockingReasons: ['MISSING_SHIFT_ASSIGNMENT'],
      }),
    });

    const out = await service.evaluateAndPersist('emp-1', DATE);
    expect(out.persisted).toBe(false);
    expect(writes).toEqual([]);
  });

  it('7. a NEEDS_REVIEW day persists, but not as final', async () => {
    const { service, writes } = evaluatorRig({
      evidence: [punch('PUNCH_IN', ist('10:00'))],
      sessions: [CLOSED_SESSION],
    });

    const out = await service.evaluateAndPersist('emp-1', DATE);

    expect(out.persisted).toBe(true);
    expect(writes[0].create.evaluationState).toBe('NEEDS_REVIEW');
    expect(writes[0].create.status).toBe('MISSING_PUNCH');
    expect(writes[0].create.locked).toBeUndefined();
  });

  it('8. provenance and fingerprint are stored with the official record', async () => {
    const { service, writes } = evaluatorRig(completeDay());
    await service.evaluateAndPersist('emp-1', DATE);

    const row = writes[0].create;
    expect(row.sourceFingerprint).toEqual(expect.any(String));
    expect(row.attendancePolicyId).toBe('ap-1');
    expect(row.shiftPolicyVersion).toBe(2);
    expect(row.evaluatorVersion).toBe(1);
    expect(row.workSessionIds).toEqual(['ws-1']);
  });

  it('9. finalize is explicit, and refuses a day that still needs review', async () => {
    const needsReview = evaluatorRig({
      existingRecord: { id: 'da-1', evaluationState: 'NEEDS_REVIEW', locked: false },
    });
    const blocked = await needsReview.service.finalize('emp-1', DATE);
    expect(blocked.finalized).toBe(false);
    expect(blocked.reason).toBe('NEEDS_REVIEW');

    const calculated = evaluatorRig({
      existingRecord: { id: 'da-1', evaluationState: 'CALCULATED', locked: false },
    });
    const ok = await calculated.service.finalize('emp-1', DATE);
    expect(ok.finalized).toBe(true);
    expect(calculated.writes[0].data).toMatchObject({ evaluationState: 'FINALIZED', locked: true });
  });
});

describe('AR-1 corrections change interpretation, never evidence', () => {
  const missingPunchOut = {
    evidence: [punch('PUNCH_IN', ist('10:00'))],
    sessions: [CLOSED_SESSION],
  };

  it('10. without a correction a missing punch out needs review', async () => {
    const { service } = evaluatorRig(missingPunchOut);
    const r = await service.evaluate('emp-1', DATE);

    expect(r.status).toBe('MISSING_PUNCH');
    expect(r.evaluationState).toBe('NEEDS_REVIEW');
    expect(r.punchOutAt).toBeNull();
  });

  it('11. an approved correction supplies the punch out and settles the day', async () => {
    const { service } = evaluatorRig({
      ...missingPunchOut,
      correction: {
        id: 'reg-1', userId: 'emp-1', date: DATE_ONLY, status: 'HR_APPROVED',
        requestType: 'MISSING_PUNCH', requestedPunchIn: null,
        requestedPunchOut: ist('19:03'), proposedStatus: null,
      },
    });

    const r = await service.evaluate('emp-1', DATE);

    expect(r.punchOutAt?.toISOString()).toBe(ist('19:03').toISOString());
    expect(r.exceptionFlags).toContain('CORRECTED_BY_REGULARIZATION');
    expect(r.exceptionFlags).not.toContain('MISSING_PUNCH_OUT');
    expect(r.calculationReason).toBe('CORRECTED_WORKDAY');

    // 10:00 to 19:03 is a 543 minute PRESENCE SPAN, which meets the 540 the
    // shift requires. Effective work is 513 after the 30 minutes of break, and
    // that is fine: 540 was never an effective-work threshold. The day settles.
    expect(r.workedMinutes).toBe(513);
    expect(r.evaluationState).toBe('CALCULATED');
    expect(r.exceptionFlags).toEqual(['CORRECTED_BY_REGULARIZATION']);
  });

  it('11b. a correction that satisfies the shift settles the day outright', async () => {
    const { service } = evaluatorRig({
      ...missingPunchOut,
      correction: {
        id: 'reg-1', userId: 'emp-1', date: DATE_ONLY, status: 'HR_APPROVED',
        requestType: 'MISSING_PUNCH', requestedPunchIn: null,
        requestedPunchOut: ist('19:30'), proposedStatus: null,
      },
    });

    const r = await service.evaluate('emp-1', DATE);

    expect(r.status).toBe('PRESENT');
    expect(r.exceptionFlags).toEqual(['CORRECTED_BY_REGULARIZATION']);
    // The correction flag alone never keeps a day in review: an approved
    // correction is a decision already made, not an open question.
    expect(r.evaluationState).toBe('CALCULATED');
    expect(r.requiresReview).toBe(false);
  });

  it('12. official worked time follows the corrected span, not the auto-closed session', async () => {
    const { service } = evaluatorRig({
      ...missingPunchOut,
      correction: {
        id: 'reg-1', userId: 'emp-1', date: DATE_ONLY, status: 'HR_APPROVED',
        requestType: 'MISSING_PUNCH', requestedPunchIn: null,
        requestedPunchOut: ist('19:30'), proposedStatus: null,
      },
    });

    const r = await service.evaluate('emp-1', DATE);

    // Span 10:00-19:30 is 570 minutes, minus the 30 minutes of break the
    // workday DID record. The auto-closed session's own 800 is not used.
    expect(r.workedMinutes).toBe(540);
    expect(r.breakMinutes).toBe(30);
  });

  it('13. an explicitly granted status outranks the evaluator reading', async () => {
    const { service } = evaluatorRig({
      evidence: [punch('PUNCH_IN', ist('10:00')), punch('PUNCH_OUT', ist('13:00'))],
      sessions: [{ ...CLOSED_SESSION, logoutAt: ist('13:00'), status: 'LOGGED_OUT', totalWorkMinutes: 180 }],
      correction: {
        id: 'reg-2', userId: 'emp-1', date: DATE_ONLY, status: 'HR_APPROVED',
        requestType: 'HALF_DAY_CORRECTION', requestedPunchIn: null,
        requestedPunchOut: null, proposedStatus: 'HALF_DAY',
      },
    });

    const r = await service.evaluate('emp-1', DATE);
    expect(r.status).toBe('HALF_DAY');
  });

  it('14. correcting a day writes nothing to punch evidence, sessions or breaks', async () => {
    const { service, raw } = evaluatorRig({
      ...missingPunchOut,
      correction: {
        id: 'reg-1', userId: 'emp-1', date: DATE_ONLY, status: 'HR_APPROVED',
        requestType: 'MISSING_PUNCH', requestedPunchIn: null,
        requestedPunchOut: ist('19:03'), proposedStatus: null,
      },
    });

    await service.evaluate('emp-1', DATE);

    // The device never reported a punch out, and it still has not. The
    // correction sits beside the raw record rather than rewriting it.
    expect(raw.punchUpdates).toEqual([]);
    expect(raw.sessionUpdates).toEqual([]);
    expect(raw.breakUpdates).toEqual([]);
  });

  it('15. only an HR-approved correction is ever consulted', async () => {
    const { service, prisma } = evaluatorRig(missingPunchOut);
    await service.evaluate('emp-1', DATE);

    const where = prisma.attendanceRegularization.findFirst.mock.calls[0][0].where;
    expect(where.status).toBe('HR_APPROVED');
  });

  it('16. a revision bumps the counter and records which correction caused it', async () => {
    const { service, writes } = evaluatorRig({
      ...missingPunchOut,
      correction: {
        id: 'reg-1', userId: 'emp-1', date: DATE_ONLY, status: 'HR_APPROVED',
        requestType: 'MISSING_PUNCH', requestedPunchIn: null,
        requestedPunchOut: ist('19:03'), proposedStatus: null,
      },
      existingRecord: { id: 'da-1', revision: 0, status: 'MISSING_PUNCH', evaluationState: 'NEEDS_REVIEW' },
    });

    const tx: any = {
      dailyAttendance: (evaluatorRig as any) && undefined,
    };
    // Use the service's own prisma mock as the transaction client.
    const out = await service.reviseForApprovedCorrection(
      (service as any).prisma,
      'emp-1',
      DATE,
      'reg-1',
    );

    expect(out.after.revision).toBe(1);
    expect(out.after.lastRegularizationId).toBe('reg-1');
    expect(writes.length).toBeGreaterThan(0);
    expect(tx).toBeDefined();
  });

  it('17. a partially funded leave stays a review item even after correction logic runs', async () => {
    const { service } = evaluatorRig({ context: workingContext() });
    (service as any).leaveFacts = {
      resolveForDate: jest.fn().mockResolvedValue({
        hasApprovedLeave: true, kind: 'PARTIALLY_FUNDED', leaveRequestId: 'lv-1', leaveType: 'ANNUAL',
      }),
    };

    const r = await service.evaluate('emp-1', DATE);

    expect(r.status).toBe('LEAVE');
    expect(r.exceptionFlags).toContain('PARTIALLY_FUNDED_LEAVE');
    expect(r.evaluationState).toBe('NEEDS_REVIEW');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The correction lifecycle.
// ─────────────────────────────────────────────────────────────────────────────

const CHAIN = [
  { id: 'tl-1', name: 'Their Team Lead', tier: 'TEAM_LEAD' },
  { id: 'mgr-1', name: 'Their Manager', tier: 'MANAGER' },
  { id: 'admin-1', name: 'An Admin', tier: 'ADMIN' },
];

const REQUEST = {
  id: 'reg-1', userId: 'emp-1', date: DATE_ONLY, status: 'PENDING',
  requestType: 'MISSING_PUNCH', reason: 'Browser crashed before punch out',
  requestedPunchIn: null, requestedPunchOut: ist('19:03'),
  basedOnFingerprint: 'fp-original', proposedStatus: null,
  managerApproverId: null, managerDecisionAt: null,
  hrApproverId: null, hrDecisionAt: null,
};

interface LifecycleFixtures {
  enabled?: boolean;
  request?: any;
  chain?: any[];
  isHR?: boolean;
  official?: any;
  openRequest?: any;
}

function lifecycleRig(f: LifecycleFixtures = {}) {
  const updates: any[] = [];
  const created: any[] = [];
  const audit: any[] = [];
  const lockOrder: string[] = [];

  const tx: any = {
    $queryRaw: jest.fn((strings: any) => {
      lockOrder.push(String(Array.isArray(strings) ? strings.join('?') : strings).replace(/\s+/g, ' ').trim());
      return Promise.resolve([{ id: 'x' }]);
    }),
    attendanceRegularization: {
      findUnique: jest.fn().mockResolvedValue('request' in f ? f.request : { ...REQUEST, status: 'MANAGER_APPROVED' }),
      update: jest.fn(({ data }: any) => {
        updates.push(data);
        return Promise.resolve({ ...REQUEST, ...data });
      }),
    },
    dailyAttendance: {
      findUnique: jest.fn().mockResolvedValue(
        'official' in f ? f.official : { id: 'da-1', sourceFingerprint: 'fp-original', revision: 0, status: 'MISSING_PUNCH' },
      ),
    },
  };

  const prisma: any = {
    $transaction: jest.fn((fn: any) => fn(tx)),
    attendanceRegularization: {
      findUnique: tx.attendanceRegularization.findUnique,
      findFirst: jest.fn().mockResolvedValue(f.openRequest ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: any) => {
        created.push(data);
        return Promise.resolve({ id: 'reg-new', ...data });
      }),
      update: tx.attendanceRegularization.update,
    },
    dailyAttendance: { findUnique: tx.dailyAttendance.findUnique },
  };

  const evaluator: any = {
    reviseForApprovedCorrection: jest.fn().mockResolvedValue({
      before: { id: 'da-1', status: 'MISSING_PUNCH', revision: 0 },
      after: { id: 'da-1', status: 'PRESENT', revision: 1 },
      result: {},
    }),
  };

  const service = new RegularizationService(
    prisma,
    tvaOf(),
    { log: jest.fn((e: any) => { audit.push(e); return Promise.resolve(undefined); }) } as any,
    {
      resolveApproverChainFor: jest.fn().mockResolvedValue(f.chain ?? CHAIN),
      isApproverFor: jest.fn(async (actorId: string) => (f.chain ?? CHAIN).some((c: any) => c.id === actorId)),
    } as any,
    { isHrOrAdmin: () => f.isHR === true } as any,
    { get: jest.fn().mockResolvedValue({ regularizationEnabled: f.enabled !== false }) } as any,
    evaluator,
  );

  return { service, prisma, tx, updates, created, audit, lockOrder, evaluator };
}

describe('AR-1 correction lifecycle', () => {
  it('18. an employee raises a correction for their own day', async () => {
    const { service, created } = lifecycleRig();

    await service.create('emp-1', {
      businessDate: DATE,
      requestType: 'MISSING_PUNCH',
      reason: 'Browser crashed before punch out',
      requestedPunchOut: ist('19:03').toISOString(),
    });

    expect(created).toHaveLength(1);
    expect(created[0].userId).toBe('emp-1');
    expect(created[0].status).toBe('PENDING');
    expect(created[0].basedOnFingerprint).toBe('fp-original');
  });

  it('19. there is no way to file a correction against another employee', async () => {
    const { service, created } = lifecycleRig();

    // The subject comes from the authenticated caller, never the body. Any
    // extra userId in the payload is simply not read.
    await service.create('emp-1', {
      businessDate: DATE,
      requestType: 'MISSING_PUNCH',
      reason: 'Browser crashed before punch out',
      userId: 'emp-2',
    } as any);

    expect(created[0].userId).toBe('emp-1');
  });

  it('20. a second open request for the same date is refused', async () => {
    const { service } = lifecycleRig({ openRequest: { id: 'reg-open', status: 'PENDING' } });

    await expect(
      service.create('emp-1', { businessDate: DATE, requestType: 'MISSING_PUNCH', reason: 'again please' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('21. an unrelated manager cannot advance the request', async () => {
    const { service, updates } = lifecycleRig({ request: { ...REQUEST, status: 'PENDING' } });

    await expect(service.approveAsManager({ id: 'mgr-other' }, 'reg-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(updates).toEqual([]);
  });

  it('22. the employee cannot approve their own correction', async () => {
    const { service, updates } = lifecycleRig({
      request: { ...REQUEST, status: 'PENDING' },
      chain: CHAIN.filter((c) => c.id !== 'emp-1'),
    });

    await expect(service.approveAsManager({ id: 'emp-1' }, 'reg-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(updates).toEqual([]);
  });

  it('23. the actual reporting manager advances it to HR review', async () => {
    const { service, updates, audit } = lifecycleRig({ request: { ...REQUEST, status: 'PENDING' } });

    await service.approveAsManager({ id: 'mgr-1' }, 'reg-1');

    expect(updates[0].status).toBe('MANAGER_APPROVED');
    expect(updates[0].managerApproverId).toBe('mgr-1');
    expect(audit[0].action).toBe('REGULARIZATION_MANAGER_APPROVED');
  });

  it('24. manager approval alone changes no official attendance', async () => {
    const { service, evaluator } = lifecycleRig({ request: { ...REQUEST, status: 'PENDING' } });

    await service.approveAsManager({ id: 'mgr-1' }, 'reg-1');

    expect(evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
  });

  it('25. an admin override at the manager stage is audited, not hidden', async () => {
    const { service, audit } = lifecycleRig({ request: { ...REQUEST, status: 'PENDING' } });

    await service.approveAsManager({ id: 'admin-1' }, 'reg-1');
    expect(audit[0].toState).toContain('admin override');
  });

  it('26. HR cannot skip the manager stage', async () => {
    const { service, evaluator } = lifecycleRig({
      request: { ...REQUEST, status: 'PENDING' },
      isHR: true,
    });

    await expect(service.approveAsHr({ id: 'hr-1' }, 'reg-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
  });

  it('27. a manager cannot give final approval', async () => {
    const { service, evaluator } = lifecycleRig({ isHR: false });

    await expect(service.approveAsHr({ id: 'mgr-1' }, 'reg-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
  });

  it('28. HR final approval revises the official record', async () => {
    const { service, updates, evaluator } = lifecycleRig({ isHR: true });

    await service.approveAsHr({ id: 'hr-1' }, 'reg-1');

    expect(updates[0].status).toBe('HR_APPROVED');
    expect(updates[0].hrApproverId).toBe('hr-1');
    expect(evaluator.reviseForApprovedCorrection).toHaveBeenCalledWith(
      expect.anything(), 'emp-1', DATE, 'reg-1',
    );
  });

  it('29. approval serializes on the request, then on the official record', async () => {
    const { service, lockOrder } = lifecycleRig({ isHR: true });

    await service.approveAsHr({ id: 'hr-1' }, 'reg-1');

    expect(lockOrder).toHaveLength(2);
    expect(lockOrder[0]).toContain('"attendance_regularizations"');
    expect(lockOrder[0]).toContain('FOR UPDATE');
    expect(lockOrder[1]).toContain('"daily_attendance"');
    expect(lockOrder[1]).toContain('FOR UPDATE');
  });

  it('30. the stage is re-checked after the lock, not before it', async () => {
    const { service, tx } = lifecycleRig({ isHR: true });

    await service.approveAsHr({ id: 'hr-1' }, 'reg-1');

    expect(tx.attendanceRegularization.findUnique.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.$queryRaw.mock.invocationCallOrder[0],
    );
  });

  it('31. a correction argued against a stale result cannot overwrite a newer one', async () => {
    const { service, evaluator } = lifecycleRig({
      isHR: true,
      official: { id: 'da-1', sourceFingerprint: 'fp-NEWER', revision: 2 },
    });

    await expect(service.approveAsHr({ id: 'hr-1' }, 'reg-1')).rejects.toBeInstanceOf(
      StaleCorrectionError,
    );
    expect(evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
  });

  it('32. the official revision is audited with before and after values', async () => {
    const { service, audit } = lifecycleRig({ isHR: true });

    await service.approveAsHr({ id: 'hr-1' }, 'reg-1');

    const revised = audit.find((e) => e.action === 'ATTENDANCE_OFFICIAL_REVISED');
    expect(revised).toBeDefined();
    expect(revised.entityType).toBe('DailyAttendance');
    expect(revised.beforeValue).toMatchObject({ status: 'MISSING_PUNCH' });
    expect(revised.afterValue).toMatchObject({ status: 'PRESENT', revision: 1 });
    // Never duplicated into the event stream.
    expect(JSON.stringify(revised)).not.toContain('cloudinary');
    expect(revised.afterValue).not.toHaveProperty('photoObjectKey');
    expect(revised.afterValue).not.toHaveProperty('latitude');
  });

  it('33. a rejection leaves every official attendance fact alone', async () => {
    const { service, updates, evaluator } = lifecycleRig({
      request: { ...REQUEST, status: 'PENDING' },
    });

    await service.reject({ id: 'mgr-1' }, 'reg-1', 'Not supported by evidence');

    expect(updates[0].status).toBe('REJECTED');
    expect(evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
  });

  it('33b. a rejection without a reason is refused', async () => {
    // A refusal the employee cannot understand is one they simply resubmit,
    // and the audit row would record that a correction was refused without
    // recording why -- the part a later dispute needs.
    const { service, updates } = lifecycleRig({ request: { ...REQUEST, status: 'PENDING' } });

    await expect(service.reject({ id: 'mgr-1' }, 'reg-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.reject({ id: 'mgr-1' }, 'reg-1', '   ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updates).toEqual([]);
  });

  it('33c. the rejection reason reaches the audit trail', async () => {
    const { service, audit } = lifecycleRig({ request: { ...REQUEST, status: 'PENDING' } });

    await service.reject({ id: 'mgr-1' }, 'reg-1', '  Not supported by evidence  ');
    const rejected = audit.find((e: any) => e.action === 'REGULARIZATION_REJECTED');

    // Trimmed, so a whitespace-padded reason is not stored as-is.
    expect(rejected.metadata).toEqual({ reason: 'Not supported by evidence' });
  });

  it('34. with the feature off nothing can be requested or approved', async () => {
    const off = lifecycleRig({ enabled: false, isHR: true });

    await expect(
      off.service.create('emp-1', { businessDate: DATE, requestType: 'MISSING_PUNCH', reason: 'anything at all' }),
    ).rejects.toBeInstanceOf(RegularizationDisabledError);
    await expect(off.service.approveAsHr({ id: 'hr-1' }, 'reg-1')).rejects.toBeInstanceOf(
      RegularizationDisabledError,
    );
    expect(off.created).toEqual([]);
    expect(off.evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
  });

  it('35. another employee cannot read a correction that is not theirs', async () => {
    const { service } = lifecycleRig({ request: REQUEST, chain: [] });

    await expect(service.findOne({ id: 'emp-9' }, 'reg-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('36. the review queue is scoped, never a company-wide listing', async () => {
    const hr = lifecycleRig({ isHR: true });
    await hr.service.pendingFor({ id: 'hr-1' });
    expect(hr.prisma.attendanceRegularization.findMany.mock.calls[0][0].where).toEqual({
      status: 'MANAGER_APPROVED',
    });

    const mgr = lifecycleRig({ isHR: false });
    await mgr.service.pendingFor({ id: 'mgr-1' });
    expect(mgr.prisma.attendanceRegularization.findMany.mock.calls[0][0].where).toEqual({
      status: 'PENDING',
    });
  });

  it('37. the controller exposes no route that edits raw evidence', () => {
    const surface = Object.getOwnPropertyNames(RegularizationController.prototype).sort();
    expect(surface).toEqual([
      'constructor',
      'create',
      'findOne',
      'hrApprove',
      'listMine',
      'managerApprove',
      'pending',
      'reject',
      'rethrow',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Duration semantics. Three measures, three policy fields, never conflated.
//
//   required presence span   AttendancePolicy/ShiftPolicy.minimumWorkingMinutes (540)
//   permitted break          AttendancePolicy.permittedBreakMinutes (60)
//   effective-work floor     AttendancePolicy.minimumEffectiveWorkMinutes (unset)
// ─────────────────────────────────────────────────────────────────────────────

describe('AR-1 duration contract', () => {
  /** A day defined by its punch times and the workday's own recorded totals. */
  const day = (
    inAt: string,
    outAt: string,
    totalWorkMinutes: number,
    totalBreakMinutes: number,
    policyOver: any = {},
  ) =>
    evaluatorRig({
      context: workingContext({ attendancePolicy: { ...POLICY, ...policyOver } }),
      evidence: [punch('PUNCH_IN', ist(inAt)), punch('PUNCH_OUT', ist(outAt))],
      sessions: [{
        ...CLOSED_SESSION,
        startWorkAt: ist(inAt),
        logoutAt: ist(outAt),
        status: 'LOGGED_OUT',
        totalWorkMinutes,
        totalBreakMinutes,
      }],
    });

  it('38. a full 540 span with the full 60 minute break does not fail', async () => {
    // Presence 10:00-19:00 = 540, break 60, effective work 480. Under the old
    // reading this failed, because 480 was compared against 540.
    const { service } = day('10:00', '19:00', 480, 60);
    const r = await service.evaluate('emp-1', DATE);

    expect(r.workedMinutes).toBe(480);
    expect(r.exceptionFlags).toEqual([]);
    expect(r.evaluationState).toBe('CALCULATED');
    expect(r.status).toBe('PRESENT');
  });

  it('39. one minute short of the span triggers the configured action', async () => {
    // 10:00 to 18:59 is 539 minutes of presence.
    const { service } = day('10:00', '18:59', 479, 60);
    const r = await service.evaluate('emp-1', DATE);

    expect(r.exceptionFlags).toContain('INSUFFICIENT_PRESENCE_SPAN');
    expect(r.evaluationState).toBe('NEEDS_REVIEW');
    // Still never a manufactured penalty.
    expect(r.leaveDeducted).toBe(0);
    expect(r.lwpDeducted).toBe(0);
    expect(r.status).not.toBe('ABSENT');
  });

  it('40. the effective-work floor is evaluated only when configured, and separately', async () => {
    // Span is fine (543) but effective work is 513. With no floor set, nothing
    // is raised -- an unset threshold must not fail anyone.
    const unset = await day('10:00', '19:03', 513, 30).service.evaluate('emp-1', DATE);
    expect(unset.exceptionFlags).toEqual([]);

    // Configure a floor above it, and only THAT flag appears: the span is still
    // satisfied, so the two questions stay independent.
    const configured = await day('10:00', '19:03', 513, 30, {
      minimumEffectiveWorkMinutes: 520,
    }).service.evaluate('emp-1', DATE);

    expect(configured.exceptionFlags).toEqual(['INSUFFICIENT_EFFECTIVE_WORK']);
    expect(configured.exceptionFlags).not.toContain('INSUFFICIENT_PRESENCE_SPAN');
    expect(configured.evaluationState).toBe('NEEDS_REVIEW');
  });

  it('41. an over-long break is its own question, not a short day', async () => {
    // Presence 570, break 90, effective work 480. The span is satisfied; the
    // break allowance is not.
    const { service } = day('10:00', '19:30', 480, 90);
    const r = await service.evaluate('emp-1', DATE);

    expect(r.exceptionFlags).toEqual(['BREAK_EXCEEDS_ALLOWANCE']);
    expect(r.exceptionFlags).not.toContain('INSUFFICIENT_PRESENCE_SPAN');
    expect(r.evaluationState).toBe('NEEDS_REVIEW');
  });

  it('42. a corrected day is judged by exactly the same duration rules', async () => {
    // Same presence span, same break, same policy -- one day proven by raw
    // punches, the other by an approved correction. The verdict must match.
    const raw = await day('10:00', '19:03', 513, 30).service.evaluate('emp-1', DATE);

    const corrected = await evaluatorRig({
      context: workingContext(),
      evidence: [punch('PUNCH_IN', ist('10:00'))],
      sessions: [{ ...CLOSED_SESSION, startWorkAt: ist('10:00'), totalBreakMinutes: 30 }],
      correction: {
        id: 'reg-1', userId: 'emp-1', date: DATE_ONLY, status: 'HR_APPROVED',
        requestType: 'MISSING_PUNCH', requestedPunchIn: null,
        requestedPunchOut: ist('19:03'), proposedStatus: null,
      },
    }).service.evaluate('emp-1', DATE);

    expect(corrected.workedMinutes).toBe(raw.workedMinutes);
    expect(corrected.status).toBe(raw.status);
    expect(corrected.evaluationState).toBe(raw.evaluationState);
    // The only difference is the correction's own informational flag.
    expect(corrected.exceptionFlags).toEqual(['CORRECTED_BY_REGULARIZATION']);
    expect(raw.exceptionFlags).toEqual([]);
  });
});
