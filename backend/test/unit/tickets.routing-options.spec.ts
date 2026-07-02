import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';

// TicketsService.getRoutingOptions — selectable recipients for cross-department
// QUERY/HELP routing (GET /tickets/routing-options). Separate from the TASK
// assignee flow (usersApi.getAll() + client-side department filter), which this
// endpoint intentionally refuses to serve.
//
// QUERY and HELP are anyone-to-anyone: any active user in the target department is
// a valid recipient, regardless of the requester's role or the recipient's role.
// There was a prior restriction funneling Employee/Intern-authored QUERY requests
// to TEAM_LEAD/MANAGER only — that was wrong (it silently blocked e.g. an Employee
// asking another department's Employee/Intern a QUERY) and has been removed. Only
// TASK assignment stays role/department scoped, and that flow never reaches this
// method at all.
describe('TicketsService.getRoutingOptions', () => {
  let prisma: any;
  let service: TicketsService;

  // Deliberately includes fields well beyond the minimal DTO (payroll-ish data,
  // isActive) to prove the response mapping strips everything but the allowed set.
  function makeUsersTable(rows: any[]) {
    return {
      findMany: jest.fn(async ({ where }: any) => {
        return rows.filter((u) => {
          if (where.departmentId && u.departmentId !== where.departmentId) return false;
          if (where.isActive !== undefined && u.isActive !== where.isActive) return false;
          const roleIn = where.role?.name?.in;
          if (roleIn && !roleIn.includes(u.role?.name)) return false;
          return true;
        });
      }),
    };
  }

  function makeService(users: any[], departments: Record<string, any>) {
    prisma = {
      department: {
        findUnique: jest.fn(async ({ where }: any) => departments[where.id] ?? null),
      },
      user: makeUsersTable(users),
    };
    return new TicketsService(
      prisma,
      {} as any, // gateway
      {} as any, // notificationEventService
      {} as any, // configService
      {} as any, // eventEmitter
      {} as any, // eventLogger
      {} as any, // ticketAccess (not used by getRoutingOptions)
      {} as any, // hierarchyApprovalService
      {} as any, // ticketTiming
      {} as any, // ticketLedger
      {} as any, // ticketImport
    );
  }

  const targetDeptUsers = [
    {
      id: 'u-emp', name: 'Target Employee', email: 'emp@x.com', isActive: true, departmentId: 'dept-target',
      password: 'hash-should-never-leak', ctcAnnual: 900000,
      role: { name: 'EMPLOYEE' }, department: { id: 'dept-target', name: 'Marketing' },
      teamMemberships: [{ team: { name: 'Growth' } }],
    },
    {
      id: 'u-intern', name: 'Target Intern', email: 'intern@x.com', isActive: true, departmentId: 'dept-target',
      role: { name: 'INTERN' }, department: { id: 'dept-target', name: 'Marketing' },
      teamMemberships: [],
    },
    {
      id: 'u-tl', name: 'Target TL', email: 'tl@x.com', isActive: true, departmentId: 'dept-target',
      role: { name: 'TEAM_LEAD' }, department: { id: 'dept-target', name: 'Marketing' },
      teamMemberships: [],
    },
    {
      id: 'u-mgr', name: 'Target Mgr', email: 'mgr@x.com', isActive: true, departmentId: 'dept-target',
      role: { name: 'MANAGER' }, department: { id: 'dept-target', name: 'Marketing' },
      teamMemberships: [],
    },
    {
      id: 'u-archived', name: 'Archived Person', email: 'gone@x.com', isActive: false, departmentId: 'dept-target',
      role: { name: 'EMPLOYEE' }, department: { id: 'dept-target', name: 'Marketing' },
      teamMemberships: [],
    },
  ];
  const departments = { 'dept-target': { id: 'dept-target', name: 'Marketing' } };
  const ALL_ACTIVE_IDS = ['u-emp', 'u-intern', 'u-mgr', 'u-tl'];

  it('rejects type=TASK — TASK keeps its existing department-scoped assignee flow, never this endpoint', async () => {
    service = makeService(targetDeptUsers, departments);
    await expect(
      service.getRoutingOptions('TASK', 'dept-target', { role: { name: 'MANAGER' } }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a missing targetDepartmentId', async () => {
    service = makeService(targetDeptUsers, departments);
    await expect(
      service.getRoutingOptions('QUERY', undefined, { role: { name: 'MANAGER' } }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a target department that does not exist', async () => {
    service = makeService(targetDeptUsers, departments);
    await expect(
      service.getRoutingOptions('QUERY', 'no-such-dept', { role: { name: 'MANAGER' } }),
    ).rejects.toThrow(NotFoundException);
  });

  it('QUERY from a Manager returns every active user in the target department, any role', async () => {
    service = makeService(targetDeptUsers, departments);
    const result = await service.getRoutingOptions('QUERY', 'dept-target', { role: { name: 'MANAGER' } });
    expect(result.map((u: any) => u.id).sort()).toEqual(ALL_ACTIVE_IDS);
  });

  it('HELP from a Manager returns every active user in the target department, any role', async () => {
    service = makeService(targetDeptUsers, departments);
    const result = await service.getRoutingOptions('HELP', 'dept-target', { role: { name: 'MANAGER' } });
    expect(result.map((u: any) => u.id).sort()).toEqual(ALL_ACTIVE_IDS);
  });

  it('QUERY from an Employee returns every active user in the target department, including Employee and Intern', async () => {
    service = makeService(targetDeptUsers, departments);
    const result = await service.getRoutingOptions('QUERY', 'dept-target', { role: { name: 'EMPLOYEE' } });
    expect(result.map((u: any) => u.id).sort()).toEqual(ALL_ACTIVE_IDS);
    expect(result.some((u: any) => u.id === 'u-emp')).toBe(true);
    expect(result.some((u: any) => u.id === 'u-intern')).toBe(true);
  });

  it('HELP from an Employee returns every active user in the target department, including Employee and Intern', async () => {
    service = makeService(targetDeptUsers, departments);
    const result = await service.getRoutingOptions('HELP', 'dept-target', { role: { name: 'EMPLOYEE' } });
    expect(result.map((u: any) => u.id).sort()).toEqual(ALL_ACTIVE_IDS);
    expect(result.some((u: any) => u.id === 'u-emp')).toBe(true);
    expect(result.some((u: any) => u.id === 'u-intern')).toBe(true);
  });

  it('QUERY from an Intern returns every active user in the target department, same as any other role', async () => {
    service = makeService(targetDeptUsers, departments);
    const result = await service.getRoutingOptions('QUERY', 'dept-target', { role: { name: 'INTERN' } });
    expect(result.map((u: any) => u.id).sort()).toEqual(ALL_ACTIVE_IDS);
  });

  it('never returns an archived/inactive user, for any role or type', async () => {
    service = makeService(targetDeptUsers, departments);
    const asManager = await service.getRoutingOptions('QUERY', 'dept-target', { role: { name: 'MANAGER' } });
    const asEmployeeHelp = await service.getRoutingOptions('HELP', 'dept-target', { role: { name: 'EMPLOYEE' } });
    expect(asManager.some((u: any) => u.id === 'u-archived')).toBe(false);
    expect(asEmployeeHelp.some((u: any) => u.id === 'u-archived')).toBe(false);
  });

  it('returns only minimal fields — never password, payroll, or other sensitive data', async () => {
    service = makeService(targetDeptUsers, departments);
    const result = await service.getRoutingOptions('QUERY', 'dept-target', { role: { name: 'MANAGER' } });
    const target = result.find((u: any) => u.id === 'u-emp');
    expect(target).toEqual({
      id: 'u-emp',
      name: 'Target Employee',
      email: 'emp@x.com',
      role: 'EMPLOYEE',
      departmentId: 'dept-target',
      departmentName: 'Marketing',
      teamName: 'Growth',
    });
    expect((target as any).password).toBeUndefined();
    expect((target as any).ctcAnnual).toBeUndefined();
  });
});
