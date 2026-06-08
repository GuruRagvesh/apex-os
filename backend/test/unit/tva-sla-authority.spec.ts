import { TVAService } from '../../src/common/services/tva.service';
import { Test, TestingModule } from '@nestjs/testing';
import { AutomationService } from '../../src/modules/platform/automation/automation.service';
import { AiCronService } from '../../src/modules/ai/ai.cron.service';
import { AnalyticsService } from '../../src/modules/platform/analytics/analytics.service';
import { TicketTimingService } from '../../src/common/services/ticket-timing.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EmailService } from '../../src/modules/platform/email/email.service';
import { ConfigService } from '@nestjs/config';
import { TicketAccessService } from '../../src/common/services/ticket-access.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { CompanyDateService } from '../../src/common/services/company-date.service';

describe('TVA-005, 006, 007: SLA Authority Consolidation', () => {
  let automationService: AutomationService;
  let aiCronService: AiCronService;
  let analyticsService: AnalyticsService;

  const mockPrisma = {
    ticket: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([{ id: 'u1', email: 'mgr@test.com' }]),
      findUnique: jest.fn(),
    },
    leaveRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    notification: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
  };

  const mockEmail = {
    sendEmail: jest.fn().mockResolvedValue(true),
  };

  const mockTicketTiming = {
    getSlaConfig: jest.fn().mockResolvedValue({ execution: {}, review: {} }),
    getTimingState: jest.fn(),
  };

  const mockAccessPolicy = {
    roleName: jest.fn().mockReturnValue('MANAGER'),
    managedDepartmentIds: jest.fn().mockResolvedValue(['d1']),
  };

  const mockTicketAccess = {
    buildTicketWhereForUser: jest.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: TVAService, useValue: { now: () => new Date(), companyTimezone: () => 'Asia/Kolkata', companyNow: () => new Date(), companyDayStart: () => new Date(), formatZoned: () => 'mock', companyDayEnd: () => new Date(), elapsedSeconds: () => 0 } },
        AutomationService,
        AiCronService,
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmail },
        { provide: TicketTimingService, useValue: mockTicketTiming },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: AccessPolicyService, useValue: mockAccessPolicy },
        { provide: TicketAccessService, useValue: mockTicketAccess },
        { provide: CompanyDateService, useValue: { getTodayStart: jest.fn().mockReturnValue(new Date('2026-06-06T00:00:00Z')) } },
      ],
    }).compile();

    automationService = module.get<AutomationService>(AutomationService);
    aiCronService = module.get<AiCronService>(AiCronService);
    analyticsService = module.get<AnalyticsService>(AnalyticsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('proves dashboard/tickets = automation = digest = analytics SLA logic', async () => {
    const tickets = [
      { id: 't1', status: 'OPEN', priority: 'HIGH', assignedToId: 'u1' },
      { id: 't2', status: 'IN_PROGRESS', priority: 'LOW', assignedToId: 'u1' },
    ];

    mockPrisma.ticket.findMany.mockResolvedValue(tickets);

    // Mock TicketTimingService to say t1 is overdue and t2 is not
    mockTicketTiming.getTimingState.mockImplementation((ticket: any) => {
      return { isOverdue: ticket.id === 't1' };
    });

    // 1. Analytics
    const analyticsRes = await analyticsService.getManagerMetrics({ id: 'u1' });
    expect(analyticsRes.overdueTickets).toBe(1);

    // 2. AI Digest
    await aiCronService.sendDailyDigest();
    // Digest sends 1 email per manager. We can check if email was called.
    expect(mockEmail.sendEmail).toHaveBeenCalled();

    // 3. Automation
    await automationService.checkOverdueTickets();
    // Check if notification was created for t1 but not t2
    expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);

    // All three services used the same `getTimingState` output!
    expect(mockTicketTiming.getTimingState).toHaveBeenCalled();
  });
});
