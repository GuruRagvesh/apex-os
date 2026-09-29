import { TVAService } from '../../src/common/services/tva.service';
import { Test, TestingModule } from '@nestjs/testing';
import { TicketLedgerService, LEDGER_STAGES, LEDGER_OWNER_TYPES, LEDGER_SOURCES, LEDGER_PAUSE_REASONS } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';

describe('TicketLedgerService', () => {
  let service: TicketLedgerService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      ticketTimeLog: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn(),
      },
      reviewCycleLog: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      ticket: {
        findUnique: jest.fn(),
      },
      workSession: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ws1', status: 'WORKING', logoutAt: null, breakLogs: [] }),
      },
      // Timer starts/pauses run in a transaction under a per-worker advisory lock.
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(async (fn: any) => fn(mockPrisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: TVAService,
          useValue: {
            now: () => new Date(), companyTimezone: () => 'Asia/Kolkata', companyNow: () => new Date(),
            companyDayStart: () => new Date(), formatZoned: () => 'mock', companyDayEnd: () => new Date(),
            // Real arithmetic, so a duration assertion actually tests something.
            elapsedSeconds: (start: Date, end?: Date) =>
              Math.max(0, Math.floor(((end ?? new Date()).getTime() - new Date(start).getTime()) / 1000)),
          },
        },
        TicketLedgerService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TicketLedgerService>(TicketLedgerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startWorkLog', () => {
    it('1. startWorkLog creates a log', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', status: 'IN_PROGRESS' });
      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue(null);
      mockPrisma.ticketTimeLog.create.mockResolvedValue({ id: 'log1' });

      const res = await service.startWorkLog({
        ticketId: 't1',
        userId: 'u1',
        stage: LEDGER_STAGES.WORK,
        ownerType: LEDGER_OWNER_TYPES.ASSIGNEE,
        source: LEDGER_SOURCES.SYSTEM,
      });

      expect(res).toEqual({ id: 'log1' });
      expect(mockPrisma.ticketTimeLog.create).toHaveBeenCalled();
    });

    it('2. startWorkLog is idempotent when same active log exists', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', status: 'IN_PROGRESS' });
      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue({ id: 'log1' });

      const res = await service.startWorkLog({
        ticketId: 't1',
        userId: 'u1',
        stage: LEDGER_STAGES.WORK,
        ownerType: LEDGER_OWNER_TYPES.ASSIGNEE,
        source: LEDGER_SOURCES.SYSTEM,
      });

      expect(res).toEqual({ id: 'log1' });
      expect(mockPrisma.ticketTimeLog.create).not.toHaveBeenCalled();
    });

    it('3. startWorkLog rejects CLOSED ticket', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', status: 'CLOSED' });

      await expect(service.startWorkLog({
        ticketId: 't1',
        userId: 'u1',
        stage: LEDGER_STAGES.WORK,
        ownerType: LEDGER_OWNER_TYPES.ASSIGNEE,
        source: LEDGER_SOURCES.SYSTEM,
      })).rejects.toThrow(BadRequestException);
    });
  });

  describe('endActiveLog', () => {
    it('4. endActiveLog closes log and calculates durationSeconds', async () => {
      const now = new Date();
      const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000);
      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue({ id: 'log1', startedAt: tenMinsAgo, endedAt: null });
      mockPrisma.ticketTimeLog.update.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));

      const res = await service.endActiveLog({ ticketId: 't1', userId: 'u1', endedAt: now });

      expect(res.durationSeconds).toBe(600);
      expect(mockPrisma.ticketTimeLog.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ durationSeconds: 600 }),
      }));
    });

    it('5. endActiveLog is idempotent when no active log exists', async () => {
      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue(null);

      const res = await service.endActiveLog({ ticketId: 't1', userId: 'u1' });

      expect(res).toBeNull();
      expect(mockPrisma.ticketTimeLog.update).not.toHaveBeenCalled();
    });
  });

  describe('pauseActiveLogsForUser', () => {
    it('6. pauseActiveLogsForUser closes all active logs for a user', async () => {
      const startedAt = new Date(Date.now() - 5000);
      mockPrisma.ticketTimeLog.findMany.mockResolvedValue([
        { id: 'log1', startedAt, endedAt: null },
        { id: 'log2', startedAt, endedAt: null },
      ]);
      mockPrisma.ticketTimeLog.update.mockResolvedValue({});

      const res = await service.pauseActiveLogsForUser({ userId: 'u1', pauseReason: LEDGER_PAUSE_REASONS.BREAK });

      expect(res).toEqual({ count: 2, logIds: ['log1', 'log2'] });
      expect(mockPrisma.ticketTimeLog.update).toHaveBeenCalledTimes(2);
    });

    it('7. pauseActiveLogsForUser returns zero when no active logs exist', async () => {
      mockPrisma.ticketTimeLog.findMany.mockResolvedValue([]);

      const res = await service.pauseActiveLogsForUser({ userId: 'u1', pauseReason: LEDGER_PAUSE_REASONS.BREAK });

      expect(res).toEqual({ count: 0, logIds: [] });
      expect(mockPrisma.ticketTimeLog.update).not.toHaveBeenCalled();
    });
  });

  describe('resumeLogsForBreak', () => {
    const pausedByBreak = {
      id: 'log1', ticketId: 't1', userId: 'u1', stage: LEDGER_STAGES.WORK,
      ownerType: LEDGER_OWNER_TYPES.ASSIGNEE, pauseReason: 'BREAK', breakLogId: 'break1',
    };

    it('8a. resumes the ticket this break paused when it is still workable by this worker', async () => {
      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue(pausedByBreak);
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', status: 'IN_PROGRESS', isBlocked: false, assignedToId: 'u1' });
      mockPrisma.ticketTimeLog.findMany.mockResolvedValue([]);
      mockPrisma.ticketTimeLog.create.mockResolvedValue({ id: 'newLog1' });

      const res = await service.resumeLogsForBreak('break1', 'u1');

      expect(res).toEqual([{ id: 'newLog1' }]);
      expect(mockPrisma.ticketTimeLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ ticketId: 't1', userId: 'u1', stage: 'WORK', ownerType: 'ASSIGNEE', workSessionId: 'ws1' }),
      });
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it('8b. does not resume a ticket that is now blocked', async () => {
      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue(pausedByBreak);
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', status: 'IN_PROGRESS', isBlocked: true, assignedToId: 'u1' });

      const res = await service.resumeLogsForBreak('break1', 'u1');

      expect(res).toEqual([]);
      expect(mockPrisma.ticketTimeLog.create).not.toHaveBeenCalled();
    });

    it('8c. does not resume a ticket reassigned to someone else during the break', async () => {
      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue(pausedByBreak);
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', status: 'IN_PROGRESS', isBlocked: false, assignedToId: 'u2' });

      expect(await service.resumeLogsForBreak('break1', 'u1')).toEqual([]);
      expect(mockPrisma.ticketTimeLog.create).not.toHaveBeenCalled();
    });

    it('8d. never creates a second active log if one already runs for the same ticket', async () => {
      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue(pausedByBreak);
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', status: 'IN_PROGRESS', isBlocked: false, assignedToId: 'u1' });
      mockPrisma.ticketTimeLog.findMany.mockResolvedValue([{ id: 'running', ticketId: 't1', ownerType: 'ASSIGNEE', startedAt: new Date() }]);

      expect(await service.resumeLogsForBreak('break1', 'u1')).toEqual([{ id: 'running', ticketId: 't1', ownerType: 'ASSIGNEE', startedAt: expect.any(Date) }]);
      expect(mockPrisma.ticketTimeLog.create).not.toHaveBeenCalled();
    });
  });

  describe('startAssigneeTimer', () => {
    const workable = { id: 't2', status: 'IN_PROGRESS', isBlocked: false, assignedToId: 'u1' };

    it('START pauses the worker\'s other active ticket (SWITCHED) and starts this one', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue(workable);
      mockPrisma.reviewCycleLog.findFirst.mockResolvedValue(null);
      mockPrisma.ticketTimeLog.findMany.mockResolvedValue([
        { id: 'logA', ticketId: 't1', ownerType: 'ASSIGNEE', startedAt: new Date(Date.now() - 60_000) },
      ]);
      mockPrisma.ticketTimeLog.create.mockResolvedValue({ id: 'logB' });

      const res = await service.startAssigneeTimer({ ticketId: 't2', workerId: 'u1', mode: 'START', source: 'TICKET_STATUS' });

      expect(res.outcome).toBe('STARTED');
      expect(res.pausedLogIds).toEqual(['logA']);
      expect(mockPrisma.ticketTimeLog.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'logA' }, data: expect.objectContaining({ pauseReason: 'SWITCHED' }),
      }));
    });

    it('UNBLOCK never pauses another active ticket', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue(workable);
      mockPrisma.ticketTimeLog.findMany.mockResolvedValue([
        { id: 'logA', ticketId: 't1', ownerType: 'ASSIGNEE', startedAt: new Date() },
      ]);

      const res = await service.startAssigneeTimer({ ticketId: 't2', workerId: 'u1', mode: 'UNBLOCK', source: 'TICKET_STATUS' });

      expect(res.outcome).toBe('OTHER_ACTIVE');
      expect(mockPrisma.ticketTimeLog.update).not.toHaveBeenCalled();
      expect(mockPrisma.ticketTimeLog.create).not.toHaveBeenCalled();
    });

    it('a worker who is not working never gets a running clock (zero-length deferred marker)', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue(workable);
      mockPrisma.reviewCycleLog.findFirst.mockResolvedValue(null);
      mockPrisma.ticketTimeLog.findMany.mockResolvedValue([]);
      mockPrisma.workSession.findFirst.mockResolvedValue({ id: 'ws1', status: 'LOGGED_OUT', logoutAt: new Date(), breakLogs: [] });
      mockPrisma.ticketTimeLog.create.mockImplementation(async ({ data }: any) => data);

      const res = await service.startAssigneeTimer({ ticketId: 't2', workerId: 'u1', mode: 'START', source: 'TICKET_STATUS' });

      expect(res.outcome).toBe('DEFERRED');
      expect(res.log).toMatchObject({ durationSeconds: 0, pauseReason: 'AWAITING_WORKDAY' });
      expect(res.log.endedAt).toEqual(res.log.startedAt);
    });

    it('uses stage REWORK while a rework segment is open', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue(workable);
      mockPrisma.ticketTimeLog.findMany.mockResolvedValue([]);
      mockPrisma.reviewCycleLog.findFirst.mockResolvedValue({ id: 'c1', cycleNo: 1, decision: 'REWORK', reworkStartedAt: new Date() });
      mockPrisma.ticketTimeLog.create.mockImplementation(async ({ data }: any) => data);

      const res = await service.startAssigneeTimer({ ticketId: 't2', workerId: 'u1', mode: 'START', source: 'TICKET_STATUS' });

      expect(res.log.stage).toBe('REWORK');
    });
  });

  describe('resumeAfterWorkdayStart', () => {
    it('resumes only when the latest segment was stopped by the workday', async () => {
      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue({ ticketId: 't1', stage: 'WORK', pauseReason: 'STATUS_CHANGE' });
      expect((await service.resumeAfterWorkdayStart('u1')).outcome).toBe('NO_CANDIDATE');

      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue({ ticketId: 't1', stage: 'WORK', pauseReason: 'SWITCHED' });
      expect((await service.resumeAfterWorkdayStart('u1')).outcome).toBe('NO_CANDIDATE');
      expect(mockPrisma.ticketTimeLog.create).not.toHaveBeenCalled();
    });

    it('resumes a LOGOUT-paused ticket that is still workable', async () => {
      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue({ ticketId: 't1', stage: 'WORK', pauseReason: 'LOGOUT' });
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', status: 'IN_PROGRESS', isBlocked: false, assignedToId: 'u1' });
      mockPrisma.ticketTimeLog.findMany.mockResolvedValue([]);
      mockPrisma.ticketTimeLog.create.mockResolvedValue({ id: 'resumed' });

      expect((await service.resumeAfterWorkdayStart('u1')).outcome).toBe('STARTED');
    });
  });

  describe('resumeWorkLog', () => {
    it('8. resumeWorkLog creates a new log after prior log ended', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', status: 'IN_PROGRESS' });
      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue(null);
      mockPrisma.ticketTimeLog.create.mockResolvedValue({ id: 'log2' });

      const res = await service.resumeWorkLog({
        ticketId: 't1',
        userId: 'u1',
        stage: LEDGER_STAGES.WORK,
        ownerType: LEDGER_OWNER_TYPES.ASSIGNEE,
        source: LEDGER_SOURCES.SYSTEM,
      });

      expect(res).toEqual({ id: 'log2' });
      expect(mockPrisma.ticketTimeLog.create).toHaveBeenCalled();
    });
  });

  describe('getActiveLogForUser', () => {
    it('9. getActiveLogForUser returns active log', async () => {
      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue({ id: 'log1' });
      const res = await service.getActiveLogForUser('u1');
      expect(res).toEqual({ id: 'log1' });
    });
  });

  describe('getActiveLogForTicket', () => {
    it('10. getActiveLogForTicket returns active log', async () => {
      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue({ id: 'log1' });
      const res = await service.getActiveLogForTicket('t1');
      expect(res).toEqual({ id: 'log1' });
    });
  });

  describe('ReviewCycleLog', () => {
    it('11. startReviewCycle creates cycleNo 1 when none exists', async () => {
      mockPrisma.reviewCycleLog.findFirst.mockResolvedValue(null);
      mockPrisma.reviewCycleLog.create.mockResolvedValue({ cycleNo: 1 });

      const res = await service.startReviewCycle({ ticketId: 't1' });

      expect(res.cycleNo).toBe(1);
    });

    it('12. startReviewCycle creates next cycleNo when previous cycles exist', async () => {
      mockPrisma.reviewCycleLog.findFirst.mockResolvedValue({ cycleNo: 1 });
      mockPrisma.reviewCycleLog.create.mockResolvedValue({ cycleNo: 2 });

      const res = await service.startReviewCycle({ ticketId: 't1' });

      expect(res.cycleNo).toBe(2);
    });

    it('13. endReviewCycle updates decision, feedback, and calculates metrics on APPROVED', async () => {
      mockPrisma.reviewCycleLog.findFirst.mockResolvedValue({ id: 'cycle1', cycleNo: 1, reviewStartedAt: new Date('2023-01-01') });
      
      // First aggregate call: ASSIGNEE logs
      mockPrisma.ticketTimeLog.aggregate.mockResolvedValueOnce({ _sum: { durationSeconds: 3600 } });
      // Second aggregate call: REVIEWER logs
      mockPrisma.ticketTimeLog.aggregate.mockResolvedValueOnce({ _sum: { durationSeconds: 1800 } });
      
      mockPrisma.reviewCycleLog.update.mockResolvedValue({ decision: 'APPROVED' });

      await service.endReviewCycle({ ticketId: 't1', decision: 'APPROVED', feedback: 'LGTM' });

      expect(mockPrisma.reviewCycleLog.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ 
          decision: 'APPROVED', 
          feedback: 'LGTM',
          assigneeWorkSeconds: 3600,
          reviewerWorkSeconds: 1800
        }),
      }));
    });

    it('14. endReviewCycle updates decision and metrics on REWORK', async () => {
      mockPrisma.reviewCycleLog.findFirst.mockResolvedValue({ id: 'cycle1', cycleNo: 1, reviewStartedAt: new Date('2023-01-01') });
      
      mockPrisma.ticketTimeLog.aggregate.mockResolvedValueOnce({ _sum: { durationSeconds: 4000 } }); // ASSIGNEE
      mockPrisma.ticketTimeLog.aggregate.mockResolvedValueOnce({ _sum: { durationSeconds: 1200 } }); // REVIEWER
      
      mockPrisma.reviewCycleLog.update.mockResolvedValue({ decision: 'REWORK' });

      await service.endReviewCycle({ ticketId: 't1', decision: 'REWORK', feedback: 'Needs fixes', reworkStartedAt: new Date('2023-01-02') });

      expect(mockPrisma.reviewCycleLog.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ 
          decision: 'REWORK', 
          feedback: 'Needs fixes',
          assigneeWorkSeconds: 4000,
          reviewerWorkSeconds: 1200
        }),
      }));
    });

    it('15. multiple cycles preserve previous metrics by fetching previous cycle bounds', async () => {
      // Mock active cycle = 2
      mockPrisma.reviewCycleLog.findFirst.mockResolvedValue({ id: 'cycle2', cycleNo: 2, ticketId: 't1', reviewStartedAt: new Date('2023-01-03') });
      
      // Mock previous cycle (cycleNo - 1)
      mockPrisma.reviewCycleLog.findUnique.mockResolvedValue({ id: 'cycle1', reworkStartedAt: new Date('2023-01-02') });

      mockPrisma.ticketTimeLog.aggregate.mockResolvedValueOnce({ _sum: { durationSeconds: 5000 } }); // ASSIGNEE
      mockPrisma.ticketTimeLog.aggregate.mockResolvedValueOnce({ _sum: { durationSeconds: 2000 } }); // REVIEWER
      
      mockPrisma.reviewCycleLog.update.mockResolvedValue({ decision: 'APPROVED' });

      await service.endReviewCycle({ ticketId: 't1', decision: 'APPROVED' });

      // Verifies it fetches previous cycle
      expect(mockPrisma.reviewCycleLog.findUnique).toHaveBeenCalledWith({
        where: { ticketId_cycleNo: { ticketId: 't1', cycleNo: 1 } },
      });

      // Verifies assignee logs fetched using reworkStartedAt as gte
      expect(mockPrisma.ticketTimeLog.aggregate).toHaveBeenNthCalledWith(1, expect.objectContaining({
        where: expect.objectContaining({ ownerType: 'ASSIGNEE', startedAt: expect.objectContaining({ gte: new Date('2023-01-02') }) })
      }));
    });

    it('16. cycle metrics remain immutable if already populated', async () => {
      mockPrisma.reviewCycleLog.findFirst.mockResolvedValue({ id: 'cycle1', cycleNo: 1, reviewStartedAt: new Date('2023-01-01') });
      
      mockPrisma.ticketTimeLog.aggregate.mockResolvedValue({ _sum: { durationSeconds: 100 } });
      
      mockPrisma.reviewCycleLog.update.mockResolvedValue({ decision: 'APPROVED' });

      // Explicitly passing existing metrics to simulate immutable write/overwrite block if passed
      await service.endReviewCycle({ ticketId: 't1', decision: 'APPROVED', assigneeWorkSeconds: 9999, reviewerWorkSeconds: 8888 });

      expect(mockPrisma.reviewCycleLog.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ 
          assigneeWorkSeconds: 9999,
          reviewerWorkSeconds: 8888
        }),
      }));
    });
  });

  describe('assertNoOpenLogsForClosedTicket', () => {
    it('14. assertNoOpenLogsForClosedTicket detects active logs', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', status: 'CLOSED' });
      mockPrisma.ticketTimeLog.findMany.mockResolvedValue([{ id: 'log1' }]);

      await expect(service.assertNoOpenLogsForClosedTicket('t1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('pauseActiveLogsForUser — scoped to one work session (N1)', () => {
    it('closing a session only closes that session\'s segments (plus session-less ones started before the close)', async () => {
      const endedAt = new Date('2026-09-28T15:30:00Z');
      mockPrisma.ticketTimeLog.findMany.mockResolvedValue([]);
      await service.pauseActiveLogsForUser({ userId: 'w1', pauseReason: 'SYSTEM', endedAt, workSessionId: 'yesterday' });
      expect(mockPrisma.ticketTimeLog.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'w1',
          endedAt: null,
          OR: [{ workSessionId: 'yesterday' }, { workSessionId: null, startedAt: { lte: endedAt } }],
        },
      });
    });

    it('without a session (break, idle) it still closes every live segment of the user', async () => {
      mockPrisma.ticketTimeLog.findMany.mockResolvedValue([]);
      await service.pauseActiveLogsForUser({ userId: 'w1', pauseReason: 'BREAK' });
      expect(mockPrisma.ticketTimeLog.findMany).toHaveBeenCalledWith({ where: { userId: 'w1', endedAt: null } });
    });
  });

  describe('resumeNextWaitingTicket (no manual pause/resume: the queue)', () => {
    beforeEach(() => {
      mockPrisma.ticketTimeLog.groupBy = jest.fn();
      mockPrisma.ticket.findMany = jest.fn();
    });

    it('does nothing while the worker already has a running ticket', async () => {
      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue({ id: 'running' });
      const spy = jest.spyOn(service, 'startAssigneeTimer');
      expect(await service.resumeNextWaitingTicket('w1')).toEqual({ outcome: 'NOTHING_TO_DO' });
      expect(spy).not.toHaveBeenCalled();
    });

    it('does nothing unless the worker is WORKING (break, idle, punched out)', async () => {
      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue(null);
      mockPrisma.workSession.findFirst.mockResolvedValue({ status: 'ON_BREAK', logoutAt: null });
      const spy = jest.spyOn(service, 'startAssigneeTimer');
      expect(await service.resumeNextWaitingTicket('w1')).toEqual({ outcome: 'NOTHING_TO_DO' });
      expect(spy).not.toHaveBeenCalled();
    });

    it('starts the waiting ticket last worked on, then never-timed tickets newest first', async () => {
      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue(null);
      mockPrisma.workSession.findFirst.mockResolvedValue({ status: 'WORKING', logoutAt: null });
      mockPrisma.ticket.findMany.mockResolvedValue([
        { id: 'fresh', updatedAt: new Date('2026-09-29T05:00:00Z') },
        { id: 'older', updatedAt: new Date('2026-09-28T05:00:00Z') },
        { id: 'recent', updatedAt: new Date('2026-09-27T05:00:00Z') },
      ]);
      mockPrisma.ticketTimeLog.groupBy.mockResolvedValue([
        { ticketId: 'older', _max: { endedAt: new Date('2026-09-28T06:00:00Z') } },
        { ticketId: 'recent', _max: { endedAt: new Date('2026-09-28T15:30:00Z') } },
      ]);
      const spy = jest.spyOn(service, 'startAssigneeTimer')
        .mockResolvedValueOnce({ outcome: 'INELIGIBLE' } as any)
        .mockResolvedValueOnce({ outcome: 'STARTED', log: { id: 'l' } } as any);

      const res = await service.resumeNextWaitingTicket('w1', 'left');

      expect(mockPrisma.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { assignedToId: 'w1', status: 'IN_PROGRESS', isBlocked: false, id: { not: 'left' } },
      }));
      expect(spy.mock.calls.map((c) => c[0].ticketId)).toEqual(['recent', 'older']);
      expect(spy.mock.calls[0][0]).toMatchObject({ workerId: 'w1', mode: 'RESUME' });
      expect(res).toMatchObject({ outcome: 'STARTED' });
    });
  });

  describe('getPauseStates', () => {
    beforeEach(() => {
      mockPrisma.workSession.findMany = jest.fn();
      mockPrisma.ticketTimeLog.groupBy = jest.fn().mockResolvedValue([]);
    });

    const t = (id: string, extra: any = {}) => ({ id, status: 'IN_PROGRESS', assignedToId: 'w1', isBlocked: false, ...extra });

    it('names the other ticket when the assignee is timing it; running tickets get no entry', async () => {
      mockPrisma.ticketTimeLog.findMany.mockResolvedValue([{ userId: 'w1', ticketId: 'b', ticket: { ticketId: 'TKT-917' } }]);
      mockPrisma.workSession.findMany.mockResolvedValue([{ userId: 'w1', status: 'WORKING', logoutAt: null }]);
      const m = await service.getPauseStates([t('a'), t('b')]);
      expect(m.get('a')).toMatchObject({ reason: 'WORKING_ON_OTHER', otherTicketId: 'b', otherTicketKey: 'TKT-917' });
      expect(m.has('b')).toBe(false);
    });

    it.each([
      [{ status: 'ON_BREAK', logoutAt: null }, 'ON_BREAK'],
      [{ status: 'IDLE', logoutAt: null }, 'IDLE'],
      [{ status: 'LOGGED_OUT', logoutAt: new Date() }, 'PUNCHED_OUT'],
      [{ status: 'AUTO_CLOSED', logoutAt: new Date() }, 'PUNCHED_OUT'],
      [{ status: 'WORKING', logoutAt: null }, 'WAITING'],
    ])('session %o → %s', async (session, reason) => {
      mockPrisma.ticketTimeLog.findMany.mockResolvedValue([]);
      mockPrisma.workSession.findMany.mockResolvedValue([{ userId: 'w1', ...session }]);
      expect((await service.getPauseStates([t('a')])).get('a')).toMatchObject({ reason });
    });

    it('blocked wins; no session at all is punched out; non-IN_PROGRESS tickets are ignored', async () => {
      mockPrisma.ticketTimeLog.findMany.mockResolvedValue([]);
      mockPrisma.workSession.findMany.mockResolvedValue([]);
      const m = await service.getPauseStates([t('a', { isBlocked: true }), t('b'), t('c', { status: 'REVIEW' })]);
      expect(m.get('a')).toMatchObject({ reason: 'BLOCKED' });
      expect(m.get('b')).toMatchObject({ reason: 'PUNCHED_OUT' });
      expect(m.has('c')).toBe(false);
    });
  });
});
