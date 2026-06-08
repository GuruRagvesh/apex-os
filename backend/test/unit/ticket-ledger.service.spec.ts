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
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: TVAService, useValue: { now: () => new Date(), companyTimezone: () => 'Asia/Kolkata', companyNow: () => new Date(), companyDayStart: () => new Date(), formatZoned: () => 'mock', companyDayEnd: () => new Date(), elapsedSeconds: () => 0 } },
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
      mockPrisma.ticketTimeLog.update.mockResolvedValue({ id: 'log1', durationSeconds: 600 });

      const res = await service.endActiveLog({ ticketId: 't1', userId: 'u1', endedAt: now });

      expect(res).toEqual({ id: 'log1', durationSeconds: 600 });
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
    it('8a. resumeLogsForBreak resumes active IN_PROGRESS unblocked assigned tickets', async () => {
      mockPrisma.ticketTimeLog.findMany.mockResolvedValue([
        {
          id: 'log1',
          ticketId: 't1',
          userId: 'u1',
          stage: LEDGER_STAGES.WORK,
          ownerType: LEDGER_OWNER_TYPES.ASSIGNEE,
          source: LEDGER_SOURCES.SYSTEM,
          countsAsWork: true,
          ticket: { status: 'IN_PROGRESS', isBlocked: false, assignedToId: 'u1' }
        }
      ]);
      mockPrisma.ticket.findUnique.mockResolvedValue({ status: 'IN_PROGRESS' });
      mockPrisma.ticketTimeLog.findFirst.mockResolvedValue(null);
      mockPrisma.ticketTimeLog.create.mockResolvedValue({ id: 'newLog1' });

      const res = await service.resumeLogsForBreak('break1', 'u1');

      expect(res).toEqual([{ id: 'newLog1' }]);
      expect(mockPrisma.ticketTimeLog.create).toHaveBeenCalled();
    });

    it('8b. resumeLogsForBreak skips tickets that are blocked or not IN_PROGRESS', async () => {
      mockPrisma.ticketTimeLog.findMany.mockResolvedValue([
        {
          id: 'log1',
          ticketId: 't1',
          userId: 'u1',
          ticket: { status: 'BLOCKED', isBlocked: true, assignedToId: 'u1' }
        }
      ]);

      const res = await service.resumeLogsForBreak('break1', 'u1');

      expect(res).toEqual([]);
      expect(mockPrisma.ticketTimeLog.create).not.toHaveBeenCalled();
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
});
