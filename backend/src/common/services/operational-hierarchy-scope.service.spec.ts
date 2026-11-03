import { OperationalHierarchyScopeService } from './operational-hierarchy-scope.service';

describe('OperationalHierarchyScopeService', () => {
  const viewer = (role: string) => ({ id: `${role.toLowerCase()}-1`, role: { name: role }, departmentId: 'home-dept' });

  function build() {
    const prisma = {
      hierarchyAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      team: { findMany: jest.fn().mockResolvedValue([]) },
      managerDeptAccess: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { prisma, service: new OperationalHierarchyScopeService(prisma as any) };
  }

  it('combines department-level and team-level Team Lead grants', async () => {
    const { prisma, service } = build();
    prisma.hierarchyAssignment.findMany
      .mockResolvedValueOnce([{ scope: 'DEPARTMENT', subjectUserId: null, departmentId: 'dept-1', assigneeUser: { departmentId: 'dept-1', role: { name: 'TEAM_LEAD' } } }])
      .mockResolvedValue([]);
    prisma.team.findMany
      .mockResolvedValueOnce([{ departmentId: 'dept-1', teamLead: { departmentId: 'dept-1' }, members: [{ userId: 'employee-2', user: { departmentId: 'dept-1' } }] }])
      .mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'team-lead-2' }, { id: 'employee-1' }, { id: 'employee-2' },
    ]);

    await expect(service.visibleUserIds(viewer('TEAM_LEAD'))).resolves.toMatchObject({
      userIds: ['team-lead-2', 'employee-1', 'employee-2'],
      sources: expect.arrayContaining(['HIERARCHY', 'TEAM']),
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        role: { name: { in: ['TEAM_LEAD', 'EMPLOYEE', 'INTERN'] } },
        AND: [{ OR: [
          { id: { in: ['employee-2'] } },
          { departmentId: { in: ['dept-1'] } },
        ] }],
      }),
    }));
  });

  it('follows direct reports and their team members for full downstream manager access', async () => {
    const { prisma, service } = build();
    prisma.hierarchyAssignment.findMany
      .mockResolvedValueOnce([{ scope: 'EMPLOYEE', subjectUserId: 'lead-1', departmentId: null, assigneeUser: { departmentId: 'home-dept', role: { name: 'MANAGER' } } }])
      .mockResolvedValueOnce([]);
    prisma.team.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ departmentId: 'dept-1', teamLead: { departmentId: 'dept-1' }, members: [{ userId: 'employee-1', user: { departmentId: 'dept-1' } }] }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'lead-1' }, { id: 'employee-1' }]);

    await expect(service.visibleUserIds(viewer('MANAGER'))).resolves.toMatchObject({
      userIds: ['lead-1', 'employee-1'],
    });
    expect(prisma.hierarchyAssignment.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.team.findMany).toHaveBeenCalledTimes(3);
  });

  it('combines explicit manager department grants without using the home department', async () => {
    const { prisma, service } = build();
    prisma.managerDeptAccess.findMany.mockResolvedValue([{ departmentId: 'dept-2' }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'lead-2' }, { id: 'employee-2' }]);

    await expect(service.visibleUserIds(viewer('MANAGER'))).resolves.toMatchObject({
      userIds: ['lead-2', 'employee-2'],
      sources: ['MANAGER_DEPARTMENT'],
    });
    const query = prisma.user.findMany.mock.calls[0][0].where;
    expect(query.AND).toEqual([{ OR: [{ departmentId: { in: ['dept-2'] } }] }]);
    expect(JSON.stringify(query)).not.toContain('home-dept');
  });

  it('returns no subordinates when a leader has no explicit scope', async () => {
    const { prisma, service } = build();
    await expect(service.visibleUserIds(viewer('TEAM_LEAD'))).resolves.toMatchObject({
      userIds: [], sources: [],
    });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('does not grant access through stale old-department team membership', async () => {
    const { prisma, service } = build();
    prisma.team.findMany.mockResolvedValueOnce([{
      departmentId: 'old-dept',
      teamLead: { departmentId: 'old-dept' },
      members: [{ userId: 'employee-1', user: { departmentId: 'new-dept' } }],
    }]);

    await expect(service.visibleUserIds(viewer('TEAM_LEAD'))).resolves.toMatchObject({ userIds: [] });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('gives administrators all eligible active non-system people', async () => {
    const { prisma, service } = build();
    prisma.user.findMany.mockResolvedValue([{ id: 'manager-1' }, { id: 'employee-1' }]);

    await expect(service.visibleUserIds(viewer('ADMIN'))).resolves.toMatchObject({
      userIds: ['manager-1', 'employee-1'], sources: ['COMPANY'],
    });
    expect(prisma.hierarchyAssignment.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        isActive: true,
        isSystemAccount: false,
        role: { name: { in: ['MANAGER', 'TEAM_LEAD', 'EMPLOYEE', 'INTERN'] } },
      }),
    }));
  });

  it('returns an empty scope for employees and interns', async () => {
    const { prisma, service } = build();
    await expect(service.visibleUserIds(viewer('EMPLOYEE'))).resolves.toMatchObject({ userIds: [] });
    expect(prisma.hierarchyAssignment.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
