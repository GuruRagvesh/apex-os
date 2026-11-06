import { TVAService } from '../../src/common/services/tva.service';
/**
 * Unit tests — SchedulerService recurring-ticket query
 *
 * Verifies that the Prisma query used to find recurring tickets
 * is well-formed and does not mix null inside a notIn array (which
 * causes: "Invalid value provided. Expected ListStringFieldRefInput
 * or Null, provided (Null, String)").
 *
 * Prisma and the gateway are fully mocked; no DB connection required.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerService } from '../../src/modules/platform/scheduler/scheduler.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventsGateway } from '../../src/modules/platform/gateway/events.gateway';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { NotificationEventService } from '../../src/modules/operations/notifications/notification-event.service';
import { SettingsService } from '../../src/modules/platform/settings/settings.service';
import { CompanyDateService } from '../../src/common/services/company-date.service';
import { AttendanceAuthorityService } from '../../src/common/services/attendance-authority.service';
import { WorkdayService } from '../../src/modules/platform/workday/workday.service';

// ── Minimal mocks ─────────────────────────────────────────────────────────────

const mockPrisma = {
  ticket: {
    findMany: jest.fn(),
  },
  notification: {
    create: jest.fn(),
    findFirst: jest.fn(),
  },
  appSetting: {
    findMany: jest.fn(),
  },
  workSession: {
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
  },
  breakLog: {
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  attendanceEvent: {
    create: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  leaveRequest: {
    findMany: jest.fn(),
  },
};

const mockGateway = {
  emitNotificationToUser: jest.fn(),
  server: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) },
};

const mockTicketLedger = {
  pauseActiveLogsForUser: jest.fn(),
  endActiveLog: jest.fn(),
  getActiveLogForUser: jest.fn(),
  getActiveLogForTicket: jest.fn(),
};

const mockNotificationEvent = {
  sendNotification: jest.fn(),
};

const mockSettingsService = {
  getWorkdayPolicy: jest.fn().mockResolvedValue({ timezone: 'Asia/Kolkata', autoClose: true }),
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('SchedulerService — recurring ticket query', () => {
  let service: SchedulerService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: return empty arrays so the cron method runs to completion
    mockPrisma.ticket.findMany.mockResolvedValue([]);
    mockPrisma.workSession.findMany.mockResolvedValue([]);
    mockPrisma.breakLog.findMany.mockResolvedValue([]);
    mockPrisma.leaveRequest.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: TVAService, useValue: { now: () => new Date(), companyTimezone: () => 'Asia/Kolkata', companyNow: () => new Date(), companyDayStart: () => new Date(), formatZoned: () => 'mock', companyDayEnd: () => new Date(), elapsedSeconds: () => 0 } },
        SchedulerService,
        { provide: PrismaService,  useValue: mockPrisma  },
        { provide: EventsGateway,  useValue: mockGateway },
        { provide: TicketLedgerService, useValue: mockTicketLedger },
        { provide: NotificationEventService, useValue: mockNotificationEvent },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: CompanyDateService, useValue: { getTodayStart: jest.fn() } },
        { provide: AttendanceAuthorityService, useValue: { setUserStatus: jest.fn(), updateManyWorkSessions: jest.fn() } },
        { provide: WorkdayService, useValue: { finalizeWorkSession: jest.fn() } },
      ],
    }).compile();

    service = module.get<SchedulerService>(SchedulerService);
  });

  // ── Query shape tests ───────────────────────────────────────────────────────

  it('recurring query does NOT pass null inside a notIn array', async () => {
    await service.checkScheduledTickets();

    const calls = mockPrisma.ticket.findMany.mock.calls;
    // Second call is the recurring query
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const recurringWhere = calls[1][0].where;

    // Must NOT have scheduleRecurring.notIn at all (that was the bug)
    expect(recurringWhere.scheduleRecurring?.notIn).toBeUndefined();
  });

  it('recurring query excludes null via AND[0].scheduleRecurring.not', async () => {
    await service.checkScheduledTickets();

    const recurringWhere = mockPrisma.ticket.findMany.mock.calls[1][0].where;
    const andClauses: any[] = recurringWhere.AND ?? [];

    const nullExclusion = andClauses.find(
      (c: any) => c.scheduleRecurring?.not === null,
    );
    expect(nullExclusion).toBeDefined();
  });

  it('recurring query excludes "none" via AND[1].scheduleRecurring.not', async () => {
    await service.checkScheduledTickets();

    const recurringWhere = mockPrisma.ticket.findMany.mock.calls[1][0].where;
    const andClauses: any[] = recurringWhere.AND ?? [];

    const noneExclusion = andClauses.find(
      (c: any) => c.scheduleRecurring?.not === 'none',
    );
    expect(noneExclusion).toBeDefined();
  });

  it('recurring query excludes DONE and CLOSED statuses', async () => {
    await service.checkScheduledTickets();

    const recurringWhere = mockPrisma.ticket.findMany.mock.calls[1][0].where;
    expect(recurringWhere.status?.notIn).toEqual(expect.arrayContaining(['DONE', 'CLOSED']));
  });

  it('recurring query allows tickets with no end date OR end date in the future', async () => {
    await service.checkScheduledTickets();

    const recurringWhere = mockPrisma.ticket.findMany.mock.calls[1][0].where;
    const orClauses: any[] = recurringWhere.OR ?? [];

    const nullEndDate = orClauses.find((c: any) => c.scheduleEndDate === null);
    const futureEndDate = orClauses.find((c: any) => c.scheduleEndDate?.gte !== undefined);

    expect(nullEndDate).toBeDefined();
    expect(futureEndDate).toBeDefined();
  });

  // ── Recurrence logic tests ──────────────────────────────────────────────────

  // Recurrence is decided in COMPANY time (Asia/Kolkata), never the host's:
  // these instants are fixed UTC values, so the result is the same on any machine.
  it('fires daily_morning reminder at 09:00 company time', async () => {
    const at9am = new Date('2026-10-05T03:30:00.000Z'); // 09:00 IST
    jest.useFakeTimers({ now: at9am });

    const ticket = {
      id: 'tk1', ticketId: 'TKT-001', title: 'Daily standup',
      scheduleRecurring: 'daily_morning', createdAt: new Date('2026-05-01'),
      assignedTo: { id: 'u1', name: 'Alice' }, assignees: [],
    };
    mockPrisma.ticket.findMany
      .mockResolvedValueOnce([])          // one-time call
      .mockResolvedValueOnce([ticket]);   // recurring call
    await service.checkScheduledTickets();

    expect(mockNotificationEvent.sendNotification).toHaveBeenCalledWith(
      'u1',
      'statusChanged',
      expect.objectContaining({
        title: expect.stringContaining('reminder'),
        entityId: 'tk1',
        dedupeKey: expect.stringContaining('scheduled-ticket:tk1'),
      }),
    );

    jest.useRealTimers();
  });

  it('does NOT fire daily_morning reminder outside 09:00 company time', async () => {
    const at2pm = new Date('2026-10-05T08:30:00.000Z'); // 14:00 IST
    jest.useFakeTimers({ now: at2pm });

    const ticket = {
      id: 'tk2', ticketId: 'TKT-002', title: 'Daily standup',
      scheduleRecurring: 'daily_morning', createdAt: new Date('2026-05-01'),
      assignedTo: { id: 'u2', name: 'Bob' }, assignees: [],
    };
    mockPrisma.ticket.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([ticket]);

    await service.checkScheduledTickets();

    expect(mockNotificationEvent.sendNotification).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('09:00 UTC (14:30 IST, the old host-time firing) does NOT fire daily_morning', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-05T09:00:00.000Z') });
    const ticket = {
      id: 'tk3', ticketId: 'TKT-003', title: 'Daily standup',
      scheduleRecurring: 'daily_morning', createdAt: new Date('2026-05-01'),
      assignedTo: { id: 'u3', name: 'Cara' }, assignees: [],
    };
    mockPrisma.ticket.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([ticket]);
    await service.checkScheduledTickets();
    expect(mockNotificationEvent.sendNotification).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('weekly fires on the company weekday the ticket was created, not the UTC weekday', async () => {
    // Created Monday 00:30 IST (= Sunday 19:00 UTC); now is Monday 09:00 IST.
    jest.useFakeTimers({ now: new Date('2026-10-05T03:30:00.000Z') });
    const ticket = {
      id: 'tk4', ticketId: 'TKT-004', title: 'Weekly report',
      scheduleRecurring: 'weekly', createdAt: new Date('2026-09-27T19:00:00.000Z'),
      assignedTo: { id: 'u4', name: 'Dev' }, assignees: [],
    };
    mockPrisma.ticket.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([ticket]);
    await service.checkScheduledTickets();
    expect(mockNotificationEvent.sendNotification).toHaveBeenCalledTimes(1);
    expect(mockNotificationEvent.sendNotification).toHaveBeenCalledWith(
      'u4',
      'statusChanged',
      expect.objectContaining({ entityId: 'tk4' }),
    );
    jest.useRealTimers();
  });

  it('runs to completion without throwing when ticket arrays are empty', async () => {
    await expect(service.checkScheduledTickets()).resolves.toBeUndefined();
  });

  it('claims a due early warning on the break, then sends one forced, deduplicated alarm', async () => {
    const plannedEndAt = new Date('2026-10-05T06:00:00.000Z');
    mockPrisma.breakLog.findMany.mockResolvedValueOnce([{
      id: 'break-1',
      userId: 'u1',
      estimatedMinutes: 30,
      plannedEndAt,
      warningStage: 'PENDING',
    }]);
    mockPrisma.breakLog.updateMany.mockResolvedValueOnce({ count: 1 });

    await service.plannedBreakOverrunReminders();

    expect(mockPrisma.breakLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ endAt: null, breakType: { not: 'MEETING' } }),
    }));
    expect(mockPrisma.breakLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'break-1', endAt: null, warningStage: 'PENDING' },
      data: expect.objectContaining({ warningStage: 'EARLY_ACTIVE' }),
    }));
    expect(mockNotificationEvent.sendNotification).toHaveBeenCalledWith(
      'u1',
      'breakOverrun',
      expect.objectContaining({
        entityId: 'break-1',
        entityType: 'BREAK',
        dedupeKey: 'break-warning:break-1:early',
        forceDelivery: true,
      }),
    );
  });

  describe('repeat rounds of an unanswered break alarm', () => {
    const now = new Date('2026-11-06T10:00:00.000Z');
    // Fahhh: 20 plays x 2.7 s = 54 s of ringing + 5 min pause = a 354 s cycle.
    const ringing = (minutesAgo: number) => ({
      id: 'break-9', userId: 'u9', warningStage: 'EARLY_ACTIVE',
      warningUpdatedAt: new Date(now.getTime() - minutesAgo * 60_000),
      plannedEndAt: new Date(now.getTime() - 60_000),
    });
    beforeEach(() => {
      jest.useFakeTimers({ now });
      mockPrisma.appSetting.findMany.mockResolvedValue([{ key: 'user-prefs-u9', value: { breakWarningSound: 'fahhh' } }]);
      mockPrisma.notification.findFirst.mockResolvedValue(null);
    });
    afterEach(() => jest.useRealTimers());

    it('re-sends a forced alarm when the second round starts', async () => {
      mockPrisma.breakLog.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([ringing(6)]);

      await service.plannedBreakOverrunReminders();

      expect(mockNotificationEvent.sendNotification).toHaveBeenCalledWith('u9', 'breakOverrun', expect.objectContaining({
        entityId: 'break-9',
        dedupeKey: 'break-warning:break-9:early:round2',
        forceDelivery: true,
        title: 'Your planned break has ended',
      }));
    });

    it('stays quiet during the first round and its pause', async () => {
      mockPrisma.breakLog.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([ringing(4)]);
      await service.plannedBreakOverrunReminders();
      expect(mockNotificationEvent.sendNotification).not.toHaveBeenCalled();
    });

    it('sends each round once', async () => {
      mockPrisma.breakLog.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([ringing(6)]);
      mockPrisma.notification.findFirst.mockResolvedValueOnce({ id: 'already-sent' });
      await service.plannedBreakOverrunReminders();
      expect(mockNotificationEvent.sendNotification).not.toHaveBeenCalled();
    });

    it('stops after the third round', async () => {
      mockPrisma.breakLog.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([ringing(18)]);
      await service.plannedBreakOverrunReminders();
      expect(mockNotificationEvent.sendNotification).not.toHaveBeenCalled();
    });
  });

  it('does not ring when another instance already claimed the alarm', async () => {
    mockPrisma.breakLog.findMany.mockResolvedValueOnce([{
      id: 'break-2',
      userId: 'u2',
      estimatedMinutes: 5,
      plannedEndAt: new Date('2026-10-05T06:00:00.000Z'),
      warningStage: 'PENDING',
    }]);
    mockPrisma.breakLog.updateMany.mockResolvedValueOnce({ count: 0 });

    await service.plannedBreakOverrunReminders();

    expect(mockNotificationEvent.sendNotification).not.toHaveBeenCalled();
  });
});
