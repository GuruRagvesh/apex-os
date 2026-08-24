import { EmployeeTimelineService } from '../../src/modules/platform/attendance/timeline/employee-timeline.service';
import { OverlappingProfileError } from '../../src/modules/platform/attendance/timeline/employee-timeline.types';
import { TVAService } from '../../src/common/services/tva.service';
import { ConfigService } from '@nestjs/config';

// Real TVAService (BL-1 company-time contract), mocked Prisma. No database.
//
// The scenario driving these tests is the one the shipped schema could not
// store at all: an employee who is a Regular Employee until 30 Jun 2026 and a
// Team Leader from 1 Jul 2026. June must keep resolving to Regular Employee
// forever, including after the promotion.

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const REGULAR = {
  id: 'prof-regular',
  userId: 'emp-1',
  category: 'REGULAR_EMPLOYEE',
  attendanceRequired: true,
  assignedShiftId: 'shift-regular',
  assignedLeavePolicyId: 'lp-1',
  assignedHolidayCalendarId: 'cal-2026',
  assignedWeeklyOffPolicyId: 'wop-1',
  reportingManagerId: 'mgr-1',
  hrReviewerId: 'hr-1',
  effectiveFrom: d('2026-04-01'),
  effectiveTo: d('2026-06-30'),
};

const TEAM_LEAD = {
  ...REGULAR,
  id: 'prof-tl',
  category: 'TEAM_LEADER',
  assignedShiftId: 'shift-tl',
  effectiveFrom: d('2026-07-01'),
  effectiveTo: null,
};

const EXEMPT = {
  ...TEAM_LEAD,
  id: 'prof-exempt',
  category: 'MANAGEMENT_EXEMPT',
  attendanceRequired: false,
};

function build(opts: { user?: any; profiles?: any[]; overlap?: any } = {}) {
  const user =
    'user' in opts
      ? opts.user
      : { id: 'emp-1', joiningDate: d('2025-11-10'), lastWorkingDate: null };
  const profiles = opts.profiles ?? [];

  // Emulates the point-in-time predicate the service issues. The service
  // normalises to the company business-DAY window, so lte/gte here are day
  // boundaries rather than UTC midnight.
  const pick = (args: any) => {
    const where = args?.where ?? {};
    const lte = where.effectiveFrom?.lte as Date | undefined;
    const gte = where.OR?.[1]?.effectiveTo?.gte as Date | undefined;
    const matches = profiles.filter((p) => {
      if (lte && p.effectiveFrom.getTime() > lte.getTime()) return false;
      if (gte && p.effectiveTo && p.effectiveTo.getTime() < gte.getTime()) return false;
      return true;
    });
    matches.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
    return Promise.resolve(matches[0] ?? null);
  };

  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'emp-1' }]),
    employeeAttendanceProfile: {
      findFirst: jest.fn().mockResolvedValue(opts.overlap ?? null),
      findUnique: jest.fn().mockResolvedValue(profiles[0] ?? null),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'new', ...data })),
      update: jest.fn().mockImplementation(({ where, data }: any) =>
        Promise.resolve({ ...profiles.find((p) => p.id === where.id), ...data }),
      ),
    },
  };

  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    employeeAttendanceProfile: {
      findFirst: jest.fn().mockImplementation(pick),
      findMany: jest.fn().mockResolvedValue(profiles),
    },
    $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    workSession: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    breakLog: { findFirst: jest.fn(), update: jest.fn() },
    leaveRequest: { findFirst: jest.fn(), findMany: jest.fn() },
    dailyAttendance: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), upsert: jest.fn() },
  };

  const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);
  return { service: new EmployeeTimelineService(prisma as any, tva), prisma, tx };
}

describe('EmployeeTimelineService (BL-3)', () => {
  describe('point-in-time category resolution', () => {
    const profiles = [REGULAR, TEAM_LEAD];

    it('June 2026 resolves to REGULAR_EMPLOYEE', async () => {
      const { service } = build({ profiles });
      const r = await service.resolveEmployeeOn('emp-1', '2026-06-15');
      expect(r.profile?.category).toBe('REGULAR_EMPLOYEE');
      expect(r.profile?.profileId).toBe('prof-regular');
      expect(r.profile?.assignedShiftId).toBe('shift-regular');
    });

    it('July 2026 resolves to TEAM_LEADER', async () => {
      const { service } = build({ profiles });
      const r = await service.resolveEmployeeOn('emp-1', '2026-07-15');
      expect(r.profile?.category).toBe('TEAM_LEADER');
      expect(r.profile?.assignedShiftId).toBe('shift-tl');
    });

    it('the last day of the old version is still the old version', async () => {
      const { service } = build({ profiles });
      expect((await service.resolveEmployeeOn('emp-1', '2026-06-30')).profile?.category)
        .toBe('REGULAR_EMPLOYEE');
    });

    it('the first day of the new version is already the new version', async () => {
      const { service } = build({ profiles });
      expect((await service.resolveEmployeeOn('emp-1', '2026-07-01')).profile?.category)
        .toBe('TEAM_LEADER');
    });

    it('a promotion never rewrites history', async () => {
      const { service } = build({ profiles });
      const before = await service.resolveEmployeeOn('emp-1', '2026-05-20');
      const after = await service.resolveEmployeeOn('emp-1', '2026-09-20');
      expect(before.profile?.category).toBe('REGULAR_EMPLOYEE');
      expect(after.profile?.category).toBe('TEAM_LEADER');
      expect(before.profile?.profileId).not.toBe(after.profile?.profileId);
    });

    it('reports the effective window of the version it used', async () => {
      const { service } = build({ profiles });
      const r = await service.resolveEmployeeOn('emp-1', '2026-06-15');
      expect(r.profile?.effectiveFrom).toBe('2026-04-01');
      expect(r.profile?.effectiveTo).toBe('2026-06-30');
    });

    it('a profile created with a mid-day timestamp is in force on its own first day', async () => {
      // effectiveFrom defaults to CURRENT_TIMESTAMP in the live schema, so a
      // row can carry a real time. Comparing against UTC midnight would have
      // wrongly excluded it on day one.
      const midDay = { ...TEAM_LEAD, effectiveFrom: new Date('2026-07-01T09:23:45.123Z') };
      const { service } = build({ profiles: [midDay] });
      const r = await service.resolveEmployeeOn('emp-1', '2026-07-01');
      expect(r.profile?.profileId).toBe('prof-tl');
      expect(r.coverage).toBe('COVERED');
    });
  });

  describe('coverage state — a missing profile is never an exemption', () => {
    it('employed with NO profile covering the date => UNRESOLVED', async () => {
      const { service } = build({ profiles: [TEAM_LEAD] });
      const r = await service.resolveEmployeeOn('emp-1', '2026-01-15');
      expect(r.profile).toBeNull();
      expect(r.coverage).toBe('UNRESOLVED');
      expect(r.coverageReason).toBe('NO_PROFILE_FOR_DATE');
    });

    it('a missing profile is NEVER reported as EXEMPT', async () => {
      const { service } = build({ profiles: [] });
      const r = await service.resolveEmployeeOn('emp-1', '2026-07-15');
      expect(r.coverage).not.toBe('EXEMPT');
      expect(r.coverage).toBe('UNRESOLVED');
    });

    it('UNRESOLVED and EXEMPT are distinguishable, not both "false"', async () => {
      const unresolved = await build({ profiles: [] }).service.resolveEmployeeOn('emp-1', '2026-07-15');
      const exempt = await build({ profiles: [EXEMPT] }).service.resolveEmployeeOn('emp-1', '2026-07-15');
      expect(unresolved.coverage).toBe('UNRESOLVED');
      expect(exempt.coverage).toBe('EXEMPT');
      expect(unresolved.coverage).not.toBe(exempt.coverage);
    });

    it('MANAGEMENT_EXEMPT category => EXEMPT', async () => {
      const { service } = build({ profiles: [{ ...EXEMPT, attendanceRequired: true }] });
      const r = await service.resolveEmployeeOn('emp-1', '2026-07-15');
      expect(r.coverage).toBe('EXEMPT');
      expect(r.coverageReason).toBe('MANAGEMENT_EXEMPT_CATEGORY');
    });

    it('explicit attendanceRequired=false => EXEMPT', async () => {
      const { service } = build({ profiles: [{ ...TEAM_LEAD, attendanceRequired: false }] });
      const r = await service.resolveEmployeeOn('emp-1', '2026-07-15');
      expect(r.coverage).toBe('EXEMPT');
      expect(r.coverageReason).toBe('ATTENDANCE_NOT_REQUIRED');
    });

    it('regular employee => COVERED', async () => {
      const { service } = build({ profiles: [REGULAR] });
      const r = await service.resolveEmployeeOn('emp-1', '2026-06-15');
      expect(r.coverage).toBe('COVERED');
      expect(r.coverageReason).toBe('COVERED');
    });

    it('team leader => COVERED', async () => {
      const { service } = build({ profiles: [TEAM_LEAD] });
      expect((await service.resolveEmployeeOn('emp-1', '2026-07-15')).coverage).toBe('COVERED');
    });

    it('coverage is configuration, never a name list: covered -> exempt over time', async () => {
      const { service } = build({ profiles: [REGULAR, { ...EXEMPT, effectiveFrom: d('2026-07-01') }] });
      expect((await service.resolveEmployeeOn('emp-1', '2026-06-15')).coverage).toBe('COVERED');
      expect((await service.resolveEmployeeOn('emp-1', '2026-07-15')).coverage).toBe('EXEMPT');
    });
  });

  describe('employment window — joiningDate and lastWorkingDate both inclusive', () => {
    it('before joining => NOT_EMPLOYED', async () => {
      const { service } = build({ profiles: [TEAM_LEAD] });
      const r = await service.resolveEmployeeOn('emp-1', '2025-06-01');
      expect(r.employment.employedOnDate).toBe(false);
      expect(r.coverage).toBe('NOT_EMPLOYED');
      expect(r.coverageReason).toBe('BEFORE_JOINING');
    });

    it('on the joining date => employed', async () => {
      const { service } = build({
        user: { id: 'emp-1', joiningDate: d('2026-04-01'), lastWorkingDate: null },
        profiles: [REGULAR],
      });
      const r = await service.resolveEmployeeOn('emp-1', '2026-04-01');
      expect(r.employment.employedOnDate).toBe(true);
      expect(r.employment.reason).toBe('EMPLOYED');
      expect(r.coverage).toBe('COVERED');
    });

    it('on lastWorkingDate => employed', async () => {
      const { service } = build({
        user: { id: 'emp-1', joiningDate: d('2026-04-01'), lastWorkingDate: d('2026-08-31') },
        profiles: [TEAM_LEAD],
      });
      const r = await service.resolveEmployeeOn('emp-1', '2026-08-31');
      expect(r.employment.employedOnDate).toBe(true);
      expect(r.employment.lastWorkingDate).toBe('2026-08-31');
      expect(r.coverage).toBe('COVERED');
    });

    it('the day after lastWorkingDate => NOT_EMPLOYED', async () => {
      const { service } = build({
        user: { id: 'emp-1', joiningDate: d('2026-04-01'), lastWorkingDate: d('2026-08-31') },
        profiles: [TEAM_LEAD],
      });
      const r = await service.resolveEmployeeOn('emp-1', '2026-09-01');
      expect(r.employment.employedOnDate).toBe(false);
      expect(r.coverage).toBe('NOT_EMPLOYED');
      expect(r.coverageReason).toBe('AFTER_LAST_WORKING_DATE');
    });

    it('no joining date => NOT_EMPLOYED, never assumed employed', async () => {
      const { service } = build({
        user: { id: 'emp-1', joiningDate: null, lastWorkingDate: null },
        profiles: [TEAM_LEAD],
      });
      const r = await service.resolveEmployeeOn('emp-1', '2026-07-15');
      expect(r.coverage).toBe('NOT_EMPLOYED');
      expect(r.coverageReason).toBe('NO_JOINING_DATE');
    });

    it('unknown user resolves cleanly rather than throwing', async () => {
      const { service } = build({ user: null, profiles: [] });
      const r = await service.resolveEmployeeOn('ghost', '2026-07-15');
      expect(r.coverage).toBe('NOT_EMPLOYED');
      expect(r.coverageReason).toBe('USER_NOT_FOUND');
    });

    it('NOT_EMPLOYED wins over a profile that would otherwise cover the date', async () => {
      const { service } = build({
        user: { id: 'emp-1', joiningDate: d('2026-04-01'), lastWorkingDate: d('2026-06-30') },
        profiles: [TEAM_LEAD],
      });
      const r = await service.resolveEmployeeOn('emp-1', '2026-07-15');
      expect(r.profile).not.toBeNull();
      expect(r.coverage).toBe('NOT_EMPLOYED');
    });
  });

  describe('concurrent assignment is serialised by a per-employee row lock', () => {
    it('locks the User row FOR UPDATE before the overlap check and the insert', async () => {
      const { service, tx } = build({ overlap: null });
      await service.assignProfile({
        userId: 'emp-1',
        category: 'TEAM_LEADER' as any,
        effectiveFrom: '2026-07-01',
      });
      const lockOrder = tx.$queryRaw.mock.invocationCallOrder[0];
      const checkOrder = tx.employeeAttendanceProfile.findFirst.mock.invocationCallOrder[0];
      const insertOrder = tx.employeeAttendanceProfile.create.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(checkOrder);
      expect(lockOrder).toBeLessThan(insertOrder);
    });

    it('binds the user id as a parameter and never interpolates it into SQL', async () => {
      const { service, tx } = build({ overlap: null });
      await service.assignProfile({
        userId: "emp-1'; DROP TABLE users; --",
        category: 'TEAM_LEADER' as any,
        effectiveFrom: '2026-07-01',
      });
      // Tagged-template call: strings array first, then bound values.
      const [strings, ...values] = tx.$queryRaw.mock.calls[0];
      expect(Array.isArray(strings)).toBe(true);
      expect(strings.join('?')).toContain('FOR UPDATE');
      expect(strings.join('?')).not.toContain('DROP TABLE');
      expect(values).toEqual(["emp-1'; DROP TABLE users; --"]);
    });

    it('takes the lock even when the overlap check will reject', async () => {
      const { service, tx } = build({ overlap: { id: 'prof-regular' } });
      await expect(
        service.assignProfile({
          userId: 'emp-1',
          category: 'TEAM_LEADER' as any,
          effectiveFrom: '2026-06-01',
        }),
      ).rejects.toBeInstanceOf(OverlappingProfileError);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('closeProfile also takes the per-employee lock', async () => {
      const { service, tx } = build({ profiles: [{ ...TEAM_LEAD, effectiveTo: null }] });
      await service.closeProfile('prof-tl', '2026-12-31');
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.employeeAttendanceProfile.update.mock.invocationCallOrder[0],
      );
    });
  });

  describe('overlap prevention', () => {
    it('rejects an assignment overlapping an existing version', async () => {
      const { service } = build({ overlap: { id: 'prof-regular' } });
      await expect(
        service.assignProfile({
          userId: 'emp-1',
          category: 'TEAM_LEADER' as any,
          effectiveFrom: '2026-06-01',
        }),
      ).rejects.toBeInstanceOf(OverlappingProfileError);
    });

    it('names the conflicting profile in the error', async () => {
      const { service } = build({ overlap: { id: 'prof-regular' } });
      await expect(
        service.assignProfile({
          userId: 'emp-1',
          category: 'TEAM_LEADER' as any,
          effectiveFrom: '2026-06-01',
        }),
      ).rejects.toThrow(/prof-regular/);
    });

    it('accepts a non-overlapping assignment', async () => {
      const { service, tx } = build({ overlap: null });
      const created = await service.assignProfile({
        userId: 'emp-1',
        category: 'TEAM_LEADER' as any,
        effectiveFrom: '2026-07-01',
        assignedShiftId: 'shift-tl',
      });
      expect(tx.employeeAttendanceProfile.create).toHaveBeenCalledTimes(1);
      expect(created.effectiveFrom).toEqual(d('2026-07-01'));
      expect(created.effectiveTo).toBeNull();
    });

    it('runs lock, check and insert in ONE transaction', async () => {
      const { service, prisma } = build({ overlap: null });
      await service.assignProfile({
        userId: 'emp-1',
        category: 'TEAM_LEADER' as any,
        effectiveFrom: '2026-07-01',
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('does not write when the overlap check fails', async () => {
      const { service, tx } = build({ overlap: { id: 'prof-regular' } });
      await expect(
        service.assignProfile({
          userId: 'emp-1',
          category: 'TEAM_LEADER' as any,
          effectiveFrom: '2026-06-01',
        }),
      ).rejects.toBeInstanceOf(OverlappingProfileError);
      expect(tx.employeeAttendanceProfile.create).not.toHaveBeenCalled();
    });

    it('rejects an inverted effective window', async () => {
      const { service } = build({ overlap: null });
      await expect(
        service.assignProfile({
          userId: 'emp-1',
          category: 'TEAM_LEADER' as any,
          effectiveFrom: '2026-07-01',
          effectiveTo: '2026-06-01',
        }),
      ).rejects.toThrow(/cannot precede/);
    });
  });

  describe('closing a version preserves history', () => {
    it('sets only effectiveTo, never the attendance content', async () => {
      const { service, tx } = build({ profiles: [{ ...TEAM_LEAD, effectiveTo: null }] });
      await service.closeProfile('prof-tl', '2026-12-31');
      expect(tx.employeeAttendanceProfile.update).toHaveBeenCalledWith({
        where: { id: 'prof-tl' },
        data: { effectiveTo: d('2026-12-31') },
      });
    });

    it('refuses to close before the version started', async () => {
      const { service } = build({ profiles: [{ ...TEAM_LEAD, effectiveTo: null }] });
      await expect(service.closeProfile('prof-tl', '2026-01-01')).rejects.toThrow(/cannot precede/);
    });

    it('never deletes a version', async () => {
      const { service, prisma } = build({ profiles: [{ ...TEAM_LEAD, effectiveTo: null }] });
      await service.closeProfile('prof-tl', '2026-12-31');
      expect((prisma.employeeAttendanceProfile as any).delete).toBeUndefined();
    });
  });

  describe('business date comes from the TVA contract', () => {
    it('converts an instant through company time', async () => {
      const { service } = build({ profiles: [TEAM_LEAD] });
      // 2026-07-14T19:15:00Z is 2026-07-15 00:45 IST.
      const r = await service.resolveEmployeeOn('emp-1', new Date('2026-07-14T19:15:00.000Z'));
      expect(r.businessDate).toBe('2026-07-15');
    });

    it('rejects an unparseable business date', async () => {
      const { service } = build();
      await expect(service.resolveEmployeeOn('emp-1', 'not-a-date')).rejects.toThrow(
        /Invalid business date/,
      );
    });
  });

  describe('determinism and sources', () => {
    it('repeated resolution returns identical facts', async () => {
      const { service } = build({ profiles: [REGULAR, TEAM_LEAD] });
      const a = await service.resolveEmployeeOn('emp-1', '2026-06-15');
      const b = await service.resolveEmployeeOn('emp-1', '2026-06-15');
      expect(a).toEqual(b);
    });

    it('reports every assignment id used to reach the answer', async () => {
      const { service } = build({ profiles: [REGULAR] });
      const r = await service.resolveEmployeeOn('emp-1', '2026-06-15');
      expect(r.sources).toEqual({
        profileId: 'prof-regular',
        assignedShiftId: 'shift-regular',
        assignedLeavePolicyId: 'lp-1',
        assignedHolidayCalendarId: 'cal-2026',
        assignedWeeklyOffPolicyId: 'wop-1',
      });
    });

    it('picks the most recent applicable version if legacy data overlaps', async () => {
      const legacyOverlap = { ...REGULAR, id: 'prof-legacy', effectiveTo: null };
      const { service } = build({ profiles: [legacyOverlap, TEAM_LEAD] });
      const r = await service.resolveEmployeeOn('emp-1', '2026-08-01');
      expect(r.profile?.profileId).toBe('prof-tl');
    });
  });

  describe('layer boundaries', () => {
    it('never reads WorkSession, BreakLog, Leave or DailyAttendance', async () => {
      const { service, prisma } = build({ profiles: [TEAM_LEAD] });
      await service.resolveEmployeeOn('emp-1', '2026-07-15');
      for (const delegate of ['workSession', 'breakLog', 'leaveRequest', 'dailyAttendance'] as const) {
        for (const fn of Object.values(prisma[delegate])) {
          expect(fn).not.toHaveBeenCalled();
        }
      }
    });

    it('resolution performs no writes and takes no lock', async () => {
      const { service, tx } = build({ profiles: [TEAM_LEAD] });
      await service.resolveEmployeeOn('emp-1', '2026-07-15');
      expect(tx.employeeAttendanceProfile.create).not.toHaveBeenCalled();
      expect(tx.employeeAttendanceProfile.update).not.toHaveBeenCalled();
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
