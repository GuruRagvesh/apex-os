import { TicketStatus } from '@prisma/client';
import { TICKET_TIMING_SELECT, TicketsService } from '../../src/modules/operations/tickets/tickets.service';

// The Overdue filter used to load EVERY open ticket with all its relations
// just to decide which were overdue. With a few hundred open tickets on
// staging that ran the API out of memory (512MB) and the page showed "No
// tickets found". It now decides from the timing fields alone and loads full
// details only for the page shown.

function service(rows: Array<{ id: string; overdue: boolean }>) {
  const prisma = {
    ticket: {
      findMany: jest.fn(async (args: any) => {
        if (args.select) return rows.map((r) => ({ id: r.id, status: TicketStatus.OPEN, overdue: r.overdue }));
        return args.where.id.in.map((id: string) => ({ id, ticketId: `T-${id}`, assignees: [] }));
      }),
    },
  };
  const ticketTiming = {
    getSlaConfig: jest.fn().mockResolvedValue({ execution: {}, review: {} }),
    getTimingState: jest.fn((t: any) => ({ isOverdue: t.overdue })),
    decorateTickets: jest.fn(async (ts: any[]) => ts),
  };
  const ticketAccess = { buildTicketWhereForUser: jest.fn().mockResolvedValue({}) };
  const svc = new TicketsService(
    prisma as any, {} as any, {} as any, { get: jest.fn() } as any, {} as any, {} as any,
    ticketAccess as any, {} as any, ticketTiming as any, { getWorkBudgets: jest.fn().mockResolvedValue(new Map()) } as any,
    {} as any, {} as any, { now: () => new Date('2026-10-14T06:00:00Z') } as any,
  );
  return { svc, prisma, ticketTiming };
}

describe('the Overdue ticket filter stays within memory', () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ id: `t${String(i).padStart(2, '0')}`, overdue: i % 3 !== 0 }));
  const overdueIds = rows.filter((r) => r.overdue).map((r) => r.id);

  it('decides overdue from the timing fields only, never loading relations for every ticket', async () => {
    const { svc, prisma } = service(rows);
    await svc.findAll({ overdue: 'true', page: 1, limit: 20 });

    const [first, second] = prisma.ticket.findMany.mock.calls.map((c: any[]) => c[0]);
    expect(first.select).toBe(TICKET_TIMING_SELECT);
    expect(first.include).toBeUndefined();
    expect(first.where).toEqual(expect.objectContaining({}));
    // Full details only for the 20 tickets on the page.
    expect(second.include).toBeDefined();
    expect(second.where.id.in).toEqual(overdueIds.slice(0, 20));
  });

  it('pages and totals exactly as before, in list order', async () => {
    const { svc } = service(rows);
    const p1 = await svc.findAll({ overdue: 'true', page: 1, limit: 20 });
    const p2 = await svc.findAll({ overdue: 'true', page: 2, limit: 20 });

    expect(p1.total).toBe(overdueIds.length);
    expect(p1.totalPages).toBe(Math.ceil(overdueIds.length / 20));
    expect(p1.tickets.map((t: any) => t.id)).toEqual(overdueIds.slice(0, 20));
    expect(p2.tickets.map((t: any) => t.id)).toEqual(overdueIds.slice(20, 40));
  });

  it('selects every field the timing rules read', () => {
    for (const f of ['status', 'priority', 'isBlocked', 'blockedAt', 'blockedReason', 'cancelledAt', 'createdAt', 'updatedAt',
      'actualStartAt', 'scheduledStartAt', 'estimatedMinutes', 'dueDate', 'executionDueAt', 'reviewDueAt', 'reviewStartedAt', 'submittedAt']) {
      expect([f, (TICKET_TIMING_SELECT as any)[f]]).toEqual([f, true]);
    }
  });

  it('an empty result loads nothing else', async () => {
    const { svc, prisma } = service([{ id: 'a', overdue: false }]);
    const res = await svc.findAll({ overdue: 'true', page: 1, limit: 20 });
    expect(res).toEqual(expect.objectContaining({ tickets: [], total: 0, totalPages: 0 }));
    expect(prisma.ticket.findMany).toHaveBeenCalledTimes(1);
  });
});
