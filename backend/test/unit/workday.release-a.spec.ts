import { WorkdayService } from '../../src/modules/platform/workday/workday.service';

describe('WorkdayService Release A corruption guards', () => {
  const today = new Date('2026-06-10T00:00:00.000Z');
  const now = new Date('2026-06-10T10:00:00.000Z');

  let service: WorkdayService;
  let prisma: any;
  let attendanceAuthority: any;
  let ticketLedger: any;

  beforeEach(() => {
    prisma = {
      workSession: {
        findFirst: jest.fn(),
      },
      breakLog: {
        create: jest.fn(),
        update: jest.fn(),
      },
      attendanceEvent: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    attendanceAuthority = {
      setUserStatus: jest.fn().mockResolvedValue({}),
      createWorkSession: jest.fn().mockImplementation(async (data) => ({ id: 'new-session', ...data })),
      updateWorkSession: jest.fn().mockImplementation(async (id, data) => ({ id, ...data })),
      updateManyWorkSessions: jest.fn(),
    };

    ticketLedger = {
      pauseActiveLogsForUser: jest.fn().mockResolvedValue({}),
      resumeLogsForBreak: jest.fn().mockResolvedValue({}),
    };

    service = new WorkdayService(
      prisma,
      {} as any,
      { log: jest.fn().mockResolvedValue({}) } as any,
      ticketLedger,
      { sendNotification: jest.fn().mockResolvedValue({}) } as any,
      attendanceAuthority,
      {
        now: jest.fn(() => now),
        companyDayStart: jest.fn(() => today),
        companyDateOnly: jest.fn(() => today),
      } as any,
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

    await expect(service.startBreak('user-1', { breakType: 'LUNCH' })).rejects.toThrow('No active working session');
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

    await expect(service.startBreak('user-1', { breakType: 'LUNCH' })).rejects.toThrow('Break already in progress');
    expect(prisma.breakLog.create).not.toHaveBeenCalled();
    expect(attendanceAuthority.updateWorkSession).not.toHaveBeenCalled();
  });

  it('endBreak rejects when there is no open break', async () => {
    prisma.workSession.findFirst.mockResolvedValue({
      id: 'open-session',
      status: 'ON_BREAK',
      logoutAt: null,
      breakLogs: [],
    });

    await expect(service.endBreak('user-1')).rejects.toThrow('No open break found');
    expect(prisma.breakLog.update).not.toHaveBeenCalled();
    expect(attendanceAuthority.updateWorkSession).not.toHaveBeenCalled();
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
