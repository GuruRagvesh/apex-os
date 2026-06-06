import { Test, TestingModule } from '@nestjs/testing';
import { WorkdayService } from '../../src/modules/platform/workday/workday.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { EventLoggerService } from '../../src/common/services/event-logger.service';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { NotificationEventService } from '../../src/modules/operations/notifications/notification-event.service';
import { formatInTimeZone } from 'date-fns-tz';
import { DEFAULT_COMPANY_TIMEZONE } from '../../src/common/utils/timezone.util';

import { AttendanceAuthorityService } from '../../src/common/services/attendance-authority.service';

describe('WorkdayService — FP-19B Daily Summary', () => {
  let service: WorkdayService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkdayService,
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1' }) },
            workSession: { findMany: jest.fn() },
          },
        },
        { provide: AccessPolicyService, useValue: { canViewUser: jest.fn().mockResolvedValue(true) } },
        { provide: EventLoggerService, useValue: { log: jest.fn() } },
        { provide: TicketLedgerService, useValue: {} },
        { provide: NotificationEventService, useValue: {} },
        { provide: AttendanceAuthorityService, useValue: {} },
      ],
    }).compile();

    service = module.get<WorkdayService>(WorkdayService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  const generateMockSession = (overrides: any) => ({
    id: 'ws_' + Math.random(),
    userId: 'u1',
    date: new Date(),
    loginAt: new Date(),
    startWorkAt: new Date(),
    status: 'LOGGED_OUT',
    logoutAt: new Date(),
    totalWorkMinutes: 120,
    totalBreakMinutes: 15,
    autoClosed: false,
    closureReason: null,
    breakLogs: [],
    ...overrides,
  });

  it('multiple same-day sessions produce one companyDate row', async () => {
    const dateStr = '2026-06-03T00:00:00.000Z';
    (prisma.workSession.findMany as jest.Mock).mockResolvedValue([
      generateMockSession({ date: new Date(dateStr), totalWorkMinutes: 60, totalBreakMinutes: 10 }),
      generateMockSession({ date: new Date(dateStr), totalWorkMinutes: 120, totalBreakMinutes: 20 }),
    ]);

    const result = await service.getHistory('u1', {});
    expect(result.length).toBe(1);
    expect(result[0].sessionCount).toBe(2);
    expect(result[0].totalWorkMinutes).toBe(180);
    expect(result[0].totalBreakMinutes).toBe(30);
    expect(result[0].netWorkMinutes).toBe(180);
  });

  it('Today appears once', async () => {
    const todayStr = formatInTimeZone(new Date(), DEFAULT_COMPANY_TIMEZONE, 'yyyy-MM-dd');
    (prisma.workSession.findMany as jest.Mock).mockResolvedValue([
      generateMockSession({ date: new Date(todayStr), totalWorkMinutes: 60 }),
      generateMockSession({ date: new Date(todayStr), totalWorkMinutes: 30 }),
    ]);

    const result = await service.getHistory('u1', {});
    expect(result.length).toBe(1);
    expect(result[0].companyDate).toBe(todayStr);
  });

  it('old open session marks needsReview', async () => {
    const dateStr = '2026-06-01T00:00:00.000Z';
    (prisma.workSession.findMany as jest.Mock).mockResolvedValue([
      generateMockSession({ date: new Date(dateStr), logoutAt: null }),
    ]);

    const result = await service.getHistory('u1', {});
    expect(result[0].needsReview).toBe(true);
    expect(result[0].status).toBe('NEEDS_REVIEW');
  });

  it('>16h total marks needsReview', async () => {
    const dateStr = '2026-06-01T00:00:00.000Z';
    (prisma.workSession.findMany as jest.Mock).mockResolvedValue([
      generateMockSession({ date: new Date(dateStr), totalWorkMinutes: 1000 }), // 1000 > 960
    ]);

    const result = await service.getHistory('u1', {});
    expect(result[0].needsReview).toBe(true);
    expect(result[0].status).toBe('NEEDS_REVIEW');
  });

  it('autoClosedCount is correct', async () => {
    const dateStr = '2026-06-01T00:00:00.000Z';
    (prisma.workSession.findMany as jest.Mock).mockResolvedValue([
      generateMockSession({ date: new Date(dateStr), autoClosed: true }),
      generateMockSession({ date: new Date(dateStr), autoClosed: false }),
    ]);

    const result = await service.getHistory('u1', {});
    expect(result[0].autoClosedCount).toBe(1);
    expect(result[0].status).toBe('AUTO_CLOSED');
  });
});
