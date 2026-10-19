import { WorkdayService } from '../../src/modules/platform/workday/workday.service';

describe('WorkdayService.getTeam hierarchy scope', () => {
  const build = () => {
    const prisma: any = {
      managerDeptAccess: { findMany: jest.fn().mockResolvedValue([]) },
      appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const tva: any = {
      companyDateOnly: jest.fn().mockReturnValue(new Date('2026-10-17T00:00:00.000Z')),
      now: jest.fn().mockReturnValue(new Date('2026-10-17T09:00:00.000Z')),
    };
    const service = new WorkdayService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, tva);
    return { service, prisma };
  };

  it('shows a team leader only employees and interns in their department', async () => {
    const { service, prisma } = build();
    await service.getTeam({ id: 'tl-1', role: { name: 'TEAM_LEAD' }, departmentId: 'dept-a' });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        departmentId: { in: ['dept-a'] },
        role: { name: { in: ['EMPLOYEE', 'INTERN'] } },
      }),
    }));
  });

  it('shows a manager all assigned departments but no peer managers or admins', async () => {
    const { service, prisma } = build();
    prisma.managerDeptAccess.findMany.mockResolvedValue([{ departmentId: 'dept-b' }, { departmentId: 'dept-c' }]);
    await service.getTeam({ id: 'manager-1', role: { name: 'MANAGER' }, departmentId: 'dept-a' });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        departmentId: { in: ['dept-b', 'dept-c'] },
        role: { name: { in: ['TEAM_LEAD', 'EMPLOYEE', 'INTERN'] } },
      }),
    }));
  });

  it('shows an administrator company members through manager level', async () => {
    const { service, prisma } = build();
    await service.getTeam({ id: 'admin-1', role: { name: 'ADMIN' } });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        role: { name: { in: ['MANAGER', 'TEAM_LEAD', 'EMPLOYEE', 'INTERN'] } },
      }),
    }));
    expect(prisma.managerDeptAccess.findMany).not.toHaveBeenCalled();
  });
});
