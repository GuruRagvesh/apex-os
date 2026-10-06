import { DailyContextService } from '../../src/modules/platform/attendance/context/daily-context.service';
import { DAILY_CONTEXT_RESOLVER_VERSION } from '../../src/modules/platform/attendance/context/daily-context.types';
import { BusinessCalendarService } from '../../src/modules/platform/attendance/calendar/business-calendar.service';
import { EmployeeTimelineService } from '../../src/modules/platform/attendance/timeline/employee-timeline.service';
import { PolicyVersionService } from '../../src/modules/platform/attendance/policy/policy-version.service';
import { TVAService } from '../../src/common/services/tva.service';
import { ConfigService } from '@nestjs/config';

// Real TVAService, real BL-2A/BL-3/BL-4 services, mocked Prisma. No database.
//
// BL-5 is the integrity gate: if the foundation cannot say exactly which rules
// applied to a person on a date, the day must not be finalizable.

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const WEEKLY_OFF = { id: 'wop-1', everySunday: true, secondSaturday: true, fourthSaturday: true };

const PROFILE = {
  id: 'prof-1',
  userId: 'emp-1',
  category: 'REGULAR_EMPLOYEE',
  attendanceRequired: true,
  assignedShiftId: 'shift-1',
  assignedLeavePolicyId: 'lp-1',
  assignedHolidayCalendarId: 'cal-1',
  assignedWeeklyOffPolicyId: 'wop-1',
  reportingManagerId: 'mgr-1',
  hrReviewerId: 'hr-1',
  effectiveFrom: d('2026-04-01'),
  effectiveTo: null,
};

const SHIFT = {
  id: 'shift-1',
  policyKey: 'shift:regular-employee',
  version: 2,
  name: 'Regular Employee',
  category: 'REGULAR_EMPLOYEE',
  startTime: '09:30',
  endTime: '18:30',
  graceMinutes: 10,
  minimumWorkingMinutes: 540,
  attendancePolicyId: 'ap-1',
};

const ATTENDANCE_POLICY = {
  id: 'ap-1',
  policyKey: 'attendance:default',
  version: 3,
  minimumWorkingMinutes: 540,
  lateExemptionEnabled: true,
  regularizationEnabled: true,
  afterPunchWindowAction: 'REQUIRE_REVIEW',
  insufficientHoursAction: 'REQUIRE_REVIEW',
  automaticHalfDayEnabled: false,
};

const LEAVE_POLICY = { id: 'lp-1', policyKey: 'leave:default', version: 1 };

interface Opts {
  user?: any;
  weeklyOffById?: Record<string, any>;
  holidayByCalendar?: Record<string, any>;
  calendars?: Record<string, any>;
  effectiveCalendar?: any;
  calendarCandidates?: any[];
  weeklyOffCandidates?: any[];
  profile?: any;
  holiday?: any;
  override?: any;
  weeklyOff?: any;
  shift?: any;
  attendancePolicy?: any;
  leavePolicy?: any;
}

function build(opts: Opts = {}) {
  const user =
    'user' in opts ? opts.user : { id: 'emp-1', joiningDate: d('2025-11-10'), lastWorkingDate: null };

  const prisma: any = {
    weeklyOffPolicy: {
      // Honours an id filter so two employees can sit on different policies.
      findFirst: jest.fn((args: any) => {
        const id = args?.where?.id;
        if (id) {
          const byId = opts.weeklyOffById ?? { 'wop-1': WEEKLY_OFF };
          return Promise.resolve(byId[id] ?? null);
        }
        return Promise.resolve('weeklyOff' in opts ? opts.weeklyOff : WEEKLY_OFF);
      }),
      // Strict candidate counting. Default: exactly one company policy.
      findMany: jest.fn(() =>
        Promise.resolve(
          opts.weeklyOffCandidates ?? ['weeklyOff' in opts ? opts.weeklyOff : WEEKLY_OFF].filter(Boolean),
        ),
      ),
    },
    holiday: {
      // Honours a calendarId filter so two employees can sit on different
      // holiday calendars for the same date.
      findFirst: jest.fn((args: any) => {
        const calId = args?.where?.calendarId;
        if (calId && opts.holidayByCalendar) {
          return Promise.resolve(opts.holidayByCalendar[calId] ?? null);
        }
        return Promise.resolve(opts.holiday ?? null);
      }),
    },
    businessDayOverride: { findFirst: jest.fn().mockResolvedValue(opts.override ?? null) },
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    employeeAttendanceProfile: {
      findFirst: jest.fn().mockResolvedValue('profile' in opts ? opts.profile : PROFILE),
    },
    shiftPolicy: {
      findFirst: jest.fn().mockResolvedValue('shift' in opts ? opts.shift : SHIFT),
    },
    attendancePolicy: {
      findFirst: jest
        .fn()
        .mockResolvedValue('attendancePolicy' in opts ? opts.attendancePolicy : ATTENDANCE_POLICY),
    },
    leavePolicy: {
      findFirst: jest.fn().mockResolvedValue('leavePolicy' in opts ? opts.leavePolicy : LEAVE_POLICY),
    },
    holidayCalendar: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(
          (opts.calendars ?? { 'cal-1': { id: 'cal-1', policyKey: 'calendar:default' } })[where.id] ??
            null,
        ),
      ),
      findFirst: jest.fn(() =>
        Promise.resolve('effectiveCalendar' in opts ? opts.effectiveCalendar : { id: 'cal-1' }),
      ),
      // Strict candidate counting. Default: exactly one company calendar.
      findMany: jest.fn(() =>
        Promise.resolve(
          opts.calendarCandidates ?? [{ id: 'cal-default' }],
        ),
      ),
    },
    // Present so tests can prove BL-5 never touches them.
    workSession: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn() },
    breakLog: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    leaveRequest: { findFirst: jest.fn(), findMany: jest.fn() },
    dailyAttendance: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), upsert: jest.fn() },
    attendanceEvent: { findMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);
  const service = new DailyContextService(
    prisma,
    tva,
    new BusinessCalendarService(prisma, tva),
    new EmployeeTimelineService(prisma, tva),
    new PolicyVersionService(prisma, tva),
  );
  return { service, prisma };
}

describe('DailyContextService (BL-5)', () => {
  describe('a fully configured working day', () => {
    it('is finalizable with every layer resolved', async () => {
      const { service } = build();
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');

      expect(c.employeeId).toBe('emp-1');
      expect(c.businessDate).toBe('2026-08-17');
      expect(c.employment.employedOnDate).toBe(true);
      expect(c.coverage).toBe('COVERED');
      expect(c.calendar.expectedCompanyWorkingDay).toBe(true);
      expect(c.profile?.profileId).toBe('prof-1');
      expect(c.shift?.policyKey).toBe('shift:regular-employee');
      expect(c.attendancePolicy?.policyKey).toBe('attendance:default');
      expect(c.leavePolicy?.policyKey).toBe('leave:default');
      expect(c.contextResolved).toBe(true);
      expect(c.requiresHrReview).toBe(false);
      expect(c.blockingReasons).toEqual([]);
    });

    it('carries the shift timing values the later engine will need', async () => {
      const { service } = build();
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.shift).toMatchObject({
        startTime: '09:30',
        endTime: '18:30',
        graceMinutes: 10,
        minimumWorkingMinutes: 540,
      });
    });

    it('carries the configurable management actions from the policy version', async () => {
      const { service } = build();
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.attendancePolicy?.afterPunchWindowAction).toBe('REQUIRE_REVIEW');
      expect(c.attendancePolicy?.insufficientHoursAction).toBe('REQUIRE_REVIEW');
      expect(c.attendancePolicy?.automaticHalfDayEnabled).toBe(false);
    });

    it('records every source id and version used', async () => {
      const { service } = build({ holiday: null });
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.sources).toEqual({
        assignedHolidayCalendarId: 'cal-1',
        assignedWeeklyOffPolicyId: 'wop-1',
        assignedAttendanceLocationId: null,
        resolvedHolidayCalendarId: 'cal-1',
        resolvedWeeklyOffPolicyId: 'wop-1',
        holidayCalendarResolution: 'ASSIGNED',
        weeklyOffPolicyResolution: 'ASSIGNED',
        weeklyOffPolicyId: 'wop-1',
        holidayCalendarId: 'cal-1',
        holidayId: null,
        businessDayOverrideId: null,
        employeeProfileId: 'prof-1',
        shiftPolicyId: 'shift-1',
        shiftPolicyVersion: 2,
        attendancePolicyId: 'ap-1',
        attendancePolicyVersion: 3,
        leavePolicyId: 'lp-1',
        leavePolicyVersion: 1,
      });
    });

    it('stamps the resolver version and resolution instant', async () => {
      const { service } = build();
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.resolverVersion).toBe(DAILY_CONTEXT_RESOLVER_VERSION);
      expect(c.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('the integrity gate — configuration gaps block finalization', () => {
    it('UNRESOLVED coverage blocks, and never yields an attendance status', async () => {
      const { service } = build({ profile: null });
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.coverage).toBe('UNRESOLVED');
      expect(c.coverageReason).toBe('NO_PROFILE_FOR_DATE');
      expect(c.contextResolved).toBe(false);
      expect(c.requiresHrReview).toBe(true);
      expect(c.blockingReasons).toEqual(['NO_PROFILE_FOR_DATE']);
      expect(c).not.toHaveProperty('status');
    });

    it('a COVERED employee with no shift ASSIGNED is blocked, not defaulted', async () => {
      const { service } = build({ profile: { ...PROFILE, assignedShiftId: null } });
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.coverage).toBe('COVERED');
      expect(c.shift).toBeNull();
      expect(c.blockingReasons).toEqual(['MISSING_SHIFT_ASSIGNMENT']);
      expect(c.contextResolved).toBe(false);
      expect(c.requiresHrReview).toBe(true);
    });

    it('a shift assigned but with no version governing the date is blocked', async () => {
      const { service } = build({ shift: null });
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.shift).toBeNull();
      expect(c.blockingReasons).toEqual(['MISSING_SHIFT_POLICY']);
      expect(c.contextResolved).toBe(false);
    });

    it('a resolvable shift with no attendance policy is blocked', async () => {
      const { service } = build({ attendancePolicy: null });
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.shift).not.toBeNull();
      expect(c.attendancePolicy).toBeNull();
      expect(c.blockingReasons).toEqual(['MISSING_ATTENDANCE_POLICY']);
      expect(c.contextResolved).toBe(false);
    });

    it('never guesses a default shift or policy when one is missing', async () => {
      const { service } = build({ shift: null });
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.shift).toBeNull();
      expect(c.attendancePolicy).toBeNull();
      expect(c.sources.shiftPolicyId).toBeNull();
      expect(c.sources.attendancePolicyId).toBeNull();
    });

    it('a missing leave policy does NOT block — it is reference only', async () => {
      const { service } = build({ leavePolicy: null });
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.leavePolicy).toBeNull();
      expect(c.blockingReasons).toEqual([]);
      expect(c.contextResolved).toBe(true);
    });
  });

  describe('complete answers finalize cleanly', () => {
    it('NOT_EMPLOYED is finalizable — there is nothing to attend', async () => {
      const { service } = build({
        user: { id: 'emp-1', joiningDate: d('2026-04-01'), lastWorkingDate: d('2026-06-30') },
      });
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.coverage).toBe('NOT_EMPLOYED');
      expect(c.contextResolved).toBe(true);
      expect(c.requiresHrReview).toBe(false);
      expect(c.blockingReasons).toEqual([]);
    });

    it('EXEMPT is finalizable and demands no shift', async () => {
      const { service } = build({
        profile: { ...PROFILE, category: 'MANAGEMENT_EXEMPT', assignedShiftId: null },
      });
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.coverage).toBe('EXEMPT');
      expect(c.shift).toBeNull();
      expect(c.blockingReasons).toEqual([]);
      expect(c.contextResolved).toBe(true);
    });

    it('an exempt employee is not blocked by missing policies', async () => {
      const { service } = build({
        profile: { ...PROFILE, attendanceRequired: false },
        shift: null,
        attendancePolicy: null,
      });
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.coverage).toBe('EXEMPT');
      expect(c.contextResolved).toBe(true);
    });
  });

  describe('calendar facts flow through unreduced', () => {
    it('Diwali on Sunday keeps both facts alongside a covered employee', async () => {
      const { service } = build({
        holiday: {
          id: 'hol-1',
          calendarId: 'cal-2026',
          date: d('2026-11-08'),
          name: 'Diwali/Deepavali',
          isOptional: false,
          calendar: { id: 'cal-2026' },
        },
      });
      const c = await service.resolveDailyContext('emp-1', '2026-11-08');
      expect(c.calendar.weeklyOff.isWeeklyOff).toBe(true);
      expect(c.calendar.weeklyOff.reasons).toEqual(['SUNDAY']);
      expect(c.calendar.holiday.name).toBe('Diwali/Deepavali');
      expect(c.calendar.expectedCompanyWorkingDay).toBe(false);
      // A non-working company day is still fully explained, so still finalizable.
      expect(c.contextResolved).toBe(true);
      expect(c.sources.holidayId).toBe('hol-1');
    });

    it('a special working day flips the expectation and is recorded as a source', async () => {
      const { service } = build({
        override: {
          id: 'ovr-1',
          type: 'SPECIAL_WORKING_DAY',
          reason: 'Critical release',
          approvedById: 'admin-1',
          revokedAt: null,
        },
      });
      const c = await service.resolveDailyContext('emp-1', '2026-08-16');
      expect(c.calendar.weeklyOff.isWeeklyOff).toBe(true);
      expect(c.calendar.expectedCompanyWorkingDay).toBe(true);
      expect(c.sources.businessDayOverrideId).toBe('ovr-1');
    });

    it('a second Saturday resolves as a weekly off', async () => {
      const { service } = build();
      const c = await service.resolveDailyContext('emp-1', '2026-08-08');
      expect(c.calendar.weeklyOff.reasons).toEqual(['SECOND_SATURDAY']);
      expect(c.calendar.expectedCompanyWorkingDay).toBe(false);
    });
  });

  describe('company time', () => {
    it('converts an instant through company time', async () => {
      const { service } = build();
      // 2026-08-20T19:15:00Z is 2026-08-21 00:45 IST.
      const c = await service.resolveDailyContext('emp-1', new Date('2026-08-20T19:15:00.000Z'));
      expect(c.businessDate).toBe('2026-08-21');
      expect(c.calendar.businessDate).toBe('2026-08-21');
    });

    it('the calendar and the timeline always agree on the business date', async () => {
      const { service } = build();
      const c = await service.resolveDailyContext('emp-1', new Date('2026-08-20T19:15:00.000Z'));
      expect(c.calendar.businessDate).toBe(c.businessDate);
    });

    it('resolves policies as of the business date, not today', async () => {
      const { service, prisma } = build();
      await service.resolveDailyContext('emp-1', '2026-06-15');
      const where = prisma.shiftPolicy.findFirst.mock.calls[0][0].where;
      expect(where.effectiveFrom.lte.toISOString()).toBe('2026-06-15T18:29:59.999Z');
      expect(where.status).toEqual({ in: ['ACTIVE', 'SUPERSEDED'] });
    });
  });

  describe('determinism', () => {
    it('repeated resolution returns identical facts apart from resolvedAt', async () => {
      const { service } = build();
      const a = await service.resolveDailyContext('emp-1', '2026-08-17');
      const b = await service.resolveDailyContext('emp-1', '2026-08-17');
      const { resolvedAt: _a, ...restA } = a;
      const { resolvedAt: _b, ...restB } = b;
      expect(restA).toEqual(restB);
    });
  });

  describe('layer boundaries — BL-5 is read-only and evidence-free', () => {
    it('never reads WorkSession, BreakLog, AttendanceEvent or LeaveRequest', async () => {
      const { service, prisma } = build();
      await service.resolveDailyContext('emp-1', '2026-08-17');
      for (const delegate of ['workSession', 'breakLog', 'leaveRequest', 'attendanceEvent'] as const) {
        for (const fn of Object.values(prisma[delegate])) {
          expect(fn).not.toHaveBeenCalled();
        }
      }
    });

    it('never touches DailyAttendance, read or write', async () => {
      const { service, prisma } = build();
      await service.resolveDailyContext('emp-1', '2026-08-17');
      for (const fn of Object.values(prisma.dailyAttendance)) {
        expect(fn).not.toHaveBeenCalled();
      }
    });

    it('performs no writes of any kind', async () => {
      const { service, prisma } = build();
      await service.resolveDailyContext('emp-1', '2026-08-17');
      const writes = ['create', 'update', 'upsert', 'delete', 'deleteMany', 'updateMany', 'createMany'];
      for (const [, delegate] of Object.entries(prisma)) {
        if (!delegate || typeof delegate !== 'object') continue;
        for (const op of writes) {
          const fn = (delegate as any)[op];
          if (typeof fn === 'function' && fn.mock) expect(fn).not.toHaveBeenCalled();
        }
      }
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('produces no attendance status field of any kind', async () => {
      const { service } = build();
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      for (const forbidden of ['status', 'attendanceStatus', 'present', 'absent', 'halfDay', 'lwp']) {
        expect(c).not.toHaveProperty(forbidden);
      }
    });
  });

  describe('contextResolved and attendanceApplicability are separate questions', () => {
    it('COVERED + complete configuration => resolved / REQUIRED / no review', async () => {
      const { service } = build();
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.contextResolved).toBe(true);
      expect(c.attendanceApplicability).toBe('REQUIRED');
      expect(c.requiresHrReview).toBe(false);
      expect(c.blockingReasons).toEqual([]);
    });

    it('EXEMPT => resolved / EXEMPT / no review', async () => {
      const { service } = build({
        profile: { ...PROFILE, category: 'MANAGEMENT_EXEMPT', assignedShiftId: null },
      });
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.contextResolved).toBe(true);
      expect(c.attendanceApplicability).toBe('EXEMPT');
      expect(c.requiresHrReview).toBe(false);
    });

    it('NOT_EMPLOYED => resolved / NOT_EMPLOYED / no review', async () => {
      const { service } = build({
        user: { id: 'emp-1', joiningDate: d('2026-04-01'), lastWorkingDate: d('2026-06-30') },
      });
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.contextResolved).toBe(true);
      expect(c.attendanceApplicability).toBe('NOT_EMPLOYED');
      expect(c.requiresHrReview).toBe(false);
    });

    it('UNRESOLVED => not resolved / BLOCKED / review required', async () => {
      const { service } = build({ profile: null });
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.contextResolved).toBe(false);
      expect(c.attendanceApplicability).toBe('BLOCKED');
      expect(c.requiresHrReview).toBe(true);
    });

    it('missing required configuration => not resolved / BLOCKED / review required', async () => {
      for (const opts of [
        { profile: { ...PROFILE, assignedShiftId: null } },
        { shift: null },
        { attendancePolicy: null },
      ]) {
        const { service } = build(opts as any);
        const c = await service.resolveDailyContext('emp-1', '2026-08-17');
        expect(c.contextResolved).toBe(false);
        expect(c.attendanceApplicability).toBe('BLOCKED');
        expect(c.requiresHrReview).toBe(true);
      }
    });

    it('BLOCKED is the only applicability that carries blocking reasons', async () => {
      const blocked = await build({ profile: null }).service.resolveDailyContext('emp-1', '2026-08-17');
      const exempt = await build({
        profile: { ...PROFILE, category: 'MANAGEMENT_EXEMPT', assignedShiftId: null },
      }).service.resolveDailyContext('emp-1', '2026-08-17');
      expect(blocked.blockingReasons.length).toBeGreaterThan(0);
      expect(exempt.blockingReasons).toEqual([]);
    });

    it('the ambiguous attendanceFinalizable boolean is gone', async () => {
      const { service } = build();
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c).not.toHaveProperty('attendanceFinalizable');
    });

    it('no attendance status is produced for any applicability', async () => {
      for (const opts of [
        {},
        { profile: null },
        { profile: { ...PROFILE, category: 'MANAGEMENT_EXEMPT' } },
        { user: { id: 'emp-1', joiningDate: d('2026-04-01'), lastWorkingDate: d('2026-06-30') } },
      ]) {
        const { service } = build(opts as any);
        const c = await service.resolveDailyContext('emp-1', '2026-08-17');
        for (const forbidden of ['status', 'attendanceStatus', 'present', 'absent', 'halfDay', 'lwp']) {
          expect(c).not.toHaveProperty(forbidden);
        }
      }
    });
  });

  describe('employee-assigned calendar and weekly-off are honoured', () => {
    const CAL_A = { id: 'cal-a', policyKey: 'calendar:office-a' };
    const CAL_B = { id: 'cal-b', policyKey: 'calendar:office-b' };
    const HOL_A = {
      id: 'hol-a',
      calendarId: 'cal-a',
      date: d('2026-08-17'),
      name: 'Regional Festival A',
      isOptional: false,
      calendar: { id: 'cal-a' },
    };

    it('two employees on different holiday calendars get different holiday facts', async () => {
      const shared = {
        calendars: { 'cal-a': CAL_A, 'cal-b': CAL_B },
        holidayByCalendar: { 'cal-a': HOL_A, 'cal-b': null },
      };

      const a = await build({
        ...shared,
        profile: { ...PROFILE, assignedHolidayCalendarId: 'cal-a' },
        effectiveCalendar: { id: 'cal-a' },
      } as any).service.resolveDailyContext('emp-a', '2026-08-17');

      const b = await build({
        ...shared,
        profile: { ...PROFILE, assignedHolidayCalendarId: 'cal-b' },
        effectiveCalendar: { id: 'cal-b' },
      } as any).service.resolveDailyContext('emp-b', '2026-08-17');

      expect(a.calendar.holiday.isHoliday).toBe(true);
      expect(a.calendar.holiday.name).toBe('Regional Festival A');
      expect(a.calendar.expectedCompanyWorkingDay).toBe(false);

      expect(b.calendar.holiday.isHoliday).toBe(false);
      expect(b.calendar.expectedCompanyWorkingDay).toBe(true);
    });

    it('source ids reflect the employee-assigned calendar, not a global one', async () => {
      const c = await build({
        calendars: { 'cal-a': CAL_A },
        holidayByCalendar: { 'cal-a': HOL_A },
        profile: { ...PROFILE, assignedHolidayCalendarId: 'cal-a' },
        effectiveCalendar: { id: 'cal-a' },
      } as any).service.resolveDailyContext('emp-a', '2026-08-17');

      expect(c.sources.holidayCalendarId).toBe('cal-a');
      expect(c.sources.holidayId).toBe('hol-a');
    });

    it('resolves the calendar VERSION governing the date, not the assigned row', async () => {
      // The profile points at v1, but v2 of the same series governs this date.
      const c = await build({
        calendars: { 'cal-a': CAL_A },
        holidayByCalendar: {
          'cal-a-v2': { ...HOL_A, id: 'hol-a-v2', calendarId: 'cal-a-v2', calendar: { id: 'cal-a-v2' } },
        },
        profile: { ...PROFILE, assignedHolidayCalendarId: 'cal-a' },
        effectiveCalendar: { id: 'cal-a-v2' },
      } as any).service.resolveDailyContext('emp-a', '2026-08-17');

      expect(c.sources.holidayCalendarId).toBe('cal-a-v2');
    });

    it('two employees on different weekly-off policies differ on the same Saturday', async () => {
      const strict = { id: 'wop-strict', everySunday: true, secondSaturday: true, fourthSaturday: true };
      const relaxed = { id: 'wop-relaxed', everySunday: true, secondSaturday: false, fourthSaturday: false };
      const byId = { 'wop-strict': strict, 'wop-relaxed': relaxed };

      // 2026-08-08 is the SECOND Saturday of August 2026.
      const a = await build({
        weeklyOffById: byId,
        profile: { ...PROFILE, assignedWeeklyOffPolicyId: 'wop-strict' },
      } as any).service.resolveDailyContext('emp-a', '2026-08-08');

      const b = await build({
        weeklyOffById: byId,
        profile: { ...PROFILE, assignedWeeklyOffPolicyId: 'wop-relaxed' },
      } as any).service.resolveDailyContext('emp-b', '2026-08-08');

      expect(a.calendar.weeklyOff.reasons).toEqual(['SECOND_SATURDAY']);
      expect(a.calendar.expectedCompanyWorkingDay).toBe(false);
      expect(a.sources.weeklyOffPolicyId).toBe('wop-strict');

      expect(b.calendar.weeklyOff.isWeeklyOff).toBe(false);
      expect(b.calendar.expectedCompanyWorkingDay).toBe(true);
      expect(b.sources.weeklyOffPolicyId).toBe('wop-relaxed');
    });

    it('passes the profile assignments through to the calendar service', async () => {
      const { service, prisma } = build({
        profile: { ...PROFILE, assignedWeeklyOffPolicyId: 'wop-strict' },
        weeklyOffById: { 'wop-strict': WEEKLY_OFF },
      } as any);
      await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(prisma.weeklyOffPolicy.findFirst.mock.calls[0][0].where.id).toBe('wop-strict');
    });

    it('with no assignment BL-5 counts candidates instead of taking the first active row', async () => {
      // BL-5 always runs the calendar service in strict mode, so the legacy
      // findFirst-on-isActive fallback is never used for a covered employee.
      const { service, prisma } = build({
        profile: { ...PROFILE, assignedHolidayCalendarId: null, assignedWeeklyOffPolicyId: null },
      });
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(prisma.weeklyOffPolicy.findMany).toHaveBeenCalled();
      expect(prisma.holidayCalendar.findMany).toHaveBeenCalled();
      expect(c.sources.holidayCalendarResolution).toBe('COMPANY_DEFAULT');
      expect(c.sources.weeklyOffPolicyResolution).toBe('COMPANY_DEFAULT');
    });

    it('an employee with no profile still resolves the calendar globally', async () => {
      const { service } = build({ profile: null });
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.calendar.businessDate).toBe('2026-08-17');
      expect(c.attendanceApplicability).toBe('BLOCKED');
    });
  });

  describe('final integrity guard — no arbitrary fallback when candidates are ambiguous', () => {
    const unassigned = { ...PROFILE, assignedHolidayCalendarId: null, assignedWeeklyOffPolicyId: null };

    describe('holiday calendar', () => {
      it('1. no assignment + exactly ONE active calendar => resolves as company default', async () => {
        const { service } = build({
          profile: unassigned,
          calendarCandidates: [{ id: 'cal-only' }],
        } as any);
        const c = await service.resolveDailyContext('emp-1', '2026-08-17');
        expect(c.sources.holidayCalendarResolution).toBe('COMPANY_DEFAULT');
        expect(c.sources.resolvedHolidayCalendarId).toBe('cal-only');
        expect(c.blockingReasons).not.toContain('MISSING_HOLIDAY_CALENDAR');
        expect(c.blockingReasons).not.toContain('AMBIGUOUS_HOLIDAY_CALENDAR');
      });

      it('2. no assignment + ZERO calendars => BLOCKED with MISSING_HOLIDAY_CALENDAR', async () => {
        const { service } = build({ profile: unassigned, calendarCandidates: [] } as any);
        const c = await service.resolveDailyContext('emp-1', '2026-08-17');
        expect(c.sources.holidayCalendarResolution).toBe('NONE');
        expect(c.blockingReasons).toContain('MISSING_HOLIDAY_CALENDAR');
        expect(c.contextResolved).toBe(false);
        expect(c.attendanceApplicability).toBe('BLOCKED');
        expect(c.requiresHrReview).toBe(true);
      });

      it('3. no assignment + TWO active calendars => BLOCKED, and nothing chosen', async () => {
        const { service } = build({
          profile: unassigned,
          calendarCandidates: [{ id: 'cal-a' }, { id: 'cal-b' }],
        } as any);
        const c = await service.resolveDailyContext('emp-1', '2026-08-17');
        expect(c.sources.holidayCalendarResolution).toBe('AMBIGUOUS');
        expect(c.blockingReasons).toContain('AMBIGUOUS_HOLIDAY_CALENDAR');
        expect(c.contextResolved).toBe(false);
        // Critically: no calendar was picked, and no holiday was read from one.
        expect(c.sources.resolvedHolidayCalendarId).toBeNull();
        expect(c.calendar.holiday.isHoliday).toBe(false);
      });

      it('3b. an ambiguous calendar never reads a holiday from an arbitrary row', async () => {
        const { service, prisma } = build({
          profile: unassigned,
          calendarCandidates: [{ id: 'cal-a' }, { id: 'cal-b' }],
        } as any);
        await service.resolveDailyContext('emp-1', '2026-08-17');
        expect(prisma.holiday.findFirst).not.toHaveBeenCalled();
      });

      it('counts candidates with take: 2 rather than loading them all', async () => {
        const { service, prisma } = build({ profile: unassigned } as any);
        await service.resolveDailyContext('emp-1', '2026-08-17');
        expect(prisma.holidayCalendar.findMany.mock.calls[0][0].take).toBe(2);
      });
    });

    describe('weekly-off policy', () => {
      it('4a. no assignment + exactly ONE active policy => resolves as company default', async () => {
        const { service } = build({
          profile: unassigned,
          weeklyOffCandidates: [WEEKLY_OFF],
        } as any);
        const c = await service.resolveDailyContext('emp-1', '2026-08-17');
        expect(c.sources.weeklyOffPolicyResolution).toBe('COMPANY_DEFAULT');
        expect(c.sources.resolvedWeeklyOffPolicyId).toBe('wop-1');
        expect(c.blockingReasons).not.toContain('MISSING_WEEKLY_OFF_POLICY');
      });

      it('4b. no assignment + ZERO policies => BLOCKED with MISSING_WEEKLY_OFF_POLICY', async () => {
        const { service } = build({ profile: unassigned, weeklyOffCandidates: [] } as any);
        const c = await service.resolveDailyContext('emp-1', '2026-08-17');
        expect(c.sources.weeklyOffPolicyResolution).toBe('NONE');
        expect(c.blockingReasons).toContain('MISSING_WEEKLY_OFF_POLICY');
        expect(c.attendanceApplicability).toBe('BLOCKED');
      });

      it('4c. no assignment + TWO active policies => BLOCKED, and nothing chosen', async () => {
        const { service } = build({
          profile: unassigned,
          weeklyOffCandidates: [
            { id: 'wop-a', everySunday: true, secondSaturday: true, fourthSaturday: true },
            { id: 'wop-b', everySunday: true, secondSaturday: false, fourthSaturday: false },
          ],
        } as any);
        const c = await service.resolveDailyContext('emp-1', '2026-08-17');
        expect(c.sources.weeklyOffPolicyResolution).toBe('AMBIGUOUS');
        expect(c.blockingReasons).toContain('AMBIGUOUS_WEEKLY_OFF_POLICY');
        expect(c.sources.resolvedWeeklyOffPolicyId).toBeNull();
        // With no policy chosen, no weekly-off rule is applied at all.
        expect(c.calendar.weeklyOff.isWeeklyOff).toBe(false);
      });

      it('counts candidates with take: 2', async () => {
        const { service, prisma } = build({ profile: unassigned } as any);
        await service.resolveDailyContext('emp-1', '2026-08-17');
        expect(prisma.weeklyOffPolicy.findMany.mock.calls[0][0].take).toBe(2);
      });
    });

    it('5. an explicit assignment still wins when several globals exist', async () => {
      const { service } = build({
        profile: { ...PROFILE, assignedHolidayCalendarId: 'cal-a', assignedWeeklyOffPolicyId: 'wop-1' },
        calendars: { 'cal-a': { id: 'cal-a', policyKey: 'calendar:office-a' } },
        effectiveCalendar: { id: 'cal-a' },
        calendarCandidates: [{ id: 'x' }, { id: 'y' }],
        weeklyOffCandidates: [{ id: 'p' }, { id: 'q' }],
        weeklyOffById: { 'wop-1': WEEKLY_OFF },
      } as any);
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.sources.holidayCalendarResolution).toBe('ASSIGNED');
      expect(c.sources.weeklyOffPolicyResolution).toBe('ASSIGNED');
      expect(c.sources.resolvedHolidayCalendarId).toBe('cal-a');
      expect(c.sources.resolvedWeeklyOffPolicyId).toBe('wop-1');
      expect(c.blockingReasons).toEqual([]);
      expect(c.attendanceApplicability).toBe('REQUIRED');
    });

    it('6. EXEMPT does not block when calendars are absent or ambiguous', async () => {
      const { service } = build({
        profile: {
          ...PROFILE,
          category: 'MANAGEMENT_EXEMPT',
          assignedShiftId: null,
          assignedHolidayCalendarId: null,
          assignedWeeklyOffPolicyId: null,
        },
        calendarCandidates: [],
        weeklyOffCandidates: [{ id: 'a' }, { id: 'b' }],
      } as any);
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.attendanceApplicability).toBe('EXEMPT');
      expect(c.contextResolved).toBe(true);
      expect(c.blockingReasons).toEqual([]);
    });

    it('7. NOT_EMPLOYED does not block when calendars are absent or ambiguous', async () => {
      const { service } = build({
        user: { id: 'emp-1', joiningDate: d('2026-04-01'), lastWorkingDate: d('2026-06-30') },
        profile: unassigned,
        calendarCandidates: [],
        weeklyOffCandidates: [],
      } as any);
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.attendanceApplicability).toBe('NOT_EMPLOYED');
      expect(c.contextResolved).toBe(true);
      expect(c.blockingReasons).toEqual([]);
    });

    it('reports assigned and resolved ids separately, so the choice is reconstructable', async () => {
      const { service } = build({
        profile: unassigned,
        calendarCandidates: [{ id: 'cal-only' }],
      } as any);
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.sources.assignedHolidayCalendarId).toBeNull();
      expect(c.sources.resolvedHolidayCalendarId).toBe('cal-only');
      expect(c.sources.holidayCalendarResolution).toBe('COMPANY_DEFAULT');
    });

    it('accumulates every calendar blocking reason rather than stopping at the first', async () => {
      const { service } = build({
        profile: unassigned,
        calendarCandidates: [],
        weeklyOffCandidates: [],
      } as any);
      const c = await service.resolveDailyContext('emp-1', '2026-08-17');
      expect(c.blockingReasons).toContain('MISSING_HOLIDAY_CALENDAR');
      expect(c.blockingReasons).toContain('MISSING_WEEKLY_OFF_POLICY');
    });
  });
});

describe('legacy employees with no joining date (production hotfix)', () => {
  // Production shipped with users.joiningDate never populated for staff
  // predating Attendance, and every punch was refused NOT_EMPLOYED. These
  // exercise the wiring end to end through the real resolver, because the
  // pure rule passing its own unit tests would not prove the context layer
  // actually uses the adjusted answer.
  const noJoiningDate = { id: 'emp-1', joiningDate: null, lastWorkingDate: null };

  it('is REQUIRED when a profile covers the date', async () => {
    const { service } = build({ user: noJoiningDate });
    const c = await service.resolveDailyContext('emp-1', '2026-08-17');

    expect(c.employment.reason).toBe('NO_JOINING_DATE');
    expect(c.coverage).toBe('COVERED');
    expect(c.attendanceApplicability).toBe('REQUIRED');
    expect(c.legacyEmploymentFallbackApplied).toBe(true);
  });

  it('reports the fallback so the missing HR date stays visible', async () => {
    const { service } = build({ user: noJoiningDate });
    const c = await service.resolveDailyContext('emp-1', '2026-08-17');

    // The employment facts still say what is actually recorded; only
    // applicability moves.
    expect(c.employment.employedOnDate).toBe(false);
    expect(c.employment.joiningDate).toBeNull();
    expect(c.legacyEmploymentFallbackApplied).toBe(true);
  });

  it('does not apply to an employee with a real joining date', async () => {
    const { service } = build();
    const c = await service.resolveDailyContext('emp-1', '2026-08-17');

    expect(c.attendanceApplicability).toBe('REQUIRED');
    expect(c.legacyEmploymentFallbackApplied).toBe(false);
  });

  it('still refuses a leaver whose last working date has passed', async () => {
    // employmentOn() returns NO_JOINING_DATE before it reads lastWorkingDate,
    // so this arrives at the fallback looking identical to an active employee.
    const { service } = build({
      user: { id: 'emp-1', joiningDate: null, lastWorkingDate: d('2026-07-31') },
    });
    const c = await service.resolveDailyContext('emp-1', '2026-08-17');

    expect(c.coverage).toBe('NOT_EMPLOYED');
    expect(c.attendanceApplicability).toBe('NOT_EMPLOYED');
    expect(c.legacyEmploymentFallbackApplied).toBe(false);
  });

  it('still refuses a future real joining date even with a profile', async () => {
    const { service } = build({
      user: { id: 'emp-1', joiningDate: d('2026-09-01'), lastWorkingDate: null },
    });
    const c = await service.resolveDailyContext('emp-1', '2026-08-17');

    expect(c.employment.reason).toBe('BEFORE_JOINING');
    expect(c.attendanceApplicability).toBe('NOT_EMPLOYED');
    expect(c.legacyEmploymentFallbackApplied).toBe(false);
  });

  it('fails closed with no profile, and reports NOT_EMPLOYED rather than BLOCKED', async () => {
    // Worth pinning precisely, because it is the one case that reads
    // ambiguously in production. resolveCoverage() checks employment BEFORE
    // profile presence, so a legacy employee with no joining date AND no
    // profile is NOT_EMPLOYED with an EMPTY blockingReasons -- not
    // BLOCKED/NO_PROFILE_FOR_DATE, which is what an employee WITH a joining
    // date and no profile would produce. So a bare NOT_EMPLOYED in production
    // does not by itself distinguish "employment window failed" from "nobody
    // configured this person"; only the database separates those.
    const { service } = build({ user: noJoiningDate, profile: null });
    const c = await service.resolveDailyContext('emp-1', '2026-08-17');

    expect(c.attendanceApplicability).toBe('NOT_EMPLOYED');
    expect(c.coverage).toBe('NOT_EMPLOYED');
    expect(c.blockingReasons).toEqual([]);
    expect(c.legacyEmploymentFallbackApplied).toBe(false);
  });

  it('an employee WITH a joining date and no profile is BLOCKED instead', async () => {
    // The contrast that makes the case above meaningful.
    const { service } = build({ profile: null });
    const c = await service.resolveDailyContext('emp-1', '2026-08-17');

    expect(c.coverage).toBe('UNRESOLVED');
    expect(c.attendanceApplicability).toBe('BLOCKED');
    expect(c.blockingReasons).toContain('NO_PROFILE_FOR_DATE');
  });
});
