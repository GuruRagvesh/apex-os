import { BusinessCalendarService } from '../../src/modules/platform/attendance/calendar/business-calendar.service';
import { TVAService } from '../../src/common/services/tva.service';
import { ConfigService } from '@nestjs/config';

// Real TVAService (company-time contract from BL-1), mocked Prisma. No database.
//
// August 2026 is the workhorse month here: it has exactly five Saturdays
// (1, 8, 15, 22, 29), so every Saturday ordinal 1-5 is a real date rather than
// a contrived one.

const DEFAULT_WEEKLY_OFF = {
  id: 'wop-1',
  everySunday: true,
  secondSaturday: true,
  fourthSaturday: true,
};

interface Fixtures {
  weeklyOff?: any;
  holiday?: any;
  override?: any;
}

function build(fixtures: Fixtures = {}) {
  const prisma = {
    weeklyOffPolicy: {
      findFirst: jest.fn().mockResolvedValue(
        'weeklyOff' in fixtures ? fixtures.weeklyOff : DEFAULT_WEEKLY_OFF,
      ),
    },
    holiday: { findFirst: jest.fn().mockResolvedValue(fixtures.holiday ?? null) },
    businessDayOverride: { findFirst: jest.fn().mockResolvedValue(fixtures.override ?? null) },
    // Present so the tests can prove these are never touched by this layer.
    workSession: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    breakLog: { findFirst: jest.fn(), update: jest.fn() },
    leaveRequest: { findFirst: jest.fn(), findMany: jest.fn() },
    dailyAttendance: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), upsert: jest.fn() },
  };
  const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);
  const service = new BusinessCalendarService(prisma as any, tva);
  return { service, prisma, tva };
}

const holidayOn = (date: string, name: string, isOptional = false) => ({
  id: `hol-${date}`,
  calendarId: 'cal-2026',
  date: new Date(`${date}T00:00:00.000Z`),
  name,
  isOptional,
  calendar: { id: 'cal-2026' },
});

const overrideOn = (type: string, reason: string) => ({
  id: 'ovr-1',
  type,
  reason,
  approvedById: 'user-admin',
  revokedAt: null,
});

describe('BusinessCalendarService (BL-2A)', () => {
  describe('weekday ordinal algorithm', () => {
    it('derives the ordinal arithmetically, never from hardcoded dates', () => {
      expect(BusinessCalendarService.weekdayOrdinal(1)).toBe(1);
      expect(BusinessCalendarService.weekdayOrdinal(7)).toBe(1);
      expect(BusinessCalendarService.weekdayOrdinal(8)).toBe(2);
      expect(BusinessCalendarService.weekdayOrdinal(14)).toBe(2);
      expect(BusinessCalendarService.weekdayOrdinal(15)).toBe(3);
      expect(BusinessCalendarService.weekdayOrdinal(22)).toBe(4);
      expect(BusinessCalendarService.weekdayOrdinal(28)).toBe(4);
      expect(BusinessCalendarService.weekdayOrdinal(29)).toBe(5);
      expect(BusinessCalendarService.weekdayOrdinal(31)).toBe(5);
    });
  });

  describe('1. normal working day', () => {
    it('a plain Monday is a working day with no facts attached', async () => {
      const { service } = build();
      const day = await service.resolveBusinessDay('2026-08-17');
      expect(day.dayOfWeek).toBe(1);
      expect(day.weeklyOff.isWeeklyOff).toBe(false);
      expect(day.weeklyOff.reasons).toEqual([]);
      expect(day.holiday.isHoliday).toBe(false);
      expect(day.override).toBeNull();
      expect(day.expectedCompanyWorkingDay).toBe(true);
    });
  });

  describe('2-7. weekly off rules across every Saturday ordinal', () => {
    it('Sunday is a weekly off', async () => {
      const { service } = build();
      const day = await service.resolveBusinessDay('2026-08-16');
      expect(day.dayOfWeek).toBe(0);
      expect(day.weeklyOff.reasons).toEqual(['SUNDAY']);
      expect(day.expectedCompanyWorkingDay).toBe(false);
    });

    it('first Saturday is a WORKING day', async () => {
      const { service } = build();
      const day = await service.resolveBusinessDay('2026-08-01');
      expect(day.weekdayOrdinal).toBe(1);
      expect(day.weeklyOff.isWeeklyOff).toBe(false);
      expect(day.expectedCompanyWorkingDay).toBe(true);
    });

    it('second Saturday is a weekly off', async () => {
      const { service } = build();
      const day = await service.resolveBusinessDay('2026-08-08');
      expect(day.weekdayOrdinal).toBe(2);
      expect(day.weeklyOff.reasons).toEqual(['SECOND_SATURDAY']);
      expect(day.expectedCompanyWorkingDay).toBe(false);
    });

    it('third Saturday is a WORKING day', async () => {
      const { service } = build();
      const day = await service.resolveBusinessDay('2026-08-15');
      expect(day.weekdayOrdinal).toBe(3);
      expect(day.weeklyOff.isWeeklyOff).toBe(false);
    });

    it('fourth Saturday is a weekly off', async () => {
      const { service } = build();
      const day = await service.resolveBusinessDay('2026-08-22');
      expect(day.weekdayOrdinal).toBe(4);
      expect(day.weeklyOff.reasons).toEqual(['FOURTH_SATURDAY']);
      expect(day.expectedCompanyWorkingDay).toBe(false);
    });

    it('fifth Saturday is a WORKING day, not a fourth', async () => {
      const { service } = build();
      const day = await service.resolveBusinessDay('2026-08-29');
      expect(day.weekdayOrdinal).toBe(5);
      expect(day.weeklyOff.isWeeklyOff).toBe(false);
      expect(day.expectedCompanyWorkingDay).toBe(true);
    });

    it('honours a policy that disables the Saturday rules', async () => {
      const { service } = build({
        weeklyOff: { id: 'wop-2', everySunday: true, secondSaturday: false, fourthSaturday: false },
      });
      expect((await service.resolveBusinessDay('2026-08-08')).weeklyOff.isWeeklyOff).toBe(false);
      expect((await service.resolveBusinessDay('2026-08-22')).weeklyOff.isWeeklyOff).toBe(false);
      expect((await service.resolveBusinessDay('2026-08-16')).weeklyOff.reasons).toEqual(['SUNDAY']);
    });

    it('treats a missing weekly-off policy as no weekly offs, not a crash', async () => {
      const { service } = build({ weeklyOff: null });
      const day = await service.resolveBusinessDay('2026-08-16');
      expect(day.weeklyOff.isWeeklyOff).toBe(false);
      expect(day.weeklyOff.policyId).toBeNull();
      expect(day.expectedCompanyWorkingDay).toBe(true);
    });
  });

  describe('8-11. holidays', () => {
    it('a company holiday on a weekday is not a working day', async () => {
      const { service } = build({ holiday: holidayOn('2026-01-26', 'Republic Day') });
      const day = await service.resolveBusinessDay('2026-01-26');
      expect(day.holiday.isHoliday).toBe(true);
      expect(day.holiday.name).toBe('Republic Day');
      expect(day.expectedCompanyWorkingDay).toBe(false);
    });

    it('Diwali on Sunday 8 Nov 2026 keeps BOTH facts', async () => {
      const { service } = build({ holiday: holidayOn('2026-11-08', 'Diwali/Deepavali') });
      const day = await service.resolveBusinessDay('2026-11-08');
      expect(day.dayOfWeek).toBe(0);
      expect(day.weeklyOff.isWeeklyOff).toBe(true);
      expect(day.weeklyOff.reasons).toEqual(['SUNDAY']);
      expect(day.holiday.isHoliday).toBe(true);
      expect(day.holiday.name).toBe('Diwali/Deepavali');
      expect(day.expectedCompanyWorkingDay).toBe(false);
    });

    it('a holiday never erases the weekly-off fact', async () => {
      const { service } = build({ holiday: holidayOn('2026-02-15', 'Maha Shivaratri') });
      const day = await service.resolveBusinessDay('2026-02-15');
      expect(day.holiday.isHoliday).toBe(true);
      expect(day.weeklyOff.isWeeklyOff).toBe(true);
      expect(day.weeklyOff.reasons).toContain('SUNDAY');
    });

    it('an optional holiday is reported as a fact but does not cancel the working day', async () => {
      const { service } = build({ holiday: holidayOn('2026-08-17', 'Optional Festival', true) });
      const day = await service.resolveBusinessDay('2026-08-17');
      expect(day.holiday.isHoliday).toBe(true);
      expect(day.holiday.optional).toBe(true);
      expect(day.expectedCompanyWorkingDay).toBe(true);
    });

    it('a holiday on the third Saturday cancels an otherwise working Saturday', async () => {
      const { service } = build({ holiday: holidayOn('2026-08-15', 'Independence Day') });
      const day = await service.resolveBusinessDay('2026-08-15');
      expect(day.weekdayOrdinal).toBe(3);
      expect(day.weeklyOff.isWeeklyOff).toBe(false);
      expect(day.holiday.isHoliday).toBe(true);
      expect(day.expectedCompanyWorkingDay).toBe(false);
    });
  });

  describe('12-15. overrides', () => {
    it('SPECIAL_WORKING_DAY overrides a Sunday expectation without erasing it', async () => {
      const { service } = build({
        override: overrideOn('SPECIAL_WORKING_DAY', 'Year-end delivery push'),
      });
      const day = await service.resolveBusinessDay('2026-08-16');
      expect(day.weeklyOff.isWeeklyOff).toBe(true);
      expect(day.weeklyOff.reasons).toEqual(['SUNDAY']);
      expect(day.override?.type).toBe('SPECIAL_WORKING_DAY');
      expect(day.expectedCompanyWorkingDay).toBe(true);
    });

    it('SPECIAL_WORKING_DAY overrides second and fourth Saturday expectations', async () => {
      const { service } = build({ override: overrideOn('SPECIAL_WORKING_DAY', 'Audit weekend') });
      for (const date of ['2026-08-08', '2026-08-22']) {
        const day = await service.resolveBusinessDay(date);
        expect(day.weeklyOff.isWeeklyOff).toBe(true);
        expect(day.expectedCompanyWorkingDay).toBe(true);
      }
    });

    it('COMPANY_CLOSURE overrides a normal working day', async () => {
      const { service } = build({ override: overrideOn('COMPANY_CLOSURE', 'Municipal strike') });
      const day = await service.resolveBusinessDay('2026-08-17');
      expect(day.weeklyOff.isWeeklyOff).toBe(false);
      expect(day.holiday.isHoliday).toBe(false);
      expect(day.override?.type).toBe('COMPANY_CLOSURE');
      expect(day.override?.reason).toBe('Municipal strike');
      expect(day.expectedCompanyWorkingDay).toBe(false);
    });

    it('an override leaves every underlying fact intact, including a holiday', async () => {
      const { service } = build({
        holiday: holidayOn('2026-11-08', 'Diwali/Deepavali'),
        override: overrideOn('SPECIAL_WORKING_DAY', 'Critical release'),
      });
      const day = await service.resolveBusinessDay('2026-11-08');
      expect(day.holiday.isHoliday).toBe(true);
      expect(day.holiday.name).toBe('Diwali/Deepavali');
      expect(day.weeklyOff.isWeeklyOff).toBe(true);
      expect(day.expectedCompanyWorkingDay).toBe(true);
    });

    it('only unrevoked overrides are considered', async () => {
      const { service, prisma } = build();
      await service.resolveBusinessDay('2026-08-17');
      expect(prisma.businessDayOverride.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ revokedAt: null }) }),
      );
    });
  });

  describe('16. duplicate holiday protection', () => {
    it('relies on the DB unique constraint, and reads a single holiday per date', async () => {
      const { service, prisma } = build({ holiday: holidayOn('2026-01-01', "New Year's Day") });
      await service.resolveBusinessDay('2026-01-01');
      // findFirst against ([calendarId, date]) unique — the service never
      // attempts to reconcile two holidays for one date because the schema
      // makes that state unreachable.
      expect(prisma.holiday.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('17. business date comes from the TVA contract', () => {
    it('converts an instant through company time, not server time', async () => {
      const { service } = build();
      // 2026-08-20T19:15:00Z is 2026-08-21 00:45 IST.
      const day = await service.resolveBusinessDay(new Date('2026-08-20T19:15:00.000Z'));
      expect(day.businessDate).toBe('2026-08-21');
    });

    it('accepts an explicit business-date string unchanged', async () => {
      const { service } = build();
      expect((await service.resolveBusinessDay('2026-08-17')).businessDate).toBe('2026-08-17');
    });

    it('queries the calendar with the UTC-midnight date encoding', async () => {
      const { service, prisma, tva } = build();
      await service.resolveBusinessDay('2026-08-17');
      const expected = tva.companyDateOnly(new Date('2026-08-17T06:00:00.000Z'));
      expect(prisma.holiday.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ date: expected }) }),
      );
    });

    it('rejects an unparseable business date', async () => {
      const { service } = build();
      await expect(service.resolveBusinessDay('not-a-date')).rejects.toThrow(/Invalid business date/);
    });
  });

  describe('18. determinism', () => {
    it('repeated resolution of the same date returns identical facts', async () => {
      const { service } = build({ holiday: holidayOn('2026-11-08', 'Diwali/Deepavali') });
      const a = await service.resolveBusinessDay('2026-11-08');
      const b = await service.resolveBusinessDay('2026-11-08');
      expect(a).toEqual(b);
    });

    it('reports every source id used to reach the answer', async () => {
      const { service } = build({
        holiday: holidayOn('2026-11-08', 'Diwali/Deepavali'),
        override: overrideOn('SPECIAL_WORKING_DAY', 'Critical release'),
      });
      const day = await service.resolveBusinessDay('2026-11-08');
      expect(day.sources).toEqual({
        weeklyOffPolicyId: 'wop-1',
        holidayCalendarId: 'cal-2026',
        holidayId: 'hol-2026-11-08',
        overrideId: 'ovr-1',
      });
    });
  });

  describe('19-21. layer boundaries', () => {
    it('never reads WorkSession or BreakLog', async () => {
      const { service, prisma } = build({ holiday: holidayOn('2026-11-08', 'Diwali') });
      await service.resolveBusinessDay('2026-11-08');
      expect(prisma.workSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.workSession.findMany).not.toHaveBeenCalled();
      expect(prisma.workSession.update).not.toHaveBeenCalled();
      expect(prisma.breakLog.findFirst).not.toHaveBeenCalled();
      expect(prisma.breakLog.update).not.toHaveBeenCalled();
    });

    it('never reads Leave', async () => {
      const { service, prisma } = build();
      await service.resolveBusinessDay('2026-08-17');
      expect(prisma.leaveRequest.findFirst).not.toHaveBeenCalled();
      expect(prisma.leaveRequest.findMany).not.toHaveBeenCalled();
    });

    it('never touches DailyAttendance, read or write', async () => {
      const { service, prisma } = build({ override: overrideOn('COMPANY_CLOSURE', 'Strike') });
      await service.resolveBusinessDay('2026-08-17');
      expect(prisma.dailyAttendance.findFirst).not.toHaveBeenCalled();
      expect(prisma.dailyAttendance.create).not.toHaveBeenCalled();
      expect(prisma.dailyAttendance.update).not.toHaveBeenCalled();
      expect(prisma.dailyAttendance.upsert).not.toHaveBeenCalled();
    });

    it('performs no writes at all — the calendar layer is read-only', async () => {
      const { service, prisma } = build();
      await service.resolveBusinessDay('2026-08-17');
      const writes = ['create', 'update', 'upsert', 'delete', 'deleteMany', 'updateMany'];
      for (const [, delegate] of Object.entries(prisma)) {
        for (const op of writes) {
          const fn = (delegate as any)[op];
          if (typeof fn === 'function' && fn.mock) expect(fn).not.toHaveBeenCalled();
        }
      }
    });
  });
});
