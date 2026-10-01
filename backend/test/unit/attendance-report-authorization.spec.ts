import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { AttendanceReportService } from '../../src/modules/platform/attendance/canonical/attendance-report.service';

/**
 * AUTHORIZATION ON THE CANONICAL REPORT PATH.
 *
 * These replace the authorization coverage that lived on the retired console
 * export (`exportRegister`, `register/export.xlsx`, `register/export.csv`).
 * Those tests proved an employee or an out-of-scope manager could not export
 * the register; deleting them with the stack would have dropped that guarantee,
 * so it is re-asserted here against the service that now serves both the
 * console and the download.
 *
 * The check lives in the SERVICE, not the controller, so it cannot be bypassed
 * by reaching the service another way -- and both routes go through this one
 * method.
 */

const HR = { id: 'hr-1', name: 'Priya', role: { name: 'HR' } };
const ADMIN = { id: 'ad-1', name: 'Admin', role: { name: 'ADMIN' } };
const SUPER = { id: 'sa-1', name: 'Root', role: { name: 'SUPER_ADMIN' } };
const MANAGER = { id: 'mg-1', name: 'Manager', role: { name: 'MANAGER' } };
const TEAM_LEAD = { id: 'tl-1', name: 'Lead', role: { name: 'TEAM_LEAD' } };
const EMPLOYEE = { id: 'e-1', name: 'Rahul', role: { name: 'EMPLOYEE' } };
const INTERN = { id: 'in-1', name: 'Intern', role: { name: 'INTERN' } };

function build() {
  const reads: string[] = [];

  const prisma: any = {
    user: {
      findMany: jest.fn(async () => {
        reads.push('user.findMany');
        return [];
      }),
    },
    dailyAttendance: { findMany: jest.fn(async () => []) },
    attendancePunchEvidence: { findMany: jest.fn(async () => []) },
    workSession: { findMany: jest.fn(async () => []) },
    leaveRequest: { findMany: jest.fn(async () => []) },
    attendanceRegularization: { findMany: jest.fn(async () => []) },
    attendancePolicy: { findMany: jest.fn(async () => []) },
    shiftPolicy: { findMany: jest.fn(async () => []) },
  };

  const service = new AttendanceReportService(
    prisma,
    {
      now: () => new Date('2026-10-01T06:00:00.000Z'),
      companyTimezone: () => 'Asia/Kolkata',
      companyDateOnly: (d: Date) => d,
      companyBusinessDate: (d: Date) => d.toISOString().slice(0, 10),
    } as any,
    {
      isHrOrAdmin: (u: any) => ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(u?.role?.name),
    } as any,
    { classifyMonth: jest.fn(async () => ({ month: '2026-09', workingDays: 22, sources: {}, days: [] })) } as any,
  );

  return { service, prisma, reads };
}

// ════════════════════════════════════════════════════════════════════════════
describe('only HR and Admin equivalents may read the attendance report', () => {
  it('ALLOWS HR, ADMIN AND SUPER_ADMIN', async () => {
    for (const actor of [HR, ADMIN, SUPER]) {
      const ctx = build();
      await expect(ctx.service.monthReport(actor, '2026-09')).resolves.toBeDefined();
    }
  });

  it('REFUSES EVERY OTHER ROLE', async () => {
    for (const actor of [MANAGER, TEAM_LEAD, EMPLOYEE, INTERN]) {
      const ctx = build();
      await expect(ctx.service.monthReport(actor, '2026-09')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
  });

  it('REFUSES BEFORE READING ANY DATA', async () => {
    // The order matters: a check that ran after the query would already have
    // loaded the month into memory for somebody not allowed to see it.
    const ctx = build();

    await expect(ctx.service.monthReport(EMPLOYEE, '2026-09')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(ctx.reads).toHaveLength(0);
    expect(ctx.prisma.dailyAttendance.findMany).not.toHaveBeenCalled();
  });

  it('refuses a missing or malformed actor', async () => {
    for (const actor of [null, undefined, {}, { role: null }, { role: { name: '' } }]) {
      const ctx = build();
      await expect(ctx.service.monthReport(actor as any, '2026-09')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the month argument is validated', () => {
  it('refuses anything that is not yyyy-MM', async () => {
    for (const month of ['2026-9', '2026-13', '2026-00', 'September', '', '2026', '2026-09-01']) {
      const ctx = build();
      await expect(ctx.service.monthReport(HR, month)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it('accepts a well-formed month', async () => {
    const ctx = build();
    await expect(ctx.service.monthReport(HR, '2026-09')).resolves.toMatchObject({
      month: '2026-09',
    });
  });

  it('validates authorization BEFORE the month, so a bad month cannot probe', async () => {
    // An employee passing a malformed month must be refused for the reason that
    // actually applies to them.
    const ctx = build();
    await expect(ctx.service.monthReport(EMPLOYEE, 'nonsense')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
