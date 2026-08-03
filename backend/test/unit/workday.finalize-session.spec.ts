import { WorkdayService } from '../../src/modules/platform/workday/workday.service';

// Covers WorkdayService.finalizeWorkSession — the single shared closer that
// manual endWork, policy auto-stop, stale/midnight auto-close, and idle
// auto-logout all route through. Unlike workday.release-a.spec.ts /
// workday.meeting-break.spec.ts (which predate a TVAService refactor and
// fail on clean main with "this.tva.companyDateOnly is not a function" —
// verified via git-stash comparison, unrelated to this change), this file's
// tva mock includes companyDateOnly so these tests actually execute.
describe('WorkdayService.finalizeWorkSession — unified session-closing finalizer', () => {
  const NOW = new Date('2026-06-10T10:00:00.000Z');
  const TODAY = new Date('2026-06-10T00:00:00.000Z');
  const START_WORK = new Date('2026-06-10T08:00:00.000Z'); // 2h before NOW

  let service: WorkdayService;
  let prisma: any;
  let attendanceAuthority: any;
  let ticketLedger: any;
  let eventLogger: any;

  function makeBreak(overrides: any) {
    return {
      id: 'break-default',
      breakType: 'TEA',
      startAt: new Date('2026-06-10T09:00:00.000Z'),
      endAt: null,
      durationMinutes: null,
      ...overrides,
    };
  }

  function baseSession(overrides: any = {}) {
    return {
      id: 'ws1',
      userId: 'user-1',
      status: 'WORKING',
      logoutAt: null,
      startWorkAt: START_WORK,
      closureReason: null,
      autoClosed: false,
      autoClosedAt: null,
      totalWorkMinutes: 0,
      totalBreakMinutes: 0,
      breakLogs: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([]),
      workSession: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      breakLog: {
        update: jest.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
      },
      ticketTimeLog: {
        count: jest.fn().mockResolvedValue(0),
      },
      attendanceEvent: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    attendanceAuthority = {
      updateWorkSession: jest.fn().mockImplementation(async (id: string, data: any) => ({ id, userId: 'user-1', ...data })),
      setUserStatus: jest.fn().mockResolvedValue({}),
    };

    ticketLedger = {
      pauseActiveLogsForUser: jest.fn().mockResolvedValue({ count: 0, logIds: [] }),
    };

    eventLogger = { log: jest.fn().mockResolvedValue({}) };

    service = new WorkdayService(
      prisma,
      {} as any,
      eventLogger,
      ticketLedger,
      { sendNotification: jest.fn().mockResolvedValue({}) } as any,
      attendanceAuthority,
      {
        now: jest.fn(() => NOW),
        companyDayStart: jest.fn(() => TODAY),
        companyDateOnly: jest.fn(() => TODAY),
      } as any,
    );
  });

  const baseOptions = (overrides: any = {}) => ({
    effectiveEndAt: NOW,
    terminalStatus: 'LOGGED_OUT' as const,
    closureReason: 'ENDED_BY_USER',
    actorUserId: 'user-1',
    eventSource: 'manual' as const,
    attendanceEventType: 'LOGOUT',
    ticketPauseReason: 'LOGOUT',
    ...overrides,
  });

  // Required scenario 1: manual end with one open break
  it('closes a single open break, clamped to effectiveEndAt, and counts it toward totalBreakMinutes', async () => {
    prisma.workSession.findUnique.mockResolvedValue(baseSession({
      breakLogs: [makeBreak({ id: 'b1', startAt: new Date('2026-06-10T09:30:00.000Z'), endAt: null })],
    }));

    const result = await service.finalizeWorkSession('ws1', baseOptions());

    expect(prisma.breakLog.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'b1' },
      data: expect.objectContaining({ endAt: NOW, durationMinutes: 30 }),
    }));
    expect(result.totalBreakMinutes).toBe(30);
    expect(result.totalWorkMinutes).toBe(90); // 120 elapsed - 30 break
  });

  // Required scenario 2: manual end with multiple open breaks — every one closes
  it('closes every open break, not just the first, and leaves already-closed breaks untouched', async () => {
    prisma.workSession.findUnique.mockResolvedValue(baseSession({
      breakLogs: [
        makeBreak({ id: 'b1', breakType: 'TEA', startAt: new Date('2026-06-10T08:10:00.000Z'), endAt: new Date('2026-06-10T08:20:00.000Z'), durationMinutes: 10 }),
        makeBreak({ id: 'b2', breakType: 'TEA', startAt: new Date('2026-06-10T09:00:00.000Z'), endAt: null }),
        makeBreak({ id: 'b3', breakType: 'LUNCH', startAt: new Date('2026-06-10T09:45:00.000Z'), endAt: null }),
      ],
    }));

    const result = await service.finalizeWorkSession('ws1', baseOptions());

    expect(prisma.breakLog.update).toHaveBeenCalledTimes(2); // only the 2 open breaks — b1 untouched
    expect(prisma.breakLog.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b2' }, data: expect.objectContaining({ durationMinutes: 60 }) }));
    expect(prisma.breakLog.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b3' }, data: expect.objectContaining({ durationMinutes: 15 }) }));
    // 10 (closed TEA) + 60 (open TEA) + 15 (open LUNCH) = 85
    expect(result.totalBreakMinutes).toBe(85);
  });

  // Required scenario 6: MEETING counted as work, across the option shapes each of the 4 paths uses
  it.each([
    ['manual endWork', baseOptions()],
    ['policy auto-stop', baseOptions({ terminalStatus: 'AUTO_CLOSED', closureReason: 'POLICY_AUTO_STOP' })],
    ['stale/midnight auto-close', baseOptions({ terminalStatus: 'AUTO_CLOSED', closureReason: 'AUTO_CLOSE' })],
    ['idle auto-logout', baseOptions({ closureReason: 'AUTO_LOGOUT_INACTIVE' })],
  ])('%s: open MEETING break is closed but excluded from totalBreakMinutes (counts as work)', async (_label, options) => {
    prisma.workSession.findUnique.mockResolvedValue(baseSession({
      breakLogs: [makeBreak({ id: 'b1', breakType: 'MEETING', startAt: new Date('2026-06-10T09:30:00.000Z'), endAt: null })],
    }));

    const result = await service.finalizeWorkSession('ws1', options as any);

    expect(prisma.breakLog.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b1' } }));
    expect(result.totalBreakMinutes).toBe(0);
    expect(result.totalWorkMinutes).toBe(120); // full elapsed, meeting not deducted
  });

  // Attendance Phase 1, item 1e: manual and automatic End Day must produce
  // structurally identical terminal records, differing only in the
  // closure-specific fields each path's own options supply — not in which
  // fields get set or how totals/breaks are computed. Exercises the actual
  // option shapes each of the 4 real call sites passes (workday.service.ts
  // endWork; scheduler.service.ts policy auto-stop, stale/midnight
  // auto-close, idle autoLogoutInactive).
  it.each([
    ['manual endWork', { effectiveEndAt: NOW, terminalStatus: 'LOGGED_OUT' as const, closureReason: 'ENDED_BY_USER', actorUserId: 'user-1', eventSource: 'manual' as const, attendanceEventType: 'LOGOUT', ticketPauseReason: 'LOGOUT' }],
    ['policy auto-stop', { effectiveEndAt: NOW, terminalStatus: 'AUTO_CLOSED' as const, closureReason: 'POLICY_AUTO_STOP', autoClosedAt: NOW, eventSource: 'system' as const, attendanceEventType: 'POLICY_AUTO_STOP', ticketPauseReason: 'POLICY_AUTO_STOP' }],
    ['stale/midnight auto-close', { effectiveEndAt: NOW, terminalStatus: 'AUTO_CLOSED' as const, closureReason: 'AUTO_CLOSE', autoClosedAt: NOW, eventSource: 'system' as const, attendanceEventType: 'AUTO_CLOSE', ticketPauseReason: 'SYSTEM' }],
    ['idle auto-logout', { effectiveEndAt: NOW, terminalStatus: 'LOGGED_OUT' as const, closureReason: 'AUTO_LOGOUT_INACTIVE', eventSource: 'system' as const, attendanceEventType: 'AUTO_LOGOUT', eventMetadata: { reason: '2 hours idle' }, ticketPauseReason: 'AUTO_LOGOUT' }],
  ])('%s: produces a structurally complete terminal record — same fields, same break-closing, same ticket-pause, same audit shape', async (_label, options) => {
    prisma.workSession.findUnique.mockResolvedValue(baseSession({
      breakLogs: [makeBreak({ id: 'b1', startAt: new Date('2026-06-10T09:00:00.000Z'), endAt: null })],
    }));

    await service.finalizeWorkSession('ws1', options as any);

    // Every path closes the open break the same way.
    expect(prisma.breakLog.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'b1' }, data: expect.objectContaining({ endAt: NOW, durationMinutes: expect.any(Number) }),
    }));
    // Every path writes the same base terminal fields; AUTO_CLOSED paths
    // additionally get autoClosed/autoClosedAt — an intended difference tied
    // to terminalStatus itself, not a parity violation.
    const updateCall = attendanceAuthority.updateWorkSession.mock.calls[0][1];
    const expectedKeys = ['closureReason', 'logoutAt', 'status', 'totalBreakMinutes', 'totalWorkMinutes'];
    if ((options as any).terminalStatus === 'AUTO_CLOSED') expectedKeys.push('autoClosed', 'autoClosedAt');
    expect(Object.keys(updateCall).sort()).toEqual(expectedKeys.sort());
    // Every path pauses ticket logs inside the same transaction.
    expect(ticketLedger.pauseActiveLogsForUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), prisma);
    // Every path emits exactly one AttendanceEvent and one OperationalEvent.
    expect(prisma.attendanceEvent.create).toHaveBeenCalledTimes(1);
    expect(eventLogger.log).toHaveBeenCalledTimes(1);
  });

  // Required scenario 7: active ticket time log paused for every close path
  it("pauses the user's active ticket logs inside the same transaction (via the tx client)", async () => {
    prisma.workSession.findUnique.mockResolvedValue(baseSession());

    await service.finalizeWorkSession('ws1', baseOptions({ ticketPauseReason: 'LOGOUT' }));

    expect(ticketLedger.pauseActiveLogsForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', pauseReason: 'LOGOUT' }),
      prisma, // the fake tx client (see $transaction mock above)
    );
  });

  // Required scenario 8: invalid effective end never precedes startWorkAt
  it('clamps effectiveEndAt to startWorkAt when the caller-provided cutoff is earlier', async () => {
    prisma.workSession.findUnique.mockResolvedValue(baseSession());

    const tooEarly = new Date(START_WORK.getTime() - 60 * 60 * 1000); // 1h before startWorkAt
    const result = await service.finalizeWorkSession('ws1', baseOptions({ effectiveEndAt: tooEarly }));

    const updateCall = attendanceAuthority.updateWorkSession.mock.calls[0][1];
    expect(updateCall.logoutAt.getTime()).toBe(START_WORK.getTime());
    expect(result.totalWorkMinutes).toBe(0);
  });

  // Required scenario 9: second finalizer call is a no-op
  it('a second call on an already fully-reconciled session is a true no-op (zero writes, zero events)', async () => {
    prisma.workSession.findUnique.mockResolvedValue(baseSession({
      status: 'LOGGED_OUT',
      logoutAt: new Date('2026-06-10T10:00:00.000Z'),
      closureReason: 'ENDED_BY_USER',
      totalWorkMinutes: 120,
      totalBreakMinutes: 0,
      breakLogs: [], // no open breaks
    }));
    prisma.ticketTimeLog.count.mockResolvedValue(0); // no active ticket logs

    const result = await service.finalizeWorkSession('ws1', baseOptions());

    expect(attendanceAuthority.updateWorkSession).not.toHaveBeenCalled();
    expect(prisma.breakLog.update).not.toHaveBeenCalled();
    expect(ticketLedger.pauseActiveLogsForUser).not.toHaveBeenCalled();
    expect(prisma.attendanceEvent.create).not.toHaveBeenCalled();
    expect(eventLogger.log).not.toHaveBeenCalled();
    expect(result.totalWorkMinutes).toBe(120);
    expect(result.totalBreakMinutes).toBe(0);
  });

  it('calling finalizeWorkSession twice in sequence does not duplicate breaks, pauses, or audit events', async () => {
    const openBreak = makeBreak({ id: 'b1', startAt: new Date('2026-06-10T09:30:00.000Z'), endAt: null });
    const session: any = baseSession({ breakLogs: [openBreak] });
    prisma.workSession.findUnique.mockImplementation(async () => session);

    await service.finalizeWorkSession('ws1', baseOptions());

    // Reflect the DB state the first call would have committed.
    session.status = 'LOGGED_OUT';
    session.logoutAt = NOW;
    session.closureReason = 'ENDED_BY_USER';
    session.breakLogs = [{ ...openBreak, endAt: NOW, durationMinutes: 30 }];
    prisma.ticketTimeLog.count.mockResolvedValue(0);

    await service.finalizeWorkSession('ws1', baseOptions());

    expect(prisma.breakLog.update).toHaveBeenCalledTimes(1); // only from the first call
    expect(ticketLedger.pauseActiveLogsForUser).toHaveBeenCalledTimes(1);
    expect(prisma.attendanceEvent.create).toHaveBeenCalledTimes(1);
    expect(eventLogger.log).toHaveBeenCalledTimes(1);
  });

  // Required scenario 10: terminal-but-incompletely-reconciled session is repaired safely
  it('a terminal session with a leftover open break and an active ticket log is reconciled without re-closing or re-auditing', async () => {
    prisma.workSession.findUnique.mockResolvedValue(baseSession({
      status: 'LOGGED_OUT',
      logoutAt: new Date('2026-06-10T09:00:00.000Z'), // already terminal, recorded end time
      closureReason: null, // path-D-style gap: terminal but reason never set
      totalWorkMinutes: 0,
      totalBreakMinutes: 0, // never frozen — the bug being repaired
      breakLogs: [makeBreak({ id: 'b1', startAt: new Date('2026-06-10T08:30:00.000Z'), endAt: null })],
    }));
    prisma.ticketTimeLog.count.mockResolvedValue(1); // one still-active ticket log left over

    const result = await service.finalizeWorkSession(
      'ws1',
      baseOptions({ terminalStatus: 'AUTO_CLOSED', closureReason: 'SOME_OTHER_CALLER_REASON' }),
    );

    // Break gets closed, clamped to the session's OWN recorded logoutAt (09:00) — not NOW (10:00).
    expect(prisma.breakLog.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'b1' },
      data: expect.objectContaining({ endAt: new Date('2026-06-10T09:00:00.000Z') }),
    }));
    expect(ticketLedger.pauseActiveLogsForUser).toHaveBeenCalled();

    const updateCall = attendanceAuthority.updateWorkSession.mock.calls[0][1];
    // Status/logoutAt preserved from the original closure — this call's options don't overwrite them.
    expect(updateCall.status).toBe('LOGGED_OUT');
    expect(updateCall.logoutAt.getTime()).toBe(new Date('2026-06-10T09:00:00.000Z').getTime());
    // closureReason gap gets filled since it was null (no prior value to preserve).
    expect(updateCall.closureReason).toBe('SOME_OTHER_CALLER_REASON');
    // Totals recomputed: 08:00->09:00 elapsed=60, minus 30min break = 30 work.
    expect(updateCall.totalBreakMinutes).toBe(30);
    expect(updateCall.totalWorkMinutes).toBe(30);

    // No duplicate "session closed" audit event — it was already closed before this call.
    expect(prisma.attendanceEvent.create).not.toHaveBeenCalled();
    expect(eventLogger.log).not.toHaveBeenCalled();
    expect(result.totalBreakMinutes).toBe(30);
    expect(result.totalWorkMinutes).toBe(30);
  });

  it('throws NotFoundException for a nonexistent session', async () => {
    prisma.workSession.findUnique.mockResolvedValue(null);
    await expect(service.finalizeWorkSession('missing', baseOptions())).rejects.toThrow('Work session not found');
  });

  it('acquires a row lock before reading the session', async () => {
    prisma.workSession.findUnique.mockResolvedValue(baseSession());
    await service.finalizeWorkSession('ws1', baseOptions());
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });
});

// Required scenarios 1/2 at the public endWork() boundary — proves path A
// actually routes through the finalizer end-to-end, not just that the
// finalizer works in isolation.
describe('WorkdayService.endWork — routes through finalizeWorkSession', () => {
  const NOW = new Date('2026-06-10T10:00:00.000Z');
  const TODAY = new Date('2026-06-10T00:00:00.000Z');
  const START_WORK = new Date('2026-06-10T08:00:00.000Z');

  let service: WorkdayService;
  let prisma: any;
  let attendanceAuthority: any;
  let ticketLedger: any;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([]),
      workSession: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      breakLog: {
        update: jest.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
      },
      ticketTimeLog: { count: jest.fn().mockResolvedValue(0) },
      attendanceEvent: { create: jest.fn().mockResolvedValue({}) },
    };

    attendanceAuthority = {
      updateWorkSession: jest.fn().mockImplementation(async (id: string, data: any) => ({ id, userId: 'user-1', ...data })),
      setUserStatus: jest.fn().mockResolvedValue({}),
    };

    ticketLedger = { pauseActiveLogsForUser: jest.fn().mockResolvedValue({ count: 0, logIds: [] }) };

    service = new WorkdayService(
      prisma,
      {} as any,
      { log: jest.fn().mockResolvedValue({}) } as any,
      ticketLedger,
      { sendNotification: jest.fn().mockResolvedValue({}) } as any,
      attendanceAuthority,
      { now: jest.fn(() => NOW), companyDayStart: jest.fn(() => TODAY), companyDateOnly: jest.fn(() => TODAY) } as any,
    );
  });

  it('one open break: closes it, freezes totals, pauses tickets, logs out the user', async () => {
    const openSession = {
      id: 'ws1', userId: 'user-1', status: 'WORKING', logoutAt: null, startWorkAt: START_WORK,
      closureReason: null, autoClosed: false, autoClosedAt: null, totalWorkMinutes: 0, totalBreakMinutes: 0,
      breakLogs: [{ id: 'b1', breakType: 'TEA', startAt: new Date('2026-06-10T09:30:00.000Z'), endAt: null, durationMinutes: null }],
    };
    prisma.workSession.findFirst.mockResolvedValue(openSession);
    prisma.workSession.findUnique.mockResolvedValue(openSession);

    const result = await service.endWork('user-1');

    expect(prisma.breakLog.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b1' } }));
    expect(result.summary).toEqual({ totalWorkMinutes: 90, totalBreakMinutes: 30 });
    expect(attendanceAuthority.setUserStatus).toHaveBeenCalledWith('user-1', 'LOGGED_OUT');
    expect(ticketLedger.pauseActiveLogsForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', pauseReason: 'LOGOUT' }),
      prisma,
    );
  });

  it('multiple open breaks: every one closes safely', async () => {
    const openSession = {
      id: 'ws1', userId: 'user-1', status: 'ON_BREAK', logoutAt: null, startWorkAt: START_WORK,
      closureReason: null, autoClosed: false, autoClosedAt: null, totalWorkMinutes: 0, totalBreakMinutes: 0,
      breakLogs: [
        { id: 'b1', breakType: 'TEA', startAt: new Date('2026-06-10T08:30:00.000Z'), endAt: null, durationMinutes: null },
        { id: 'b2', breakType: 'LUNCH', startAt: new Date('2026-06-10T09:00:00.000Z'), endAt: null, durationMinutes: null },
      ],
    };
    prisma.workSession.findFirst.mockResolvedValue(openSession);
    prisma.workSession.findUnique.mockResolvedValue(openSession);

    await service.endWork('user-1');

    expect(prisma.breakLog.update).toHaveBeenCalledTimes(2);
    expect(prisma.breakLog.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b1' } }));
    expect(prisma.breakLog.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b2' } }));
  });

  it('an already-closed session short-circuits before ever reaching the finalizer', async () => {
    const closedSession = {
      id: 'closed-session', status: 'LOGGED_OUT', logoutAt: new Date('2026-06-10T09:00:00.000Z'),
      totalWorkMinutes: 420, totalBreakMinutes: 30, breakLogs: [],
    };
    prisma.workSession.findFirst.mockResolvedValue(closedSession);

    const result = await service.endWork('user-1');

    expect(result).toEqual({ session: closedSession, summary: { totalWorkMinutes: 420, totalBreakMinutes: 30 } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(attendanceAuthority.updateWorkSession).not.toHaveBeenCalled();
    expect(attendanceAuthority.setUserStatus).not.toHaveBeenCalled();
  });
});

// Required scenario 11: auto-close consent / recent-activity grace behavior
// is unaffected. shouldPolicyAutoStop (scheduler.policy.spec.ts, tests 13-17)
// and getToday()'s needsAutoCloseConsent computation were not touched by this
// change — continueWorking() is spot-checked here as a direct regression
// guard on the PR #9 flow this task must not alter.
describe('WorkdayService.continueWorking — unaffected by the finalizer change', () => {
  it('still refreshes activity and records WORKDAY_CONTINUED without touching session status', async () => {
    const now = new Date('2026-06-10T20:05:00.000Z');
    const session = { id: 'ws1', userId: 'user-1', status: 'WORKING' };
    const prisma: any = {
      workSession: { findFirst: jest.fn().mockResolvedValue(session) },
      attendanceEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const attendanceAuthority: any = { setUserStatus: jest.fn().mockResolvedValue({}) };
    const eventLogger: any = { log: jest.fn().mockResolvedValue({}) };

    const service = new WorkdayService(
      prisma,
      {} as any,
      eventLogger,
      {} as any,
      {} as any,
      attendanceAuthority,
      { now: jest.fn(() => now), companyDayStart: jest.fn(() => new Date('2026-06-10T00:00:00.000Z')), companyDateOnly: jest.fn(() => new Date('2026-06-10T00:00:00.000Z')) } as any,
    );

    const result = await service.continueWorking('user-1');

    expect(result).toEqual({ message: 'Continuing workday' });
    expect(attendanceAuthority.setUserStatus).toHaveBeenCalledWith('user-1', 'WORKING', now);
    expect(prisma.attendanceEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'WORKDAY_CONTINUED', workSessionId: 'ws1' }),
    }));
  });
});
