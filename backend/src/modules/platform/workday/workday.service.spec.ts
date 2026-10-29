import { WorkdayService } from './workday.service';

describe('Workday team hierarchy visibility', () => {
  it('lists active team members even when the team lead has no work session', async () => {
    const prisma = {
      team: {
        findMany: jest.fn().mockResolvedValue([
          { members: [{ userId: 'employee-1' }, { userId: 'employee-2' }] },
        ]),
      },
      appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const tva = {
      companyDateOnly: jest.fn().mockReturnValue(new Date('2026-10-28T00:00:00.000Z')),
      now: jest.fn().mockReturnValue(new Date('2026-10-28T09:00:00.000Z')),
    };
    const service = new WorkdayService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      tva as any,
      undefined,
    );

    await expect(service.getTeam({
      id: 'lead-1',
      role: { name: 'TEAM_LEAD' },
      departmentId: 'department-1',
    })).resolves.toEqual([]);

    expect(prisma.team.findMany).toHaveBeenCalledWith({
      where: { teamLeadId: 'lead-1', isActive: true },
      select: { members: { select: { userId: true } } },
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        isActive: true,
        isSystemAccount: false,
        id: { in: ['employee-1', 'employee-2'] },
        role: { name: { in: ['EMPLOYEE', 'INTERN'] } },
      }),
    }));
  });
});
