import { WorkdayService } from '../../src/modules/platform/workday/workday.service';

describe('WorkdayService.getTeam hierarchy scope', () => {
  const build = () => {
    const prisma: any = {
      managerDeptAccess: { findMany: jest.fn().mockResolvedValue([]) },
      appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      team: {
        findMany: jest.fn().mockResolvedValue([
          { members: [{ userId: 'employee-1' }, { userId: 'intern-1' }] },
        ]),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const tva: any = {
      companyDateOnly: jest.fn().mockReturnValue(new Date('2026-10-17T00:00:00.000Z')),
      now: jest.fn().mockReturnValue(new Date('2026-10-17T09:00:00.000Z')),
      companyInstantAt: jest.fn((date: string) => new Date(`${date}T18:29:00.000Z`)),
    };
    const service = new WorkdayService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, tva);
    return { service, prisma };
  };

  it('shows a team leader only employees and interns in their explicit team membership', async () => {
    const { service, prisma } = build();
    await service.getTeam({ id: 'tl-1', role: { name: 'TEAM_LEAD' }, departmentId: 'dept-a' });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ['employee-1', 'intern-1'] },
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

  it('loads sessions and approved leave for the selected historical business date', async () => {
    const { service, prisma } = build();
    await service.getTeam({ id: 'admin-1', role: { name: 'ADMIN' } }, '2026-10-16');

    const selectedDate = new Date('2026-10-16T00:00:00.000Z');
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        workSessions: expect.objectContaining({ where: { date: selectedDate } }),
        leaveRequests: expect.objectContaining({
          where: expect.objectContaining({
            startDate: { lte: selectedDate },
            endDate: { gte: selectedDate },
          }),
        }),
      }),
    }));
  });

  it('refuses invalid and future dates', async () => {
    const { service } = build();
    await expect(service.getTeam({ id: 'admin-1', role: { name: 'ADMIN' } }, '2026-02-30'))
      .rejects.toThrow('real calendar date');
    await expect(service.getTeam({ id: 'admin-1', role: { name: 'ADMIN' } }, '2026-10-18'))
      .rejects.toThrow('future date');
  });
});
