import { TicketStatus } from '@prisma/client';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';

// TicketsService.update() — actual worked-time ledger wiring. The audit found that
// TicketLedgerService's start/pause/resume/end mechanics were fully built and
// correctly called from workday break-start/end-day/auto-close, but nothing in the
// real ticket status-transition flow ever called startWorkLog() — so there was
// never an active TicketTimeLog for those pause calls to act on. These tests use a
// REAL TicketLedgerService (backed by an in-memory fake ticketTimeLog table) so the
// dedup/pause/resume behavior is genuinely exercised, not just asserted-as-called.
//
// This is strictly about worked-time (TicketTimeLog). The SLA/due-date countdown
// (TicketTimingService) is untouched and out of scope for this suite.
describe('TicketsService.update — worked-time ledger wiring', () => {
  let prisma: any;
  let ticketAccess: any;
  let ticketLedger: TicketLedgerService;
  let service: TicketsService;
  let timeLogTable: ReturnType<typeof makeTicketTimeLogTable>;
  let gateway: { emitTicketStatusChanged: jest.Mock; emitTicketCreated: jest.Mock };
  let eventEmitter: { emit: jest.Mock };

  const NOW = new Date('2026-07-02T10:00:00Z');

  function makeTicketTimeLogTable() {
    const rows: any[] = [];
    let counter = 0;
    return {
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        let matches = rows.filter((r) => {
          if (where.ticketId !== undefined && r.ticketId !== where.ticketId) return false;
          if (where.userId !== undefined && r.userId !== where.userId) return false;
          if (where.stage !== undefined && r.stage !== where.stage) return false;
          if (where.endedAt === null && r.endedAt !== null) return false;
          return true;
        });
        if (orderBy?.startedAt === 'desc') matches = [...matches].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
        return matches[0] ?? null;
      }),
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => {
        if (where.ticketId !== undefined && r.ticketId !== where.ticketId) return false;
        if (where.userId !== undefined && r.userId !== where.userId) return false;
        if (where.endedAt === null && r.endedAt !== null) return false;
        if (where.pauseReason !== undefined && r.pauseReason !== where.pauseReason) return false;
        if (where.breakLogId !== undefined && r.breakLogId !== where.breakLogId) return false;
        return true;
      })),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `log-${++counter}`, endedAt: null, durationSeconds: null, pauseReason: null, breakLogId: null, ...data };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      }),
      aggregate: jest.fn(async () => ({ _sum: { durationSeconds: 0 } })),
      rows,
    };
  }

  function makeReviewCycleTable() {
    const rows: any[] = [];
    let counter = 0;
    const matches = (r: any, where: any) => {
      if (where.ticketId !== undefined && r.ticketId !== where.ticketId) return false;
      if ('decision' in where && (r.decision ?? null) !== where.decision) return false;
      if ('reworkEndedAt' in where && where.reworkEndedAt === null && r.reworkEndedAt) return false;
      if (where.reworkStartedAt?.not === null && !r.reworkStartedAt) return false;
      return true;
    };
    return {
      findFirst: jest.fn(async ({ where }: any) =>
        rows.filter((r) => matches(r, where)).sort((a, b) => b.cycleNo - a.cycleNo)[0] ?? null),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `cycle-${++counter}`, decision: null, reworkEndedAt: null, ...data };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        Object.assign(row, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
        return row;
      }),
      rows,
    };
  }

  function makeTicketFixture(overrides: any = {}) {
    return {
      id: 'ticket-1',
      ticketId: 'TKT-500',
      status: TicketStatus.OPEN,
      type: 'TASK',
      priority: 'MEDIUM',
      createdById: 'creator-1',
      assignedToId: 'worker-1',
      assignees: [],
      estimatedMinutes: 60,
      submittedAt: null,
      ...overrides,
    };
  }

  const worker = { id: 'worker-1', role: { name: 'EMPLOYEE' } };

  beforeEach(() => {
    timeLogTable = makeTicketTimeLogTable();
    prisma = {
      ticket: {
        // startAssigneeTimer() re-reads the ticket under the worker lock: it must be
        // IN_PROGRESS, unblocked and still assigned to the worker.
        findUnique: jest.fn().mockResolvedValue({ id: 'ticket-1', status: 'IN_PROGRESS', isBlocked: false, assignedToId: 'worker-1' }),
        // Next-ticket auto-resume after a stop: nothing else is waiting here.
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(async ({ data }: any) => ({
          ...makeTicketFixture(), ...data, assignedTo: { id: 'worker-1', name: 'Worker One' },
        })),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ currentStatus: 'ACTIVE' }) },
      ticketHistory: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
      ticketTimeLog: timeLogTable,
      reviewCycleLog: makeReviewCycleTable(),
      // The worker has an open, working session unless a test says otherwise.
      workSession: { findFirst: jest.fn().mockResolvedValue({ id: 'ws-1', status: 'WORKING', logoutAt: null, breakLogs: [] }) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    ticketAccess = {
      findAccessibleTicket: jest.fn(async () => makeTicketFixture()),
      assertCanTransitionTicket: jest.fn().mockResolvedValue(undefined),
      assertCanAssignTicket: jest.fn().mockResolvedValue(undefined),
      assertCanUpdateTicket: jest.fn().mockResolvedValue(undefined),
      isSelfAssigned: jest.fn().mockReturnValue(false),
      canViewTicket: jest.fn().mockResolvedValue(false),
    };

    ticketLedger = new TicketLedgerService(
      prisma,
      {
        now: () => NOW,
        elapsedSeconds: (start: Date, end?: Date) =>
          Math.floor(((end ?? NOW).getTime() - new Date(start).getTime()) / 1000),
      } as any,
    );

    gateway = { emitTicketStatusChanged: jest.fn(), emitTicketCreated: jest.fn() };
    eventEmitter = { emit: jest.fn() };
    service = new TicketsService(
      prisma,
      gateway as any, // gateway
      { sendNotification: jest.fn().mockResolvedValue(null) } as any, // notificationEventService
      { get: jest.fn() } as any, // configService
      eventEmitter as any, // eventEmitter
      { log: jest.fn().mockReturnValue({ catch: jest.fn() }) } as any, // eventLogger
      ticketAccess,
      { resolveTaskCreationApprover: jest.fn(), resolvePrimaryApproverFor: jest.fn().mockResolvedValue(null) } as any, // hierarchyApprovalService
      { getSlaConfig: jest.fn().mockResolvedValue({ review: { MEDIUM: 24 } }), decorateTicket: jest.fn((t: any) => Promise.resolve(t)) } as any, // ticketTiming
      ticketLedger,
      {} as any, // ticketImport
    );
  });

  it('1. OPEN → IN_PROGRESS starts an active TicketTimeLog for the primary assignee', async () => {
    ticketAccess.findAccessibleTicket.mockResolvedValue(makeTicketFixture({ status: TicketStatus.OPEN }));

    await service.update('ticket-1', { status: TicketStatus.IN_PROGRESS }, 'worker-1', worker);

    const activeLogs = timeLogTable.rows.filter((r) => r.endedAt === null);
    expect(activeLogs).toHaveLength(1);
    expect(activeLogs[0]).toMatchObject({
      ticketId: 'ticket-1', userId: 'worker-1', stage: 'WORK', ownerType: 'ASSIGNEE', source: 'TICKET_STATUS',
    });
  });

  it('2. IN_PROGRESS → REVIEW ends the active TicketTimeLog', async () => {
    ticketAccess.findAccessibleTicket.mockResolvedValue(makeTicketFixture({ status: TicketStatus.IN_PROGRESS }));
    timeLogTable.rows.push({
      id: 'log-seed', ticketId: 'ticket-1', userId: 'worker-1', stage: 'WORK', ownerType: 'ASSIGNEE', source: 'TICKET_STATUS',
      startedAt: new Date('2026-07-02T09:00:00Z'), endedAt: null, durationSeconds: null, pauseReason: null, breakLogId: null,
    });

    await service.update('ticket-1', { status: TicketStatus.REVIEW }, 'worker-1', worker);

    const log = timeLogTable.rows.find((r) => r.id === 'log-seed');
    expect(log.endedAt).not.toBeNull();
    expect(log.pauseReason).toBe('STATUS_CHANGE');
    expect(log.durationSeconds).toBe(3600); // 09:00 -> 10:00
  });

  it.each([TicketStatus.DONE, TicketStatus.CLOSED])('3. IN_PROGRESS → %s ends the active TicketTimeLog', async (target) => {
    ticketAccess.findAccessibleTicket.mockResolvedValue(makeTicketFixture({ status: TicketStatus.IN_PROGRESS }));
    timeLogTable.rows.push({
      id: 'log-seed', ticketId: 'ticket-1', userId: 'worker-1', stage: 'WORK', ownerType: 'ASSIGNEE', source: 'TICKET_STATUS',
      startedAt: new Date('2026-07-02T09:00:00Z'), endedAt: null, durationSeconds: null, pauseReason: null, breakLogId: null,
    });

    await service.update('ticket-1', { status: target }, 'worker-1', worker);

    const log = timeLogTable.rows.find((r) => r.id === 'log-seed');
    expect(log.endedAt).not.toBeNull();
    expect(log.pauseReason).toBe('STATUS_CHANGE');
  });

  it('4. IN_PROGRESS → OPEN ends the active TicketTimeLog', async () => {
    ticketAccess.findAccessibleTicket.mockResolvedValue(makeTicketFixture({ status: TicketStatus.IN_PROGRESS }));
    timeLogTable.rows.push({
      id: 'log-seed', ticketId: 'ticket-1', userId: 'worker-1', stage: 'WORK', ownerType: 'ASSIGNEE', source: 'TICKET_STATUS',
      startedAt: new Date('2026-07-02T09:00:00Z'), endedAt: null, durationSeconds: null, pauseReason: null, breakLogId: null,
    });

    await service.update('ticket-1', { status: TicketStatus.OPEN }, 'worker-1', worker);

    const log = timeLogTable.rows.find((r) => r.id === 'log-seed');
    expect(log.endedAt).not.toBeNull();
  });

  it('5a. re-sending status: IN_PROGRESS while already IN_PROGRESS does not start a second active log', async () => {
    ticketAccess.findAccessibleTicket.mockResolvedValue(makeTicketFixture({ status: TicketStatus.IN_PROGRESS }));
    timeLogTable.rows.push({
      id: 'log-seed', ticketId: 'ticket-1', userId: 'worker-1', stage: 'WORK', ownerType: 'ASSIGNEE', source: 'TICKET_STATUS',
      startedAt: new Date('2026-07-02T09:00:00Z'), endedAt: null, durationSeconds: null, pauseReason: null, breakLogId: null,
    });

    // Same status re-sent alongside an unrelated field edit — not a real transition.
    await service.update('ticket-1', { status: TicketStatus.IN_PROGRESS, priority: 'HIGH' }, 'worker-1', worker);

    const activeLogs = timeLogTable.rows.filter((r) => r.endedAt === null);
    expect(activeLogs).toHaveLength(1);
    expect(activeLogs[0].id).toBe('log-seed');
  });

  it('5b. rework re-entry (REVIEW → IN_PROGRESS) ends the old log and leaves exactly one new active log', async () => {
    ticketAccess.findAccessibleTicket.mockResolvedValue(
      makeTicketFixture({ status: TicketStatus.REVIEW, submittedAt: new Date('2026-07-02T09:30:00Z') }),
    );
    timeLogTable.rows.push({
      id: 'log-old', ticketId: 'ticket-1', userId: 'worker-1', stage: 'WORK', ownerType: 'ASSIGNEE', source: 'TICKET_STATUS',
      startedAt: new Date('2026-07-02T08:00:00Z'), endedAt: new Date('2026-07-02T09:30:00Z'),
      durationSeconds: 5400, pauseReason: 'STATUS_CHANGE', breakLogId: null,
    });

    await service.update('ticket-1', { status: TicketStatus.IN_PROGRESS }, 'worker-1', worker);

    const activeLogs = timeLogTable.rows.filter((r) => r.endedAt === null);
    expect(activeLogs).toHaveLength(1);
    expect(activeLogs[0].id).not.toBe('log-old');
  });

  it('6. a log started via update() can still be paused by the existing, untouched pauseActiveLogsForUser (break-start compatibility)', async () => {
    ticketAccess.findAccessibleTicket.mockResolvedValue(makeTicketFixture({ status: TicketStatus.OPEN }));
    await service.update('ticket-1', { status: TicketStatus.IN_PROGRESS }, 'worker-1', worker);
    expect(timeLogTable.rows.filter((r) => r.endedAt === null)).toHaveLength(1);

    // This is workday.service.ts's exact break-start call — untouched by this change.
    const result = await ticketLedger.pauseActiveLogsForUser({ userId: 'worker-1', pauseReason: 'BREAK', breakLogId: 'break-1' });

    expect(result.count).toBe(1);
    expect(timeLogTable.rows.filter((r) => r.endedAt === null)).toHaveLength(0);
    expect(timeLogTable.rows[0].pauseReason).toBe('BREAK');
  });

  it('7. a log paused for break resumes correctly via the existing, untouched resumeLogsForBreak', async () => {
    ticketAccess.findAccessibleTicket.mockResolvedValue(makeTicketFixture({ status: TicketStatus.OPEN }));
    await service.update('ticket-1', { status: TicketStatus.IN_PROGRESS }, 'worker-1', worker);
    await ticketLedger.pauseActiveLogsForUser({ userId: 'worker-1', pauseReason: 'BREAK', breakLogId: 'break-1' });
    expect(timeLogTable.rows.filter((r) => r.endedAt === null)).toHaveLength(0);

    // This is workday.service.ts's exact break-end call. resumeLogsForBreak()
    // re-reads the ticket under the worker lock (still IN_PROGRESS, unblocked,
    // still assigned to this worker) before resuming.
    const resumed = await ticketLedger.resumeLogsForBreak('break-1', 'worker-1');

    expect(resumed).toHaveLength(1);
    expect(timeLogTable.rows.filter((r) => r.endedAt === null)).toHaveLength(1);
  });

  it('8. a manager moving the ticket to IN_PROGRESS starts the ASSIGNEE\'s timer, not the manager\'s', async () => {
    ticketAccess.findAccessibleTicket.mockResolvedValue(makeTicketFixture({ status: TicketStatus.OPEN }));

    await service.update('ticket-1', { status: TicketStatus.IN_PROGRESS }, 'manager-1', { id: 'manager-1', role: { name: 'MANAGER' } });

    const activeLogs = timeLogTable.rows.filter((r) => r.endedAt === null);
    expect(activeLogs).toHaveLength(1);
    expect(activeLogs[0].userId).toBe('worker-1');
  });

  it('9. a manager moving the ticket out of IN_PROGRESS stops the WORKER\'s clock', async () => {
    ticketAccess.findAccessibleTicket.mockResolvedValue(makeTicketFixture({ status: TicketStatus.IN_PROGRESS }));
    timeLogTable.rows.push({
      id: 'log-seed', ticketId: 'ticket-1', userId: 'worker-1', stage: 'WORK', ownerType: 'ASSIGNEE', source: 'TICKET_STATUS',
      startedAt: new Date('2026-07-02T09:00:00Z'), endedAt: null, durationSeconds: null, pauseReason: null, breakLogId: null,
    });

    await service.update('ticket-1', { status: TicketStatus.REVIEW }, 'manager-1', { id: 'manager-1', role: { name: 'MANAGER' } });

    expect(timeLogTable.rows.find((r) => r.id === 'log-seed')).toMatchObject({ pauseReason: 'STATUS_CHANGE', durationSeconds: 3600 });
  });

  it('10. starting while the worker is off-shift writes a zero-length deferred marker, never a running clock', async () => {
    ticketAccess.findAccessibleTicket.mockResolvedValue(makeTicketFixture({ status: TicketStatus.OPEN }));
    prisma.workSession.findFirst.mockResolvedValue({ id: 'ws-1', status: 'LOGGED_OUT', logoutAt: NOW, breakLogs: [] });

    await service.update('ticket-1', { status: TicketStatus.IN_PROGRESS }, 'manager-1', { id: 'manager-1', role: { name: 'MANAGER' } });

    expect(timeLogTable.rows.filter((r) => r.endedAt === null)).toHaveLength(0);
    expect(timeLogTable.rows[0]).toMatchObject({ userId: 'worker-1', durationSeconds: 0, pauseReason: 'AWAITING_WORKDAY' });
  });

  it('11. rework re-entry opens a REWORK cycle and times the worker in stage REWORK', async () => {
    ticketAccess.findAccessibleTicket.mockResolvedValue(
      makeTicketFixture({ status: TicketStatus.REVIEW, submittedAt: NOW, reviewStartedAt: NOW }),
    );

    await service.update('ticket-1', { status: TicketStatus.IN_PROGRESS }, 'manager-1', { id: 'manager-1', role: { name: 'MANAGER' } });

    const cycles = prisma.reviewCycleLog.rows;
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({ decision: 'REWORK' });
    expect(cycles[0].reworkStartedAt).toBeInstanceOf(Date);
    const active = timeLogTable.rows.filter((r) => r.endedAt === null);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ userId: 'worker-1', stage: 'REWORK' });
  });

  // Phase 2D2 reverses the old fail-open rule: a status change and the timer
  // change it requires commit together, so a ledger failure fails the whole
  // transition (PostgreSQL rollback is proven in integration-pg/t5) and no
  // "status changed" event is announced for a change that did not commit.
  it('a ledger failure fails the status transition and emits nothing', async () => {
    ticketAccess.findAccessibleTicket.mockResolvedValue(makeTicketFixture({ status: TicketStatus.OPEN }));
    (timeLogTable.create as jest.Mock).mockRejectedValueOnce(new Error('db write failed'));

    await expect(
      service.update('ticket-1', { status: TicketStatus.IN_PROGRESS }, 'worker-1', worker),
    ).rejects.toThrow('db write failed');

    expect(gateway.emitTicketStatusChanged).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });
});
