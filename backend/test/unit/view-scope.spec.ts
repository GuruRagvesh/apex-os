import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { activeViewDepartment, viewDepartmentOf } from '../../src/common/services/view-scope';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { TicketAccessService } from '../../src/common/services/ticket-access.service';
import { LeaveAccessService } from '../../src/common/services/leave-access.service';
import { UsersService } from '../../src/modules/core/users/users.service';

// Default department for Admin / Super Admin: on → lists cover one department
// (plus the admin's own items); off → the whole company, as before.

const superAdmin = (viewDepartmentId: string | null = null) => ({ id: 'sa', role: { name: 'SUPER_ADMIN' }, departmentId: 'ops', viewDepartmentId });
const employee = { id: 'e1', role: { name: 'EMPLOYEE' }, departmentId: 'ai', viewDepartmentId: 'ai' };

describe('viewDepartmentOf / activeViewDepartment', () => {
  it('applies only to admins with a department set', () => {
    expect(viewDepartmentOf(superAdmin('ai'))).toBe('ai');
    expect(viewDepartmentOf({ ...superAdmin('ai'), role: 'ADMIN' })).toBe('ai');
    expect(viewDepartmentOf(superAdmin())).toBeNull();
    expect(viewDepartmentOf(employee)).toBeNull(); // a stray value never narrows a non-admin
    expect(viewDepartmentOf(undefined)).toBeNull();
  });

  it('reads the stored preference only when switched on', () => {
    expect(activeViewDepartment({ viewScope: { enabled: true, departmentId: 'ai' } })).toBe('ai');
    expect(activeViewDepartment({ viewScope: { enabled: false, departmentId: 'ai' } })).toBeNull();
    expect(activeViewDepartment({})).toBeNull();
    expect(activeViewDepartment(null)).toBeNull();
  });
});

describe('list scopes', () => {
  const policy = new AccessPolicyService({} as any);

  it('projects: whole company when off, one department plus own projects when on', async () => {
    expect(await policy.projectWhereForUser(superAdmin())).toEqual({});
    expect(await policy.projectWhereForUser(superAdmin('ai'))).toEqual({
      OR: [{ members: { some: { userId: 'sa' } } }, { departmentId: 'ai' }],
    });
  });

  it('tickets: whole company when off, the department scope when on', async () => {
    const tickets = new TicketAccessService({} as any, policy, {} as any);
    expect(await tickets.buildTicketWhereForUser({}, superAdmin())).toEqual({});
    const where = await tickets.buildTicketWhereForUser({}, superAdmin('ai'));
    // Filed under the department, or assigned to or created by its people;
    // never the admin's own tickets elsewhere.
    expect(where.OR).toEqual([
      { departmentId: { in: ['ai'] } },
      { assignedTo: { departmentId: { in: ['ai'] } } },
      { createdBy: { departmentId: { in: ['ai'] } } },
      { assignees: { some: { user: { departmentId: { in: ['ai'] } } } } },
    ]);
  });

  it('tickets: the locked page department filter does not narrow below the department scope', async () => {
    const prisma = { department: { findFirst: jest.fn(async () => ({ id: 'ai' })) } };
    const tickets = new TicketAccessService(prisma as any, policy, {} as any);
    const where = await tickets.buildTicketWhereForUser({ departmentId: 'ai' }, superAdmin('ai'));
    expect(JSON.stringify(where)).not.toContain('"departmentId":"ai"');
  });

  it('tickets: an admin can still open any ticket directly while narrowed', async () => {
    const prisma = {
      ticket: { findFirst: jest.fn(async () => ({ id: 't1' })), findUnique: jest.fn(async () => ({ id: 't1', departmentId: 'sales' })), count: jest.fn() },
    };
    const tickets = new TicketAccessService(prisma as any, policy, {} as any);
    await expect(tickets.findAccessibleTicket('t1', superAdmin('ai'))).resolves.toEqual({ id: 't1', departmentId: 'sales' });
    expect(prisma.ticket.count).not.toHaveBeenCalled();
  });

  it('leave: whole company when off, the department plus own requests when on', async () => {
    const leave = new LeaveAccessService({} as any, policy);
    expect(await leave.buildLeaveWhereForUser({}, superAdmin())).toEqual({});
    const where = await leave.buildLeaveWhereForUser({}, superAdmin('ai'));
    expect(JSON.stringify(where)).toContain('"departmentId":"ai"');
    expect(JSON.stringify(where)).toContain('"userId":"sa"');
  });
});

describe('saving the default department', () => {
  function build(departmentExists = true) {
    const tx = {
      appSetting: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async ({ create }: any) => ({ value: create.value })),
      },
    };
    const prisma = {
      department: { findUnique: jest.fn(async () => (departmentExists ? { id: 'ai' } : null)) },
      $transaction: jest.fn((op: any) => op(tx)),
    };
    return new UsersService(prisma as any, {} as any, {} as any, {} as any, {} as any);
  }

  it('saves a valid setting for a super admin', async () => {
    await expect(build().savePreferences('sa', { viewScope: { enabled: true, departmentId: 'ai', extra: 1 } }, superAdmin()))
      .resolves.toEqual({ viewScope: { enabled: true, departmentId: 'ai' } });
  });

  it('refuses non-admins, a switched-on setting with no department, and unknown departments', async () => {
    await expect(build().savePreferences('e1', { viewScope: { enabled: true, departmentId: 'ai' } }, employee)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(build().savePreferences('sa', { viewScope: { enabled: true, departmentId: null } }, superAdmin())).rejects.toBeInstanceOf(BadRequestException);
    await expect(build(false).savePreferences('sa', { viewScope: { enabled: true, departmentId: 'gone' } }, superAdmin())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('other preference saves are unaffected', async () => {
    await expect(build().savePreferences('e1', { autoAssign: true }, employee)).resolves.toEqual({ autoAssign: true });
  });
});
