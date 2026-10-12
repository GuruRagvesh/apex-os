import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { HomeCarouselService } from '../../src/modules/platform/dashboard/home-carousel.service';

const prisma: any = {
  appSetting: { findUnique: jest.fn(), upsert: jest.fn() },
  dailyAttendance: { findMany: jest.fn() },
  department: { count: jest.fn() },
};
const access: any = {
  isAdmin: jest.fn((user) => user.role.name === 'ADMIN'),
  roleName: jest.fn((user) => user.role.name),
};
const ticketAccess: any = { visibleUserIdsForWorkload: jest.fn() };
const tva: any = { now: () => new Date('2026-10-15T05:00:00Z'), companyToday: () => '2026-10-15' };
const make = () => new HomeCarouselService(prisma, access, ticketAccess, tva);
const employee = { id: 'u1', role: { name: 'EMPLOYEE' }, departmentId: 'd1' };
const admin = { id: 'admin', role: { name: 'ADMIN' }, departmentId: 'd2' };
const notice = (audience: string, targetIds: string[], priority = 'IMPORTANT') => ({
  id: `${audience}-${priority}`, title: 'Notice', body: 'Details', priority, audience, targetIds,
  startsAt: '2026-10-10T00:00:00Z', endsAt: null, active: true,
});

describe('HomeCarouselService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.appSetting.findUnique.mockResolvedValue({ value: [] });
    prisma.dailyAttendance.findMany.mockResolvedValue([]);
    ticketAccess.visibleUserIdsForWorkload.mockResolvedValue(['u1']);
  });

  it('returns only role and department targeted notices for the signed-in user', async () => {
    prisma.appSetting.findUnique.mockResolvedValue({ value: [
      notice('COMPANY', []), notice('ROLE', ['MANAGER']), notice('ROLE', ['EMPLOYEE']),
      notice('DEPARTMENT', ['d2']), notice('DEPARTMENT', ['d1'], 'CRITICAL'),
    ] });
    const result = await make().getCarousel(employee);
    expect(result.announcement?.audience).toBe('COMPANY');
    expect(result.criticalAnnouncements.map((item) => item.audience)).toEqual(['DEPARTMENT']);
    expect(prisma.dailyAttendance.findMany.mock.calls[0][0].where.user.id.in).toEqual(['u1']);
  });

  it('uses finalized scheduled days and excludes leave, off-days and unresolved evidence', async () => {
    prisma.dailyAttendance.findMany.mockResolvedValue([
      { userId: 'u1', user: { name: 'One' }, status: 'PRESENT', attendancePolicyId: 'p1', exceptionFlags: [] },
      { userId: 'u1', user: { name: 'One' }, status: 'LATE', attendancePolicyId: 'p1', exceptionFlags: [] },
      { userId: 'u1', user: { name: 'One' }, status: 'LEAVE', attendancePolicyId: 'p1', exceptionFlags: [] },
      { userId: 'u1', user: { name: 'One' }, status: 'PRESENT', attendancePolicyId: 'p1', exceptionFlags: ['GEO'] },
      { userId: 'u2', user: { name: 'Two' }, status: 'PRESENT', attendancePolicyId: 'p2', exceptionFlags: [] },
    ]);
    const result = await make().getCarousel(employee);
    expect(result.spotlight.leaders).toEqual([{ id: 'u1', name: 'One', onTime: 1, eligible: 2, rate: 50 }]);
    expect(prisma.dailyAttendance.findMany.mock.calls[0][0].where.evaluationState).toBe('FINALIZED');
  });

  it('keeps publishing admin-only and rejects malformed target and dates', async () => {
    await expect(make().publishAnnouncements(employee, [])).rejects.toBeInstanceOf(ForbiddenException);
    await expect(make().publishAnnouncements(admin, [{ ...notice('ROLE', ['UNKNOWN']), endsAt: '2026-10-11' }]))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
  });
});
