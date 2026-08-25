import { WorkdayService } from '../../src/modules/platform/workday/workday.service';

const TODAY = new Date('2026-06-10T00:00:00.000Z');
const NOW   = new Date('2026-06-10T10:00:00.000Z');

// startWorkAt is 2h before NOW → elapsed = 120 min
const START_WORK = new Date('2026-06-10T08:00:00.000Z');

// 30 min before NOW — used for open break and timing assertions
const THIRTY_AGO = new Date('2026-06-10T09:30:00.000Z');

describe('WorkdayService — Phase A1 (MEETING excluded from break totals)', () => {
  let service: WorkdayService;
  let prisma: any;
  let attendanceAuthority: any;
  let ticketLedger: any;

  beforeEach(() => {
    prisma = {
      workSession: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      breakLog: {
        create: jest.fn(),
        update: jest.fn(),
      },
      attendanceEvent: {
        create: jest.fn().mockResolvedValue({}),
      },
      leaveRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      appSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
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
        now: jest.fn(() => NOW),
        companyDayStart: jest.fn(() => TODAY),
      } as any,
    );
  });

  // ── endBreak ──────────────────────────────────────────────────────────────

  describe('endBreak', () => {
    function setupBreakSession(breakType: string, minsAgo: number) {
      const startAt = new Date(NOW.getTime() - minsAgo * 60_000);
      prisma.workSession.findFirst.mockResolvedValue({
        id: 'ws1',
        status: 'ON_BREAK',
        logoutAt: null,
        totalBreakMinutes: 0,
        breakLogs: [{ id: 'bl1', breakType, startAt, endAt: null }],
      });
      prisma.breakLog.update.mockResolvedValue({ id: 'bl1' });
    }

    it('MEETING: breakLog is closed but totalBreakMinutes is NOT incremented', async () => {
      setupBreakSession('MEETING', 45);

      await service.endBreak('u1');

      expect(prisma.breakLog.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'bl1' }, data: expect.objectContaining({ endAt: NOW }) }),
      );
      const wsUpdate = attendanceAuthority.updateWorkSession.mock.calls[0][1];
      expect(wsUpdate.status).toBe('WORKING');
      expect(wsUpdate.totalBreakMinutes).toBe(0); // 0 + 0 (MEETING not counted)
    });

    it('TEA: breakLog is closed AND totalBreakMinutes IS incremented', async () => {
      setupBreakSession('TEA', 15);

      await service.endBreak('u1');

      const wsUpdate = attendanceAuthority.updateWorkSession.mock.calls[0][1];
      expect(wsUpdate.status).toBe('WORKING');
      expect(wsUpdate.totalBreakMinutes).toBe(15); // 0 + 15
    });

    it('LUNCH: totalBreakMinutes IS incremented (regression guard)', async () => {
      setupBreakSession('LUNCH', 60);

      await service.endBreak('u1');

      const wsUpdate = attendanceAuthority.updateWorkSession.mock.calls[0][1];
      expect(wsUpdate.totalBreakMinutes).toBe(60);
    });
  });

  // ── endWork ───────────────────────────────────────────────────────────────

  describe('endWork', () => {
    function setupWorkSession(breakLogs: any[]) {
      prisma.workSession.findFirst.mockResolvedValue({
        id: 'ws1',
        status: 'WORKING',
        logoutAt: null,
        startWorkAt: START_WORK,
        breakLogs,
      });
      prisma.breakLog.update.mockResolvedValue({});
    }

    it('MEETING-only closed break: totalBreakMinutes=0, totalWorkMinutes=120', async () => {
      setupWorkSession([
        {
          id: 'bl1', breakType: 'MEETING', durationMinutes: 60,
          startAt: new Date('2026-06-10T08:30:00.000Z'),
          endAt:   new Date('2026-06-10T09:30:00.000Z'),
        },
      ]);

      await service.endWork('u1');

      const wsUpdate = attendanceAuthority.updateWorkSession.mock.calls[0][1];
      expect(wsUpdate.totalBreakMinutes).toBe(0);
      expect(wsUpdate.totalWorkMinutes).toBe(120);
    });

    it('mixed LUNCH + MEETING: only LUNCH counted, totalWorkMinutes = 120 - 30 = 90', async () => {
      setupWorkSession([
        { id: 'bl1', breakType: 'LUNCH',   durationMinutes: 30, endAt: new Date() },
        { id: 'bl2', breakType: 'MEETING', durationMinutes: 60, endAt: new Date() },
      ]);

      await service.endWork('u1');

      const wsUpdate = attendanceAuthority.updateWorkSession.mock.calls[0][1];
      expect(wsUpdate.totalBreakMinutes).toBe(30);
      expect(wsUpdate.totalWorkMinutes).toBe(90);
    });

    it('TEA-only break: totalBreakMinutes=20, totalWorkMinutes=100 (regression guard)', async () => {
      setupWorkSession([
        { id: 'bl1', breakType: 'TEA', durationMinutes: 20, endAt: new Date() },
      ]);

      await service.endWork('u1');

      const wsUpdate = attendanceAuthority.updateWorkSession.mock.calls[0][1];
      expect(wsUpdate.totalBreakMinutes).toBe(20);
      expect(wsUpdate.totalWorkMinutes).toBe(100);
    });

    it('open MEETING at endWork: breakLog closed but duration NOT added to totalBreakMinutes', async () => {
      setupWorkSession([
        {
          id: 'bl1', breakType: 'MEETING', durationMinutes: null,
          startAt: THIRTY_AGO, // 30 min before NOW
          endAt: null,
        },
      ]);

      await service.endWork('u1');

      expect(prisma.breakLog.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'bl1' } }),
      );
      const wsUpdate = attendanceAuthority.updateWorkSession.mock.calls[0][1];
      expect(wsUpdate.totalBreakMinutes).toBe(0);   // MEETING not counted
      expect(wsUpdate.totalWorkMinutes).toBe(120);   // full elapsed, meeting not deducted
    });

    it('open TEA at endWork: duration IS added to totalBreakMinutes (regression guard)', async () => {
      setupWorkSession([
        {
          id: 'bl1', breakType: 'TEA', durationMinutes: null,
          startAt: THIRTY_AGO, // 30 min before NOW
          endAt: null,
        },
      ]);

      await service.endWork('u1');

      const wsUpdate = attendanceAuthority.updateWorkSession.mock.calls[0][1];
      expect(wsUpdate.totalBreakMinutes).toBe(30);
      expect(wsUpdate.totalWorkMinutes).toBe(90);
    });
  });

  // ── getToday ──────────────────────────────────────────────────────────────
  // calculateWorkdayRuntime runs with the real implementation (no mock).
  // NOW = 10:00, START_WORK = 08:00 → elapsed = 120 min.
  // The pre-filter in workday.service.ts removes MEETING from breakLogs
  // before passing sessions to calculateWorkdayRuntime, so the live MEETING
  // duration is invisible to that function.

  describe('getToday', () => {
    function setupTodaySessions(breakLogs: any[], totalBreakMinutes = 0) {
      prisma.workSession.findMany.mockResolvedValue([{
        id: 'ws1',
        status: 'WORKING',
        startWorkAt: START_WORK,
        logoutAt: null,
        totalBreakMinutes,
        totalWorkMinutes: 0,
        autoClosed: false,
        autoClosedAt: null,
        closureReason: null,
        continuationOfSessionId: null,
        breakLogs,
        attendanceEvents: [],
      }]);
    }

    it('open MEETING break: elapsedWorkMinutes = 120 (meeting not subtracted)', async () => {
      setupTodaySessions([
        { breakType: 'MEETING', startAt: THIRTY_AGO, endAt: null, durationMinutes: null },
      ]);

      const result = await service.getToday('u1');

      expect(result.elapsedWorkMinutes).toBe(120);
      expect(result.totalBreakMinutes).toBe(0);
    });

    it('open TEA break: elapsedWorkMinutes = 90 (tea IS subtracted)', async () => {
      setupTodaySessions([
        { breakType: 'TEA', startAt: THIRTY_AGO, endAt: null, durationMinutes: null },
      ]);

      const result = await service.getToday('u1');

      expect(result.elapsedWorkMinutes).toBe(90);
      expect(result.totalBreakMinutes).toBe(30);
    });

    it('no breaks: elapsedWorkMinutes = 120', async () => {
      setupTodaySessions([]);

      const result = await service.getToday('u1');

      expect(result.elapsedWorkMinutes).toBe(120);
      expect(result.totalBreakMinutes).toBe(0);
    });
  });

  // ── getTeam ───────────────────────────────────────────────────────────────
  // Admin user bypasses managerDeptAccess query.
  // totalBreakMinutes on the session is the POST-FIX stored value
  // (MEETING was not added, so it reflects only true break time).

  describe('getTeam', () => {
    const admin = { id: 'admin1', role: { name: 'ADMIN' }, isHR: false };

    function setupTeamMember(breakLogs: any[], totalBreakMinutes = 0) {
      prisma.user.findMany.mockResolvedValue([{
        id: 'u2',
        name: 'Alice',
        avatar: null,
        photoUrl: null,
        role: { name: 'ADMIN' }, // ADMIN → isFlexible, skips isLate call
        department: null,
        currentStatus: 'WORKING',
        lastActiveAt: null,
        workdayPolicyOverride: null,
        workSessions: [{
          id: 'ws1',
          startWorkAt: START_WORK,
          logoutAt: null,
          totalBreakMinutes,
          totalWorkMinutes: 0,
          autoClosed: false,
          autoClosedAt: null,
          closureReason: null,
          continuationOfSessionId: null,
          breakLogs,
        }],
        leaveRequests: [],
      }]);
    }

    it('completed MEETING break: breakMinutesToday=0, workMinutesToday=120', async () => {
      // totalBreakMinutes=0: MEETING was NOT stored by endBreak (after fix)
      setupTeamMember([
        {
          breakType: 'MEETING', durationMinutes: 60,
          startAt: new Date('2026-06-10T08:30:00.000Z'),
          endAt:   new Date('2026-06-10T09:30:00.000Z'),
        },
      ], 0);

      const result = await service.getTeam(admin);

      expect(result[0].breakMinutesToday).toBe(0);
      expect(result[0].workMinutesToday).toBe(120);
    });

    it('TEA break: breakMinutesToday=15, workMinutesToday=105 (regression guard)', async () => {
      // totalBreakMinutes=15: TEA was stored by endBreak
      setupTeamMember([
        {
          breakType: 'TEA', durationMinutes: 15,
          startAt: new Date('2026-06-10T09:00:00.000Z'),
          endAt:   new Date('2026-06-10T09:15:00.000Z'),
        },
      ], 15);

      const result = await service.getTeam(admin);

      expect(result[0].breakMinutesToday).toBe(15);
      expect(result[0].workMinutesToday).toBe(105);
    });

    it('open MEETING break: live meeting time NOT counted in breakMinutesToday', async () => {
      setupTeamMember([
        { breakType: 'MEETING', durationMinutes: null, startAt: THIRTY_AGO, endAt: null },
      ], 0);

      const result = await service.getTeam(admin);

      expect(result[0].breakMinutesToday).toBe(0);
      expect(result[0].workMinutesToday).toBe(120);
    });

    it('MEETING + RESTROOM: only RESTROOM in breakMinutesToday', async () => {
      // totalBreakMinutes=10: only RESTROOM stored, MEETING not stored
      setupTeamMember([
        {
          breakType: 'MEETING', durationMinutes: 60,
          startAt: new Date('2026-06-10T08:00:00.000Z'),
          endAt:   new Date('2026-06-10T09:00:00.000Z'),
        },
        {
          breakType: 'RESTROOM', durationMinutes: 10,
          startAt: new Date('2026-06-10T09:15:00.000Z'),
          endAt:   new Date('2026-06-10T09:25:00.000Z'),
        },
      ], 10);

      const result = await service.getTeam(admin);

      expect(result[0].breakMinutesToday).toBe(10);
      expect(result[0].workMinutesToday).toBe(110);
    });
  });
});
