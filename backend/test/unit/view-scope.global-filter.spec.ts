import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { OperationalHierarchyScopeService } from '../../src/common/services/operational-hierarchy-scope.service';
import { TicketAccessService } from '../../src/common/services/ticket-access.service';
import { AssetsService } from '../../src/modules/operations/assets/assets.service';
import { DepartmentsService } from '../../src/modules/core/departments/departments.service';
import { UsersService } from '../../src/modules/core/users/users.service';

// Top-bar department filter (Admin / Super Admin) as a global filter:
// page-level department filters lock to it, people lists show only that
// department's people (never the admin), and Inventory / Departments narrow too.

const superAdmin = (viewDepartmentId: string | null = null) => ({ id: 'sa', role: { name: 'SUPER_ADMIN' }, departmentId: 'ops', viewDepartmentId });

describe('page department filters lock to the top-bar department', () => {
  it('people scope: the top-bar department wins over a page department filter', async () => {
    const findMany = jest.fn(async () => [{ id: 'x' }]);
    const scope = new OperationalHierarchyScopeService({ user: { findMany } } as any);
    const result = await scope.visibleUserIds(superAdmin('ai') as any, { departmentId: 'sales' });
    expect(result.departmentId).toBe('ai');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ departmentId: 'ai', id: { not: 'sa' } }),
    }));
  });

  it('people scope: without a top-bar department the page filter still applies', async () => {
    const findMany = jest.fn(async () => []);
    const scope = new OperationalHierarchyScopeService({ user: { findMany } } as any);
    expect((await scope.visibleUserIds(superAdmin() as any, { departmentId: 'sales' })).departmentId).toBe('sales');
  });
});

describe('people lists leave out the admin', () => {
  it('users list: only the department, not the signed-in admin', async () => {
    const findMany = jest.fn(async () => []);
    const prisma = { user: { findMany, count: jest.fn(async () => 0) } };
    const users = new UsersService(prisma as any, new AccessPolicyService({} as any), {} as any, {} as any, {} as any);
    await users.findAll({ departmentId: 'sales' }, superAdmin('ai'));
    const where = (findMany.mock.calls[0] as any)[0].where;
    expect(where.departmentId).toBe('ai');
    expect(where.id).toEqual({ not: 'sa' });
  });

  it('workload people: the department only, and everyone again when cleared', async () => {
    const findMany = jest.fn(async () => [{ id: 'x' }, { id: 'y' }]);
    const tickets = new TicketAccessService({ user: { findMany } } as any, new AccessPolicyService({} as any), {} as any);
    await expect(tickets.visibleUserIdsForWorkload(superAdmin('ai'))).resolves.toEqual(['x', 'y']);
    expect((findMany.mock.calls[0] as any)[0].where).toEqual({ isActive: true, departmentId: 'ai', id: { not: 'sa' } });
    await expect(tickets.visibleUserIdsForWorkload(superAdmin())).resolves.toBeNull();
  });
});

describe('Inventory follows the top-bar department', () => {
  function build() {
    const prisma: any = {
      user: { findMany: jest.fn(async () => [{ id: 'x' }, { id: 'y' }]) },
      companyAsset: { findMany: jest.fn(async () => []) },
      assetType: { findMany: jest.fn(async () => []) },
      assetAllocation: { findMany: jest.fn(async () => []) },
      assetRequest: { findMany: jest.fn(async () => []) },
      assetMobileSubscription: { findMany: jest.fn(async () => []) },
      assetImportBatch: { findMany: jest.fn(async () => []) },
      assetAuditEvent: { findMany: jest.fn(async () => []) },
    };
    return { prisma, service: new AssetsService(prisma) };
  }

  it('registry: assets held by the department plus unassigned stock', async () => {
    const { prisma, service } = build();
    await service.overview('registry', superAdmin('ai'));
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { departmentId: 'ai' }, select: { id: true } });
    expect(prisma.companyAsset.findMany.mock.calls[0][0].where).toEqual({
      OR: [
        { allocations: { none: { returned: false } } },
        { allocations: { some: { returned: false, employeeId: { in: ['x', 'y'] } } } },
      ],
    });
  });

  it('allocations and SIM lines: the department people only (unassigned SIMs stay)', async () => {
    const { prisma, service } = build();
    await service.overview('allocations', superAdmin('ai'));
    expect(prisma.assetAllocation.findMany.mock.calls[0][0].where).toEqual({ employeeId: { in: ['x', 'y'] } });
    await service.overview('mobile', superAdmin('ai'));
    expect(prisma.assetMobileSubscription.findMany.mock.calls[0][0].where).toEqual({ OR: [{ employeeId: null }, { employeeId: { in: ['x', 'y'] } }] });
  });

  it('whole company when no department is selected', async () => {
    const { prisma, service } = build();
    await service.overview('registry', superAdmin());
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.companyAsset.findMany.mock.calls[0][0].where).toBeUndefined();
  });
});

describe('Departments follow the top-bar department', () => {
  function build() {
    const findMany = jest.fn(async () => []);
    return { findMany, service: new DepartmentsService({ department: { findMany } } as any, new AccessPolicyService({} as any)) };
  }

  it('lists only the selected department', async () => {
    const { findMany, service } = build();
    await service.findAll(superAdmin('ai'));
    expect((findMany.mock.calls[0] as any)[0].where).toEqual({ id: 'ai' });
  });

  it('still lists every department for the switcher and edit forms', async () => {
    const { findMany, service } = build();
    await service.findAll(superAdmin('ai'), true);
    expect((findMany.mock.calls[0] as any)[0].where).toEqual({});
  });
});
