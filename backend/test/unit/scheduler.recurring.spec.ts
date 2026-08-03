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
  },
  workSession: {
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
  },
  breakLog: {
    update: jest.fn(),
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

  it('fires daily_morning reminder at hour 9', async () => {
    // Build a local-time 09:00 so getHours() === 9 regardless of machine timezone
    const at9am = new Date();
    at9am.setHours(9, 0, 0, 0);
    jest.useFakeTimers({ now: at9am });

    const ticket = {
      id: 'tk1', ticketId: 'TKT-001', title: 'Daily standup',
      scheduleRecurring: 'daily_morning', createdAt: new Date('2026-05-01'),
      assignedTo: { id: 'u1', name: 'Alice' }, assignees: [],
    };
    mockPrisma.ticket.findMany
      .mockResolvedValueOnce([])          // one-time call
      .mockResolvedValueOnce([ticket]);   // recurring call
    mockPrisma.notification.create.mockResolvedValue({});

    await service.checkScheduledTickets();

    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          title: expect.stringContaining('reminder'),
        }),
      }),
    );

    jest.useRealTimers();
  });

  it('does NOT fire daily_morning reminder outside hour 9', async () => {
    // Build a local-time 14:00 so getHours() === 14 regardless of machine timezone
    const at2pm = new Date();
    at2pm.setHours(14, 0, 0, 0);
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

    expect(mockPrisma.notification.create).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('runs to completion without throwing when ticket arrays are empty', async () => {
    await expect(service.checkScheduledTickets()).resolves.toBeUndefined();
  });
});
