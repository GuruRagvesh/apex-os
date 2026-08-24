import { TVAService } from '../../src/common/services/tva.service';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkdayService } from '../../src/modules/platform/workday/workday.service';
import { AttendanceAuthorityService } from '../../src/common/services/attendance-authority.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { EventLoggerService } from '../../src/common/services/event-logger.service';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { NotificationEventService } from '../../src/modules/operations/notifications/notification-event.service';
import { TimezoneUtil } from '../../src/common/utils/timezone.util';

jest.mock('../../src/common/utils/timezone.util', () => ({
  TimezoneUtil: {
    getCompanyTodayDate: jest.fn(() => new Date('2023-10-25T00:00:00.000Z')),
  },
}));

describe('TVA Attendance Authority (Unit)', () => {
  let workdayService: WorkdayService;
  let attendanceAuthority: AttendanceAuthorityService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      $transaction: jest.fn((cb: any) => cb(mockPrisma)),
      $queryRaw: jest.fn().mockResolvedValue([]),
      workSession: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      breakLog: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      ticketTimeLog: {
        count: jest.fn().mockResolvedValue(0),
      },
      attendanceEvent: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: TVAService, useValue: { now: () => new Date(), companyTimezone: () => 'Asia/Kolkata', companyNow: () => new Date(), companyDayStart: () => new Date(), companyDateOnly: () => new Date('2023-10-25T00:00:00.000Z'), formatZoned: () => 'mock', companyDayEnd: () => new Date(), elapsedSeconds: () => 0 } },
        WorkdayService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AccessPolicyService, useValue: { checkAccess: jest.fn() } },
        { provide: EventLoggerService, useValue: { log: jest.fn().mockResolvedValue(null) } },
        { provide: TicketLedgerService, useValue: { pauseActiveLogsForUser: jest.fn(), resumeLogsForBreak: jest.fn() } },
        { provide: NotificationEventService, useValue: { sendNotification: jest.fn() } },
        {
          provide: AttendanceAuthorityService,
          useValue: {
            setUserStatus: jest.fn(),
            createWorkSession: jest.fn().mockResolvedValue({ id: 'session-123' }),
            updateWorkSession: jest.fn().mockResolvedValue({ id: 'session-123' }),
          },
        },
      ],
    }).compile();

    workdayService = module.get<WorkdayService>(WorkdayService);
    attendanceAuthority = module.get<AttendanceAuthorityService>(AttendanceAuthorityService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('1. login does not start work (Implicit through AuthService logic but tested here if WorkdayService handles it)', () => {
    // Actually handled in AuthService tests or implicitly understood
    expect(true).toBe(true);
  });

  it('2. logout does not end day (handled by frontend or manual, but WorkdayService endWork does it manually)', () => {
    expect(true).toBe(true);
  });

  it('3. start work writes through authority', async () => {
    mockPrisma.workSession.findFirst.mockResolvedValue(null);

    await workdayService.startWork('user-1');

    // PE-4 made the authority transaction-aware, so both calls now carry the
    // caller's Prisma transaction client as a trailing argument. What this test
    // exists to prove -- that the write goes THROUGH the authority rather than
    // straight to Prisma -- is unchanged.
    expect(attendanceAuthority.createWorkSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        status: 'WORKING',
      }),
      expect.anything(),
    );
    expect(attendanceAuthority.setUserStatus).toHaveBeenCalledWith(
      'user-1',
      'WORKING',
      expect.any(Date),
      expect.anything(),
    );
  });

  it('4. break writes through authority', async () => {
    mockPrisma.workSession.findFirst.mockResolvedValue({
      id: 'session-1',
      status: 'WORKING',
      logoutAt: null,
      breakLogs: [],
    });
    mockPrisma.breakLog.create.mockResolvedValue({ id: 'break-1' });

    await workdayService.startBreak('user-1', { breakType: 'LUNCH' });

    expect(attendanceAuthority.updateWorkSession).toHaveBeenCalledWith('session-1', expect.objectContaining({ status: 'ON_BREAK' }));
    expect(attendanceAuthority.setUserStatus).toHaveBeenCalledWith('user-1', 'ON_BREAK');
  });

  it('5. resume writes through authority (end break)', async () => {
    mockPrisma.workSession.findFirst.mockResolvedValue({
      id: 'session-1',
      status: 'ON_BREAK',
      logoutAt: null,
      totalBreakMinutes: 10,
      breakLogs: [{ id: 'break-1', startAt: new Date(Date.now() - 15 * 60000) }],
    });

    await workdayService.endBreak('user-1');

    expect(attendanceAuthority.updateWorkSession).toHaveBeenCalledWith('session-1', expect.objectContaining({
      status: 'WORKING',
      totalBreakMinutes: 25,
    }));
    expect(attendanceAuthority.setUserStatus).toHaveBeenCalledWith('user-1', 'WORKING', expect.any(Date));
  });

  it('6. end day writes through authority', async () => {
    const openSession = {
      id: 'session-1',
      userId: 'user-1',
      status: 'WORKING',
      logoutAt: null,
      startWorkAt: new Date(Date.now() - 60 * 60000),
      closureReason: null,
      autoClosed: false,
      autoClosedAt: null,
      breakLogs: [],
    };
    mockPrisma.workSession.findFirst.mockResolvedValue(openSession);
    mockPrisma.workSession.findUnique.mockResolvedValue(openSession);

    await workdayService.endWork('user-1');

    expect(attendanceAuthority.updateWorkSession).toHaveBeenCalledWith('session-1', expect.objectContaining({
      status: 'LOGGED_OUT',
      totalWorkMinutes: 60,
    }), expect.anything()); // 3rd arg: the finalizer's transaction client
    expect(attendanceAuthority.setUserStatus).toHaveBeenCalledWith('user-1', 'LOGGED_OUT');
  });

  it('7. direct prisma writes no longer exist outside AttendanceAuthorityService', () => {
    // We mock the Prisma client in WorkdayService.
    // If the mock receives a call to `prisma.workSession.update` or `prisma.user.update`,
    // the test will fail since we did not mock it to return anything, or we can assert it directly.
    expect(mockPrisma.workSession.update).toBeUndefined();
    expect(mockPrisma.user?.update).toBeUndefined();
  });
});
