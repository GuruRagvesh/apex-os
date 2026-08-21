import { AttendanceConsoleService } from '../../src/modules/platform/attendance/console/attendance-console.service';
import { AttendanceConsoleController } from '../../src/modules/platform/attendance/console/attendance-console.controller';
import { TVAService } from '../../src/common/services/tva.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

// HC-1. Real TVAService, mocked Prisma and a mocked evaluator, because the
// point of every test here is that the console READS stored results and
// OPERATES existing services — it must never compute an attendance answer.

const DATE = '2026-08-20';
const tvaOf = () => new TVAService({ get: () => undefined } as unknown as ConfigService);
const dateOnly = new Date(`${DATE}T00:00:00.000Z`);

const employee = (id: string, name = id) => ({
  id, name, email: `${id}@x.com`, employeeId: `E-${id}`,
  department: { id: 'dept-1', name: 'Ops' },
});

const record = (userId: string, over: any = {}) => ({
  id: `da-${userId}`, userId, date: dateOnly,
  status: 'PRESENT', evaluationState: 'CALCULATED',
  calculationReason: 'COMPLETE_WORKDAY', exceptionFlags: [],
  punchInAt: new Date(`${DATE}T04:30:00.000Z`),
  punchOutAt: new Date(`${DATE}T14:00:00.000Z`),
  workedMinutes: 510, breakMinutes: 30, lateMinutes: 0,
  leaveDeducted: 0, lwpDeducted: 0, revision: 0, locked: false,
  ...over,
});

interface Fixtures {
  isHr?: boolean;
  actorEmployeeId?: string | null;
  departmentId?: string | null;
  managedDepartments?: string[];
  reports?: any[];
  employees?: any[];
  records?: any[];
  regularizations?: any[];
  regularizationCount?: number;
  evaluateOutcome?: any;
  evaluateThrows?: Record<string, string>;
  finalizeOutcome?: any;
  blockedFromLastRun?: any[] | null;
}

function rig(f: Fixtures = {}) {
  const audit: any[] = [];
  const employees = f.employees ?? [employee('emp-1'), employee('emp-2')];

  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'actor-1',
        employeeId: 'actorEmployeeId' in f ? f.actorEmployeeId : 'E-mgr',
        departmentId: 'departmentId' in f ? (f as any).departmentId : 'dept-1',
        role: { name: 'MANAGER' },
      }),
      findMany: jest.fn((args: any) => {
        // The scope query asks for reports; every other query asks for the
        // employee list the caller is allowed to see.
        if (args?.where?.OR) return Promise.resolve(f.reports ?? [{ id: 'emp-1' }]);
        return Promise.resolve(employees);
      }),
      count: jest.fn().mockResolvedValue(employees.length),
      update: jest.fn(),
    },
    dailyAttendance: {
      findMany: jest.fn().mockResolvedValue(f.records ?? []),
      findUnique: jest.fn().mockResolvedValue((f.records ?? [])[0] ?? null),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    attendanceRegularization: {
      findMany: jest.fn().mockResolvedValue(f.regularizations ?? []),
      count: jest.fn().mockResolvedValue(f.regularizationCount ?? 0),
    },
    attendancePunchEvidence: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    workSession: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    leaveRequest: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
  };

  const evaluator: any = {
    evaluateAndPersist: jest.fn(async (userId: string, businessDate: string) => {
      const key = `${userId}:${businessDate}`;
      if (f.evaluateThrows?.[key]) throw new Error(f.evaluateThrows[key]);
      return f.evaluateOutcome ?? { persisted: true, reason: 'WRITTEN' };
    }),
    finalize: jest.fn().mockResolvedValue(
      f.finalizeOutcome ?? { finalized: true, reason: 'FINALIZED', record: { id: 'da-1' } },
    ),
    evaluate: jest.fn(),
  };

  const service = new AttendanceConsoleService(
    prisma,
    tvaOf(),
    {
      isHrOrAdmin: () => f.isHr === true,
      managedDepartmentIds: jest.fn().mockResolvedValue(f.managedDepartments ?? []),
    } as any,
    { isApproverFor: jest.fn().mockResolvedValue(true) } as any,
    { log: jest.fn((e: any) => { audit.push(e); return Promise.resolve(undefined); }) } as any,
    evaluator,
    // SS-1: blocked employees come from the last processing run. Null here
    // means "no run yet", which every pre-SS-1 case below assumes.
    { blockedFromLastRun: jest.fn().mockResolvedValue(f.blockedFromLastRun ?? null) } as any,
  );

  return { service, prisma, evaluator, audit };
}

const HR = { id: 'hr-1' };
const MANAGER = { id: 'actor-1' };
const EMPLOYEE = { id: 'emp-9' };

describe('HC-1 scoping', () => {
  it('1. HR and admin see the whole company', async () => {
    const { service } = rig({ isHr: true });
    const scope = await service.resolveScope(HR);

    expect(scope.isHr).toBe(true);
    expect(scope.userIds).toBeNull();
  });

  it('2. a manager is narrowed to their own reporting hierarchy', async () => {
    const { service, prisma } = rig({
      isHr: false,
      actorEmployeeId: 'E-mgr',
      reports: [{ id: 'emp-1' }],
    });

    const scope = await service.resolveScope(MANAGER);

    expect(scope.isHr).toBe(false);
    expect(scope.userIds).toEqual(['emp-1']);

    // Scoped by the hierarchy's own employeeId links and the managed
    // departments the access policy reports — never by department NAME.
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([{ reportingManager: 'E-mgr' }, { teamLeadName: 'E-mgr' }]),
    );
    expect(where.id).toEqual({ not: 'actor-1' });
  });

  it('3. someone with no hierarchy links and no department sees nobody', async () => {
    const { service } = rig({
      isHr: false,
      actorEmployeeId: null,
      departmentId: null,
      managedDepartments: [],
    });
    const scope = await service.resolveScope(EMPLOYEE);

    // An empty scope, not an unfiltered one. This is the failure mode that
    // would otherwise hand a plain employee the company roster.
    expect(scope.userIds).toEqual([]);
  });

  it('4. an ordinary employee cannot operate the console', async () => {
    const { service } = rig({
      isHr: false,
      actorEmployeeId: null,
      departmentId: null,
      managedDepartments: [],
    });
    const access = await service.canOperate(EMPLOYEE);

    expect(access.isHr).toBe(false);
    expect(access.hasTeam).toBe(false);
  });

  it('5. a manager naming an employee outside their scope gets nothing, not a leak', async () => {
    const { service } = rig({ isHr: false, reports: [{ id: 'emp-1' }] });

    const out = await service.roster(MANAGER, { businessDate: DATE, employeeId: 'emp-999' });

    expect(out.total).toBe(0);
    expect(out.rows).toEqual([]);
  });

  it('6. a manager cannot read a day detail outside their scope', async () => {
    const { service } = rig({ isHr: false, reports: [{ id: 'emp-1' }] });

    await expect(service.dayDetail(MANAGER, 'emp-999', DATE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('7. every scoped query filters by user id before reading a row', async () => {
    const { service, prisma } = rig({ isHr: false, reports: [{ id: 'emp-1' }] });

    await service.todaySummary(MANAGER, DATE);

    const attendanceWhere = prisma.dailyAttendance.findMany.mock.calls[0][0].where;
    expect(attendanceWhere.userId).toEqual({ in: ['emp-1'] });
  });
});

describe('HC-1 commands are HR-only and explicit', () => {
  it('8. an employee cannot run evaluation', async () => {
    const { service, evaluator } = rig({ isHr: false });

    await expect(service.runEvaluation(EMPLOYEE, { businessDate: DATE })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(evaluator.evaluateAndPersist).not.toHaveBeenCalled();
  });

  it('9. a manager cannot run evaluation', async () => {
    const { service, evaluator } = rig({ isHr: false });

    await expect(service.runEvaluation(MANAGER, { businessDate: DATE })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(evaluator.evaluateAndPersist).not.toHaveBeenCalled();
  });

  it('10. an employee cannot finalize', async () => {
    const { service, evaluator } = rig({ isHr: false });

    await expect(service.finalize(EMPLOYEE, 'emp-1', DATE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(evaluator.finalize).not.toHaveBeenCalled();
  });

  it('11. HR evaluation goes through the existing persistence service', async () => {
    const { service, evaluator } = rig({ isHr: true, employees: [employee('emp-1')] });

    const out = await service.runEvaluation(HR, { businessDate: DATE });

    expect(evaluator.evaluateAndPersist).toHaveBeenCalledWith('emp-1', DATE);
    expect(out.evaluated).toBe(1);
    expect(out.requested).toBe(1);
  });

  it('12. the same run repeated is idempotent and reported as unchanged', async () => {
    const { service } = rig({
      isHr: true,
      employees: [employee('emp-1')],
      evaluateOutcome: { persisted: false, reason: 'UNCHANGED' },
    });

    const out = await service.runEvaluation(HR, { businessDate: DATE });

    expect(out.evaluated).toBe(0);
    expect(out.unchanged).toBe(1);
  });

  it('13. one employee failing does not abandon the others', async () => {
    const { service } = rig({
      isHr: true,
      employees: [employee('emp-1'), employee('emp-2'), employee('emp-3')],
      evaluateThrows: { [`emp-2:${DATE}`]: 'MISSING_SHIFT_ASSIGNMENT' },
    });

    const out = await service.runEvaluation(HR, { businessDate: DATE });

    expect(out.evaluated).toBe(2);
    expect(out.failed).toEqual([
      { userId: 'emp-2', businessDate: DATE, error: 'MISSING_SHIFT_ASSIGNMENT' },
    ]);
  });

  it('14. range bounds are enforced', async () => {
    const { service } = rig({ isHr: true });

    await expect(
      service.runEvaluation(HR, { startDate: '2026-01-01', endDate: '2026-12-31' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.runEvaluation(HR, { startDate: '2026-08-20', endDate: '2026-08-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('15. a batch too large is refused before any evaluation runs', async () => {
    const many = Array.from({ length: 200 }, (_, i) => employee(`emp-${i}`));
    const { service, evaluator } = rig({ isHr: true, employees: many });

    await expect(
      service.runEvaluation(HR, { startDate: '2026-08-01', endDate: '2026-08-31' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(evaluator.evaluateAndPersist).not.toHaveBeenCalled();
  });

  it('16. an evaluation run is audited with counts only', async () => {
    const { service, audit } = rig({ isHr: true, employees: [employee('emp-1')] });

    await service.runEvaluation(HR, { businessDate: DATE });

    const entry = audit.find((e) => e.action === 'ATTENDANCE_EVALUATION_RUN');
    expect(entry).toBeDefined();
    expect(entry.metadata).toMatchObject({ from: DATE, to: DATE, employees: 1, evaluated: 1 });
    // No evidence, no coordinates, no photo keys reach the event stream.
    const serialised = JSON.stringify(entry);
    expect(serialised).not.toContain('latitude');
    expect(serialised).not.toContain('photo');
    expect(serialised).not.toContain('cloudinary');
  });

  it('17. HR finalization delegates to the existing finalize service', async () => {
    const { service, evaluator, audit } = rig({ isHr: true });

    const out = await service.finalize(HR, 'emp-1', DATE);

    expect(evaluator.finalize).toHaveBeenCalledWith('emp-1', DATE);
    expect(out.finalized).toBe(true);
    expect(audit.find((e) => e.action === 'ATTENDANCE_FINALIZED')).toBeDefined();
  });

  it('18. a day that needs review is not finalized, and not audited as if it were', async () => {
    const { service, audit } = rig({
      isHr: true,
      finalizeOutcome: { finalized: false, reason: 'NEEDS_REVIEW' },
    });

    const out = await service.finalize(HR, 'emp-1', DATE);

    expect(out.finalized).toBe(false);
    expect(out.reason).toBe('NEEDS_REVIEW');
    expect(audit.find((e) => e.action === 'ATTENDANCE_FINALIZED')).toBeUndefined();
  });

  it('19. no GET route can evaluate or finalize', async () => {
    const { service, evaluator } = rig({ isHr: true, records: [record('emp-1')] });
    const controller = new AttendanceConsoleController(service);

    await controller.access(HR);
    await controller.summary(HR, DATE);
    await controller.roster(HR, DATE);
    await controller.reviewQueue(HR, DATE, DATE);
    await controller.register(HR, DATE, DATE);
    await controller.detail(HR, 'emp-1', DATE);

    expect(evaluator.evaluateAndPersist).not.toHaveBeenCalled();
    expect(evaluator.finalize).not.toHaveBeenCalled();
  });

  it('20. reading never writes', async () => {
    const { service, prisma } = rig({ isHr: true, records: [record('emp-1')] });

    await service.todaySummary(HR, DATE);
    await service.roster(HR, { businessDate: DATE });
    await service.monthlyRegister(HR, { from: DATE, to: DATE });
    await service.dayDetail(HR, 'emp-1', DATE);
    await service.reviewQueue(HR, { from: DATE, to: DATE });

    expect(prisma.dailyAttendance.upsert).not.toHaveBeenCalled();
    expect(prisma.dailyAttendance.update).not.toHaveBeenCalled();
    expect(prisma.attendancePunchEvidence.update).not.toHaveBeenCalled();
    expect(prisma.workSession.update).not.toHaveBeenCalled();
    expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('HC-1 summary counts stored facts, never recalculates', () => {
  it('21. each status is counted once, from the stored classification', async () => {
    const { service, evaluator } = rig({
      isHr: true,
      employees: [employee('e1'), employee('e2'), employee('e3'), employee('e4')],
      records: [
        record('e1', { status: 'PRESENT' }),
        record('e2', { status: 'LEAVE' }),
        record('e3', { status: 'HOLIDAY' }),
        record('e4', { status: 'WEEKLY_OFF' }),
      ],
    });

    const s = await service.todaySummary(HR, DATE);

    expect(s.present).toBe(1);
    expect(s.leave).toBe(1);
    expect(s.holiday).toBe(1);
    expect(s.weeklyOff).toBe(1);
    expect(s.notEvaluated).toBe(0);
    // The console has no evaluator of its own to reach for.
    expect(evaluator.evaluate).not.toHaveBeenCalled();
    expect(evaluator.evaluateAndPersist).not.toHaveBeenCalled();
  });

  it('22. a missing row is NOT_EVALUATED and is never counted as absence', async () => {
    const { service } = rig({
      isHr: true,
      employees: [employee('e1'), employee('e2'), employee('e3')],
      records: [record('e1')],
    });

    const s = await service.todaySummary(HR, DATE);

    expect(s.expectedEmployees).toBe(3);
    expect(s.notEvaluated).toBe(2);
    // The decisive assertion: unknown days do not silently become absences.
    expect(s.absent).toBe(0);
  });

  it('23. review is separated from every attendance status', async () => {
    const { service } = rig({
      isHr: true,
      employees: [employee('e1'), employee('e2')],
      records: [
        record('e1', { status: 'PRESENT', evaluationState: 'CALCULATED' }),
        record('e2', { status: 'MISSING_PUNCH', evaluationState: 'NEEDS_REVIEW' }),
      ],
    });

    const s = await service.todaySummary(HR, DATE);

    expect(s.needsReview).toBe(1);
    expect(s.present).toBe(1);
    expect(s.absent).toBe(0);
  });

  it('24. exception counts come from the stored flags', async () => {
    const { service } = rig({
      isHr: true,
      employees: [employee('e1'), employee('e2')],
      regularizationCount: 3,
      records: [
        record('e1', { exceptionFlags: ['LOCATION_OUTSIDE_GEOFENCE', 'MISSING_PUNCH_OUT'] }),
        record('e2', { exceptionFlags: ['PARTIALLY_FUNDED_LEAVE'] }),
      ],
    });

    const s = await service.todaySummary(HR, DATE);

    expect(s.exceptions.outsideGeofence).toBe(1);
    expect(s.exceptions.missingPunchOut).toBe(1);
    expect(s.exceptions.partialLeaveFunding).toBe(1);
    expect(s.exceptions.regularizationPending).toBe(3);
  });

  it('25. a count the console cannot compute is reported unavailable, never as zero', async () => {
    const { service } = rig({
      isHr: true,
      employees: [employee('e1'), employee('e2')],
      records: [record('e1')],
    });

    const s = await service.todaySummary(HR, DATE);

    // A blocked context produces no DailyAttendance row, so this genuinely
    // cannot be counted here. Zero would read to HR as "nobody is blocked";
    // null reads as "not worked out yet", which is the truth.
    expect(s.exceptions.configurationBlocked).toBeNull();
    expect(s.exceptions.configurationBlocked).not.toBe(0);

    // The counts that ARE derivable from stored rows stay numeric, so the null
    // is a deliberate signal rather than a broken summary.
    expect(typeof s.exceptions.missingPunch).toBe('number');
    expect(typeof s.notEvaluated).toBe('number');
  });

  it('25b. once a processing run has happened, the blocked count is real', async () => {
    const { service } = rig({
      isHr: true,
      employees: [employee('e1'), employee('e2')],
      records: [record('e1')],
      blockedFromLastRun: [
        { userId: 'e2', blockingReasons: ['MISSING_SHIFT_ASSIGNMENT'] },
      ],
    });

    const s = await service.todaySummary(HR, DATE);
    expect(s.exceptions.configurationBlocked).toBe(1);
  });

  it('25c. a manager never sees blocked employees outside their scope', async () => {
    const { service } = rig({
      isHr: false,
      reports: [{ id: 'emp-1' }],
      employees: [employee('emp-1')],
      blockedFromLastRun: [
        { userId: 'emp-1', blockingReasons: ['MISSING_SHIFT_ASSIGNMENT'] },
        { userId: 'someone-else', blockingReasons: ['MISSING_SHIFT_ASSIGNMENT'] },
      ],
    });

    const s = await service.todaySummary(MANAGER, DATE);
    // Only their own report counts; the company-wide run is not a leak.
    expect(s.exceptions.configurationBlocked).toBe(1);
  });

  it('25. an invalid date is refused rather than silently defaulted', async () => {
    const { service } = rig({ isHr: true });
    await expect(service.todaySummary(HR, '20-08-2026')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('HC-1 roster and register report stored results', () => {
  it('26. an employee with no record is shown as NOT_EVALUATED with a null status', async () => {
    const { service } = rig({
      isHr: true,
      employees: [employee('e1'), employee('e2')],
      records: [record('e1')],
    });

    const out = await service.roster(HR, { businessDate: DATE });

    const missing = out.rows.find((r) => r.employee.id === 'e2')!;
    expect(missing.status).toBeNull();
    expect(missing.evaluationState).toBe('NOT_EVALUATED');
    expect(missing.workedMinutes).toBeNull();
  });

  it('27. the monthly register counts stored classifications and never re-runs the evaluator', async () => {
    const { service, evaluator } = rig({
      isHr: true,
      employees: [employee('e1')],
      records: [
        record('e1', { status: 'PRESENT', workedMinutes: 480, breakMinutes: 60 }),
        record('e1', { status: 'LEAVE', workedMinutes: 0, breakMinutes: 0 }),
        record('e1', { status: 'WEEKLY_OFF', workedMinutes: 0, breakMinutes: 0 }),
      ],
    });

    const out = await service.monthlyRegister(HR, { from: '2026-08-01', to: '2026-08-05' });
    const row = out.rows[0];

    expect(row.present).toBe(1);
    expect(row.leave).toBe(1);
    expect(row.weeklyOff).toBe(1);
    expect(row.totalEffectiveWorkMinutes).toBe(480);
    expect(row.totalBreakMinutes).toBe(60);
    expect(evaluator.evaluate).not.toHaveBeenCalled();
    expect(evaluator.evaluateAndPersist).not.toHaveBeenCalled();
  });

  it('28. unevaluated days are reported, not counted as absence', async () => {
    const { service } = rig({
      isHr: true,
      employees: [employee('e1')],
      records: [record('e1', { status: 'PRESENT' })],
    });

    // Five days in the range, one evaluated.
    const out = await service.monthlyRegister(HR, { from: '2026-08-01', to: '2026-08-05' });
    const row = out.rows[0];

    expect(out.days).toBe(5);
    expect(row.notEvaluated).toBe(4);
    expect(row.absent).toBe(0);
  });

  it('29. the percentage denominator excludes non-working and unevaluated days', async () => {
    const { service } = rig({
      isHr: true,
      employees: [employee('e1')],
      records: [
        record('e1', { status: 'PRESENT' }),
        record('e1', { status: 'PRESENT' }),
        record('e1', { status: 'ABSENT' }),
        record('e1', { status: 'WEEKLY_OFF' }),
        record('e1', { status: 'HOLIDAY' }),
      ],
    });

    const out = await service.monthlyRegister(HR, { from: '2026-08-01', to: '2026-08-10' });
    const row = out.rows[0];

    // 5 stored days, of which 2 are non-working: 3 evaluated working days,
    // 2 attended. A weekly off must never count against anyone.
    expect(row.evaluatedWorkingDays).toBe(3);
    expect(row.attendancePercent).toBe(66.7);
  });

  it('30. an employee with nothing evaluated has no percentage rather than zero', async () => {
    const { service } = rig({ isHr: true, employees: [employee('e1')], records: [] });

    const out = await service.monthlyRegister(HR, { from: '2026-08-01', to: '2026-08-05' });

    // 0% would read as "never attended". Null reads as "we do not know yet".
    expect(out.rows[0].attendancePercent).toBeNull();
    expect(out.rows[0].notEvaluated).toBe(5);
  });

  it('31. the register range is bounded', async () => {
    const { service } = rig({ isHr: true });
    await expect(
      service.monthlyRegister(HR, { from: '2026-01-01', to: '2026-12-31' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('HC-1 detail exposes facts, not evidence payloads', () => {
  it('32. the day detail never returns photo keys, hashes or coordinates', async () => {
    const { service, prisma } = rig({ isHr: true, records: [record('emp-1')] });
    prisma.attendancePunchEvidence.findMany.mockResolvedValue([
      {
        id: 'ev-1', type: 'PUNCH_IN', serverOccurredAt: new Date(),
        locationVerification: 'VERIFIED', photoVerification: 'CAPTURED',
        accuracyMeters: 12,
        // Present on the row, and deliberately not forwarded.
        photoObjectKey: 'cloudinary:authenticated:image:x:jpg',
        photoHash: 'a'.repeat(64), latitude: 18.5204, longitude: 73.8567,
      },
    ]);

    const detail = await service.dayDetail(HR, 'emp-1', DATE);
    const serialised = JSON.stringify(detail);

    expect(serialised).not.toContain('cloudinary');
    expect(serialised).not.toContain('a'.repeat(64));
    expect(serialised).not.toContain('18.5204');
    expect(detail.punchEvidence[0]).toMatchObject({
      locationVerification: 'VERIFIED',
      photoCaptured: true,
    });
  });

  it('33. the detail reports presence span and effective work as separate numbers', async () => {
    const { service, prisma } = rig({ isHr: true });
    prisma.dailyAttendance.findUnique.mockResolvedValue(
      record('emp-1', {
        punchInAt: new Date(`${DATE}T04:30:00.000Z`), // 10:00 IST
        punchOutAt: new Date(`${DATE}T14:00:00.000Z`), // 19:30 IST
        workedMinutes: 540, breakMinutes: 30,
      }),
    );

    const detail = await service.dayDetail(HR, 'emp-1', DATE);

    expect(detail.official!.presenceSpanMinutes).toBe(570);
    expect(detail.official!.effectiveWorkMinutes).toBe(540);
    expect(detail.official!.breakMinutes).toBe(30);
  });

  it('34. the detail carries the provenance needed to explain the result', async () => {
    const { service, prisma } = rig({ isHr: true });
    prisma.dailyAttendance.findUnique.mockResolvedValue(
      record('emp-1', {
        attendancePolicyId: 'ap-1', attendancePolicyVersion: 3,
        shiftPolicyId: 'shift-1', shiftPolicyVersion: 2,
        resolverVersion: 1, evaluatorVersion: 1, workSessionIds: ['ws-1'],
      }),
    );

    const detail = await service.dayDetail(HR, 'emp-1', DATE);

    expect(detail.official!.provenance).toMatchObject({
      attendancePolicyVersion: 3,
      shiftPolicyVersion: 2,
      evaluatorVersion: 1,
      workSessionIds: ['ws-1'],
    });
  });

  it('35. an employee can always read their own day', async () => {
    const { service } = rig({ isHr: false, reports: [] });

    // Scope is empty, but the subject is the caller.
    await expect(service.dayDetail({ id: 'emp-1' }, 'emp-1', DATE)).resolves.toBeDefined();
  });
});

describe('HC-1 review queue links back to existing sources', () => {
  it('36. queue items name the record they came from', async () => {
    const { service } = rig({
      isHr: true,
      records: [record('e1', { status: 'MISSING_PUNCH', evaluationState: 'NEEDS_REVIEW' })],
      regularizations: [
        {
          id: 'reg-1', userId: 'e1', date: dateOnly, status: 'PENDING',
          requestType: 'MISSING_PUNCH', reason: 'Browser crashed',
          user: { id: 'e1', name: 'E One', email: 'e1@x.com' },
        },
      ],
    });

    const queue = await service.reviewQueue(HR, { from: DATE, to: DATE });

    expect(queue.attendance[0]).toMatchObject({
      source: 'DAILY_ATTENDANCE',
      id: 'da-e1',
      businessDate: DATE,
      status: 'MISSING_PUNCH',
    });
    expect(queue.regularizations[0]).toMatchObject({
      source: 'REGULARIZATION',
      id: 'reg-1',
      stage: 'PENDING',
    });
  });

  it('37. the queue is scoped like everything else', async () => {
    const { service, prisma } = rig({ isHr: false, reports: [{ id: 'emp-1' }] });

    await service.reviewQueue(MANAGER, { from: DATE, to: DATE });

    expect(prisma.dailyAttendance.findMany.mock.calls[0][0].where.userId).toEqual({
      in: ['emp-1'],
    });
    expect(prisma.attendanceRegularization.findMany.mock.calls[0][0].where.userId).toEqual({
      in: ['emp-1'],
    });
  });

  it('38. the console controller exposes exactly two write routes', () => {
    const surface = Object.getOwnPropertyNames(AttendanceConsoleController.prototype).sort();
    expect(surface).toEqual([
      'access',
      'constructor',
      'detail',
      'evaluate',
      'finalize',
      'register',
      'reviewQueue',
      'roster',
      'summary',
    ]);
  });
});
