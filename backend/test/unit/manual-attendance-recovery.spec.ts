import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RegularizationService } from '../../src/modules/platform/attendance/regularization/regularization.service';

// The last resort in a three-step hierarchy: laptop, then the employee's phone
// by QR, then an authorised person recording the punch by hand. It exists so an
// outage does not make attendance impossible to record -- and it must never
// become the ordinary route, which is why an employee cannot reach it at all.
//
// The camera now fails closed, so this path is what catches the punches the
// gate refuses.

const NOW = new Date('2026-08-29T13:00:00.000Z');
const DATE = '2026-08-29';
const dateOnly = new Date(`${DATE}T00:00:00.000Z`);

const EMPLOYEE = 'emp-1';
const MANAGER = { id: 'mgr-1', role: { name: 'MANAGER' } };
const HR = { id: 'hr-1', role: { name: 'HR' } };
const OUTSIDER = { id: 'mgr-9', role: { name: 'MANAGER' } };

function build(over: any = {}) {
  const created: any[] = [];
  const audit: any[] = [];

  const prisma: any = {
    attendanceRegularization: {
      findFirst: jest.fn().mockResolvedValue(over.openRequest ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: 'reg-1', ...data };
        created.push(row);
        return row;
      }),
    },
    dailyAttendance: {
      findUnique: jest.fn().mockResolvedValue(over.official ?? null),
    },
  };

  const tva: any = {
    now: () => NOW,
    companyDateOnly: () => dateOnly,
    companyTimezone: () => 'Asia/Kolkata',
    companyBusinessDate: () => DATE,
  };
  const accessPolicy: any = {
    isHrOrAdmin: (u: any) => ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(u?.role?.name),
    roleName: (u: any) => u?.role?.name ?? 'EMPLOYEE',
  };
  const hierarchy: any = {
    isApproverFor: jest.fn(async (actorId: string) => actorId === MANAGER.id),
  };
  const eventLogger: any = {
    log: jest.fn(async (e: any) => {
      if (over.auditThrows) throw new Error('audit down');
      audit.push(e);
    }),
  };
  const settings: any = { get: jest.fn().mockResolvedValue({ regularizationEnabled: true }) };
  const evaluator: any = { reviseForApprovedCorrection: jest.fn() };

  const service = new RegularizationService(
    prisma,
    tva,
    eventLogger,
    hierarchy,
    accessPolicy,
    settings,
    evaluator,
  );
  // The feature gate reads settings; short-circuit it for these cases.
  (service as any).enabled = async () => over.enabled !== false;

  return { service, prisma, created, audit, hierarchy };
}

const input = (over: any = {}) => ({
  userId: EMPLOYEE,
  businessDate: DATE,
  requestedPunchOut: '2026-08-29T13:00:00.000Z',
  recoveryReason: 'SERVER_UNAVAILABLE',
  reason: 'Apex OS was unavailable when the employee tried to punch out.',
  employeeInformedAt: '2026-08-29T13:06:00.000Z',
  ...over,
});

describe('who may record a manual punch', () => {
  it('refuses the employee recording their own', async () => {
    // The whole point: an employee who could write their own authoritative
    // punch would make evidence optional.
    const { service } = build();

    await expect(
      service.createManualRecovery({ id: EMPLOYEE, role: { name: 'EMPLOYEE' } }, input() as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a manager outside their managed scope', async () => {
    const { service } = build();

    await expect(service.createManualRecovery(OUTSIDER, input() as any)).rejects.toThrow(
      /only record a manual punch for an employee you manage/i,
    );
  });

  it('allows a manager for an employee they manage', async () => {
    const { service, created } = build();
    await service.createManualRecovery(MANAGER, input() as any);

    expect(created).toHaveLength(1);
  });

  it('allows HR regardless of reporting line', async () => {
    const { service, created, hierarchy } = build();
    await service.createManualRecovery(HR, input() as any);

    expect(created).toHaveLength(1);
    // HR authority does not depend on being in the chain.
    expect(hierarchy.isApproverFor).toHaveBeenCalled();
  });
});

describe('the justification is mandatory and durable', () => {
  it.each([
    ['no reason category', { recoveryReason: undefined }, /select why/i],
    ['unknown reason category', { recoveryReason: 'MADE_UP' }, /select why/i],
    ['no explanation', { reason: '' }, /explain what happened/i],
    ['a token explanation', { reason: 'oops' }, /explain what happened/i],
    ['no informed time', { employeeInformedAt: undefined }, /when the employee reported/i],
    [
      'neither punch value',
      { requestedPunchIn: undefined, requestedPunchOut: undefined },
      /punch in or punch out time/i,
    ],
  ])('refuses %s', async (_label, over, message) => {
    const { service } = build();

    await expect(service.createManualRecovery(MANAGER, input(over) as any)).rejects.toThrow(
      message,
    );
  });

  it('survives an audit failure, because the row carries the justification', async () => {
    // EventLogger is best-effort and catches its own errors. If the reason
    // lived only there, a failed write would leave an authoritative punch
    // nobody can justify.
    const { service, created } = build({ auditThrows: true });
    await service.createManualRecovery(MANAGER, input() as any);

    expect(created[0].reason).toMatch(/Apex OS was unavailable/);
    expect(created[0].recoveryReason).toBe('SERVER_UNAVAILABLE');
    expect(created[0].employeeInformedAt).toEqual(new Date('2026-08-29T13:06:00.000Z'));
  });
});

describe('creator and approver stay distinct', () => {
  it('records who entered it, separately from who approves', async () => {
    const { service, created } = build();
    await service.createManualRecovery(MANAGER, input() as any);

    expect(created[0].createdById).toBe(MANAGER.id);
    expect(created[0].entrySource).toBe('MANUAL_RECOVERY');
  });

  it('snapshots the role held AT ENTRY', async () => {
    // If this manager later becomes HR, the record must still say a manager
    // entered it.
    const { service, created } = build();
    await service.createManualRecovery(MANAGER, input() as any);

    expect(created[0].actorRoleAtEntry).toBe('MANAGER');
  });

  it('starts at MANAGER_APPROVED with the creator as that approver', async () => {
    // The creator's act of entering IS their operational judgment; making them
    // immediately approve their own entry would be ceremony, not control.
    const { service, created } = build();
    await service.createManualRecovery(MANAGER, input() as any);

    expect(created[0].status).toBe('MANAGER_APPROVED');
    expect(created[0].managerApproverId).toBe(MANAGER.id);
    expect(created[0].managerDecisionAt).toEqual(NOW);
  });

  it('leaves HR approval outstanding — nothing official has changed', async () => {
    const { service, created } = build();
    await service.createManualRecovery(MANAGER, input() as any);

    expect(created[0].hrApproverId).toBeUndefined();
    expect(created[0].status).not.toBe('HR_APPROVED');
  });
});

describe('the old value is preserved at creation', () => {
  it('records nulls when adding a punch that did not exist', async () => {
    const { service, created } = build({ official: { punchInAt: null, punchOutAt: null } });
    await service.createManualRecovery(MANAGER, input() as any);

    expect(created[0].originalPunchOut).toBeNull();
    expect(created[0].requestedPunchOut).toEqual(new Date('2026-08-29T13:00:00.000Z'));
  });

  it('records the existing value when correcting one', async () => {
    // Six months later this row must still say 18:04 -> 18:31 on its own: once
    // the official record is rewritten the previous value exists nowhere else.
    const before = new Date('2026-08-29T12:34:00.000Z');
    const { service, created } = build({
      official: { punchOutAt: before, punchInAt: null, sourceFingerprint: 'fp-1' },
    });

    await service.createManualRecovery(
      MANAGER,
      input({ correctExisting: true, requestedPunchOut: '2026-08-29T13:01:00.000Z' }) as any,
    );

    expect(created[0].originalPunchOut).toEqual(before);
    expect(created[0].requestedPunchOut).toEqual(new Date('2026-08-29T13:01:00.000Z'));
  });

  it('captures the fingerprint so a stale correction cannot overwrite a newer result', async () => {
    const { service, created } = build({ official: { sourceFingerprint: 'fp-1' } });
    await service.createManualRecovery(MANAGER, input() as any);

    expect(created[0].basedOnFingerprint).toBe('fp-1');
  });
});

describe('duplicate protection', () => {
  it('refuses adding a punch out when one already exists', async () => {
    const { service } = build({
      official: { punchOutAt: new Date('2026-08-29T12:34:00.000Z'), punchInAt: null },
    });

    await expect(service.createManualRecovery(MANAGER, input() as any)).rejects.toThrow(
      /already exists.*Correct it instead/is,
    );
  });

  it('refuses adding a punch in when one already exists', async () => {
    const { service } = build({
      official: { punchInAt: new Date('2026-08-29T04:00:00.000Z'), punchOutAt: null },
    });

    await expect(
      service.createManualRecovery(
        MANAGER,
        input({ requestedPunchIn: '2026-08-29T04:05:00.000Z', requestedPunchOut: undefined }) as any,
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it('allows it when the actor deliberately chose to correct', async () => {
    const { service, created } = build({
      official: { punchOutAt: new Date('2026-08-29T12:34:00.000Z'), punchInAt: null },
    });

    await service.createManualRecovery(MANAGER, input({ correctExisting: true }) as any);

    expect(created).toHaveLength(1);
  });

  it('refuses a second recovery while one is already under review', async () => {
    const { service } = build({ openRequest: { id: 'reg-existing', status: 'MANAGER_APPROVED' } });

    await expect(service.createManualRecovery(MANAGER, input() as any)).rejects.toThrow(
      /already under review/i,
    );
  });
});

describe('no evidence is fabricated', () => {
  it('writes no coordinates, accuracy, geofence verdict or photo', async () => {
    // Manufacturing any of these would make an unevidenced punch
    // indistinguishable from a verified one.
    const { service, created } = build();
    await service.createManualRecovery(MANAGER, input() as any);

    const row = created[0];
    for (const field of [
      'latitude',
      'longitude',
      'accuracyMeters',
      'photoAssetId',
      'locationVerification',
      'photoVerification',
    ]) {
      expect(row[field]).toBeUndefined();
    }
  });

  it('records the before and after values in the audit too', async () => {
    const { service, audit } = build({
      official: { punchOutAt: new Date('2026-08-29T12:34:00.000Z'), punchInAt: null },
    });
    await service.createManualRecovery(MANAGER, input({ correctExisting: true }) as any);

    const event = audit[0];

    expect(event.beforeValue.punchOutAt).toEqual(new Date('2026-08-29T12:34:00.000Z'));
    expect(event.afterValue.punchOutAt).toEqual(new Date('2026-08-29T13:00:00.000Z'));
    expect(event.metadata.entrySource).toBe('MANUAL_RECOVERY');
    expect(event.metadata.actorRole).toBe('MANAGER');
  });
});

describe('ordinary employee requests are unaffected', () => {
  it('still creates at PENDING with no recovery fields', async () => {
    const { service, created } = build();
    await service.create(EMPLOYEE, {
      businessDate: DATE,
      requestType: 'MISSING_PUNCH',
      reason: 'Forgot to punch out before leaving.',
    } as any);

    expect(created[0].status).toBe('PENDING');
    expect(created[0].createdById).toBeUndefined();
    expect(created[0].entrySource).toBeUndefined();
    expect(created[0].recoveryReason).toBeUndefined();
  });
});

describe('AR-1b the shared correction rules reach the service', () => {
  it('20. refuses a punch pair that ends before it starts', async () => {
    const { service } = build();

    // Nothing enforced this before the rules were extracted: an inverted pair
    // reached the evaluator and became a nonsensical presence on a record that
    // feeds payroll.
    await expect(
      service.createManualRecovery(HR, input({
        requestedPunchIn: '2026-08-29T13:00:00.000Z',
        requestedPunchOut: '2026-08-29T04:00:00.000Z',
      }) as any),
    ).rejects.toThrow(/must be after punch in/i);
  });

  it('21. still refuses a proposal that asserts nothing', async () => {
    const { service } = build();

    await expect(
      service.createManualRecovery(HR, input({
        requestedPunchIn: undefined,
        requestedPunchOut: undefined,
      }) as any),
    ).rejects.toThrow(/punch in or punch out/i);
  });

  it('22. still refuses a token explanation', async () => {
    const { service } = build();

    await expect(
      service.createManualRecovery(HR, input({ reason: 'outage' }) as any),
    ).rejects.toThrow(/Explain what happened/i);
  });
});
