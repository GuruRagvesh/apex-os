import { BadRequestException } from '@nestjs/common';
import { HomeInsightsService } from '../../src/modules/platform/dashboard/home-insights.service';
import { createTvaDouble } from '../helpers/tva-double';

// 2026-10-07 17:00 IST
const NOW = new Date('2026-10-07T11:30:00.000Z');

const prisma: any = {
  ticket: { count: jest.fn(), findMany: jest.fn() },
  ticketTimeLog: { findMany: jest.fn() },
  project: { count: jest.fn() },
  leaveRequest: { count: jest.fn() },
};
const ticketAccess: any = { buildTicketWhereForUser: jest.fn(async () => ({ departmentId: 'd1' })) };
const leaveAccess: any = { buildLeaveWhereForUser: jest.fn(async () => ({ departmentId: 'd1' })) };
const dashboard: any = { buildProjectScope: jest.fn(async () => ({})) };

const make = () => new HomeInsightsService(prisma, ticketAccess, leaveAccess, createTvaDouble(NOW) as any, dashboard);
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
  });

  it('gives employees personal KPIs only, with no approval counts', async () => {
    const kpis = await make().getKpis(employee);
    expect(kpis.activeTickets).toEqual({ mine: 3, team: null });
    expect(kpis.pendingTicketApprovals).toBeNull();
    expect(kpis.pendingLeaveApprovals).toBeNull();
    expect(prisma.leaveRequest.count).not.toHaveBeenCalled();
  });

  it('gives leads team scope and approval counts, excluding their own leave', async () => {
    const kpis = await make().getKpis(lead);
    expect(kpis.activeTickets).toEqual({ mine: 3, team: 3 });
    expect(kpis.pendingTicketApprovals).toBe(3);
    expect(kpis.pendingLeaveApprovals).toBe(1);
    const leaveWhere = prisma.leaveRequest.count.mock.calls[0][0].where;
    expect(JSON.stringify(leaveWhere)).toContain('"NOT":{"userId":"u2"}');
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
