import { readFileSync } from 'fs';
import { resolve } from 'path';
import { LeaveType } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { TVAService } from '../../src/common/services/tva.service';
import { LeaveBalanceService } from '../../src/modules/operations/leave/leave-balance.service';

describe('management leave entitlements', () => {
  const rig = (rows: any[] = [], leaveApprovalEnabled = false) => {
    const prisma: any = {
      employeeAttendanceProfile: {
        findFirst: jest.fn().mockResolvedValue({
          assignedLeavePolicy: {
            totalPaidLeaves: 14,
            casualLeaveAllocation: 10,
            emergencyLeaveAllocation: 4,
          },
        }),
      },
      leaveRequest: {
        findMany: jest.fn().mockResolvedValue(rows),
        count: jest.fn().mockResolvedValue(0),
      },
      user: { findUnique: jest.fn() },
    };
    const settings: any = {
      get: jest.fn((key: string) =>
        Promise.resolve(
          key === 'attendance_v2'
            ? { leaveAuthorityEnabled: true, leaveApprovalEnabled }
            : {},
        ),
      ),
      getLeaveQuotas: jest.fn(),
    };
    const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);
    const workingDays: any = {
      countWorkingDays: jest.fn().mockResolvedValue(1),
      enumerateBusinessDates: jest.fn(),
    };
    return { service: new LeaveBalanceService(prisma, settings, tva, workingDays), prisma };
  };

  it('keeps Casual 10 and Emergency 4 as separate FY authorities', async () => {
    const { service } = rig();
    expect(await service.getYearlyAllocation('emp-1', 2026, LeaveType.CASUAL)).toBe(10);
    expect(await service.getYearlyAllocation('emp-1', 2026, LeaveType.EMERGENCY)).toBe(4);
  });

  it('uses TVA financial-year bounds for management balances', async () => {
    const { service, prisma } = rig();
    await service.getLeaveBalance('emp-1', 2026, LeaveType.CASUAL);
    const range = prisma.leaveRequest.findMany.mock.calls[0][0].where.startDate;
    expect(range.gte.toISOString().slice(0, 10)).toBe('2026-03-31'); // 1 Apr IST start
    expect(range.lte.toISOString().slice(0, 10)).toBe('2027-03-31');
  });

  it('never cross-consumes Emergency from Casual or Casual from Emergency', async () => {
    const casual = rig([{ type: LeaveType.CASUAL, status: 'APPROVED', startDate: new Date(), endDate: new Date(), isHalfDay: false }]);
    const emergency = rig([]);

    const casualBalance = await casual.service.getLeaveBalance('emp-1', 2026, LeaveType.CASUAL);
    const emergencyBalance = await emergency.service.getLeaveBalance('emp-1', 2026, LeaveType.EMERGENCY);

    expect(casual.prisma.leaveRequest.findMany.mock.calls[0][0].where.type).toBe(LeaveType.CASUAL);
    expect(emergency.prisma.leaveRequest.findMany.mock.calls[0][0].where.type).toBe(LeaveType.EMERGENCY);
    expect(casualBalance).toMatchObject({ allocation: 10, approved: 1, balance: 9 });
    expect(emergencyBalance).toMatchObject({ allocation: 4, approved: 0, balance: 4 });
  });

  it('allows an underfunded entitlement request only for LH-2 final settlement', async () => {
    const enabled = rig([], true);
    jest.spyOn(enabled.service, 'getLeaveBalance').mockResolvedValue({
      allocation: 10, approved: 10, pending: 0, balance: 0,
    });
    await expect(enabled.service.validateLeaveRequest(
      'emp-1',
      '2026-08-03',
      '2026-08-03',
      false,
      LeaveType.CASUAL,
    )).resolves.toBeUndefined();

    const legacy = rig([], false);
    jest.spyOn(legacy.service, 'getLeaveBalance').mockResolvedValue({
      allocation: 10, approved: 10, pending: 0, balance: 0,
    });
    await expect(legacy.service.validateLeaveRequest(
      'emp-1',
      '2026-08-03',
      '2026-08-03',
      false,
      LeaveType.CASUAL,
    )).rejects.toThrow(/Insufficient leave balance/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The migration itself, read as text. These assert what the SQL does NOT do,
// which cannot be observed from the schema or from a running database.
// ─────────────────────────────────────────────────────────────────────────────

describe('management policy migration', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../prisma/migrations/20260821010000_management_attendance_policy_extension/migration.sql',
    ),
    'utf8',
  );

  it('promotes only exactly-known historical half-day values', () => {
    // Case- and whitespace-insensitive, so 'first_half' and ' FIRST_HALF ' are
    // recognised — but nothing else is guessed at.
    expect(sql).toMatch(/UPPER\(TRIM\("halfDayType"\)\)\s*=\s*'FIRST_HALF'/);
    expect(sql).toMatch(/UPPER\(TRIM\("halfDayType"\)\)\s*=\s*'SECOND_HALF'/);
    expect(sql).toMatch(/ELSE NULL/);
  });

  it('leaves unknown legacy half-day strings unfabricated and readable', () => {
    // The free-text column is never dropped or rewritten, so an unrecognised
    // historical value stays exactly as somebody typed it and can still be
    // explained by a human later.
    expect(sql).not.toMatch(/DROP COLUMN\s+"halfDayType"/i);
    expect(sql).not.toMatch(/SET\s+"halfDayType"\s*=/i);
    // No catch-all that would sweep unknown values into one of the typed ones.
    expect(sql).not.toMatch(/ELSE\s+'(FIRST|SECOND)_HALF'/i);
  });

  it('only touches rows that actually claim to be half days', () => {
    expect(sql).toMatch(/WHERE "isHalfDay" = true AND "halfDayType" IS NOT NULL/);
  });

  it('lets one leave request consume many comp off credits', () => {
    // A unique index here would make a two-day comp off impossible to settle.
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX[^;]*"comp_off_credits"\("leaveRequestId"\)/);
    expect(sql).toMatch(/CREATE INDEX[^;]*"comp_off_credits"\("leaveRequestId"\)/);
  });

  it('enforces one comp off credit per employee per source date in the database', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX[^;]*"comp_off_credits"\("employeeId", "earnedFromBusinessDate"\)/,
    );
  });

  it('is additive: no drops, renames, deletes or type narrowing', () => {
    expect(/DROP\s+(TABLE|COLUMN|TYPE)/i.test(sql)).toBe(false);
    expect(/RENAME/i.test(sql)).toBe(false);
    expect(/DELETE\s+FROM|TRUNCATE/i.test(sql)).toBe(false);
    expect(/ALTER COLUMN[^;]*SET NOT NULL/i.test(sql)).toBe(false);
  });
});
