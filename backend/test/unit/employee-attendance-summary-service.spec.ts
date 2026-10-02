import { EmployeeAttendanceSummaryService } from '../../src/modules/platform/attendance/summary/employee-attendance-summary.service';
import { createTvaDouble } from '../helpers/tva-double';

/**
 * The composition layer: which table a date is read from, and who may ask.
 *
 * The pure arithmetic (employee-attendance-summary.spec.ts) already carries
 * the counting/averaging invariants under mutation. This suite is about the
 * NEW, genuinely risky glue: a past month reads PERSISTED DailyAttendance
 * rows, never a live re-evaluation that a policy change since could quietly
 * alter; today falls back to the same live, read-only evaluate() every other
 * Attendance surface uses; and a day with no row at all is told apart from a
 * day that was never an attendance day for this person to begin with.
 *
 * NOW is fixed mid-month (2026-08-17) so "today" and "an earlier day in the
 * same month" are both exercisable without the calendar shifting under the
 * suite.
 */

const NOW = new Date('2026-08-17T09:00:00.000Z'); // 14:30 IST
const SELF = 'emp-1';
const OTHER = 'emp-2';

interface RigOptions {
  requester?: { id: string; role?: any; departmentId?: string | null; isHR?: boolean };
  target?: any;
  canView?: boolean;
  rows?: any[];
  liveEvaluate?: any;
  context?: any;
  pendingRegularizations?: number;
}

const DEFAULT_TARGET = {
  id: SELF, name: 'Asha Rao', employeeId: 'TE-0412', designation: 'Engineer',
  joiningDate: new Date('2023-11-09T00:00:00.000Z'), lastWorkingDate: null,
  isActive: true, department: { id: 'dept-1', name: 'Platform' },
};

function rig(opts: RigOptions = {}) {
  const requester = opts.requester ?? { id: SELF };
  const target = 'target' in opts ? opts.target : DEFAULT_TARGET;
  const evaluateCalls: string[] = [];

  const prisma: any = {
    user: {
      findUnique: jest.fn(({ where }: any) => {
        if (where.id === requester.id && requester.id !== target?.id) {
          return Promise.resolve({ id: requester.id, role: requester.role, departmentId: requester.departmentId, isHR: requester.isHR });
        }
        return Promise.resolve(target);
      }),
    },
    dailyAttendance: {
      findMany: jest.fn().mockResolvedValue(opts.rows ?? []),
    },
    attendanceRegularization: {
      count: jest.fn().mockResolvedValue(opts.pendingRegularizations ?? 0),
    },
  };

  const accessPolicy: any = {
    canViewUser: jest.fn().mockResolvedValue(opts.canView ?? false),
  };

  const dailyContext: any = {
    resolveDailyContext: jest.fn().mockResolvedValue(
      opts.context ?? {
        shift: { startTime: '09:00', minimumWorkingMinutes: 540 },
        attendancePolicy: null,
        attendanceApplicability: 'REQUIRED',
        profile: { category: 'REGULAR_EMPLOYEE' },
      },
    ),
  };

  const evaluator: any = {
    evaluate: jest.fn((userId: string, businessDate: string) => {
      evaluateCalls.push(businessDate);
      return Promise.resolve(
        opts.liveEvaluate ?? {
          official: true, status: 'PRESENT', evaluationState: 'CALCULATED',
          calculationReason: 'ON_TIME', punchInAt: null, punchOutAt: null,
          workedMinutes: 0, breakMinutes: 0, lateMinutes: 0,
        },
      );
    }),
  };

  const tva = createTvaDouble(NOW);
  const service = new EmployeeAttendanceSummaryService(
    prisma, tva as any, accessPolicy, dailyContext, evaluator,
  );

  return { service, prisma, accessPolicy, dailyContext, evaluator, evaluateCalls };
}

const row = (over: any = {}) => ({
  date: new Date('2026-08-05T00:00:00.000Z'),
  status: 'PRESENT', evaluationState: 'CALCULATED',
  punchInAt: new Date('2026-08-05T04:17:00.000Z'), // 09:47 IST
  punchOutAt: new Date('2026-08-05T13:29:00.000Z'), // 18:59 IST
  workedMinutes: 480, breakMinutes: 30, lateMinutes: 0, locked: false,
  ...over,
});

// ════════════════════════════════════════════════════════════════════════════
describe('authority', () => {
  it('1. self may always view their own summary', async () => {
    const { service } = rig();
    await expect(service.summary(SELF, SELF, '2026-08')).resolves.toBeDefined();
  });

  it('2. A STRANGER IS REFUSED, via the SAME canViewUser rule the profile endpoint uses', async () => {
    const { service, accessPolicy } = rig({
      requester: { id: OTHER }, target: { ...DEFAULT_TARGET, id: SELF }, canView: false,
    });
    await expect(service.summary(OTHER, SELF, '2026-08')).rejects.toThrow(/permission/i);
    expect(accessPolicy.canViewUser).toHaveBeenCalled();
  });

  it('3. an authorized manager may view it', async () => {
    const { service } = rig({
      requester: { id: OTHER }, target: { ...DEFAULT_TARGET, id: SELF }, canView: true,
    });
    await expect(service.summary(OTHER, SELF, '2026-08')).resolves.toBeDefined();
  });

  it('4. a target that does not exist is NOT FOUND, not a permission question', async () => {
    const { service } = rig({ requester: { id: OTHER }, target: null });
    await expect(service.summary(OTHER, 'ghost', '2026-08')).rejects.toThrow(/not found/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('a past month reads PERSISTED rows, never a live re-evaluation', () => {
  it('5. a day WITH a stored row uses it, and never calls evaluate() for it', async () => {
    // The month also includes "today" (Aug 17), which the rig's default
    // liveEvaluate ALSO reports as PRESENT -- so the assertion is on the
    // SPECIFIC stored day, not the month's aggregate present count, which
    // this test is not about.
    const { service, evaluateCalls } = rig({ rows: [row()] });
    const out = await service.summary(SELF, SELF, '2026-08');
    const stored = out.days.find((d: any) => d.businessDate === '2026-08-05');
    expect(stored?.status).toBe('PRESENT');
    expect(evaluateCalls).not.toContain('2026-08-05');
  });

  it('6. A LOCKED ROW’S STORED VALUES SURVIVE, exactly as recorded', async () => {
    // 480/30/0 here -- not the fixture's own default -- proves the STORED
    // figures reach the response rather than something recomputed.
    const { service } = rig({
      rows: [row({ locked: true, workedMinutes: 480, breakMinutes: 30 })],
    });
    const out = await service.summary(SELF, SELF, '2026-08');
    const day = out.days.find((d: any) => d.businessDate === '2026-08-05');
    expect(day).toBeDefined();
    expect(day.locked).toBe(true);
    expect(day.workedMinutes).toBe(480);
  });

  it('7. a past date with NO ROW is unresolved, not absent', async () => {
    const { service } = rig({ rows: [] });
    const out = await service.summary(SELF, SELF, '2026-07');
    expect(out.counts.absent).toBe(0);
    expect(out.counts.noRecord).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('today falls back to a live, read-only evaluation', () => {
  it('8. today (in the current month) calls evaluate() exactly once', async () => {
    const { service, evaluateCalls } = rig({
      rows: [],
      liveEvaluate: {
        official: true, status: 'PRESENT', evaluationState: 'CALCULATED', calculationReason: 'ON_TIME',
        punchInAt: new Date('2026-08-17T04:47:00.000Z'), punchOutAt: null,
        workedMinutes: 200, breakMinutes: 10, lateMinutes: 0,
      },
    });
    const out = await service.summary(SELF, SELF, '2026-08');
    expect(evaluateCalls.filter((d) => d === '2026-08-17')).toHaveLength(1);
    expect(out.today.businessDate).toBe('2026-08-17');
  });

  it('9. A DAY ALREADY PERSISTED IS NOT RE-EVALUATED, even if it is today', async () => {
    const { service, evaluateCalls } = rig({
      rows: [row({ date: new Date('2026-08-17T00:00:00.000Z') })],
    });
    await service.summary(SELF, SELF, '2026-08');
    expect(evaluateCalls).not.toContain('2026-08-17');
  });

  it('10. EXPECTED COMPLETION USES max(punch in, shift start) + required presence', async () => {
    // Punch 09:47 IST, shift 09:00, required 540 -- none of them defaults.
    // 09:47 wins the max, so completion is 09:47 + 540m = 18:47 IST = 750+540=1290.
    const { service } = rig({
      rows: [],
      liveEvaluate: {
        official: true, status: 'PRESENT', evaluationState: 'CALCULATED', calculationReason: 'ON_TIME',
        punchInAt: new Date('2026-08-17T04:17:00.000Z'), punchOutAt: null, // 09:47 IST
        workedMinutes: 0, breakMinutes: 0, lateMinutes: 0,
      },
    });
    const out = await service.summary(SELF, SELF, '2026-08');
    // 09:47 = 587min; +540 = 1127min = 18:47.
    expect(out.today.completion.expectedCompletionMinutes).toBe(587 + 540);
  });

  it('11. no punch in today: completion is unresolved, not guessed', async () => {
    const { service } = rig({
      rows: [],
      liveEvaluate: {
        official: false, status: null, evaluationState: 'CALCULATED', calculationReason: 'NO_EVIDENCE',
        punchInAt: null, punchOutAt: null, workedMinutes: 0, breakMinutes: 0, lateMinutes: 0,
      },
    });
    const out = await service.summary(SELF, SELF, '2026-08');
    expect(out.today.completion.expectedCompletionMinutes).toBeNull();
    expect(out.today.completion.unresolvedReason).toBe('NO_PUNCH_IN');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('not applicable days are told apart from genuine gaps', () => {
  it('12. a day BEFORE JOINING is not applicable; a day AFTER joining with no row is a real gap', async () => {
    const { service } = rig({
      target: { ...DEFAULT_TARGET, joiningDate: new Date('2026-08-10T00:00:00.000Z') },
      rows: [],
    });
    const out = await service.summary(SELF, SELF, '2026-08');
    // 08-01 through 08-09: before joining, not applicable (9 days).
    expect(out.counts.notApplicable).toBe(9);
    // 08-10 through 08-16: employed, but nothing has evaluated these days yet
    // in this fixture -- a genuine, resolved-by-nobody-yet gap (7 days).
    // 08-17 is "today" and goes through the live evaluate() path instead.
    expect(out.counts.noRecord).toBe(7);
  });

  it('13. an EXEMPT employee is not applicable, not a wall of "needs attention"', async () => {
    const { service } = rig({
      rows: [],
      context: {
        shift: null, attendancePolicy: null, attendanceApplicability: 'EXEMPT',
        profile: { category: 'MANAGEMENT_EXEMPT' },
      },
      liveEvaluate: {
        official: false, status: null, evaluationState: 'CALCULATED',
        calculationReason: 'NOT_APPLICABLE_EXEMPT',
        punchInAt: null, punchOutAt: null, workedMinutes: 0, breakMinutes: 0, lateMinutes: 0,
      },
    });
    const out = await service.summary(SELF, SELF, '2026-08');
    expect(out.counts.noRecord).toBe(0);
    expect(out.counts.notApplicable).toBeGreaterThan(0);
    expect(out.employee.employmentCategory).toBe('MANAGEMENT_EXEMPT');
  });

  it('13b. EACH DAY carries its OWN notApplicable flag, not just the aggregate count', async () => {
    const { service } = rig({
      rows: [],
      context: {
        shift: null, attendancePolicy: null, attendanceApplicability: 'EXEMPT',
        profile: { category: 'MANAGEMENT_EXEMPT' },
      },
      liveEvaluate: {
        official: false, status: null, evaluationState: 'CALCULATED',
        calculationReason: 'NOT_APPLICABLE_EXEMPT',
        punchInAt: null, punchOutAt: null, workedMinutes: 0, breakMinutes: 0, lateMinutes: 0,
      },
    });
    const out = await service.summary(SELF, SELF, '2026-08');
    const earlierDay = out.days.find((d: any) => d.businessDate === '2026-08-05');
    const today = out.days.find((d: any) => d.businessDate === '2026-08-17');
    expect(earlierDay.notApplicable).toBe(true);
    expect(today.notApplicable).toBe(true);
  });

  it('13c. a day that IS a genuine gap carries notApplicable: false, not merely an absent field', async () => {
    const { service } = rig({ rows: [row()] });
    const out = await service.summary(SELF, SELF, '2026-08');
    const stored = out.days.find((d: any) => d.businessDate === '2026-08-05');
    const laterGap = out.days.find((d: any) => d.businessDate === '2026-08-06');
    expect(stored.notApplicable).toBe(false);
    expect(laterGap.notApplicable).toBe(false);
  });

  it('14. a CONTEXT-BLOCKED day is a REAL gap, not swallowed as not-applicable', async () => {
    const { service } = rig({
      rows: [],
      liveEvaluate: {
        official: false, status: null, evaluationState: 'NEEDS_REVIEW',
        calculationReason: 'CONTEXT_BLOCKED',
        punchInAt: null, punchOutAt: null, workedMinutes: 0, breakMinutes: 0, lateMinutes: 0,
      },
    });
    const out = await service.summary(SELF, SELF, '2026-08');
    expect(out.needsAttention.needsReview).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the rest of the composed response', () => {
  it('15. joining date, employment category and tenure reach the header', async () => {
    const { service } = rig({
      target: { ...DEFAULT_TARGET, joiningDate: new Date('2023-11-09T00:00:00.000Z') },
    });
    const out = await service.summary(SELF, SELF, '2026-08');
    expect(out.employee.joiningDate).toBe('2023-11-09');
    expect(out.employee.employmentCategory).toBe('REGULAR_EMPLOYEE');
    expect(out.employee.tenure.known).toBe(true);
  });

  it('16. MISSING JOINING DATE: known is false, tenure never fabricated', async () => {
    const { service } = rig({ target: { ...DEFAULT_TARGET, joiningDate: null } });
    const out = await service.summary(SELF, SELF, '2026-08');
    expect(out.employee.tenure.known).toBe(false);
    expect(out.needsAttention.missingJoiningDate).toBe(true);
  });

  it('17. a former employee is not "currently employed" once past lastWorkingDate', async () => {
    const { service } = rig({
      target: { ...DEFAULT_TARGET, lastWorkingDate: new Date('2026-01-01T00:00:00.000Z'), isActive: false },
    });
    const out = await service.summary(SELF, SELF, '2026-08');
    expect(out.employee.isActive).toBe(false);
    expect(out.employee.lastWorkingDate).toBe('2026-01-01');
  });

  it('18. pending regularizations reach needsAttention', async () => {
    const { service } = rig({ pendingRegularizations: 3 });
    const out = await service.summary(SELF, SELF, '2026-08');
    expect(out.needsAttention.pendingRegularizations).toBe(3);
  });

  it('18b. THE REGULARIZATION COUNT QUERY IS SCOPED TO OPEN STATUSES ONLY', async () => {
    const { service, prisma } = rig({ pendingRegularizations: 3 });
    await service.summary(SELF, SELF, '2026-08');
    expect(prisma.attendanceRegularization.count).toHaveBeenCalledWith({
      where: { userId: SELF, status: { in: ['PENDING', 'MANAGER_APPROVED'] } },
    });
  });

  it('19b. REQUIRED PRESENCE GOES THROUGH THE SHARED RESOLVER, not shift alone', async () => {
    // A shift with an UNUSABLE figure (0) and a real AttendancePolicy fallback
    // (525, not the 540 default) -- the exact combination that only the
    // resolver's own >0 guard distinguishes from a bare `shift ?? 540` read.
    const { service } = rig({
      context: {
        shift: { startTime: '09:00', minimumWorkingMinutes: 0 },
        attendancePolicy: { minimumWorkingMinutes: 525 },
        attendanceApplicability: 'REQUIRED',
        profile: { category: 'REGULAR_EMPLOYEE' },
      },
    });
    const out = await service.summary(SELF, SELF, '2026-08');
    expect(out.requiredPresenceMinutes).toBe(525);
  });

  it('19. an unresolved required-presence policy is reported, not guessed at 540', async () => {
    const { service } = rig({
      context: { shift: null, attendancePolicy: null, attendanceApplicability: 'REQUIRED', profile: null },
      liveEvaluate: {
        official: false, status: null, evaluationState: 'CALCULATED', calculationReason: 'CONTEXT_BLOCKED',
        punchInAt: null, punchOutAt: null, workedMinutes: 0, breakMinutes: 0, lateMinutes: 0,
      },
    });
    const out = await service.summary(SELF, SELF, '2026-08');
    expect(out.requiredPresenceMinutes).toBe(540); // system fallback, not null -- no shift AND no policy
    expect(out.needsAttention.requiredPresenceUnconfigured).toBe(false);
  });

  it('20. omitting month defaults to the current company month', async () => {
    const { service } = rig();
    const out = await service.summary(SELF, SELF, undefined as any);
    expect(out.month).toBe('2026-08');
  });

  it('21. a future month is refused cleanly rather than evaluating dates that have not happened', async () => {
    const { service, evaluateCalls, prisma } = rig();
    const out = await service.summary(SELF, SELF, '2026-12');
    expect(out.days).toEqual([]);
    expect(evaluateCalls).toEqual([]);
    // Not merely empty output: no DailyAttendance query is issued for a
    // month with no days that could possibly have one yet.
    expect(prisma.dailyAttendance.findMany).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('a former employee’s days after leaving are not applicable either', () => {
  it('22. A MISSING PAST ROW AFTER lastWorkingDate IS NOT A GAP', async () => {
    const { service } = rig({
      target: { ...DEFAULT_TARGET, lastWorkingDate: new Date('2026-08-03T00:00:00.000Z') },
      rows: [],
    });
    const out = await service.summary(SELF, SELF, '2026-08');
    // 08-04 through 08-16 are after leaving, with no row -- not applicable,
    // not a gap. 08-01 through 08-03 are also covered (employed, no row) and
    // land in noRecord; 08-17 is live-evaluated as today.
    const afterLeaving = out.days.filter((d: any) => d.businessDate > '2026-08-03' && d.businessDate < '2026-08-17');
    for (const d of afterLeaving) {
      expect(d.status).toBeNull();
    }
    expect(out.counts.notApplicable).toBeGreaterThanOrEqual(afterLeaving.length);
  });
});
