import { OperationalHierarchyScopeService } from './operational-hierarchy-scope.service';

describe('OperationalHierarchyScopeService', () => {
  const viewer = (role: string) => ({ id: `${role.toLowerCase()}-1`, role: { name: role }, departmentId: 'home-dept' });

  function build() {
    const prisma = {
      hierarchyAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      team: { findMany: jest.fn().mockResolvedValue([]) },
      organizationReportingLine: { findMany: jest.fn().mockResolvedValue([]) },
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
          { departmentId: { in: ['home-dept', 'dept-1'] } },
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
    expect(prisma.organizationReportingLine.findMany).toHaveBeenCalledTimes(3);
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

  it('gives every Team Lead all eligible people in their current department', async () => {
    const { prisma, service } = build();
    prisma.user.findMany.mockResolvedValue([{ id: 'employee-1' }, { id: 'intern-1' }]);
    await expect(service.visibleUserIds(viewer('TEAM_LEAD'))).resolves.toMatchObject({
      userIds: ['employee-1', 'intern-1'], sources: ['HOME_DEPARTMENT'],
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [{ OR: [{ departmentId: { in: ['home-dept'] } }] }],
      }),
    }));
  });

  it('keeps a Manager empty when no explicit or reporting scope exists', async () => {
    const { prisma, service } = build();
    await expect(service.visibleUserIds(viewer('MANAGER'))).resolves.toMatchObject({
      userIds: [], sources: [],
    });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('follows reports-to lines and expands departments led by downstream leaders', async () => {
    const { prisma, service } = build();
    prisma.organizationReportingLine.findMany
      .mockResolvedValueOnce([{
        subjectUserId: 'child-lead',
        departmentId: 'child-dept',
        subject: {
          departmentId: 'child-dept',
          role: { name: 'TEAM_LEAD' },
          departmentMemberships: [{ departmentId: 'matrix-dept' }],
        },
      }])
      .mockResolvedValueOnce([{
        subjectUserId: 'employee-1',
        departmentId: 'child-dept',
        subject: {
          departmentId: 'child-dept',
          role: { name: 'EMPLOYEE' },
          departmentMemberships: [],
        },
      }])
      .mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'child-lead' }, { id: 'employee-1' }, { id: 'employee-without-line' },
    ]);

    await expect(service.visibleUserIds(viewer('TEAM_LEAD'))).resolves.toMatchObject({
      userIds: ['child-lead', 'employee-1', 'employee-without-line'],
      sources: expect.arrayContaining(['HOME_DEPARTMENT', 'REPORTING_LINE']),
    });
    expect(prisma.organizationReportingLine.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [{ OR: [
          { id: { in: ['child-lead', 'employee-1'] } },
          { departmentId: { in: ['home-dept', 'child-dept', 'matrix-dept'] } },
        ] }],
      }),
    }));
  });

  it('gives a Manager access to direct and recursive reports from the organization chart', async () => {
    const { prisma, service } = build();
    prisma.organizationReportingLine.findMany
      .mockResolvedValueOnce([{
        subjectUserId: 'lead-1',
        departmentId: 'dept-1',
        subject: {
          departmentId: 'dept-1',
          role: { name: 'TEAM_LEAD' },
          departmentMemberships: [],
        },
      }])
      .mockResolvedValueOnce([{
        subjectUserId: 'employee-1',
        departmentId: 'dept-1',
        subject: {
          departmentId: 'dept-1',
          role: { name: 'EMPLOYEE' },
          departmentMemberships: [],
        },
      }])
      .mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([{ id: 'lead-1' }, { id: 'employee-1' }]);

    await expect(service.visibleUserIds(viewer('MANAGER'))).resolves.toMatchObject({
      userIds: ['lead-1', 'employee-1'],
      sources: ['REPORTING_LINE'],
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [{ OR: [
          { id: { in: ['lead-1', 'employee-1'] } },
          { departmentId: { in: ['dept-1'] } },
        ] }],
      }),
    }));
  });

  it('does not grant access through stale old-department team membership', async () => {
    const { prisma, service } = build();
    prisma.team.findMany.mockResolvedValueOnce([{
      departmentId: 'old-dept',
      teamLead: { departmentId: 'old-dept' },
      members: [{ userId: 'employee-1', user: { departmentId: 'new-dept' } }],
    }]);

    await expect(service.visibleUserIds(viewer('TEAM_LEAD'))).resolves.toMatchObject({ userIds: [] });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [{ OR: [{ departmentId: { in: ['home-dept'] } }] }],
      }),
    }));
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
