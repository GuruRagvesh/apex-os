import { WorkdayService } from '../../src/modules/platform/workday/workday.service';
import { createTvaDouble } from '../helpers/tva-double';

// The ticket clock belongs to the assignee and follows only their own day:
// idle is not work, and "resume" from a break is a break end.
const NOW = new Date('2026-06-10T10:00:00.000Z');

describe('WorkdayService — idle / resume keep the assignee ticket clock honest', () => {
  let service: WorkdayService;
  let prisma: any;
  let attendanceAuthority: any;
  let ticketLedger: any;

  beforeEach(() => {
    prisma = {
      workSession: { findFirst: jest.fn() },
      breakLog: { update: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'bl1', ...data })) },
      attendanceEvent: { create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));

    attendanceAuthority = {
      setUserStatus: jest.fn().mockResolvedValue({}),
      updateWorkSession: jest.fn().mockImplementation(async (id: string, data: any) => ({ id, ...data })),
      updateManyWorkSessions: jest.fn().mockResolvedValue({ count: 1 }),
    };

    ticketLedger = {
      pauseActiveLogsForUser: jest.fn().mockResolvedValue({ count: 1, logIds: ['l1'] }),
      resumeLogsForBreak: jest.fn().mockResolvedValue([]),
      resumeAfterWorkdayStart: jest.fn().mockResolvedValue({ outcome: 'STARTED' }),
    };

    service = new WorkdayService(
      prisma,
      {} as any,
      { log: jest.fn().mockResolvedValue({}) } as any,
      ticketLedger,
      { sendNotification: jest.fn().mockResolvedValue({}) } as any,
      attendanceAuthority,
      createTvaDouble(NOW) as any,
    );
  });

  describe('reportIdle', () => {
    it('pauses only this user\'s ticket clock, back-dated to when idle began', async () => {
      await service.reportIdle('u1', 30);

      expect(ticketLedger.pauseActiveLogsForUser).toHaveBeenCalledWith({
        userId: 'u1',
        pauseReason: 'IDLE',
        endedAt: new Date(NOW.getTime() - 30 * 60_000),
      });
    });

    it('does not pause anything under the idle threshold', async () => {
      await service.reportIdle('u1', 10);
      expect(ticketLedger.pauseActiveLogsForUser).not.toHaveBeenCalled();
    });

    it('does not pause when the session was not WORKING (already idle, on break, closed)', async () => {
      attendanceAuthority.updateManyWorkSessions.mockResolvedValue({ count: 0 });
      await service.reportIdle('u1', 30);
      expect(ticketLedger.pauseActiveLogsForUser).not.toHaveBeenCalled();
    });
  });

  describe('startWork closes a previous day left open (N1)', () => {
    beforeEach(() => {
      prisma.workSession.findMany = jest.fn();
      prisma.appSetting = { findUnique: jest.fn().mockResolvedValue({ value: { timezone: 'Asia/Kolkata', autoCloseTime: '21:00' } }) };
      prisma.attendanceEvent.create = jest.fn().mockResolvedValue({});
      attendanceAuthority.createWorkSession = jest.fn().mockImplementation(async (data: any) => ({ id: 'today', ...data }));
      ticketLedger.resumeAfterWorkdayStart = jest.fn().mockResolvedValue({ outcome: 'STARTED' });
    });

    it('finalizes yesterday\'s open session at its policy cutoff before today\'s session starts', async () => {
      prisma.workSession.findMany.mockResolvedValue([
        { id: 'yesterday', userId: 'u1', loginAt: new Date('2026-06-09T04:00:00Z'), createdAt: new Date('2026-06-09T04:00:00Z'), logoutAt: null },
      ]);
      prisma.workSession.findFirst.mockResolvedValue(null); // nothing for today yet
      const finalize = jest.spyOn(service, 'finalizeWorkSessionInTransaction').mockResolvedValue({} as any);

      await service.startWork('u1');

      expect(finalize).toHaveBeenCalledWith(prisma, 'yesterday', expect.objectContaining({
        effectiveEndAt: new Date('2026-06-09T15:30:00.000Z'), // 21:00 IST on that day
        terminalStatus: 'AUTO_CLOSED',
        ticketPauseReason: 'SYSTEM',
      }));
      // Closed before today's session is created, and the ticket then resumes.
      expect(finalize.mock.invocationCallOrder[0]).toBeLessThan(attendanceAuthority.createWorkSession.mock.invocationCallOrder[0]);
      expect(ticketLedger.resumeAfterWorkdayStart).toHaveBeenCalledWith('u1');
    });

    it('does nothing extra when no previous day is open', async () => {
      prisma.workSession.findMany.mockResolvedValue([]);
      prisma.workSession.findFirst.mockResolvedValue(null);
      const finalize = jest.spyOn(service, 'finalizeWorkSessionInTransaction');

      await service.startWork('u1');

      expect(finalize).not.toHaveBeenCalled();
    });
  });

  describe('resumeWork', () => {
    it('from a break: ends the break and resumes the ticket it paused (same path as the break banner)', async () => {
      prisma.workSession.findFirst.mockResolvedValue({
        id: 'ws1',
        status: 'ON_BREAK',
        logoutAt: null,
        totalBreakMinutes: 0,
        breakLogs: [{ id: 'bl1', breakType: 'TEA', startAt: new Date(NOW.getTime() - 15 * 60_000), endAt: null }],
      });

      await service.resumeWork('u1');

      expect(prisma.breakLog.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bl1' } }));
      expect(ticketLedger.resumeLogsForBreak).toHaveBeenCalledWith('bl1', 'u1');
      expect(attendanceAuthority.updateManyWorkSessions).not.toHaveBeenCalled();
    });

    it('from idle: sets WORKING and resumes this user\'s paused ticket', async () => {
      prisma.workSession.findFirst.mockResolvedValue({ id: 'ws1', status: 'IDLE', logoutAt: null });

      await service.resumeWork('u1');

      expect(attendanceAuthority.updateManyWorkSessions).toHaveBeenCalled();
      expect(ticketLedger.resumeAfterWorkdayStart).toHaveBeenCalledWith('u1');
    });

    it('does not resume a ticket when there was nothing to resume', async () => {
      prisma.workSession.findFirst.mockResolvedValue({ id: 'ws1', status: 'WORKING', logoutAt: null });
      attendanceAuthority.updateManyWorkSessions.mockResolvedValue({ count: 0 });

      await service.resumeWork('u1');

      expect(ticketLedger.resumeAfterWorkdayStart).not.toHaveBeenCalled();
    });
  });
});
