import { PolicyVersionService } from '../../src/modules/platform/attendance/policy/policy-version.service';
import {
  PolicyAuthorizationError,
  PolicyImmutableError,
  PolicySelfApprovalError,
  PolicyTransitionError,
} from '../../src/modules/platform/attendance/policy/policy-version.types';
import { TVAService } from '../../src/common/services/tva.service';
import { ConfigService } from '@nestjs/config';

// Real TVAService (BL-1 company-time contract), mocked Prisma. No database.
//
// The rule under test throughout: once a policy version has been ACTIVE, it is
// frozen. Change means a NEW version, so historical attendance keeps meaning.

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const HR = { userId: 'hr-1', role: 'MANAGER' };
const ADMIN = { userId: 'admin-1', role: 'ADMIN' };
const SUPER = { userId: 'su-1', role: 'SUPER_ADMIN' };

const V1 = {
  id: 'pol-v1',
  policyKey: 'attendance:default',
  financialYear: '2026-2027',
  name: 'Default Attendance Policy',
  isActive: true,
  minimumWorkingMinutes: 540,
  afterPunchWindowAction: 'REQUIRE_REVIEW',
  insufficientHoursAction: 'REQUIRE_REVIEW',
  automaticHalfDayEnabled: false,
  version: 1,
  status: 'ACTIVE',
  effectiveFrom: d('2026-04-01'),
  effectiveTo: null,
  createdById: 'hr-1',
  approvedById: 'admin-1',
  approvedAt: d('2026-03-25'),
  supersededById: null,
  createdAt: d('2026-03-01'),
  updatedAt: d('2026-03-25'),
};

function build(
  rows: Record<string, any> = {},
  opts: { currentActive?: any; latest?: any; holidays?: any[] } = {},
) {
  const store = { ...rows };
  const delegate = {
    findUnique: jest.fn(({ where }: any) => Promise.resolve(store[where.id] ?? null)),
    // Serves both the "currently ACTIVE in this series" lookup and the
    // "highest version in this series" lookup.
    findFirst: jest.fn((args: any) =>
      Promise.resolve(args?.orderBy?.version ? (opts.latest ?? null) : (opts.currentActive ?? null)),
    ),
    findMany: jest.fn().mockResolvedValue(Object.values(store)),
    create: jest.fn(({ data }: any) => Promise.resolve({ id: 'pol-new', ...data })),
    update: jest.fn(({ where, data }: any) => Promise.resolve({ ...store[where.id], ...data })),
  };
  const holiday = {
    findMany: jest.fn().mockResolvedValue(opts.holidays ?? []),
    createMany: jest.fn().mockResolvedValue({ count: (opts.holidays ?? []).length }),
  };
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    attendancePolicy: delegate,
    shiftPolicy: delegate,
    leavePolicy: delegate,
    holidayCalendar: delegate,
    holiday,
  };
  const prisma: any = { ...tx, $transaction: jest.fn((fn: any) => fn(tx)) };
  const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);
  return { service: new PolicyVersionService(prisma, tva), prisma, delegate, tx, holiday };
}

describe('PolicyVersionService (BL-4)', () => {
  describe('lifecycle transitions', () => {
    it('DRAFT -> APPROVED records the approver and timestamp', async () => {
      const { service, delegate } = build({ 'pol-d': { ...V1, id: 'pol-d', status: 'DRAFT' } });
      await service.approve('ATTENDANCE_POLICY', 'pol-d', ADMIN);
      const data = delegate.update.mock.calls[0][0].data;
      expect(data.status).toBe('APPROVED');
      expect(data.approvedById).toBe('admin-1');
      expect(data.approvedAt).toBeInstanceOf(Date);
    });

    it('APPROVED -> ACTIVE sets isActive as the derived mirror', async () => {
      const { service, delegate } = build({
        'pol-a': { ...V1, id: 'pol-a', status: 'APPROVED', createdById: 'hr-1', isActive: false },
      });
      await service.activate('ATTENDANCE_POLICY', 'pol-a', ADMIN);
      const data = delegate.update.mock.calls[0][0].data;
      expect(data.status).toBe('ACTIVE');
      expect(data.isActive).toBe(true);
    });

    it('rejects DRAFT -> ACTIVE, skipping approval', async () => {
      const { service } = build({ 'pol-d': { ...V1, id: 'pol-d', status: 'DRAFT' } });
      await expect(service.activate('ATTENDANCE_POLICY', 'pol-d', ADMIN)).rejects.toBeInstanceOf(
        PolicyTransitionError,
      );
    });

    it('rejects reactivating a SUPERSEDED version', async () => {
      const { service } = build({ 'pol-s': { ...V1, id: 'pol-s', status: 'SUPERSEDED' } });
      await expect(service.activate('ATTENDANCE_POLICY', 'pol-s', ADMIN)).rejects.toBeInstanceOf(
        PolicyTransitionError,
      );
    });

    it('rejects approving an already-ACTIVE version', async () => {
      const { service } = build({ 'pol-v1': V1 });
      await expect(service.approve('ATTENDANCE_POLICY', 'pol-v1', ADMIN)).rejects.toBeInstanceOf(
        PolicyTransitionError,
      );
    });
  });

  describe('maker-checker on activation', () => {
    it('a MANAGER may not activate', async () => {
      const { service } = build({ 'pol-a': { ...V1, id: 'pol-a', status: 'APPROVED' } });
      await expect(service.activate('ATTENDANCE_POLICY', 'pol-a', HR)).rejects.toBeInstanceOf(
        PolicyAuthorizationError,
      );
    });

    it('an EMPLOYEE may not activate', async () => {
      const { service } = build({ 'pol-a': { ...V1, id: 'pol-a', status: 'APPROVED' } });
      await expect(
        service.activate('ATTENDANCE_POLICY', 'pol-a', { userId: 'e-1', role: 'EMPLOYEE' }),
      ).rejects.toBeInstanceOf(PolicyAuthorizationError);
    });

    it('ADMIN and SUPER_ADMIN may activate', async () => {
      for (const actor of [ADMIN, SUPER]) {
        const { service, delegate } = build({
          'pol-a': { ...V1, id: 'pol-a', status: 'APPROVED', createdById: 'hr-1' },
        });
        await service.activate('ATTENDANCE_POLICY', 'pol-a', actor);
        expect(delegate.update).toHaveBeenCalled();
      }
    });

    it('the draft creator may NOT also activate it, even as ADMIN', async () => {
      const { service } = build({
        'pol-a': { ...V1, id: 'pol-a', status: 'APPROVED', createdById: 'admin-1' },
      });
      await expect(service.activate('ATTENDANCE_POLICY', 'pol-a', ADMIN)).rejects.toBeInstanceOf(
        PolicySelfApprovalError,
      );
    });

    it('a second authorised actor can activate what the first created', async () => {
      const { service, delegate } = build({
        'pol-a': { ...V1, id: 'pol-a', status: 'APPROVED', createdById: 'admin-1' },
      });
      await service.activate('ATTENDANCE_POLICY', 'pol-a', SUPER);
      expect(delegate.update).toHaveBeenCalled();
    });

    it('the role check runs before any database read', async () => {
      const { service, delegate } = build({ 'pol-a': { ...V1, id: 'pol-a', status: 'APPROVED' } });
      await expect(service.activate('ATTENDANCE_POLICY', 'pol-a', HR)).rejects.toBeInstanceOf(
        PolicyAuthorizationError,
      );
      expect(delegate.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('an active version is frozen', () => {
    it('refuses to edit an ACTIVE version in place', async () => {
      const { service } = build({ 'pol-v1': V1 });
      await expect(
        service.updateDraft('ATTENDANCE_POLICY', 'pol-v1', { minimumWorkingMinutes: 480 }),
      ).rejects.toBeInstanceOf(PolicyImmutableError);
    });

    it('refuses to edit an APPROVED version', async () => {
      const { service } = build({ 'pol-a': { ...V1, id: 'pol-a', status: 'APPROVED' } });
      await expect(
        service.updateDraft('ATTENDANCE_POLICY', 'pol-a', { minimumWorkingMinutes: 480 }),
      ).rejects.toBeInstanceOf(PolicyImmutableError);
    });

    it('refuses to edit a SUPERSEDED version', async () => {
      const { service } = build({ 'pol-s': { ...V1, id: 'pol-s', status: 'SUPERSEDED' } });
      await expect(
        service.updateDraft('ATTENDANCE_POLICY', 'pol-s', { name: 'x' }),
      ).rejects.toBeInstanceOf(PolicyImmutableError);
    });

    it('allows editing a DRAFT', async () => {
      const { service, delegate } = build({ 'pol-d': { ...V1, id: 'pol-d', status: 'DRAFT' } });
      await service.updateDraft('ATTENDANCE_POLICY', 'pol-d', { minimumWorkingMinutes: 480 });
      expect(delegate.update.mock.calls[0][0].data.minimumWorkingMinutes).toBe(480);
    });

    it('strips lifecycle fields from a draft edit', async () => {
      const { service, delegate } = build({ 'pol-d': { ...V1, id: 'pol-d', status: 'DRAFT' } });
      await service.updateDraft('ATTENDANCE_POLICY', 'pol-d', {
        name: 'ok',
        status: 'ACTIVE',
        version: 99,
        approvedById: 'self',
        isActive: true,
      } as any);
      const data = delegate.update.mock.calls[0][0].data;
      expect(data.name).toBe('ok');
      expect(data.status).toBeUndefined();
      expect(data.version).toBeUndefined();
      expect(data.approvedById).toBeUndefined();
      expect(data.isActive).toBeUndefined();
    });
  });

  describe('issuing the next version', () => {
    it('increments version, starts as DRAFT, and is not active', async () => {
      const { service, delegate } = build({ 'pol-v1': V1 }, { latest: V1 });
      await service.createNextVersion(
        'ATTENDANCE_POLICY',
        'pol-v1',
        { afterPunchWindowAction: 'DEDUCT_FULL_PAID_LEAVE' },
        HR,
        '2026-10-01',
      );
      const data = delegate.create.mock.calls[0][0].data;
      expect(data.version).toBe(2);
      expect(data.status).toBe('DRAFT');
      expect(data.isActive).toBe(false);
      expect(data.afterPunchWindowAction).toBe('DEDUCT_FULL_PAID_LEAVE');
      expect(data.effectiveFrom).toEqual(d('2026-10-01'));
    });

    it('carries forward unchanged settings from the previous version', async () => {
      const { service, delegate } = build({ 'pol-v1': V1 }, { latest: V1 });
      await service.createNextVersion('ATTENDANCE_POLICY', 'pol-v1', {}, HR, '2026-10-01');
      const data = delegate.create.mock.calls[0][0].data;
      expect(data.minimumWorkingMinutes).toBe(540);
      expect(data.financialYear).toBe('2026-2027');
    });

    it('never carries the previous id, approval or supersession state', async () => {
      const { service, delegate } = build({ 'pol-v1': V1 }, { latest: V1 });
      await service.createNextVersion('ATTENDANCE_POLICY', 'pol-v1', {}, HR, '2026-10-01');
      const data = delegate.create.mock.calls[0][0].data;
      expect(data.id).toBeUndefined();
      expect(data.approvedById).toBeNull();
      expect(data.approvedAt).toBeNull();
      expect(data.supersededById).toBeNull();
      expect(data.createdById).toBe('hr-1');
    });

    it('does NOT touch the previous version — an abandoned draft changes nothing', async () => {
      const { service, delegate } = build({ 'pol-v1': V1 }, { latest: V1 });
      await service.createNextVersion('ATTENDANCE_POLICY', 'pol-v1', {}, HR, '2026-10-01');
      expect(delegate.update).not.toHaveBeenCalled();
    });
  });

  describe('activation is serialised per policy series', () => {
    const V2 = {
      ...V1,
      id: 'pol-v2',
      version: 2,
      status: 'APPROVED',
      createdById: 'hr-1',
      effectiveFrom: d('2026-10-01'),
    };

    it('locks the series BEFORE the active-version lookup, supersession and activation', async () => {
      const { service, tx, delegate } = build({ 'pol-v2': V2 }, { currentActive: V1 });
      await service.activate('ATTENDANCE_POLICY', 'pol-v2', ADMIN);

      const lock = tx.$queryRaw.mock.invocationCallOrder[0];
      const activeLookup = delegate.findFirst.mock.invocationCallOrder[0];
      expect(lock).toBeLessThan(activeLookup);
      for (const w of delegate.update.mock.invocationCallOrder) {
        expect(lock).toBeLessThan(w);
      }
    });

    it('re-reads the incoming version AFTER acquiring the lock', async () => {
      const { service, tx, delegate } = build({ 'pol-v2': V2 }, { currentActive: null });
      await service.activate('ATTENDANCE_POLICY', 'pol-v2', ADMIN);
      const lock = tx.$queryRaw.mock.invocationCallOrder[0];
      const reads = delegate.findUnique.mock.invocationCallOrder;
      expect(reads[0]).toBeLessThan(lock);
      expect(reads.some((r: number) => r > lock)).toBe(true);
    });

    it('binds policyKey as a parameter and inlines only the table name', async () => {
      const { service, tx } = build({ 'pol-v2': V2 }, { currentActive: null });
      await service.activate('ATTENDANCE_POLICY', 'pol-v2', ADMIN);
      const sql = tx.$queryRaw.mock.calls[0][0];
      expect(sql.sql).toContain('attendance_policies');
      expect(sql.sql).toContain('FOR UPDATE');
      expect(sql.values).toEqual(['attendance:default']);
    });

    it('resolves the outgoing ACTIVE version from the series, not from the caller', async () => {
      const { service, delegate } = build({ 'pol-v2': V2 }, { currentActive: V1 });
      await service.activate('ATTENDANCE_POLICY', 'pol-v2', ADMIN);
      const lookup = delegate.findFirst.mock.calls[0][0].where;
      expect(lookup.policyKey).toBe('attendance:default');
      expect(lookup.status).toBe('ACTIVE');
      expect(lookup.NOT).toEqual({ id: 'pol-v2' });
    });

    it('closes the outgoing version the day before the incoming one opens', async () => {
      const { service, delegate } = build({ 'pol-v2': V2 }, { currentActive: V1 });
      await service.activate('ATTENDANCE_POLICY', 'pol-v2', ADMIN);
      const supersede = delegate.update.mock.calls.find((c: any) => c[0].where.id === 'pol-v1')[0];
      expect(supersede.data.status).toBe('SUPERSEDED');
      expect(supersede.data.isActive).toBe(false);
      expect(supersede.data.supersededById).toBe('pol-v2');
      expect(supersede.data.effectiveTo).toEqual(d('2026-09-30'));
    });

    it('activates cleanly when the series has no ACTIVE version yet', async () => {
      const { service, delegate } = build({ 'pol-v2': V2 }, { currentActive: null });
      await service.activate('ATTENDANCE_POLICY', 'pol-v2', ADMIN);
      expect(delegate.update).toHaveBeenCalledTimes(1);
      expect(delegate.update.mock.calls[0][0].data.status).toBe('ACTIVE');
    });

    it('lock, supersede and activate all run in ONE transaction', async () => {
      const { service, prisma } = build({ 'pol-v2': V2 }, { currentActive: V1 });
      await service.activate('ATTENDANCE_POLICY', 'pol-v2', ADMIN);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('a draft that lost the race is rejected on the post-lock re-read', async () => {
      // By the time the lock is granted this draft is already SUPERSEDED,
      // because a competing activation promoted a sibling first.
      const stale = { ...V2, status: 'SUPERSEDED' };
      const { service } = build({ 'pol-v2': stale }, { currentActive: null });
      await expect(service.activate('ATTENDANCE_POLICY', 'pol-v2', ADMIN)).rejects.toBeInstanceOf(
        PolicyTransitionError,
      );
    });
  });

  describe('policy series identity', () => {
    it('a new version stays in the same series', async () => {
      const { service, delegate } = build({ 'pol-v1': V1 }, { latest: V1 });
      await service.createNextVersion('ATTENDANCE_POLICY', 'pol-v1', {}, HR, '2026-10-01');
      expect(delegate.create.mock.calls[0][0].data.policyKey).toBe('attendance:default');
    });

    it('policyKey is not caller-writable on a new version', async () => {
      const { service, delegate } = build({ 'pol-v1': V1 }, { latest: V1 });
      await service.createNextVersion(
        'ATTENDANCE_POLICY',
        'pol-v1',
        { policyKey: 'attendance:hijacked' } as any,
        HR,
        '2026-10-01',
      );
      expect(delegate.create.mock.calls[0][0].data.policyKey).toBe('attendance:default');
    });

    it('policyKey is stripped from a draft edit', async () => {
      const { service, delegate } = build({ 'pol-d': { ...V1, id: 'pol-d', status: 'DRAFT' } });
      await service.updateDraft('ATTENDANCE_POLICY', 'pol-d', { policyKey: 'other' } as any);
      expect(delegate.update.mock.calls[0][0].data.policyKey).toBeUndefined();
    });

    it('version is derived from the highest in the series, not the source row', async () => {
      const { service, delegate } = build(
        { 'pol-v1': V1 },
        { latest: { ...V1, id: 'pol-v3', version: 3 } },
      );
      await service.createNextVersion('ATTENDANCE_POLICY', 'pol-v1', {}, HR, '2026-10-01');
      expect(delegate.create.mock.calls[0][0].data.version).toBe(4);
    });

    it('two different shift series stay independent', async () => {
      const regular = { ...V1, id: 'shift-reg', policyKey: 'shift:regular-employee' };
      const { service, delegate } = build({ 'shift-reg': regular }, { latest: regular });
      await service.createNextVersion('SHIFT_POLICY', 'shift-reg', {}, HR, '2026-10-01');
      expect(delegate.create.mock.calls[0][0].data.policyKey).toBe('shift:regular-employee');
    });
  });

  describe('HolidayCalendar child versioning', () => {
    const CAL = { ...V1, id: 'cal-v1', policyKey: 'calendar:techno-2026' };
    const HOLIDAYS = [
      { id: 'h1', calendarId: 'cal-v1', date: d('2026-11-10'), name: 'Bhai Duj', isOptional: false },
      { id: 'h2', calendarId: 'cal-v1', date: d('2026-11-11'), name: 'Bhai Duj', isOptional: false },
    ];

    it('clones the holidays into the new draft calendar', async () => {
      const { service, holiday } = build({ 'cal-v1': CAL }, { latest: CAL, holidays: HOLIDAYS });
      await service.createNextVersion('HOLIDAY_CALENDAR', 'cal-v1', {}, HR, '2027-04-01');
      const cloned = holiday.createMany.mock.calls[0][0].data;
      expect(cloned).toHaveLength(2);
      expect(cloned.every((h: any) => h.calendarId === 'pol-new')).toBe(true);
      expect(cloned.map((h: any) => h.name)).toEqual(['Bhai Duj', 'Bhai Duj']);
    });

    it('clones inside the SAME transaction as the draft creation', async () => {
      const { service, prisma } = build({ 'cal-v1': CAL }, { latest: CAL, holidays: HOLIDAYS });
      await service.createNextVersion('HOLIDAY_CALENDAR', 'cal-v1', {}, HR, '2027-04-01');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('never mutates or deletes the original holidays', async () => {
      const { service, holiday } = build({ 'cal-v1': CAL }, { latest: CAL, holidays: HOLIDAYS });
      await service.createNextVersion('HOLIDAY_CALENDAR', 'cal-v1', {}, HR, '2027-04-01');
      expect((holiday as any).update).toBeUndefined();
      expect((holiday as any).delete).toBeUndefined();
      expect((holiday as any).deleteMany).toBeUndefined();
      expect(HOLIDAYS[0].calendarId).toBe('cal-v1');
    });

    it('cloned rows keep distinct dates, so the calendarId+date unique still holds', async () => {
      const { service, holiday } = build({ 'cal-v1': CAL }, { latest: CAL, holidays: HOLIDAYS });
      await service.createNextVersion('HOLIDAY_CALENDAR', 'cal-v1', {}, HR, '2027-04-01');
      const cloned = holiday.createMany.mock.calls[0][0].data;
      const pairs = cloned.map((h: any) => h.calendarId + '|' + h.date.toISOString());
      expect(new Set(pairs).size).toBe(pairs.length);
    });

    it('V1 and V2 diverge freely: the clones carry no id from the originals', async () => {
      const { service, holiday } = build({ 'cal-v1': CAL }, { latest: CAL, holidays: HOLIDAYS });
      await service.createNextVersion('HOLIDAY_CALENDAR', 'cal-v1', {}, HR, '2027-04-01');
      const cloned = holiday.createMany.mock.calls[0][0].data;
      expect(cloned.every((h: any) => h.id === undefined)).toBe(true);
      expect(HOLIDAYS.map((h) => h.calendarId)).toEqual(['cal-v1', 'cal-v1']);
    });

    it('an empty source calendar clones nothing rather than failing', async () => {
      const { service, holiday } = build({ 'cal-v1': CAL }, { latest: CAL, holidays: [] });
      await service.createNextVersion('HOLIDAY_CALENDAR', 'cal-v1', {}, HR, '2027-04-01');
      expect(holiday.createMany).not.toHaveBeenCalled();
    });

    it('non-calendar families never touch the holiday table', async () => {
      const { service, holiday } = build({ 'pol-v1': V1 }, { latest: V1 });
      await service.createNextVersion('ATTENDANCE_POLICY', 'pol-v1', {}, HR, '2026-10-01');
      expect(holiday.findMany).not.toHaveBeenCalled();
      expect(holiday.createMany).not.toHaveBeenCalled();
    });
  });

  describe('point-in-time resolution', () => {
    it('considers only versions that actually governed a day', async () => {
      const { service, delegate } = build();
      await service.resolvePolicyOn('ATTENDANCE_POLICY', '2026-06-15');
      const where = delegate.findFirst.mock.calls[0][0].where;
      expect(where.status).toEqual({ in: ['ACTIVE', 'SUPERSEDED'] });
    });

    it('a DRAFT or APPROVED version never applies to a real date', async () => {
      const { service, delegate } = build();
      await service.resolvePolicyOn('ATTENDANCE_POLICY', '2026-06-15');
      const statuses = delegate.findFirst.mock.calls[0][0].where.status.in;
      expect(statuses).not.toContain('DRAFT');
      expect(statuses).not.toContain('APPROVED');
    });

    it('uses the company business-DAY window, matching BL-3', async () => {
      const { service, delegate } = build();
      await service.resolvePolicyOn('ATTENDANCE_POLICY', '2026-06-15');
      const where = delegate.findFirst.mock.calls[0][0].where;
      // companyDayEnd(2026-06-15 IST) = 2026-06-15T18:29:59.999Z
      expect(where.effectiveFrom.lte.toISOString()).toBe('2026-06-15T18:29:59.999Z');
      expect(where.OR[1].effectiveTo.gte.toISOString()).toBe('2026-06-14T18:30:00.000Z');
    });

    it('prefers the newest applicable version deterministically', async () => {
      const { service, delegate } = build();
      await service.resolvePolicyOn('ATTENDANCE_POLICY', '2026-06-15');
      expect(delegate.findFirst.mock.calls[0][0].orderBy).toEqual([
        { effectiveFrom: 'desc' },
        { version: 'desc' },
      ]);
    });

    it('converts an instant through company time', async () => {
      const { service, delegate } = build();
      // 2026-06-15T19:15:00Z is 2026-06-16 00:45 IST.
      await service.resolvePolicyOn('ATTENDANCE_POLICY', new Date('2026-06-15T19:15:00.000Z'));
      const where = delegate.findFirst.mock.calls[0][0].where;
      expect(where.effectiveFrom.lte.toISOString()).toBe('2026-06-16T18:29:59.999Z');
    });
  });

  describe('undecided management rules are configurable, and safe by default', () => {
    it('defaults require review rather than deducting anything', () => {
      expect(V1.afterPunchWindowAction).toBe('REQUIRE_REVIEW');
      expect(V1.insufficientHoursAction).toBe('REQUIRE_REVIEW');
      expect(V1.automaticHalfDayEnabled).toBe(false);
    });

    it('management can change the rule via a new version without touching history', async () => {
      const { service, delegate } = build({ 'pol-v1': V1 }, { latest: V1 });
      await service.createNextVersion(
        'ATTENDANCE_POLICY',
        'pol-v1',
        {
          afterPunchWindowAction: 'DEDUCT_FULL_PAID_LEAVE',
          insufficientHoursAction: 'MARK_LWP',
          automaticHalfDayEnabled: true,
        },
        HR,
        '2026-10-01',
      );
      const data = delegate.create.mock.calls[0][0].data;
      expect(data.afterPunchWindowAction).toBe('DEDUCT_FULL_PAID_LEAVE');
      expect(data.insufficientHoursAction).toBe('MARK_LWP');
      expect(data.automaticHalfDayEnabled).toBe(true);
      // V1 itself is untouched.
      expect(delegate.update).not.toHaveBeenCalled();
      expect(V1.afterPunchWindowAction).toBe('REQUIRE_REVIEW');
    });
  });

  describe('all four policy families share the lifecycle', () => {
    it.each([
      ['ATTENDANCE_POLICY'],
      ['SHIFT_POLICY'],
      ['LEAVE_POLICY'],
      ['HOLIDAY_CALENDAR'],
    ])('%s supports approve and activate', async (kind) => {
      const { service, delegate } = build(
        { 'p': { ...V1, id: 'p', status: 'APPROVED', createdById: 'hr-1' } },
        { currentActive: null },
      );
      await service.activate(kind as any, 'p', ADMIN);
      expect(delegate.update.mock.calls[0][0].data.status).toBe('ACTIVE');
    });

    it('rejects an unknown policy kind rather than guessing', async () => {
      const { service } = build();
      await expect(
        service.resolvePolicyOn('NOT_A_POLICY' as any, '2026-06-15'),
      ).rejects.toThrow(/Unknown policy kind/);
    });
  });
});
