/**
 * MANAGER COMP OFF: WHO MAY ACT, AND HOW FAR THE CEILING LETS THEM.
 *
 * Two things are under test and they fail differently, so both are covered:
 *
 *   SCOPE    A manager may act only inside the departments they manage. The
 *            check lives in the service, so reaching it from anywhere -- a
 *            different controller, a script, a future endpoint -- is refused
 *            the same way. Hiding a button is not what is stopping anyone.
 *
 *   CEILING  An extension may move an expiry forward, never past 60 days from
 *            the GRANT. Measured from the current expiry instead, each
 *            extension would move its own baseline and a credit could be
 *            walked forward forever without ever breaching anything -- so the
 *            repeated-extension case is tested explicitly, not assumed.
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TVAService } from '../../src/common/services/tva.service';
import { CompOffService } from '../../src/modules/operations/leave/comp-off.service';
import { addDays } from '../../src/modules/operations/leave/comp-off-workflow';

const tvaOf = () => new TVAService({ get: () => undefined } as unknown as ConfigService);

/** 5 September 2026, the day every credit below was granted. */
const GRANTED_AT = new Date('2026-09-05T06:00:00.000Z');
const GRANTED_ON = tvaOf().companyDateOnly(GRANTED_AT);

const HR = { id: 'hr-1', role: { name: 'ADMIN' }, isHR: true };
const MANAGER = { id: 'mgr-1', role: { name: 'MANAGER' }, departmentId: 'dept-a' };
const OTHER_MANAGER = { id: 'mgr-2', role: { name: 'MANAGER' }, departmentId: 'dept-b' };
const TEAM_LEAD = { id: 'tl-1', role: { name: 'TEAM_LEAD' }, departmentId: 'dept-a' };
const EMPLOYEE = { id: 'emp-1', role: { name: 'EMPLOYEE' }, departmentId: 'dept-a' };

const HOLIDAY_FACTS = {
  isWorkingDay: false,
  weeklyOff: { isWeeklyOff: true, reasons: ['SUNDAY'] },
  holiday: { isHoliday: false },
};

interface Opts {
  /** The credit under test. Defaults to a live one granted on 5 September. */
  credit?: Partial<{
    id: string;
    employeeId: string;
    status: string;
    earnedAt: Date;
    expiresAt: Date;
    earnedFromBusinessDate: Date;
  }>;
  /** Departments the acting manager manages. */
  managed?: string[];
  /** The target employee's department. */
  employeeDept?: string | null;
  expiryDays?: number;
  maxValidityDays?: number | null;
}

function rig(opts: Opts = {}) {
  const events: any[] = [];
  const updates: any[] = [];
  const created: any[] = [];

  const credit = {
    id: 'credit-1',
    employeeId: 'emp-1',
    status: 'AVAILABLE',
    earnedAt: GRANTED_AT,
    expiresAt: addDays(GRANTED_ON, 45),
    earnedFromBusinessDate: new Date('2026-09-06T00:00:00.000Z'),
    ...(opts.credit ?? {}),
  };

  const tx: any = {
    compOffCredit: {
      update: jest.fn(async (args: any) => {
        updates.push(args);
        return { ...credit, ...args.data };
      }),
    },
    operationalEvent: {
      create: jest.fn(async (args: any) => {
        events.push(args.data);
        return args.data;
      }),
    },
  };

  const prisma: any = {
    $transaction: jest.fn((fn: any) => fn(tx)),
    compOffCredit: {
      findUnique: jest.fn(async () => (opts.credit === null ? null : credit)),
      create: jest.fn(async (args: any) => {
        const row = { id: 'credit-new', ...args.data };
        created.push(row);
        return row;
      }),
      findMany: jest.fn(async () => []),
    },
    user: {
      findUnique: jest.fn(async ({ where }: any) => ({
        id: where.id,
        departmentId: 'employeeDept' in opts ? opts.employeeDept : 'dept-a',
      })),
    },
    leavePolicy: {
      findUnique: jest.fn(async () => ({
        compOffExpiryDays: opts.expiryDays ?? 45,
        compOffMaximumValidityDays:
          opts.maxValidityDays === undefined ? 60 : opts.maxValidityDays,
      })),
    },
    managerDeptAccess: { findMany: jest.fn(async () => []) },
  };

  // The real predicates, not stubs: roleName and managedDepartmentIds are what
  // the scope rule is built on, and faking them would test the fake.
  const accessPolicy: any = {
    isHrOrAdmin: (u: any) => Boolean(u?.isHR) || ['ADMIN', 'SUPER_ADMIN'].includes(u?.role?.name),
    roleName: (u: any) => u?.role?.name ?? '',
    managedDepartmentIds: jest.fn(async (u: any) =>
      opts.managed ?? (u?.departmentId ? [u.departmentId] : []),
    ),
  };

  const calendar: any = { resolveBusinessDay: jest.fn(async () => HOLIDAY_FACTS) };
  const timeline: any = {
    findProfileOn: jest.fn(async () => ({
      assignedHolidayCalendarId: 'cal-1',
      assignedWeeklyOffPolicyId: 'week-1',
      assignedLeavePolicyId: 'lp-1',
    })),
  };
  const eventLogger: any = { log: jest.fn(async () => undefined) };

  const service = new CompOffService(
    prisma, tvaOf(), calendar, timeline, accessPolicy, eventLogger,
  );

  return { service, prisma, events, updates, created, credit };
}

const GRANT = {
  employeeId: 'emp-1',
  earnedFromBusinessDate: '2026-09-06',
  reason: 'Worked the Sunday release',
};

// ════════════════════════════════════════════════════════════════════════════
describe('who may grant comp off', () => {
  it('A MANAGER MAY GRANT inside a department they manage', async () => {
    const { service, created } = rig({ managed: ['dept-a'], employeeDept: 'dept-a' });

    await service.grantManual(MANAGER, GRANT);

    expect(created).toHaveLength(1);
    expect(created[0].employeeId).toBe('emp-1');
  });

  it('A MANAGER MAY NOT GRANT outside their departments', async () => {
    const { service, created } = rig({ managed: ['dept-b'], employeeDept: 'dept-a' });

    await expect(service.grantManual(OTHER_MANAGER, GRANT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(created).toHaveLength(0);
  });

  it('refuses an employee with no department rather than letting them through', async () => {
    // A null department must not compare equal to anything in the managed list.
    const { service, created } = rig({ managed: ['dept-a'], employeeDept: null });

    await expect(service.grantManual(MANAGER, GRANT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(created).toHaveLength(0);
  });

  it('AN EMPLOYEE MAY NOT GRANT, to anyone', async () => {
    const { service, created } = rig({ managed: [], employeeDept: 'dept-a' });

    await expect(service.grantManual(EMPLOYEE, GRANT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(created).toHaveLength(0);
  });

  it('NOBODY GRANTS TO THEMSELF, manager included', async () => {
    // The authority exists to recognise somebody else's weekend work.
    const { service, created } = rig({ managed: ['dept-a'], employeeDept: 'dept-a' });

    await expect(
      service.grantManual(MANAGER, { ...GRANT, employeeId: MANAGER.id }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(created).toHaveLength(0);
  });

  it('a team lead may not grant, which takes nothing away', async () => {
    // Granting was HR/Admin-only before managers were wired up, so a team lead
    // never had this. Including them would be a product decision.
    const { service } = rig({ managed: ['dept-a'], employeeDept: 'dept-a' });

    await expect(service.grantManual(TEAM_LEAD, GRANT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('HR AND ADMIN STILL GRANT ANYWHERE, unchanged', async () => {
    const { service, created } = rig({ managed: [], employeeDept: 'dept-z' });

    await service.grantManual(HR, GRANT);

    expect(created).toHaveLength(1);
  });

  it('GRANTS +45 DAYS FROM THE GRANT DATE by default', async () => {
    const { service, created } = rig({ managed: ['dept-a'], expiryDays: 45 });

    await service.grantManual(MANAGER, GRANT);

    const today = tvaOf().companyDateOnly(new Date());
    expect(created[0].expiresAt.toISOString().slice(0, 10)).toBe(
      addDays(today, 45).toISOString().slice(0, 10),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('who may extend, and how far', () => {
  const EXTEND = (days: number) => ({
    newExpiry: addDays(GRANTED_ON, days).toISOString().slice(0, 10),
    reason: 'Project ran into the following month',
  });

  it('A MANAGER MAY EXTEND inside their departments', async () => {
    const { service, updates } = rig({ managed: ['dept-a'] });

    await service.extendValidity(MANAGER, 'credit-1', EXTEND(50));

    expect(updates).toHaveLength(1);
    expect(updates[0].data.expiresAt.toISOString().slice(0, 10)).toBe(
      addDays(GRANTED_ON, 50).toISOString().slice(0, 10),
    );
  });

  it('A MANAGER MAY NOT EXTEND outside their departments', async () => {
    const { service, updates } = rig({ managed: ['dept-b'], employeeDept: 'dept-a' });

    await expect(
      service.extendValidity(OTHER_MANAGER, 'credit-1', EXTEND(50)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(updates).toHaveLength(0);
  });

  it('AN EMPLOYEE MAY NOT EXTEND their own credit', async () => {
    const { service, updates } = rig({ managed: [] });

    await expect(
      service.extendValidity(EMPLOYEE, 'credit-1', EXTEND(50)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(updates).toHaveLength(0);
  });

  it('ALLOWS exactly 60 days from the grant', async () => {
    const { service, updates } = rig({ managed: ['dept-a'] });

    await service.extendValidity(MANAGER, 'credit-1', EXTEND(60));

    expect(updates).toHaveLength(1);
  });

  it('REFUSES 61 days from the grant', async () => {
    const { service, updates } = rig({ managed: ['dept-a'] });

    await expect(
      service.extendValidity(MANAGER, 'credit-1', EXTEND(61)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updates).toHaveLength(0);
  });

  it('A SECOND EXTENSION CANNOT WALK PAST 60, even from a credit already at 60', async () => {
    // THE CASE THE CEILING EXISTS FOR. Measured from the current expiry this
    // would read as "60 + 15" and pass; measured from the grant it is day 75
    // and is refused. Without this test the difference is invisible.
    const { service, updates } = rig({
      managed: ['dept-a'],
      credit: { expiresAt: addDays(GRANTED_ON, 60) },
    });

    await expect(
      service.extendValidity(MANAGER, 'credit-1', EXTEND(75)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updates).toHaveLength(0);
  });

  it('refuses an extension that does not move the expiry forward', async () => {
    const { service } = rig({ managed: ['dept-a'] });

    // Equal to the current expiry: an extension that changes nothing would put
    // a decision in the audit trail that had no effect.
    await expect(
      service.extendValidity(MANAGER, 'credit-1', EXTEND(45)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to extend a credit that has been used', async () => {
    const { service } = rig({ managed: ['dept-a'], credit: { status: 'USED' } });

    await expect(
      service.extendValidity(MANAGER, 'credit-1', EXTEND(50)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses when the policy configures no ceiling at all', async () => {
    // An absent maximum is an unwritten rule, not permission to extend freely.
    const { service } = rig({ managed: ['dept-a'], maxValidityDays: null });

    await expect(
      service.extendValidity(MANAGER, 'credit-1', EXTEND(50)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a reason', async () => {
    const { service } = rig({ managed: ['dept-a'] });

    for (const bad of ['', '   ', 'fix']) {
      await expect(
        service.extendValidity(MANAGER, 'credit-1', { ...EXTEND(50), reason: bad }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('refuses a malformed date rather than guessing one', async () => {
    const { service } = rig({ managed: ['dept-a'] });

    await expect(
      service.extendValidity(MANAGER, 'credit-1', { newExpiry: '06-11-2026', reason: 'valid reason' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports a credit that does not exist as missing, not as forbidden', async () => {
    const { service } = rig({ credit: null as any });

    await expect(
      service.extendValidity(HR, 'nope', EXTEND(50)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the extension audit', () => {
  const EXTEND = {
    newExpiry: addDays(GRANTED_ON, 55).toISOString().slice(0, 10),
    reason: 'Client delivery slipped into October',
  };

  it('RECORDS BOTH EXPIRIES, the actor and the reason', async () => {
    const { service, events } = rig({ managed: ['dept-a'] });

    await service.extendValidity(MANAGER, 'credit-1', EXTEND);

    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.action).toBe('COMP_OFF_EXTENDED');
    expect(event.entityType).toBe('CompOffCredit');
    expect(event.entityId).toBe('credit-1');
    expect(event.actorId).toBe('mgr-1');
    expect(event.metadata.reason).toBe(EXTEND.reason);

    // The previous expiry is the question a dispute actually asks, and the
    // credit row itself no longer holds it.
    expect(event.beforeValue.expiresAt.toISOString().slice(0, 10)).toBe(
      addDays(GRANTED_ON, 45).toISOString().slice(0, 10),
    );
    expect(event.afterValue.expiresAt.toISOString().slice(0, 10)).toBe(EXTEND.newExpiry);
    expect(event.beforeValue.expiresAt).not.toEqual(event.afterValue.expiresAt);
  });

  it('WRITES THE AUDIT IN THE SAME TRANSACTION as the change', async () => {
    // Not through eventLogger.log(), which swallows its own failures. An
    // extension whose audit quietly failed is one nobody can account for.
    const { service, prisma } = rig({ managed: ['dept-a'] });

    await service.extendValidity(MANAGER, 'credit-1', EXTEND);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('writes NO audit when the extension is refused', async () => {
    const { service, events } = rig({ managed: ['dept-a'] });

    await expect(
      service.extendValidity(MANAGER, 'credit-1', {
        newExpiry: addDays(GRANTED_ON, 61).toISOString().slice(0, 10),
        reason: 'Past the ceiling',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(events).toEqual([]);
  });

  it('records the ceiling it judged against', async () => {
    const { service, events } = rig({ managed: ['dept-a'] });

    await service.extendValidity(MANAGER, 'credit-1', EXTEND);

    expect(events[0].metadata.ceiling.toISOString().slice(0, 10)).toBe(
      addDays(GRANTED_ON, 60).toISOString().slice(0, 10),
    );
  });
});
