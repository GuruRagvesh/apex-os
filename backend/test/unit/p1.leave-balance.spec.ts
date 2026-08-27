import { TVAService } from '../../src/common/services/tva.service';
import { Test, TestingModule } from '@nestjs/testing';
import { LeaveBalanceService } from '../../src/modules/operations/leave/leave-balance.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SettingsService } from '../../src/modules/platform/settings/settings.service';
import { LeaveStatus } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { CompanyDateService } from '../../src/common/services/company-date.service';
import { LeaveWorkingDayService } from '../../src/modules/operations/leave/leave-working-day.service';
import { ConfigService } from '@nestjs/config';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  leaveRequest: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

const mockSettings = {
  getLeaveQuotas: jest.fn().mockResolvedValue({ EMPLOYEE: 12, TEAM_LEAD: 12, MANAGER: 15, INTERN: 6 }),
  get: jest.fn().mockResolvedValue({ workingDays: 'Mon–Sat' }),
};

describe('LeaveBalanceService', () => {
  let service: LeaveBalanceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: TVAService, useValue: { now: () => new Date(), companyTimezone: () => 'Asia/Kolkata', companyNow: () => new Date(), companyDayStart: () => new Date(), formatZoned: () => 'mock', companyDayEnd: () => new Date(), elapsedSeconds: () => 0 } },
        LeaveBalanceService,
        {
          // LH-1 added this dependency. It is given a REAL TVAService so the
          // company-date arithmetic under test actually runs; the outer
          // TVAService stub above is left exactly as it was.
          provide: LeaveWorkingDayService,
          useValue: new LeaveWorkingDayService(
            new TVAService({ get: () => undefined } as unknown as ConfigService),
            {} as any,
            {} as any,
          ),
        },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SettingsService, useValue: mockSettings },
        { 
          provide: CompanyDateService, 
          useValue: { 
            getStartOfDay: jest.fn().mockImplementation(d => new Date(new Date(d).setUTCHours(0,0,0,0))) 
          } 
        },
      ],
    }).compile();

    service = module.get<LeaveBalanceService>(LeaveBalanceService);
  });

  describe('getYearlyAllocation', () => {
    it('returns role-based quota', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user1',
        role: { name: 'EMPLOYEE' },
      });
      const allocation = await service.getYearlyAllocation('user1');
      expect(allocation).toBe(12);
    });

    it('returns default value if role quota not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user1',
        role: { name: 'CONTRACTOR' },
      });
      const allocation = await service.getYearlyAllocation('user1');
      expect(allocation).toBe(12);
    });
  });

  describe('calculateLeaveDuration', () => {
    it('excludes Sundays under Mon-Sat working schedule', async () => {
      // 2026-03-01 is a Sunday. 2026-03-02 is Monday, 2026-03-03 is Tuesday.
      const duration = await service.calculateLeaveDuration(
        new Date('2026-03-01T00:00:00.000Z'),
        new Date('2026-03-03T00:00:00.000Z'),
        false,
        'Mon–Sat',
      );
      expect(duration).toBe(2); // Sun excluded, Mon + Tue = 2 days
    });

    it('excludes Saturdays and Sundays under Mon-Fri working schedule', async () => {
      // 2026-02-28 is a Saturday, 2026-03-01 is a Sunday, 2026-03-02 is Monday.
      const duration = await service.calculateLeaveDuration(
        new Date('2026-02-28T00:00:00.000Z'),
        new Date('2026-03-02T00:00:00.000Z'),
        false,
        'Mon–Fri',
      );
      expect(duration).toBe(1); // Sat + Sun excluded, Mon = 1 day
    });

    it('excludes company public holidays', async () => {
      // 2026-01-01 is New Year's Day (holiday). 2026-01-02 is a Friday.
      const duration = await service.calculateLeaveDuration(
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2026-01-02T00:00:00.000Z'),
        false,
        'Mon–Sat',
      );
      expect(duration).toBe(1); // New Year's Day excluded, Jan 2 included
    });

    it('counts half days as exactly 0.5 days', async () => {
      const duration = await service.calculateLeaveDuration(
        new Date('2026-03-02T00:00:00.000Z'),
        new Date('2026-03-02T00:00:00.000Z'),
        true,
        'Mon–Sat',
      );
      expect(duration).toBe(0.5);
    });
  });

  describe('getLeaveBalance', () => {
    it('correctly calculates dynamic balance', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user1',
        role: { name: 'EMPLOYEE' },
      });
      // Mock approved leave request for 3 days
      mockPrisma.leaveRequest.findMany.mockResolvedValue([
        {
          id: 'leave1',
          status: LeaveStatus.APPROVED,
          startDate: new Date('2026-03-02T00:00:00.000Z'), // Mon
          endDate: new Date('2026-03-04T00:00:00.000Z'),   // Wed (3 days)
          isHalfDay: false,
        },
        {
          id: 'leave2',
          status: LeaveStatus.PENDING,
          startDate: new Date('2026-04-01T00:00:00.000Z'),
          endDate: new Date('2026-04-01T00:00:00.000Z'),
          isHalfDay: true, // 0.5 days
        },
      ]);

      const balance = await service.getLeaveBalance('user1');
      expect(balance.allocation).toBe(12);
      expect(balance.approved).toBe(3);
      expect(balance.pending).toBe(0.5);
      expect(balance.balance).toBe(9); // 12 - 3 = 9
    });
  });

  describe('validateLeaveRequest', () => {
    it('throws ForbiddenException when there is an overlapping request', async () => {
      mockPrisma.leaveRequest.count.mockResolvedValue(1);

      await expect(
        service.validateLeaveRequest('user1', new Date('2026-03-02'), new Date('2026-03-04')),
      ).rejects.toThrow('overlapping');
    });

    it('throws ForbiddenException when balance is insufficient', async () => {
      mockPrisma.leaveRequest.count.mockResolvedValue(0);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user1',
        role: { name: 'INTERN' }, // Allocation: 6
      });
      // User has already taken 5.5 days of leave
      mockPrisma.leaveRequest.findMany.mockResolvedValue([
        {
          id: 'leave1',
          status: LeaveStatus.APPROVED,
          startDate: new Date('2026-03-02T00:00:00.000Z'),
          endDate: new Date('2026-03-06T00:00:00.000Z'), // 5 days
          isHalfDay: false,
        },
        {
          id: 'leave2',
          status: LeaveStatus.APPROVED,
          startDate: new Date('2026-04-01T00:00:00.000Z'),
          endDate: new Date('2026-04-01T00:00:00.000Z'), // 0.5 days
          isHalfDay: true,
        },
      ]);

      // Requesting 2 more days (should throw since remaining is 0.5)
      await expect(
        service.validateLeaveRequest('user1', new Date('2026-05-11'), new Date('2026-05-12')),
      ).rejects.toThrow('Insufficient leave balance');
    });
  });
});
