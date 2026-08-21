import { LeaveWorkingDayService, LeaveCalendarUnresolvedError } from '../../src/modules/operations/leave/leave-working-day.service';
import { LeaveBalanceService } from '../../src/modules/operations/leave/leave-balance.service';
import { BusinessCalendarService } from '../../src/modules/platform/attendance/calendar/business-calendar.service';
import { DailyAttendanceController } from '../../src/modules/platform/attendance/evaluation/daily-attendance.controller';
import { TVAService } from '../../src/common/services/tva.service';
import { ConfigService } from '@nestjs/config';

// LH-1. Real TVAService and a real BusinessCalendarService, so the company-date
// and weekly-off rules genuinely execute. Prisma, settings and the employee
// timeline are mocked. No database.
//
// August 2026 has exactly five Saturdays (1, 8, 15, 22, 29), so every Saturday
// ordinal 1-5 is a real date rather than a contrived one.

const DEFAULT_WEEKLY_OFF = {
  id: 'wop-1',
  everySunday: true,
  secondSaturday: true,
  fourthSaturday: true,
};

const holidayRow = (date: string, name: string, calendarId = 'cal-2026', isOptional = false) => ({
  id: `hol-${date}`,
  calendarId,
  date: new Date(`${date}T00:00:00.000Z`),
  name,
  isOptional,
  calendar: { id: calendarId },
});

interface CalendarFixtures {
  /** Holidays keyed by calendar id, then business date. */
  holidaysByCalendar?: Record<string, Record<string, any>>;
  weeklyOffById?: Record<string, any>;
  weeklyOffCandidates?: any[];
  holidayCalendarCandidates?: any[];
  overridesByDate?: Record<string, any>;
  /** Profile per business date, so effective-dated changes are testable. */
  profileByDate?: Record<string, any>;
  profile?: any;
}

const DEFAULT_PROFILE = {
  id: 'prof-1',
  assignedHolidayCalendarId: 'cal-2026',
  assignedWeeklyOffPolicyId: 'wop-1',
};

function calendarRig(f: CalendarFixtures = {}) {
  const dateOf = (args: any) => {
    const d: Date = args?.where?.date;
    return d instanceof Date ? d.toISOString().slice(0, 10) : '';
  };

  const prisma: any = {
    weeklyOffPolicy: {
      findFirst: jest.fn((args: any) => {
        const id = args?.where?.id;
        if (id) return Promise.resolve((f.weeklyOffById ?? { 'wop-1': DEFAULT_WEEKLY_OFF })[id] ?? null);
        return Promise.resolve((f.weeklyOffCandidates ?? [DEFAULT_WEEKLY_OFF])[0] ?? null);
      }),
      findMany: jest.fn().mockResolvedValue(f.weeklyOffCandidates ?? [DEFAULT_WEEKLY_OFF]),
    },
    holiday: {
      findFirst: jest.fn((args: any) => {
        const calendarId = args?.where?.calendarId ?? args?.where?.calendar?.id ?? 'cal-2026';
        const table = (f.holidaysByCalendar ?? {})[calendarId] ?? {};
        return Promise.resolve(table[dateOf(args)] ?? null);
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    holidayCalendar: {
      // The assigned id resolves to itself, carrying a policyKey so the version
      // lookup below has a series to match on.
      findUnique: jest.fn((args: any) =>
        Promise.resolve(
          args?.where?.id ? { id: args.where.id, policyKey: `key-${args.where.id}` } : null,
        ),
      ),
      // No superseding version in these fixtures: the assigned row governs.
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue(
        f.holidayCalendarCandidates ?? [{ id: 'cal-2026' }],
      ),
    },
    businessDayOverride: {
      findFirst: jest.fn((args: any) =>
        Promise.resolve((f.overridesByDate ?? {})[dateOf(args)] ?? null),
      ),
    },
    // Present so tests can prove this layer never touches them.
    workSession: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    dailyAttendance: { upsert: jest.fn(), create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    leaveRequest: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn() },
    employeeAttendanceProfile: { findFirst: jest.fn().mockResolvedValue(null) },
  };

  const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);
  const calendar = new BusinessCalendarService(prisma, tva);
  const timeline: any = {
    resolveEmployeeOn: jest.fn((_userId: string, date: string) => {
      const profile =
        (f.profileByDate ?? {})[date] ??
        ('profile' in f ? f.profile : DEFAULT_PROFILE);
      return Promise.resolve({ profile, coverage: profile ? 'COVERED' : 'UNRESOLVED' });
    }),
  };

  const service = new LeaveWorkingDayService(tva, timeline, calendar);
  return { service, prisma, tva, calendar, timeline };
}

describe('LH-1 company business dates', () => {
  it('1. 26 January 2026 IST stays 26 January and is never read as the 25th', async () => {
    const { service } = calendarRig();

    const dates = service.enumerateBusinessDates(
      new Date('2026-01-26T00:00:00.000+05:30'),
      new Date('2026-01-26T00:00:00.000+05:30'),
    );

    // The old implementation derived this from
    // companyDayStart(d).toISOString().split('T')[0], which yields 2026-01-25.
    expect(dates).toEqual(['2026-01-26']);
    expect(dates).not.toContain('2026-01-25');
  });

  it('2. an instant just after IST midnight belongs to the new business date', async () => {
    const { service } = calendarRig();

    // 2026-01-26T18:45Z is 2026-01-27 00:15 IST.
    const dates = service.enumerateBusinessDates(
      new Date('2026-01-26T18:45:00.000Z'),
      new Date('2026-01-26T18:45:00.000Z'),
    );
    expect(dates).toEqual(['2026-01-27']);

    // ...and an instant just before it still belongs to the 26th.
    const before = service.enumerateBusinessDates(
      new Date('2026-01-26T18:15:00.000Z'),
      new Date('2026-01-26T18:15:00.000Z'),
    );
    expect(before).toEqual(['2026-01-26']);
  });

  it('3. a range spans whole business dates without dropping or duplicating one', async () => {
    const { service } = calendarRig();
    const dates = service.enumerateBusinessDates('2026-08-01', '2026-08-31');
    expect(dates).toHaveLength(31);
    expect(dates[0]).toBe('2026-08-01');
    expect(dates[30]).toBe('2026-08-31');
    expect(new Set(dates).size).toBe(31);
  });
});

describe('LH-1 weekly-off authority', () => {
  const workingOn = async (date: string, fixtures: CalendarFixtures = {}) => {
    const { service } = calendarRig(fixtures);
    const result = await service.resolveForEmployee('emp-1', date, date);
    return result;
  };

  it('4. Sunday is excluded', async () => {
    const r = await workingOn('2026-08-02'); // Sunday
    expect(r.days[0].isWeeklyOff).toBe(true);
    expect(r.workingDays).toBe(0);
  });

  it('5. the 2nd Saturday is excluded', async () => {
    const r = await workingOn('2026-08-08');
    expect(r.days[0].isWeeklyOff).toBe(true);
    expect(r.workingDays).toBe(0);
  });

  it('6. the 4th Saturday is excluded', async () => {
    const r = await workingOn('2026-08-22');
    expect(r.days[0].isWeeklyOff).toBe(true);
    expect(r.workingDays).toBe(0);
  });

  it('7. the 1st Saturday is a working day', async () => {
    const r = await workingOn('2026-08-01');
    expect(r.days[0].isWeeklyOff).toBe(false);
    expect(r.workingDays).toBe(1);
  });

  it('8. the 3rd Saturday is a working day', async () => {
    const r = await workingOn('2026-08-15');
    expect(r.days[0].isWeeklyOff).toBe(false);
    expect(r.workingDays).toBe(1);
  });

  it('9. the 5th Saturday follows the policy, which today can only name the 2nd and 4th', async () => {
    // WeeklyOffPolicy has exactly three switches: everySunday, secondSaturday,
    // fourthSaturday. There is no fifthSaturday column, so a 5th Saturday is
    // always a working day -- not by assumption, but because no configurable
    // rule can currently make it an off day. Reported as a schema limitation in
    // the LH-1 findings; making it configurable would be an additive column.
    const fifth = await workingOn('2026-08-29');
    expect(fifth.days[0].isWeeklyOff).toBe(false);
    expect(fifth.workingDays).toBe(1);

    // Turning the named switches off proves the 2nd and 4th really are policy
    // driven, and not hardcoded alongside a hidden 5th rule.
    const noSaturdays = await workingOn('2026-08-08', {
      weeklyOffById: {
        'wop-1': { id: 'wop-1', everySunday: true, secondSaturday: false, fourthSaturday: false },
      },
    });
    expect(noSaturdays.days[0].isWeeklyOff).toBe(false);
  });
});

describe('LH-1 holiday authority', () => {
  it('10. an official holiday is excluded', async () => {
    const { service } = calendarRig({
      holidaysByCalendar: {
        'cal-2026': { '2026-08-19': holidayRow('2026-08-19', 'Ganesh Chaturthi') },
      },
    });

    const r = await service.resolveForEmployee('emp-1', '2026-08-19', '2026-08-19');
    expect(r.days[0].isHoliday).toBe(true);
    expect(r.days[0].holidayName).toBe('Ganesh Chaturthi');
    expect(r.workingDays).toBe(0);
  });

  it('11. Good Friday is NOT excluded unless the configured calendar contains it', async () => {
    // The official 2026 calendar deliberately excludes Good Friday. The leave
    // module used to exclude it anyway from its own hardcoded array.
    const { service } = calendarRig({ holidaysByCalendar: { 'cal-2026': {} } });

    const r = await service.resolveForEmployee('emp-1', '2026-04-03', '2026-04-03');
    expect(r.days[0].isHoliday).toBe(false);
    expect(r.workingDays).toBe(1);

    // Configure it, and it is excluded — because the calendar says so.
    const configured = calendarRig({
      holidaysByCalendar: {
        'cal-2026': { '2026-04-03': holidayRow('2026-04-03', 'Good Friday') },
      },
    });
    const r2 = await configured.service.resolveForEmployee('emp-1', '2026-04-03', '2026-04-03');
    expect(r2.days[0].isHoliday).toBe(true);
  });

  it('12. a SPECIAL_WORKING_DAY override makes an off day count', async () => {
    const { service } = calendarRig({
      overridesByDate: {
        '2026-08-08': { id: 'ovr-1', type: 'SPECIAL_WORKING_DAY', reason: 'Release', approvedById: 'u-1', revokedAt: null },
      },
    });

    const r = await service.resolveForEmployee('emp-1', '2026-08-08', '2026-08-08');
    expect(r.days[0].overrideType).toBe('SPECIAL_WORKING_DAY');
    expect(r.days[0].isWorkingDay).toBe(true);
    expect(r.workingDays).toBe(1);
  });

  it('13. a COMPANY_CLOSURE override excludes an ordinary working day', async () => {
    const { service } = calendarRig({
      overridesByDate: {
        '2026-08-20': { id: 'ovr-2', type: 'COMPANY_CLOSURE', reason: 'Shutdown', approvedById: 'u-1', revokedAt: null },
      },
    });

    const r = await service.resolveForEmployee('emp-1', '2026-08-20', '2026-08-20');
    expect(r.days[0].overrideType).toBe('COMPANY_CLOSURE');
    expect(r.days[0].isWorkingDay).toBe(false);
    expect(r.workingDays).toBe(0);
  });
});

describe('LH-1 employee-specific calendars', () => {
  it('14. two employees on different holiday calendars get different answers', async () => {
    const fixtures: CalendarFixtures = {
      holidaysByCalendar: {
        'cal-a': { '2026-08-19': holidayRow('2026-08-19', 'Regional festival', 'cal-a') },
        'cal-b': {},
      },
    };

    const a = calendarRig({ ...fixtures, profile: { ...DEFAULT_PROFILE, assignedHolidayCalendarId: 'cal-a' } });
    const b = calendarRig({ ...fixtures, profile: { ...DEFAULT_PROFILE, assignedHolidayCalendarId: 'cal-b' } });

    const ra = await a.service.resolveForEmployee('emp-a', '2026-08-19', '2026-08-19');
    const rb = await b.service.resolveForEmployee('emp-b', '2026-08-19', '2026-08-19');

    expect(ra.workingDays).toBe(0);
    expect(rb.workingDays).toBe(1);
  });

  it('15. two employees on different weekly-off policies get different answers', async () => {
    const weeklyOffById = {
      'wop-a': { id: 'wop-a', everySunday: true, secondSaturday: true, fourthSaturday: true },
      'wop-b': { id: 'wop-b', everySunday: true, secondSaturday: false, fourthSaturday: false },
    };

    const a = calendarRig({ weeklyOffById, profile: { ...DEFAULT_PROFILE, assignedWeeklyOffPolicyId: 'wop-a' } });
    const b = calendarRig({ weeklyOffById, profile: { ...DEFAULT_PROFILE, assignedWeeklyOffPolicyId: 'wop-b' } });

    const ra = await a.service.resolveForEmployee('emp-a', '2026-08-08', '2026-08-08'); // 2nd Saturday
    const rb = await b.service.resolveForEmployee('emp-b', '2026-08-08', '2026-08-08');

    expect(ra.workingDays).toBe(0);
    expect(rb.workingDays).toBe(1);
  });

  it('16. an effective-dated profile change is honoured mid-range', async () => {
    // The employee moves from calendar A to calendar B partway through the range.
    const { service } = calendarRig({
      holidaysByCalendar: {
        'cal-a': { '2026-08-19': holidayRow('2026-08-19', 'Festival', 'cal-a') },
        'cal-b': { '2026-08-20': holidayRow('2026-08-20', 'Other festival', 'cal-b') },
      },
      profileByDate: {
        '2026-08-19': { ...DEFAULT_PROFILE, assignedHolidayCalendarId: 'cal-a' },
        '2026-08-20': { ...DEFAULT_PROFILE, assignedHolidayCalendarId: 'cal-b' },
      },
    });

    const r = await service.resolveForEmployee('emp-1', '2026-08-19', '2026-08-20');

    // Each date used the calendar in force on that date, so both are holidays.
    expect(r.days.map((d) => d.isHoliday)).toEqual([true, true]);
    expect(r.workingDays).toBe(0);
  });
});

describe('LH-1 fails safely rather than guessing', () => {
  it('17. an ambiguous weekly-off configuration refuses to answer', async () => {
    const { service } = calendarRig({
      profile: { ...DEFAULT_PROFILE, assignedWeeklyOffPolicyId: null },
      weeklyOffCandidates: [
        { id: 'wop-1', everySunday: true },
        { id: 'wop-2', everySunday: true },
      ],
    });

    const r = await service.resolveForEmployee('emp-1', '2026-08-10', '2026-08-10');
    expect(r.resolved).toBe(false);
    expect(r.blockingReasons).toContain('AMBIGUOUS_WEEKLY_OFF_POLICY');

    await expect(service.countWorkingDays('emp-1', '2026-08-10', '2026-08-10')).rejects.toBeInstanceOf(
      LeaveCalendarUnresolvedError,
    );
  });

  it('18. a missing weekly-off configuration refuses to answer', async () => {
    const { service } = calendarRig({
      profile: { ...DEFAULT_PROFILE, assignedWeeklyOffPolicyId: null },
      weeklyOffCandidates: [],
    });

    const r = await service.resolveForEmployee('emp-1', '2026-08-10', '2026-08-10');
    expect(r.resolved).toBe(false);
    expect(r.blockingReasons).toContain('MISSING_WEEKLY_OFF_POLICY');
  });

  it('19. a date with no employee profile refuses to answer', async () => {
    const { service } = calendarRig({ profile: null });

    const r = await service.resolveForEmployee('emp-1', '2026-08-10', '2026-08-10');
    expect(r.resolved).toBe(false);
    expect(r.blockingReasons).toContain('NO_PROFILE_FOR_DATE');
  });

  it('20. nothing in this layer writes anything', async () => {
    const { service, prisma } = calendarRig();
    await service.resolveForEmployee('emp-1', '2026-08-01', '2026-08-31');

    expect(prisma.workSession.update).not.toHaveBeenCalled();
    expect(prisma.workSession.updateMany).not.toHaveBeenCalled();
    expect(prisma.dailyAttendance.upsert).not.toHaveBeenCalled();
    expect(prisma.dailyAttendance.create).not.toHaveBeenCalled();
    expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(prisma.leaveRequest.updateMany).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LeaveBalanceService: flag gating, allocation authority, and the legacy fix.
// ─────────────────────────────────────────────────────────────────────────────

interface BalanceFixtures {
  v2?: boolean;
  leavePolicy?: any;
  roleName?: string;
  quotas?: Record<string, number>;
  workingDayCount?: number;
  workingDaysSetting?: string;
  leaves?: any[];
}

function balanceRig(f: BalanceFixtures = {}) {
  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', role: { name: f.roleName ?? 'EMPLOYEE' } }),
      update: jest.fn(),
    },
    employeeAttendanceProfile: {
      findFirst: jest.fn().mockResolvedValue(
        'leavePolicy' in f ? { id: 'prof-1', assignedLeavePolicy: f.leavePolicy } : null,
      ),
    },
    leaveRequest: {
      findMany: jest.fn().mockResolvedValue(f.leaves ?? []),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    dailyAttendance: { upsert: jest.fn(), update: jest.fn() },
    workSession: { update: jest.fn(), updateMany: jest.fn() },
  };

  const settings: any = {
    get: jest.fn((key: string) => {
      if (key === 'attendance_v2') return Promise.resolve({ leaveAuthorityEnabled: f.v2 === true });
      if (key === 'leave_policy')
        return Promise.resolve({ workingDays: f.workingDaysSetting ?? 'Mon–Sat' });
      return Promise.resolve(null);
    }),
    getLeaveQuotas: jest
      .fn()
      .mockResolvedValue(f.quotas ?? { EMPLOYEE: 12, TEAM_LEAD: 12, MANAGER: 15, INTERN: 6 }),
  };

  const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);
  const workingDays: any = {
    countWorkingDays: jest.fn().mockResolvedValue(f.workingDayCount ?? 1),
    // The real implementation, so legacy date arithmetic is genuinely exercised.
    enumerateBusinessDates: new LeaveWorkingDayService(tva, {} as any, {} as any)
      .enumerateBusinessDates.bind(new LeaveWorkingDayService(tva, {} as any, {} as any)),
  };

  const service = new LeaveBalanceService(prisma, settings, tva, workingDays);
  return { service, prisma, settings, workingDays, tva };
}

describe('LH-1 leave balance authority', () => {
  it('21. with the flag OFF the legacy path answers and the new authority is untouched', async () => {
    const { service, workingDays } = balanceRig({ v2: false });

    // 2026-08-03 (Mon) to 2026-08-08 (2nd Sat): legacy Mon–Sat counts six days,
    // because the legacy rule only ever excludes Sundays.
    const duration = await service.getDurationForRequest('2026-08-03', '2026-08-08', false, 'emp-1');

    expect(duration).toBe(6);
    expect(workingDays.countWorkingDays).not.toHaveBeenCalled();
  });

  it('22. with the flag ON the business calendar authority answers instead', async () => {
    const { service, workingDays } = balanceRig({ v2: true, workingDayCount: 5 });

    const duration = await service.getDurationForRequest('2026-08-03', '2026-08-08', false, 'emp-1');

    // Five, not six: the 2nd Saturday is a weekly off in the real policy.
    expect(duration).toBe(5);
    expect(workingDays.countWorkingDays).toHaveBeenCalledWith('emp-1', '2026-08-03', '2026-08-08');
  });

  it('23. the legacy holiday comparison no longer shifts a day', async () => {
    // Republic Day is in the legacy list. Before the fix the comparison string
    // was 2026-01-25, so the 26th counted as a working day and the 27th did not.
    const { service } = balanceRig({ v2: false });

    const republicDay = await service.getDurationForRequest('2026-01-26', '2026-01-26', false);
    expect(republicDay).toBe(0);

    const dayAfter = await service.getDurationForRequest('2026-01-27', '2026-01-27', false);
    expect(dayAfter).toBe(1);
  });

  it('24. weekday exclusion no longer depends on the server timezone', async () => {
    const { service } = balanceRig({ v2: false });

    // 2026-08-02 is a Sunday in company time and must be excluded regardless of
    // where the process happens to be running.
    expect(await service.getDurationForRequest('2026-08-02', '2026-08-02', false)).toBe(0);
    // 2026-08-03 is the Monday after it.
    expect(await service.getDurationForRequest('2026-08-03', '2026-08-03', false)).toBe(1);
  });

  it('25. both dash spellings of the working-day setting mean the same thing', async () => {
    // company.workingDays ships an ASCII hyphen, leave_policy.workingDays an
    // en-dash. Before normalisation only one spelling matched, so the other
    // silently counted Sundays as working days.
    const week = ['2026-08-03', '2026-08-09'] as const; // Mon through Sun

    for (const spelling of ['Mon-Sat', 'Mon–Sat', 'Mon—Sat', ' mon-sat ']) {
      const { service } = balanceRig({ v2: false, workingDaysSetting: spelling });
      // Six working days: the Sunday is excluded whichever dash was stored.
      expect(await service.getDurationForRequest(week[0], week[1], false)).toBe(6);
    }

    for (const spelling of ['Mon-Fri', 'Mon–Fri']) {
      const { service } = balanceRig({ v2: false, workingDaysSetting: spelling });
      // Five: Saturday and Sunday both excluded.
      expect(await service.getDurationForRequest(week[0], week[1], false)).toBe(5);
    }
  });

  it('26. an unrecognised working-day setting still excludes nothing, as before', async () => {
    // Normalisation must not invent a schedule it was never given: an unknown
    // value keeps the pre-existing 'count every day' behaviour rather than
    // quietly defaulting to Mon-Sat.
    const { service } = balanceRig({ v2: false, workingDaysSetting: 'Everyday' });
    expect(await service.getDurationForRequest('2026-08-03', '2026-08-09', false)).toBe(7);
  });

  it('25. a half day is still half a day on both paths', async () => {
    for (const v2 of [false, true]) {
      const { service } = balanceRig({ v2 });
      expect(await service.getDurationForRequest('2026-08-03', '2026-08-03', true, 'emp-1')).toBe(0.5);
    }
  });

  it('26. with the flag ON the allocation comes from the versioned LeavePolicy', async () => {
    const { service, settings } = balanceRig({
      v2: true,
      leavePolicy: { id: 'lp-1', totalPaidLeaves: 14 },
    });

    expect(await service.getYearlyAllocation('emp-1', 2026)).toBe(14);
    // The role quota table was not consulted at all.
    expect(settings.getLeaveQuotas).not.toHaveBeenCalled();
  });

  it('27. with the flag OFF the allocation still comes from the role quota table', async () => {
    const { service, settings } = balanceRig({
      v2: false,
      leavePolicy: { id: 'lp-1', totalPaidLeaves: 14 },
      roleName: 'EMPLOYEE',
    });

    expect(await service.getYearlyAllocation('emp-1', 2026)).toBe(12);
    expect(settings.getLeaveQuotas).toHaveBeenCalled();
  });

  it('28. with the flag ON but no policy assigned, it falls back rather than inventing a number', async () => {
    const { service, settings } = balanceRig({ v2: true, roleName: 'MANAGER' });

    // No effective LeavePolicy: the legacy quota answers, and the gap is
    // visible in the LH-1 duplicate-authority report rather than silently zero.
    expect(await service.getYearlyAllocation('emp-1', 2026)).toBe(15);
    expect(settings.getLeaveQuotas).toHaveBeenCalled();
  });

  it('29. computing a balance never mutates anything', async () => {
    const { service, prisma } = balanceRig({
      v2: true,
      leavePolicy: { id: 'lp-1', totalPaidLeaves: 14 },
      workingDayCount: 1,
      leaves: [
        {
          id: 'lv-1',
          status: 'APPROVED',
          startDate: new Date('2026-08-03T00:00:00.000Z'),
          endDate: new Date('2026-08-03T00:00:00.000Z'),
          isHalfDay: false,
        },
      ],
    });

    const balance = await service.getLeaveBalance('emp-1', 2026);

    expect(balance.allocation).toBe(14);
    expect(balance.approved).toBe(1);
    expect(balance.balance).toBe(13);
    expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(prisma.leaveRequest.updateMany).not.toHaveBeenCalled();
    expect(prisma.dailyAttendance.upsert).not.toHaveBeenCalled();
    expect(prisma.workSession.update).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('LH-1 locked contract: GET attendance never persists', () => {
  it('30. neither attendance read route can reach the persisting evaluator', async () => {
    const evaluator: any = {
      evaluate: jest.fn().mockResolvedValue({
        businessDate: '2026-08-20',
        official: true,
        status: 'PRESENT',
        evaluationState: 'CALCULATED',
        calculationReason: 'COMPLETE_WORKDAY',
        exceptionFlags: [],
        requiresReview: false,
        punchInAt: null,
        punchOutAt: null,
        workedMinutes: 0,
        breakMinutes: 0,
        lateMinutes: 0,
        leaveDeducted: 0,
        lwpDeducted: 0,
      }),
      evaluateAndPersist: jest.fn(),
    };
    const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);
    const controller = new DailyAttendanceController(evaluator, tva);

    await controller.today({ id: 'emp-1' });
    await controller.range({ id: 'emp-1' }, '2026-08-01', '2026-08-03');

    expect(evaluator.evaluate).toHaveBeenCalled();
    // The official DailyAttendance record is only ever written by an explicit
    // finalization path, never as a side effect of somebody opening a page.
    expect(evaluator.evaluateAndPersist).not.toHaveBeenCalled();
  });
});
