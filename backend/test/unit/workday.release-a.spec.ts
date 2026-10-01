import { BadRequestException, ConflictException } from '@nestjs/common';
import { WorkdayService } from '../../src/modules/platform/workday/workday.service';
import { createTvaDouble } from '../helpers/tva-double';

describe('WorkdayService Release A corruption guards', () => {
  const today = new Date('2026-06-10T00:00:00.000Z');
  const now = new Date('2026-06-10T10:00:00.000Z');

  let service: WorkdayService;
  let prisma: any;
  let attendanceAuthority: any;
  let ticketLedger: any;
  let eventLogger: { log: jest.Mock };

  beforeEach(() => {
    prisma = {
      workSession: {
        findFirst: jest.fn(),
        // No previous-day workday left open in these cases.
        findMany: jest.fn().mockResolvedValue([]),
      },
      breakLog: {
        create: jest.fn(),
        update: jest.fn(),
      },
      attendanceEvent: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    // The service runs startWork/finalize inside a transaction. Hand the
    // callback this same mock so the existing assertions still observe the
    // calls made inside it.
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));
    // finalize takes a `SELECT ... FOR UPDATE` row lock before writing
    // terminal fields; the double just has to answer it.
    prisma.$queryRaw = jest.fn().mockResolvedValue([]);
    // Break start/end (Phase 2D2) re-read the row-locked session inside their
    // transaction; by default that is the same session findFirst returns.
    prisma.workSession.findUnique = jest.fn((args: any) => prisma.workSession.findFirst(args));

    attendanceAuthority = {
      setUserStatus: jest.fn().mockResolvedValue({}),
      createWorkSession: jest.fn().mockImplementation(async (data) => ({ id: 'new-session', ...data })),
      updateWorkSession: jest.fn().mockImplementation(async (id, data) => ({ id, ...data })),
      updateManyWorkSessions: jest.fn(),
    };

    ticketLedger = {
      pauseActiveLogsForUser: jest.fn().mockResolvedValue({}),
      resumeLogsForBreak: jest.fn().mockResolvedValue({}),
      resumeAfterWorkdayStart: jest.fn().mockResolvedValue(undefined),
    };

    eventLogger = { log: jest.fn().mockResolvedValue({}) };
    service = new WorkdayService(
      prisma,
      {} as any,
      eventLogger as any,
      ticketLedger,
      { sendNotification: jest.fn().mockResolvedValue({}) } as any,
      attendanceAuthority,
      createTvaDouble(now) as any,
    );
  });

  it('endWork returns a closed session without mutating it', async () => {
    const closedSession = {
      id: 'closed-session',
      status: 'LOGGED_OUT',
      logoutAt: new Date('2026-06-10T09:00:00.000Z'),
      totalWorkMinutes: 420,
      totalBreakMinutes: 30,
      breakLogs: [],
    };
    prisma.workSession.findFirst.mockResolvedValue(closedSession);

    const result = await service.endWork('user-1');

    expect(result).toEqual({
      session: closedSession,
      summary: { totalWorkMinutes: 420, totalBreakMinutes: 30 },
    });
    expect(attendanceAuthority.updateWorkSession).not.toHaveBeenCalled();
    expect(attendanceAuthority.setUserStatus).not.toHaveBeenCalled();
    expect(prisma.breakLog.update).not.toHaveBeenCalled();
    expect(ticketLedger.pauseActiveLogsForUser).not.toHaveBeenCalled();
  });

  it('startWork creates a new session when the latest same-day session is closed', async () => {
    prisma.workSession.findFirst.mockResolvedValue({
      id: 'closed-session',
      status: 'LOGGED_OUT',
      logoutAt: new Date('2026-06-10T09:00:00.000Z'),
      autoClosed: false,
    });

    const result = await service.startWork('user-1');

    expect(result.session.id).toBe('new-session');
    expect(attendanceAuthority.updateWorkSession).not.toHaveBeenCalled();
    expect(attendanceAuthority.createWorkSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        date: today,
        loginAt: now,
        startWorkAt: now,
        status: 'WORKING',
        continuationOfSessionId: 'closed-session',
      }),
      // The service now runs this inside its transaction and forwards the
      // client as a second argument. Field expectations above are unchanged.
      expect.anything(),
    );
  });

  it('startWork reuses an open working session without resetting startWorkAt', async () => {
    const openSession = {
      id: 'open-session',
      status: 'WORKING',
      logoutAt: null,
      startWorkAt: new Date('2026-06-10T08:00:00.000Z'),
      loginAt: new Date('2026-06-10T07:55:00.000Z'),
    };
    prisma.workSession.findFirst.mockResolvedValue(openSession);

    const result = await service.startWork('user-1');

    expect(result.session).toBe(openSession);
    expect(attendanceAuthority.createWorkSession).not.toHaveBeenCalled();
    expect(attendanceAuthority.updateWorkSession).not.toHaveBeenCalled();
  });

  it('startBreak rejects closed sessions', async () => {
    prisma.workSession.findFirst.mockResolvedValue({
      id: 'closed-session',
      status: 'LOGGED_OUT',
      logoutAt: new Date('2026-06-10T09:00:00.000Z'),
      breakLogs: [],
    });

    const err = await service.startBreak('user-1', { breakType: 'LUNCH' }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException); // 400, not 500
    expect(err.message).toBe('No active working session');
    expect(prisma.breakLog.create).not.toHaveBeenCalled();
    expect(attendanceAuthority.updateWorkSession).not.toHaveBeenCalled();
  });

  it('startBreak rejects when an open break already exists', async () => {
    prisma.workSession.findFirst.mockResolvedValue({
      id: 'open-session',
      status: 'WORKING',
      logoutAt: null,
      breakLogs: [{ id: 'break-1', startAt: new Date('2026-06-10T09:30:00.000Z'), endAt: null }],
    });

    const err = await service.startBreak('user-1', { breakType: 'LUNCH' }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException); // 409, not 500
    expect(err.message).toBe('User is already on a break.');
    expect(prisma.breakLog.create).not.toHaveBeenCalled();
    expect(attendanceAuthority.updateWorkSession).not.toHaveBeenCalled();
  });

  it('D-1: startBreak while ON_BREAK is a 409 with a clear message and changes nothing', async () => {
    prisma.workSession.findFirst.mockResolvedValue({
      id: 'open-session',
      status: 'ON_BREAK',
      logoutAt: null,
      breakLogs: [{ id: 'break-1', startAt: new Date('2026-06-10T09:30:00.000Z'), endAt: null }],
    });

    const err = await service.startBreak('user-1', { breakType: 'TEA' }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getStatus()).toBe(409);
    expect(err.message).toBe('User is already on a break.');
    expect(prisma.breakLog.create).not.toHaveBeenCalled();
    expect(attendanceAuthority.updateWorkSession).not.toHaveBeenCalled();
    expect(ticketLedger.pauseActiveLogsForUser).not.toHaveBeenCalled();
  });

  it('endBreak rejects when there is no open break', async () => {
    prisma.workSession.findFirst.mockResolvedValue({
      id: 'open-session',
      status: 'ON_BREAK',
      logoutAt: null,
      breakLogs: [],
    });

    const err = await service.endBreak('user-1').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('No active break found.');
    expect(prisma.breakLog.update).not.toHaveBeenCalled();
    expect(attendanceAuthority.updateWorkSession).not.toHaveBeenCalled();
  });

  it('D-1: endBreak while WORKING (no break open) is a 409 with a clear message and changes nothing', async () => {
    prisma.workSession.findFirst.mockResolvedValue({
      id: 'open-session',
      status: 'WORKING',
      logoutAt: null,
      breakLogs: [],
    });

    const err = await service.endBreak('user-1').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getStatus()).toBe(409);
    expect(err.message).toBe('No active break found.');
    expect(prisma.breakLog.update).not.toHaveBeenCalled();
    expect(attendanceAuthority.updateWorkSession).not.toHaveBeenCalled();
    expect(ticketLedger.resumeLogsForBreak).not.toHaveBeenCalled();
  });

  // Phase 2D2 reverses the old fail-open rule: the break close, WORKING status
  // and ticket resume commit together, so a resume failure fails the break end
  // (the PostgreSQL rollback itself is proven in integration-pg/t5) and nothing
  // announces a break end that did not commit. The person stays ON_BREAK and
  // can retry.
  it('endBreak fails, and announces nothing, when the ticket auto-resume fails', async () => {
    prisma.workSession.findFirst.mockResolvedValue({
      id: 'open-session',
      status: 'ON_BREAK',
      logoutAt: null,
      totalBreakMinutes: 0,
      breakLogs: [{ id: 'break-1', breakType: 'TEA', startAt: new Date('2026-06-10T09:45:00.000Z'), endAt: null }],
    });
    prisma.breakLog.update.mockResolvedValue({ id: 'break-1' });
    ticketLedger.resumeLogsForBreak.mockRejectedValueOnce(new Error('ledger unavailable'));

    await expect(service.endBreak('user-1')).rejects.toThrow('ledger unavailable');
    expect(ticketLedger.resumeLogsForBreak).toHaveBeenCalledWith('break-1', 'user-1', expect.anything());
    expect(eventLogger.log).not.toHaveBeenCalled();
  });

  it('endBreak rejects multiple open breaks without mutating either break', async () => {
    prisma.workSession.findFirst.mockResolvedValue({
      id: 'open-session',
      status: 'ON_BREAK',
      logoutAt: null,
      breakLogs: [
        { id: 'break-1', startAt: new Date('2026-06-10T09:00:00.000Z'), endAt: null },
        { id: 'break-2', startAt: new Date('2026-06-10T09:30:00.000Z'), endAt: null },
      ],
    });

    await expect(service.endBreak('user-1')).rejects.toThrow('Multiple open breaks found');
    expect(prisma.breakLog.update).not.toHaveBeenCalled();
    expect(attendanceAuthority.updateWorkSession).not.toHaveBeenCalled();
  });
});
