import { BadRequestException } from '@nestjs/common';
import { HomeInsightsService } from '../../src/modules/platform/dashboard/home-insights.service';
import { createTvaDouble } from '../helpers/tva-double';

// 2026-10-07 17:00 IST
const NOW = new Date('2026-10-07T11:30:00.000Z');

const prisma: any = {
  ticket: { count: jest.fn(), findMany: jest.fn() },
  ticketTimeLog: { findMany: jest.fn() },
  project: { count: jest.fn() },
  leaveRequest: { count: jest.fn(), findMany: jest.fn() },
};
const leaveAccess: any = { buildLeaveWhereForUser: jest.fn(async () => ({ departmentId: 'd1' })) };
const leaveService: any = { viewerCanApprove: jest.fn(async () => true) };

const make = () => new HomeInsightsService(prisma, leaveAccess, createTvaDouble(NOW) as any, leaveService);
const employee = { id: 'u1', role: { name: 'EMPLOYEE' } };
const lead = { id: 'u2', role: { name: 'TEAM_LEAD' } };

describe('HomeInsightsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.ticket.count.mockResolvedValue(3);
    prisma.ticket.findMany.mockResolvedValue([]);
    prisma.ticketTimeLog.findMany.mockResolvedValue([]);
    prisma.project.count.mockResolvedValue(2);
    prisma.leaveRequest.count.mockResolvedValue(1);
    prisma.leaveRequest.findMany.mockResolvedValue([]);
  });

  it('gives employees personal work KPIs and no approval queues', async () => {
    const kpis = await make().getKpis(employee);
    expect(kpis.mine).toEqual({
      openTickets: 3, inProgressTickets: 3, underReviewTickets: 3,
      pendingTicketApprovals: 0, activeProjects: 2, leaveApprovals: 0,
    });
    expect(kpis.scoped).toBeNull();
    expect(kpis.pendingTicketApprovals).toBeNull();
    expect(kpis.pendingLeaveApprovals).toBeNull();
    expect(prisma.leaveRequest.findMany).not.toHaveBeenCalled();
  });

  it('gives leads personal work KPIs and only actionable approvals', async () => {
    prisma.leaveRequest.findMany.mockResolvedValue([{ id: 'leave-1', userId: 'u3' }]);
    const kpis = await make().getKpis(lead);
    expect(kpis.mine).toEqual({
      openTickets: 3, inProgressTickets: 3, underReviewTickets: 3,
      pendingTicketApprovals: 3, activeProjects: 2, leaveApprovals: 1,
    });
    expect(kpis.scoped).toBeNull();
    expect(kpis.pendingTicketApprovals).toBe(3);
    expect(kpis.pendingLeaveApprovals).toBe(1);
    expect(leaveService.viewerCanApprove).toHaveBeenCalledWith(lead, { id: 'leave-1', userId: 'u3' });
    const leaveWhere = prisma.leaveRequest.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(leaveWhere)).toContain('"NOT":{"userId":"u2"}');
  });

  it('counts company projects for managers and membership projects for team leads', async () => {
    await make().getKpis({ id: 'manager-1', role: { name: 'MANAGER' } });
    expect(prisma.project.count).toHaveBeenLastCalledWith({ where: { status: 'ACTIVE' } });

    await make().getKpis(lead);
    expect(prisma.project.count).toHaveBeenLastCalledWith({
      where: { AND: [{ members: { some: { userId: 'u2' } } }, { status: 'ACTIVE' }] },
    });
  });

  it('buckets done tickets by company date, not UTC date', async () => {
    prisma.ticket.findMany
      // closed 2026-10-06 20:00 UTC = 2026-10-07 01:30 IST
      .mockResolvedValueOnce([{ id: 't1', ticketId: 'TKT-1', title: 'A', closedAt: new Date('2026-10-06T20:00:00Z'), estimatedMinutes: 60 }])
      .mockResolvedValueOnce([]);
    const days = await make().getDailyProductivity(employee, '2026-10-06', '2026-10-07');
    expect(days.map((d) => d.ticketsDone)).toEqual([0, 1]);
    expect(days[1].estimatedMinutesDone).toBe(60);
    expect(days[1].doneTickets[0].ticketId).toBe('TKT-1');
  });

  it('buckets tickets added to the user workload for the created-versus-solved chart', async () => {
    prisma.ticket.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      // 2026-10-06 20:00 UTC = 2026-10-07 01:30 IST
      .mockResolvedValueOnce([{ createdAt: new Date('2026-10-06T20:00:00Z') }]);
    const days = await make().getDailyProductivity(employee, '2026-10-06', '2026-10-07');
    expect(days.map((d) => d.ticketsCreated)).toEqual([0, 1]);
  });

  it('splits a time log that runs past company midnight', async () => {
    prisma.ticketTimeLog.findMany.mockResolvedValue([
      // 23:00 IST on the 6th to 01:00 IST on the 7th
      { startedAt: new Date('2026-10-06T17:30:00Z'), endedAt: new Date('2026-10-06T19:30:00Z'), durationSeconds: 7200 },
    ]);
    const days = await make().getDailyProductivity(employee, '2026-10-06', '2026-10-07');
    expect(days.map((d) => d.ticketMinutes)).toEqual([60, 60]);
  });

  it('counts a running timer only up to now', async () => {
    prisma.ticketTimeLog.findMany.mockResolvedValue([
      { startedAt: new Date('2026-10-07T10:30:00Z'), endedAt: null, durationSeconds: null },
    ]);
    const days = await make().getDailyProductivity(employee, '2026-10-07', '2026-10-07');
    expect(days[0].ticketMinutes).toBe(60);
  });

  it('rejects malformed or oversized ranges', async () => {
    await expect(make().getDailyProductivity(employee, '2026-10-07', '2026-10-01')).rejects.toBeInstanceOf(BadRequestException);
    await expect(make().getDailyProductivity(employee, 'yesterday', '2026-10-01')).rejects.toBeInstanceOf(BadRequestException);
    await expect(make().getDailyProductivity(employee, '2026-01-01', '2026-10-01')).rejects.toBeInstanceOf(BadRequestException);
  });
});
