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

    it('13. endReviewCycle updates decision, feedback, and reviewEndedAt', async () => {
      mockPrisma.reviewCycleLog.findFirst.mockResolvedValue({ id: 'cycle1' });
      mockPrisma.reviewCycleLog.update.mockResolvedValue({ decision: 'APPROVED' });

      const res = await service.endReviewCycle({ ticketId: 't1', decision: 'APPROVED', feedback: 'LGTM' });

      expect(res?.decision).toBe('APPROVED');
      expect(mockPrisma.reviewCycleLog.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ decision: 'APPROVED', feedback: 'LGTM' }),
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
