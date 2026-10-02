/**
 * WHO MAY CHANGE ATTENDANCE, AND WHO MAY ONLY READ IT.
 *
 * THERE IS NO "ACCOUNTS" ROLE IN APEX OS, AND THAT IS THE FINDING THESE TESTS
 * RECORD. The canonical ladder is six entries, guarded by
 * CANONICAL_ROLE_COUNT: SUPER_ADMIN, ADMIN, MANAGER, TEAM_LEAD, EMPLOYEE,
 * INTERN. "Accounts" is a DEPARTMENT -- it appears in the department colour
 * map beside IT, Facilities and QC Team -- so somebody in Accounts holds one
 * of those six roles, almost always EMPLOYEE, occasionally MANAGER.
 *
 * Read-only for Accounts therefore is not a rule to be written; it is a
 * consequence of the role they already hold, and what these tests do is prove
 * that consequence actually holds at every attendance mutation rather than
 * leaving it asserted in a document. An Accounts employee is tested as what
 * they are: an EMPLOYEE, with no isHR flag and no managed departments.
 *
 * Every denial below is checked at the SERVICE, not at a controller or a
 * button, because that is the only layer a crafted request cannot route
 * around.
 */
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CANONICAL_ROLES,
  CANONICAL_ROLE_COUNT,
  ROLES,
} from '../../src/shared/constants/roles';
import { TVAService } from '../../src/common/services/tva.service';
import { AttendanceReportService } from '../../src/modules/platform/attendance/canonical/attendance-report.service';
import { CompOffService } from '../../src/modules/operations/leave/comp-off.service';

const tvaOf = () => new TVAService({ get: () => undefined } as unknown as ConfigService);

/**
 * The people. An Accounts employee and an Accounts manager are modelled as
 * exactly what the product gives them: a role, and a department named
 * Accounts.
 */
const ACCOUNTS_EMPLOYEE = {
  id: 'acct-1',
  role: { name: ROLES.EMPLOYEE },
  departmentId: 'dept-accounts',
};
const ACCOUNTS_MANAGER = {
  id: 'acct-mgr',
  role: { name: ROLES.MANAGER },
  departmentId: 'dept-accounts',
};
const DELIVERY_EMPLOYEE = {
  id: 'emp-1',
  role: { name: ROLES.EMPLOYEE },
  departmentId: 'dept-delivery',
};
const HR = { id: 'hr-1', role: { name: ROLES.ADMIN }, isHR: true };

// ════════════════════════════════════════════════════════════════════════════
describe('the role ladder this product actually has', () => {
  it('HAS NO ACCOUNTS ROLE', () => {
    // Pinned so the premise behind the rest of this file is checked, not
    // remembered. If Accounts ever becomes a real role, this fails and tells
    // whoever added it that the attendance access rules need revisiting.
    const names = CANONICAL_ROLES.map((r) => r.name);

    expect(names).toEqual([
      'SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEAD', 'EMPLOYEE', 'INTERN',
    ]);
    expect(names).not.toContain('ACCOUNTS');
    expect(names).not.toContain('FINANCE');
    expect(CANONICAL_ROLES).toHaveLength(CANONICAL_ROLE_COUNT);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('an Accounts employee cannot change attendance', () => {
  function reportRig() {
    const prisma: any = {
      user: { findMany: jest.fn(async () => []) },
      dailyAttendance: { findMany: jest.fn(async () => []) },
      attendancePunchEvidence: { findMany: jest.fn(async () => []) },
      workSession: { findMany: jest.fn(async () => []) },
      leaveRequest: { findMany: jest.fn(async () => []) },
      attendanceRegularization: { findMany: jest.fn(async () => []) },
      attendancePolicy: { findMany: jest.fn(async () => []) },
      shiftPolicy: { findMany: jest.fn(async () => []) },
      appSetting: { findUnique: jest.fn(async () => null) },
    };
    const service = new AttendanceReportService(
      prisma,
      {
        now: () => new Date('2026-10-02T06:00:00.000Z'),
        companyTimezone: () => 'Asia/Kolkata',
        companyDateOnly: (d: Date) => d,
        companyBusinessDate: (d: Date) => d.toISOString().slice(0, 10),
      } as any,
      {
        isHrOrAdmin: (u: any) =>
          Boolean(u?.isHR) || ['ADMIN', 'SUPER_ADMIN'].includes(u?.role?.name),
      } as any,
      {
        classifyMonth: jest.fn(async () => ({
          month: '2026-09',
          sources: { weeklyOffPolicy: { resolved: true } },
          days: [],
        })),
      } as any,
    );
    return { service, prisma };
  }

  it('CANNOT READ THE COMPANY REGISTER, which is HR-only', async () => {
    // Not a read-only grant either: the company-wide register is payroll
    // input, and an Accounts employee has no authorization to it today.
    // Giving them one is a product decision, not a wiring gap.
    const { service } = reportRig();

    await expect(
      service.monthReport(ACCOUNTS_EMPLOYEE, '2026-09'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.monthReport(ACCOUNTS_MANAGER, '2026-09'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('CAN READ THEIR OWN attendance, month and year', async () => {
    // The read that does exist for them, and it is scoped to themselves by
    // the JWT subject with no userId parameter to point elsewhere.
    const { service } = reportRig();

    await expect(service.myMonth(ACCOUNTS_EMPLOYEE, '2026-09')).resolves.toBeDefined();
    await expect(service.myYear(ACCOUNTS_EMPLOYEE, '2026')).resolves.toBeDefined();
  });

  it('CANNOT READ ANOTHER EMPLOYEE through the self-service route', async () => {
    // There is no parameter to try. The scope is the subject, so the test is
    // that the rows come back belonging to the caller and nobody else.
    const { service, prisma } = reportRig();

    await service.myMonth(ACCOUNTS_EMPLOYEE, '2026-09');

    const restriction = (prisma.user.findMany.mock.calls[0][0].where.AND ?? []).find(
      (c: any) => c?.id?.in,
    );
    expect(restriction).toEqual({ id: { in: ['acct-1'] } });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('an Accounts employee cannot grant or extend comp off', () => {
  function compOffRig() {
    const created: any[] = [];
    const updates: any[] = [];
    const prisma: any = {
      $transaction: jest.fn((fn: any) =>
        fn({
          compOffCredit: {
            update: jest.fn(async (a: any) => {
              updates.push(a);
              return a.data;
            }),
          },
          operationalEvent: { create: jest.fn(async () => ({})) },
        }),
      ),
      compOffCredit: {
        findUnique: jest.fn(async () => ({
          id: 'credit-1',
          employeeId: 'emp-1',
          status: 'AVAILABLE',
          earnedAt: new Date('2026-09-05T06:00:00.000Z'),
          expiresAt: new Date('2026-10-20T00:00:00.000Z'),
          earnedFromBusinessDate: new Date('2026-09-06T00:00:00.000Z'),
        })),
        create: jest.fn(async (a: any) => {
          created.push(a.data);
          return { id: 'c', ...a.data };
        }),
        findMany: jest.fn(async () => []),
      },
      user: {
        findUnique: jest.fn(async ({ where }: any) => ({
          id: where.id,
          departmentId: 'dept-delivery',
        })),
      },
      leavePolicy: {
        findUnique: jest.fn(async () => ({
          compOffExpiryDays: 45,
          compOffMaximumValidityDays: 60,
        })),
      },
      managerDeptAccess: { findMany: jest.fn(async () => []) },
    };

    const accessPolicy: any = {
      isHrOrAdmin: (u: any) =>
        Boolean(u?.isHR) || ['ADMIN', 'SUPER_ADMIN'].includes(u?.role?.name),
      roleName: (u: any) => u?.role?.name ?? '',
      // An Accounts manager manages Accounts, and nothing else.
      managedDepartmentIds: jest.fn(async (u: any) =>
        u?.departmentId ? [u.departmentId] : [],
      ),
    };

    const service = new CompOffService(
      prisma,
      tvaOf(),
      {
        resolveBusinessDay: jest.fn(async () => ({
          isWorkingDay: false,
          weeklyOff: { isWeeklyOff: true, reasons: ['SUNDAY'] },
          holiday: { isHoliday: false },
        })),
      } as any,
      {
        findProfileOn: jest.fn(async () => ({
          assignedHolidayCalendarId: 'cal-1',
          assignedWeeklyOffPolicyId: 'week-1',
          assignedLeavePolicyId: 'lp-1',
        })),
      } as any,
      accessPolicy,
      { log: jest.fn(async () => undefined) } as any,
    );

    return { service, created, updates };
  }

  const GRANT = {
    employeeId: 'emp-1',
    earnedFromBusinessDate: '2026-09-06',
    reason: 'Worked the Sunday release',
  };
  const EXTEND = { newExpiry: '2026-10-25', reason: 'Delivery slipped' };

  it('GRANT DENIED for an Accounts employee', async () => {
    const { service, created } = compOffRig();

    await expect(service.grantManual(ACCOUNTS_EMPLOYEE, GRANT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(created).toHaveLength(0);
  });

  it('EXTENSION DENIED for an Accounts employee', async () => {
    const { service, updates } = compOffRig();

    await expect(
      service.extendValidity(ACCOUNTS_EMPLOYEE, 'credit-1', EXTEND),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(updates).toHaveLength(0);
  });

  it('AN ACCOUNTS MANAGER IS STILL CONFINED TO ACCOUNTS', async () => {
    // Being a manager is not company-wide authority. The target here is in
    // Delivery, so managing Accounts buys nothing.
    const { service, created, updates } = compOffRig();

    await expect(service.grantManual(ACCOUNTS_MANAGER, GRANT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.extendValidity(ACCOUNTS_MANAGER, 'credit-1', EXTEND),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(created).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('A DELIVERY EMPLOYEE CANNOT GRANT EITHER, so this is about role not department', async () => {
    // Guards against the denials above passing merely because the department
    // string happened not to match.
    const { service, created } = compOffRig();

    await expect(service.grantManual(DELIVERY_EMPLOYEE, GRANT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(created).toHaveLength(0);
  });

  it('HR STILL GRANTS, so the rig is capable of succeeding', async () => {
    // Without this, every denial above could be passing because the rig
    // refuses everything.
    const { service, created } = compOffRig();

    await service.grantManual(HR, GRANT);

    expect(created).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('reopen and finalize stay with HR', () => {
  // Both go through the same assertHr in PayrollReportService, so the rule is
  // tested where it is written rather than per endpoint. payroll-month-close
  // covers HR's own path; this covers the refusal for everybody else.
  const { PayrollReportService } = require('../../src/modules/platform/attendance/reports/payroll-report.service');

  function payrollRig() {
    const prisma: any = {
      $transaction: jest.fn((fn: any) => fn(prisma)),
      attendanceMonthClose: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
      },
      $executeRaw: jest.fn(async () => 0),
    };
    const service = new PayrollReportService(
      prisma,
      { now: () => new Date('2026-10-02T06:00:00.000Z'), companyDateOnly: (d: Date) => d } as any,
      {
        isHrOrAdmin: (u: any) =>
          Boolean(u?.isHR) || ['ADMIN', 'SUPER_ADMIN'].includes(u?.role?.name),
      } as any,
      { log: jest.fn(async () => undefined) } as any,
      { get: jest.fn(async () => null), set: jest.fn(async () => undefined) } as any,
      { sendPayrollAttendanceReport: jest.fn(async () => ({ outcome: 'SENT' })) } as any,
      { monthReport: jest.fn(async () => ({ dailyRows: [], summaryRows: [], metadata: {} })) } as any,
    );
    return { service, prisma };
  }

  it.each([
    ['an Accounts employee', ACCOUNTS_EMPLOYEE],
    ['an Accounts manager', ACCOUNTS_MANAGER],
    ['an ordinary employee', DELIVERY_EMPLOYEE],
  ])('REFUSES finalize, reopen and send for %s', async (_label, actor) => {
    const { service } = payrollRig();

    await expect(service.finalize(actor, '2026-09')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.reopen(actor, '2026-09', 'Correcting the 14th'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.send(actor, '2026-09')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('REFUSES BEFORE TOUCHING THE MONTH AT ALL', async () => {
    // The refusal is authorization, not a side effect of the month happening
    // to be absent: no transaction is opened and no row is read on the way to
    // it. Asserted by watching the double, not by inspecting the service.
    const { service, prisma } = payrollRig();

    await expect(
      service.reopen(ACCOUNTS_EMPLOYEE, '2026-09', 'Correcting the 14th'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.attendanceMonthClose.findUnique).not.toHaveBeenCalled();
  });
});
