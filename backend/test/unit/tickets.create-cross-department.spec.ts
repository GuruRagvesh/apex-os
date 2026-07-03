import { BadRequestException } from '@nestjs/common';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';

// TicketsService.create() — cross-department QUERY/HELP routing + the EMPLOYEE/
// INTERN self-assign gate. The self-assign force must stay exactly as before for
// TASK (regression coverage — this behavior was previously unconditional and is
// now gated on type), while QUERY/HELP must be able to target someone else,
// including in another department, with the dormant Ticket routing fields
// (requestingDepartmentId/targetDepartmentId/*TeamId/isCrossDepartment) populated.
//
// IDs below are UUID-shaped on purpose: normalizeTicketCreateData() only does a
// department/user *name* lookup for non-UUID values, and this suite isn't testing
// that lookup (tickets.create-assignee.spec.ts already covers it) — UUID-shaped
// ids keep these tests isolated to the cross-department population logic itself.
const DEPT_A = '11111111-1111-1111-1111-111111111111';
const DEPT_B = '22222222-2222-2222-2222-222222222222';
const USER_TARGET_IN_B = '44444444-4444-4444-4444-444444444444';
const USER_COLLEAGUE_IN_A = '55555555-5555-5555-5555-555555555555';
const USER_MISMATCHED_DEPT = '66666666-6666-6666-6666-666666666666';
const USER_INACTIVE = '77777777-7777-7777-7777-777777777777';

describe('TicketsService.create — QUERY/HELP cross-department routing', () => {
  let prisma: any;
  let service: TicketsService;

  function makeService() {
    prisma = {
      department: { findFirst: jest.fn() },
      user: {
        // Real production ids (cuid()) never match isUUID() either, so create()'s
        // generic "resolve assignedToId by id-or-name" always round-trips through
        // this lookup — echo the id back to simulate "this id is a real, existing
        // user", matching what actually happens against a live database.
        findFirst: jest.fn(async ({ where }: any) => {
          const id = where?.OR?.[0]?.id;
          return id ? { id, name: 'Test User' } : null;
        }),
        findUnique: jest.fn(),
      },
      teamMember: { findFirst: jest.fn().mockResolvedValue(null) },
      ticket: { create: jest.fn() },
      ticketAssignee: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
      appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([{ max: 0 }]),
    };
    prisma.ticket.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'ticket-1', ticketId: 'TKT-001', assignedTo: null, ...data }),
    );

    return new TicketsService(
      prisma,
      { emitTicketCreated: jest.fn() } as any, // gateway
      { sendNotification: jest.fn().mockResolvedValue(null) } as any, // notificationEventService
      { get: jest.fn() } as any, // configService
      { emit: jest.fn() } as any, // eventEmitter
      { log: jest.fn().mockReturnValue({ catch: jest.fn() }) } as any, // eventLogger
      {} as any, // ticketAccess (not used by create())
      { resolveTaskCreationApprover: jest.fn() } as any, // hierarchyApprovalService
      { decorateTicket: jest.fn((t: any) => Promise.resolve(t)) } as any, // ticketTiming
      { startReviewCycle: jest.fn(), endReviewCycle: jest.fn() } as any, // ticketLedger
      {} as any, // ticketImport
    );
  }

  const employee = { id: 'emp-1', role: { name: 'EMPLOYEE' } };

  it('TASK from an Employee is still force-self-assigned (unchanged regression coverage)', async () => {
    service = makeService();
    await service.create(
      { title: 'Fix bug', category: 'OPERATIONS', priority: 'HIGH', type: 'TASK', assignedToId: USER_TARGET_IN_B },
      'emp-1',
      employee,
    );
    expect(prisma.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedToId: 'emp-1' }) }),
    );
  });

  it('QUERY from an Employee is NOT force-self-assigned — the chosen recipient survives (if senior)', async () => {
    service = makeService();
    // New rule: employees can only route QUERY to TL/Manager/Admin/SuperAdmin
    prisma.user.findUnique.mockResolvedValue({ isActive: true, departmentId: DEPT_B, role: { name: 'MANAGER' } });

    await service.create(
      {
        title: 'How does X work?', category: 'OPERATIONS', priority: 'MEDIUM', type: 'QUERY',
        departmentId: DEPT_A, assignedToId: USER_TARGET_IN_B, targetDepartmentId: DEPT_B,
      },
      'emp-1',
      employee,
    );

    expect(prisma.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedToId: USER_TARGET_IN_B }) }),
    );
  });

  it('Employee CANNOT route QUERY to a non-senior (new hierarchy rule)', async () => {
    service = makeService();
    // NEW RULE: Recipient is explicitly an EMPLOYEE (not TL/Manager) in the target department.
    // Employees can now only route QUERY to TL/Manager/Admin/SuperAdmin, so this should be rejected.
    prisma.user.findUnique.mockResolvedValue({ isActive: true, departmentId: DEPT_B, role: { name: 'EMPLOYEE' } });

    await expect(
      service.create(
        {
          title: 'How do I file an expense report?', category: 'OPERATIONS', priority: 'LOW', type: 'QUERY',
          departmentId: DEPT_A, assignedToId: USER_TARGET_IN_B, targetDepartmentId: DEPT_B,
        },
        'emp-1',
        employee,
      ),
    ).rejects.toThrow(/Employees can only route Queries to Team Leads, Managers, or Admins/);
  });

  it('Employee CAN route QUERY to a senior in another department (new hierarchy rule)', async () => {
    service = makeService();
    // Recipients with senior roles (TEAM_LEAD, MANAGER, ADMIN, SUPER_ADMIN) are allowed
    prisma.user.findUnique.mockResolvedValue({ isActive: true, departmentId: DEPT_B, role: { name: 'TEAM_LEAD' } });

    await service.create(
      {
        title: 'How should we handle this?', category: 'OPERATIONS', priority: 'LOW', type: 'QUERY',
        departmentId: DEPT_A, assignedToId: USER_TARGET_IN_B, targetDepartmentId: DEPT_B,
      },
      'emp-1',
      employee,
    );

    expect(prisma.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedToId: USER_TARGET_IN_B, targetDepartmentId: DEPT_B }),
      }),
    );
  });

  it('QUERY populates requestingDepartmentId/targetDepartmentId/isCrossDepartment when departments differ', async () => {
    service = makeService();
    // Need to mock a senior role for employee QUERY routing (new hierarchy rule)
    prisma.user.findUnique.mockResolvedValue({ isActive: true, departmentId: DEPT_B, role: { name: 'MANAGER' } });

    await service.create(
      {
        title: 'Ask finance', category: 'OPERATIONS', priority: 'MEDIUM', type: 'QUERY',
        departmentId: DEPT_A, assignedToId: USER_TARGET_IN_B, targetDepartmentId: DEPT_B,
      },
      'emp-1',
      employee,
    );

    expect(prisma.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestingDepartmentId: DEPT_A,
          targetDepartmentId: DEPT_B,
          isCrossDepartment: true,
        }),
      }),
    );
  });

  it('HELP targeting the same department sets isCrossDepartment: false', async () => {
    service = makeService();
    prisma.user.findUnique.mockResolvedValue({ isActive: true, departmentId: DEPT_A });

    await service.create(
      {
        title: 'Need a hand', category: 'OPERATIONS', priority: 'LOW', type: 'HELP',
        departmentId: DEPT_A, assignedToId: USER_COLLEAGUE_IN_A, targetDepartmentId: DEPT_A,
      },
      'emp-1',
      employee,
    );

    expect(prisma.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isCrossDepartment: false }) }),
    );
  });

  it('rejects a QUERY whose chosen recipient does not actually belong to the target department (defense in depth)', async () => {
    service = makeService();
    // Recipient's real department doesn't match the claimed targetDepartmentId.
    prisma.user.findUnique.mockResolvedValue({ isActive: true, departmentId: 'some-other-dept' });

    await expect(
      service.create(
        {
          title: 'Ask finance', category: 'OPERATIONS', priority: 'MEDIUM', type: 'QUERY',
          departmentId: DEPT_A, assignedToId: USER_MISMATCHED_DEPT, targetDepartmentId: DEPT_B,
        },
        'emp-1',
        employee,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a QUERY whose chosen recipient is inactive (defense in depth)', async () => {
    service = makeService();
    prisma.user.findUnique.mockResolvedValue({ isActive: false, departmentId: DEPT_B });

    await expect(
      service.create(
        {
          title: 'Ask finance', category: 'OPERATIONS', priority: 'MEDIUM', type: 'QUERY',
          departmentId: DEPT_A, assignedToId: USER_INACTIVE, targetDepartmentId: DEPT_B,
        },
        'emp-1',
        employee,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('TASK never populates the cross-department fields, even if targetDepartmentId is (incorrectly) sent', async () => {
    service = makeService();
    await service.create(
      {
        title: 'Normal task', category: 'OPERATIONS', priority: 'MEDIUM', type: 'TASK',
        departmentId: DEPT_A, targetDepartmentId: DEPT_B,
      },
      'mgr-1',
      { id: 'mgr-1', role: { name: 'MANAGER' } },
    );

    const call = prisma.ticket.create.mock.calls[0][0];
    expect(call.data.requestingDepartmentId).toBeUndefined();
    expect(call.data.targetDepartmentId).toBeUndefined();
    expect(call.data.isCrossDepartment).toBeUndefined();
  });
});
