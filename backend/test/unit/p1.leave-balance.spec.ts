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
import { formatInTimeZone } from 'date-fns-tz';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  leaveRequest: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  // Reached only when leaveAuthorityEnabled is on: the allocation probe looks
  // for an assigned LeavePolicy. Null means none assigned, which is the
  // production shape -- the policy seed deliberately assigns no profiles.
  employeeAttendanceProfile: {
    findFirst: jest.fn().mockResolvedValue(null),
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
        {
          // A REAL TVAService. The hand-rolled stub that used to sit here had
          // companyDayStart/End both returning `new Date()` and no
          // financialYearBounds at all, so it could not express the balance
          // window it was standing in for -- and a mock that cannot be wrong
          // cannot catch a change to what it mocks.
          provide: TVAService,
          useValue: new TVAService({ get: () => undefined } as unknown as ConfigService),
        },
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

/**
 * THE BALANCE WINDOW IS THE FINANCIAL YEAR, WHATEVER THE FLAGS SAY.
 *
 * getLeaveBalance() used to pick its window from
 * attendance_v2.leaveAuthorityEnabled: April-March when on, January-December
 * when off. `year` meant the FY START year at every caller either way, so the
 * same argument named two different periods depending on a feature flag -- and
 * for nine months of the year both windows carry the same number, which is
 * exactly why the disagreement went unseen.
 *
 * These tests read the WHERE clause the method actually builds, so they prove
 * the window rather than the arithmetic of whoever called it.
 */
describe('LeaveBalanceService — the balance window', () => {
  let service: LeaveBalanceService;
  let settings: { get: jest.Mock; getLeaveQuotas: jest.Mock };

  /** Builds the service with attendance_v2 in a chosen state. */
  const build = async (attendanceV2: any) => {
    settings = {
      getLeaveQuotas: jest.fn().mockResolvedValue({ EMPLOYEE: 12 }),
      get: jest.fn(async (key: string) =>
        key === 'attendance_v2' ? attendanceV2 : { workingDays: 'Mon–Sat' },
      ),
    };

    const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveBalanceService,
        { provide: TVAService, useValue: tva },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SettingsService, useValue: settings },
        {
          provide: LeaveWorkingDayService,
          useValue: new LeaveWorkingDayService(tva, {} as any, {} as any),
        },
        {
          provide: CompanyDateService,
          useValue: { getStartOfDay: jest.fn((d) => new Date(new Date(d).setUTCHours(0, 0, 0, 0))) },
        },
      ],
    }).compile();

    service = module.get(LeaveBalanceService);
  };

  /** The window getLeaveBalance() asked the database for. */
  const windowFor = async (year: number) => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', role: { name: 'EMPLOYEE' } });
    mockPrisma.leaveRequest.findMany.mockResolvedValue([]);

    await service.getLeaveBalance('u1', year);

    const where = mockPrisma.leaveRequest.findMany.mock.calls.at(-1)![0].where;
    return { gte: where.startDate.gte as Date, lte: where.startDate.lte as Date };
  };

  /** Whether a leave starting on this business date falls inside the window. */
  const covers = (w: { gte: Date; lte: Date }, businessDate: string) => {
    // Midday avoids arguing with the IST offset at either edge; the question
    // here is which YEAR the date belongs to, not which minute.
    const at = new Date(`${businessDate}T12:00:00.000Z`);
    return at >= w.gte && at <= w.lte;
  };

  const FLAG_STATES: Array<[string, any]> = [
    ['leaveAuthorityEnabled true', { leaveAuthorityEnabled: true }],
    ['leaveAuthorityEnabled false', { leaveAuthorityEnabled: false }],
    ['attendance_v2 absent entirely', {}],
  ];

  for (const [label, cfg] of FLAG_STATES) {
    describe(`with ${label}`, () => {
      beforeEach(async () => {
        jest.clearAllMocks();
        await build(cfg);
      });

      it('runs April to March for FY 2026-2027', async () => {
        const w = await windowFor(2026);

        // Inside.
        expect(covers(w, '2026-04-01')).toBe(true);
        expect(covers(w, '2026-09-15')).toBe(true);
        expect(covers(w, '2026-12-31')).toBe(true);
        expect(covers(w, '2027-01-01')).toBe(true);
        expect(covers(w, '2027-03-31')).toBe(true);

        // Outside. These two are the whole point: a calendar-year window would
        // include 2026-03-31 and exclude 2027-01-01.
        expect(covers(w, '2026-03-31')).toBe(false);
        expect(covers(w, '2027-04-01')).toBe(false);
      });

      it('steps a whole year forward for FY 2027-2028', async () => {
        const w = await windowFor(2027);

        expect(covers(w, '2027-04-01')).toBe(true);
        expect(covers(w, '2028-03-31')).toBe(true);
        expect(covers(w, '2027-03-31')).toBe(false);
        expect(covers(w, '2028-04-01')).toBe(false);
      });

      it('never uses a January-December window', async () => {
        const w = await windowFor(2026);

        // Read in COMPANY time, not UTC. The IST day beginning 1 April starts
        // at 18:30 UTC on 31 March, so the raw UTC month reads 2026-03 and
        // asserting on it would be asserting the timezone, not the policy.
        const tz = 'Asia/Kolkata';
        expect(formatInTimeZone(w.gte, tz, 'yyyy-MM-dd')).toBe('2026-04-01');
        expect(formatInTimeZone(w.lte, tz, 'yyyy-MM-dd')).toBe('2027-03-31');
      });
    });
  }

  it('validateLeaveRequest names the same year the window measures', async () => {
    // The two sides used to be chosen by different rules: the window branched
    // on the flag, and so did the year handed to it. With the window now always
    // April-March, a calendar year here would ask FY 2027-2028 for a February
    // 2027 request -- a year that has not begun and holds no leave, so an
    // underfunded request would sail through on an empty balance.
    for (const [, cfg] of FLAG_STATES) {
      jest.clearAllMocks();
      await build(cfg);

      const spy = jest
        .spyOn(service, 'getLeaveBalance')
        .mockResolvedValue({ allocation: 12, approved: 0, pending: 0, balance: 12 });
      mockPrisma.leaveRequest.count.mockResolvedValue(0);
      mockPrisma.leaveRequest.findMany.mockResolvedValue([]);
      // Duration is a separate decision with its own flag branch and its own
      // tests. Stubbed so this test proves one thing: which year is asked for.
      const duration = jest.spyOn(service, 'calculateLeaveDuration').mockResolvedValue(1);

      await service.validateLeaveRequest('u1', new Date('2027-02-15'), new Date('2027-02-16'));

      const [, yearArg] = spy.mock.calls.at(-1)!;
      expect(yearArg).toBe(2026);
      spy.mockRestore();
      duration.mockRestore();
    }
  });

  it('the three flag states produce byte-identical windows', async () => {
    const seen: string[] = [];
    for (const [, cfg] of FLAG_STATES) {
      jest.clearAllMocks();
      await build(cfg);
      const w = await windowFor(2026);
      seen.push(`${w.gte.toISOString()}..${w.lte.toISOString()}`);
    }

    // The flag governs leave DURATION and ALLOCATION, which are separate
    // decisions left untouched. It no longer governs which year a balance is.
    expect(new Set(seen).size).toBe(1);
  });
});
