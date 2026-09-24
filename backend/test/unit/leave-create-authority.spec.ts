import 'reflect-metadata';
import { LeaveService } from '../../src/modules/operations/leave/leave.service';
import { LeaveController } from '../../src/modules/operations/leave/leave.controller';
import { CreateLeaveRequestDto } from '../../src/modules/operations/leave/dto/create-leave-request.dto';

/**
 * P0: what an employee may put in their own leave request.
 *
 * The incident: POST /leave took `@Body() body: any`, so the global
 * ValidationPipe -- correctly configured with whitelist and
 * forbidNonWhitelisted -- had no DTO metatype to validate against and skipped
 * the request entirely. LeaveService.create then destructured five fields and
 * spread the REST straight into prisma.leaveRequest.create. Six fields were
 * reassigned after the spread and were therefore safe; every other column on
 * the model, `status` among them, was whatever the client sent.
 *
 * These tests assert on the object actually handed to Prisma, not on what the
 * service returns. A mock returning a tidy row would let a forged status pass
 * unnoticed; the write itself is the boundary under test.
 *
 * FIXTURES AVOID EVERY DEFAULT. A forged approver id that is not the
 * requester, a decision timestamp in 2019 that no clock here would produce,
 * 4.5 paid days against 0.5 unpaid, and a leave type of EMERGENCY rather than
 * the CASUAL every other fixture uses.
 */

const EMPLOYEE = 'emp-4417';
const OTHER_EMPLOYEE = 'emp-9002';
const A_MANAGER = 'mgr-7781';

function rig(opts: { validate?: jest.Mock } = {}) {
  const created: any[] = [];
  const prisma: any = {
    leaveRequest: {
      create: jest.fn((args: any) => {
        created.push(args);
        return Promise.resolve({
          id: 'leave-1',
          type: args.data.type ?? 'EMERGENCY',
          userId: args.data.userId,
          startDate: new Date('2026-09-28T00:00:00.000Z'),
          endDate: new Date('2026-09-29T00:00:00.000Z'),
          user: { id: args.data.userId, name: 'Asha Rao', departmentId: null },
        });
      }),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const service = new LeaveService(
    prisma,
    { emitLeaveStatusChanged: jest.fn() } as any,
    { sendNotification: jest.fn().mockResolvedValue(undefined) } as any,
    { get: jest.fn() } as any,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    {} as any,
    { validateLeaveRequest: opts.validate ?? jest.fn().mockResolvedValue(undefined) } as any,
    {} as any,
    {} as any,
    { now: () => new Date('2026-09-24T09:00:00.000Z') } as any,
    {} as any,
    {} as any,
  );

  return { service, prisma, created, dataOf: () => created[0]?.data ?? {} };
}

/** A legitimate request: intent only, nothing authoritative. */
const legitimate = () => ({
  type: 'EMERGENCY',
  startDate: '2026-09-28',
  endDate: '2026-09-29',
  reason: 'Family medical emergency, travelling to Coimbatore.',
});

// ════════════════════════════════════════════════════════════════════════════
describe('an employee cannot grant their own leave', () => {
  it('1. A FORGED APPROVED STATUS NEVER REACHES THE DATABASE', async () => {
    const { service, dataOf } = rig();
    await service.create({ ...legitimate(), status: 'APPROVED' }, EMPLOYEE);
    // The headline of the incident. Anything other than the server's own
    // initial state here means an employee approved their own leave.
    expect(dataOf().status).toBe('PENDING');
  });

  it('2. every other status an employee might name is refused just as hard', async () => {
    for (const forged of ['APPROVED', 'REJECTED', 'CANCELLED']) {
      const { service, dataOf } = rig();
      await service.create({ ...legitimate(), status: forged }, EMPLOYEE);
      expect({ forged, written: dataOf().status }).toEqual({ forged, written: 'PENDING' });
    }
  });

  it('3. A FORGED APPROVER IDENTITY IS NOT WRITTEN', async () => {
    const { service, dataOf } = rig();
    await service.create(
      {
        ...legitimate(),
        status: 'APPROVED',
        approvedBy: A_MANAGER,
        approvedAt: '2019-03-11T04:30:00.000Z',
        rejectedBy: A_MANAGER,
        rejectedAt: '2019-03-11T04:30:00.000Z',
      },
      EMPLOYEE,
    );
    const data = dataOf();
    expect(data.approvedBy).toBeUndefined();
    expect(data.approvedAt).toBeUndefined();
    expect(data.rejectedBy).toBeUndefined();
    expect(data.rejectedAt).toBeUndefined();
  });

  it('4. THE TWO-STAGE APPROVAL CHAIN CANNOT BE SKIPPED FROM THE CLIENT', async () => {
    // approvalStage is what routes a request through manager then HR. A client
    // starting it at HR_REVIEW skips the manager entirely; one starting it
    // COMPLETED skips both.
    const { service, dataOf } = rig();
    await service.create(
      {
        ...legitimate(),
        approvalStage: 'COMPLETED',
        managerApprovedById: A_MANAGER,
        managerApprovedAt: '2019-03-11T04:30:00.000Z',
        hrApprovedById: A_MANAGER,
        hrApprovedAt: '2019-03-11T04:30:00.000Z',
      },
      EMPLOYEE,
    );
    const data = dataOf();
    expect(data.approvalStage).toBeUndefined();
    expect(data.managerApprovedById).toBeUndefined();
    expect(data.managerApprovedAt).toBeUndefined();
    expect(data.hrApprovedById).toBeUndefined();
    expect(data.hrApprovedAt).toBeUndefined();
  });

  it('5. PAYROLL CONSEQUENCE FIELDS ARE NOT EMPLOYEE INPUT', async () => {
    // fundingOutcome, paidDays and unpaidDays are the settlement's own output
    // and feed Finance-facing reports. A request arriving with them already
    // filled in asserts a payroll outcome nobody decided.
    const { service, dataOf } = rig();
    await service.create(
      { ...legitimate(), fundingOutcome: 'FULLY_PAID', paidDays: 4.5, unpaidDays: 0.5 },
      EMPLOYEE,
    );
    const data = dataOf();
    expect(data.fundingOutcome).toBeUndefined();
    expect(data.paidDays).toBeUndefined();
    expect(data.unpaidDays).toBeUndefined();
  });

  it('6. AUDIT AND IDENTITY COLUMNS ARE THE SERVER’S', async () => {
    const { service, dataOf } = rig();
    await service.create(
      {
        ...legitimate(),
        id: 'leave-chosen-by-the-client',
        createdAt: '2019-03-11T04:30:00.000Z',
        updatedAt: '2019-03-11T04:30:00.000Z',
      },
      EMPLOYEE,
    );
    const data = dataOf();
    expect(data.id).toBeUndefined();
    expect(data.createdAt).toBeUndefined();
    expect(data.updatedAt).toBeUndefined();
  });

  it('7. LEAVE CANNOT BE FILED IN SOMEBODY ELSE’S NAME', async () => {
    const { service, dataOf } = rig();
    await service.create({ ...legitimate(), userId: OTHER_EMPLOYEE }, EMPLOYEE);
    // The owner is the authenticated caller, never the body.
    expect(dataOf().userId).toBe(EMPLOYEE);
  });

  it('8. NOR THROUGH A NESTED RELATION WRITE', async () => {
    // Prisma accepts `user: { connect: { id } }` as an alternative spelling of
    // ownership. Stripping the scalar while leaving the relation open would
    // have moved the hole rather than closed it.
    const { service, dataOf } = rig();
    await service.create(
      { ...legitimate(), user: { connect: { id: OTHER_EMPLOYEE } } } as any,
      EMPLOYEE,
    );
    const data = dataOf();
    expect(data.user).toBeUndefined();
    expect(data.userId).toBe(EMPLOYEE);
  });

  it('9. NO UNKNOWN FIELD SURVIVES INTO THE WRITE', async () => {
    // The allow-list is positive: anything the incident did not anticipate,
    // and anything a future column adds, is absent by construction rather than
    // by being individually named in a deny-list.
    const { service, dataOf } = rig();
    await service.create(
      { ...legitimate(), somethingNobodyHasThoughtOf: 'x', compOffCredits: { connect: [] } } as any,
      EMPLOYEE,
    );
    const data = dataOf();
    expect(data.somethingNobodyHasThoughtOf).toBeUndefined();
    expect(data.compOffCredits).toBeUndefined();
    expect(Object.keys(data).sort()).toEqual([
      'endDate', 'halfDaySession', 'halfDayType', 'isHalfDay',
      'reason', 'startDate', 'status', 'type', 'userId',
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('a legitimate request is unaffected', () => {
  it('10. intent fields are written exactly as asked', async () => {
    const { service, dataOf } = rig();
    await service.create(legitimate(), EMPLOYEE);
    const data = dataOf();
    expect(data.type).toBe('EMERGENCY');
    expect(data.reason).toBe('Family medical emergency, travelling to Coimbatore.');
    expect(data.userId).toBe(EMPLOYEE);
    expect(data.status).toBe('PENDING');
    expect(data.isHalfDay).toBe(false);
  });

  it('11. a half-day request keeps both the typed field and its mirror', async () => {
    const { service, dataOf } = rig();
    await service.create(
      { ...legitimate(), endDate: '2026-09-28', isHalfDay: true, halfDaySession: 'SECOND_HALF' },
      EMPLOYEE,
    );
    const data = dataOf();
    expect(data.isHalfDay).toBe(true);
    expect(data.halfDaySession).toBe('SECOND_HALF');
    expect(data.halfDayType).toBe('SECOND_HALF');
  });

  it('12. the existing validations still run and still refuse', async () => {
    const { service } = rig();
    await expect(service.create({ ...legitimate(), type: 'NOT_A_TYPE' }, EMPLOYEE))
      .rejects.toThrow(/Invalid leave type/);
    await expect(
      service.create({ ...legitimate(), startDate: '2026-09-30', endDate: '2026-09-28' }, EMPLOYEE),
    ).rejects.toThrow(/cannot be after/);
    await expect(
      service.create({ ...legitimate(), halfDaySession: 'FIRST_HALF' }, EMPLOYEE),
    ).rejects.toThrow(/valid only for a half-day/);
  });

  it('13. the balance check still runs, and still runs for the CALLER', async () => {
    const validate = jest.fn().mockResolvedValue(undefined);
    const { service } = rig({ validate });
    await service.create({ ...legitimate(), userId: OTHER_EMPLOYEE }, EMPLOYEE);
    // Validating the forged owner's balance instead of the caller's would let
    // somebody spend an entitlement that is not theirs.
    expect(validate).toHaveBeenCalledWith(
      EMPLOYEE, expect.any(Date), expect.any(Date), false, 'EMERGENCY',
    );
  });

  it('14. a request that fails the balance check is never written', async () => {
    const validate = jest.fn().mockRejectedValue(new Error('Insufficient balance'));
    const { service, created } = rig({ validate });
    await expect(service.create(legitimate(), EMPLOYEE)).rejects.toThrow(/Insufficient balance/);
    expect(created).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the HTTP boundary is what makes the ValidationPipe engage', () => {
  it('15. THE CREATE HANDLER IS TYPED WITH THE DTO, checked at runtime', () => {
    // NOT a regex over the source. The global ValidationPipe decides whether
    // to validate a handler by looking at exactly this reflected metadata: an
    // `any` body reflects as Object, the pipe's toValidate() returns false,
    // and whitelist/forbidNonWhitelisted are skipped for that route. Reading
    // the same metadata the pipe reads is the only guard that proves the
    // thing that actually matters.
    const params = Reflect.getMetadata(
      'design:paramtypes', LeaveController.prototype, 'create',
    );
    expect(params[0]).toBe(CreateLeaveRequestDto);
    expect(params[0]).not.toBe(Object);
  });

  it('16. THE CONTROLLER PASSES THE TOKEN’S OWNER, never the body’s', () => {
    const create = jest.fn().mockResolvedValue({ id: 'leave-1' });
    const controller = new LeaveController({ create } as any, {} as any);
    controller.create(
      { ...legitimate(), userId: OTHER_EMPLOYEE } as any,
      { id: EMPLOYEE },
    );
    expect(create).toHaveBeenCalledWith(expect.anything(), EMPLOYEE);
    expect(create.mock.calls[0][1]).not.toBe(OTHER_EMPLOYEE);
  });

  it('17. the DTO admits intent only, and names no authoritative column', () => {
    // The absences are the security property, so they are asserted rather
    // than left to a reader noticing they are missing.
    const dto = new CreateLeaveRequestDto();
    const declared = Reflect.getMetadata('design:paramtypes', CreateLeaveRequestDto) ?? [];
    expect(declared).toEqual([]); // no constructor injection, a plain shape
    for (const forbidden of [
      'status', 'approvedBy', 'approvedAt', 'rejectedBy', 'rejectedAt',
      'approvalStage', 'managerApprovedById', 'hrApprovedById',
      'fundingOutcome', 'paidDays', 'unpaidDays', 'userId', 'id',
    ]) {
      expect({ forbidden, present: forbidden in dto }).toEqual({ forbidden, present: false });
    }
  });
});
