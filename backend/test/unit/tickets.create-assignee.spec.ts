import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';

// Regression test for a bug found during ticket detail page audit (fresh-ticket validation):
// TicketsService.create()'s "resolve assignedToId: accept display name or UUID" step used
// isUUID(), which only matches the hyphenated 8-4-4-4-12 UUID format. Prisma's @default(cuid())
// IDs never match that pattern, so every real assignedToId was wrongly treated as a typed
// display name, failed the name-only lookup, and got silently reset to undefined — leaving
// tickets created with a real assignee stored as unassigned (assignedToId: null).
describe('TicketsService.create — assignedToId resolution (cuid, not UUID)', () => {
  let prisma: any;
  let notificationEventService: any;
  let service: TicketsService;

  beforeEach(() => {
    prisma = {
      department: { findFirst: jest.fn() },
      user: { findFirst: jest.fn() },
      ticket: { create: jest.fn() },
      ticketAssignee: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
      appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([{ max: 0 }]),
    };
    notificationEventService = { sendNotification: jest.fn().mockResolvedValue(null) };

    service = new TicketsService(
      prisma,
      { emitTicketCreated: jest.fn() } as any, // gateway
      notificationEventService,
      { get: jest.fn() } as any, // configService
      { emit: jest.fn() } as any, // eventEmitter
      { log: jest.fn().mockReturnValue({ catch: jest.fn() }) } as any, // eventLogger
      {} as any, // ticketAccess (not used by create())
      { resolveTaskCreationApprover: jest.fn() } as any, // hierarchyApprovalService
      { decorateTicket: jest.fn((t: any) => Promise.resolve(t)) } as any, // ticketTiming
      { startReviewCycle: jest.fn(), endReviewCycle: jest.fn() } as any, // ticketLedger (not used by create())
      {} as any, // ticketImport (not used by create())
    );
  });

  it('keeps a real cuid assignedToId instead of nulling it out via the name-lookup fallback', async () => {
    const realCuidAssigneeId = 'cl9ebqhxk00003b6tlmmz3pgw'; // cuid() shape — isUUID() returns false for this
    prisma.user.findFirst.mockResolvedValue({ id: realCuidAssigneeId, name: 'Pratik' });
    prisma.ticket.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'ticket-1', ticketId: 'TKT-001', assignedTo: null, ...data }),
    );

    await service.create(
      { title: 'Apex QC', category: 'OPERATIONS', priority: 'HIGH', assignedToId: realCuidAssigneeId },
      'creator-1',
      { role: { name: 'MANAGER' } },
    );

    // The bug: this lookup must match by id, not name-only, or a valid id gets nulled out.
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: realCuidAssigneeId }, { name: { equals: realCuidAssigneeId, mode: 'insensitive' } }] },
    });
    expect(prisma.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedToId: realCuidAssigneeId }) }),
    );
  });

  it('still resolves a typed display name to the matching user id', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-resolved-id', name: 'Sonali' });
    prisma.ticket.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'ticket-2', ticketId: 'TKT-002', assignedTo: null, ...data }),
    );

    await service.create(
      { title: 'Apex QC 2', category: 'OPERATIONS', priority: 'HIGH', assignedToId: 'Sonali' },
      'creator-1',
      { role: { name: 'MANAGER' } },
    );

    expect(prisma.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedToId: 'user-resolved-id' }) }),
    );
  });

  it('falls back to undefined when neither id nor name matches any user', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.ticket.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'ticket-3', ticketId: 'TKT-003', assignedTo: null, ...data }),
    );

    await service.create(
      { title: 'Apex QC 3', category: 'OPERATIONS', priority: 'HIGH', assignedToId: 'no-such-user' },
      'creator-1',
      { role: { name: 'MANAGER' } },
    );

    expect(prisma.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedToId: undefined }) }),
    );
  });
});
