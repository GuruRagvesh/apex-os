import { readFileSync } from 'fs';
import { resolve } from 'path';
import { LeaveType } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { TVAService } from '../../src/common/services/tva.service';
import { LeaveBalanceService } from '../../src/modules/operations/leave/leave-balance.service';

/**
 * Phase 3 entitlements: 10 Casual + 4 Sick, both from the versioned
 * LeavePolicy. Emergency is a submission mode funded from one of those two
 * buckets, never a third pool, and the retired Emergency allocation is never
 * read -- so no balance can reach 18. There are no role or intern hard-codes.
 */
describe('management leave entitlements (Phase 3)', () => {
  const POLICY = { id: 'lp-1', casualLeaveAllocation: 10, sickLeaveAllocation: 4, emergencyLeaveAllocation: 4 };
  const rig = (rows: any[] = [], policy: any = POLICY) => {
    const prisma: any = {
      employeeAttendanceProfile: { findFirst: jest.fn().mockResolvedValue(null) },
      leaveRequest: {
        findMany: jest.fn().mockResolvedValue(rows),
        count: jest.fn().mockResolvedValue(0),
      },
      user: { findUnique: jest.fn() },
    };
    const settings: any = {
      get: jest.fn((key: string) => Promise.resolve(key === 'attendance_v2' ? { leaveAuthorityEnabled: true } : {})),
      getLeaveQuotas: jest.fn(),
    };
    const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);
    const workingDays: any = {
      countWorkingDays: jest.fn().mockResolvedValue(1),
      enumerateBusinessDates: jest.fn(),
    };
    const policies: any = { resolvePolicyOn: jest.fn().mockResolvedValue(policy) };
    const timeline: any = { findProfileOn: jest.fn().mockResolvedValue({ assignedLeavePolicyId: 'lp-1' }) };
    return { service: new LeaveBalanceService(prisma, settings, tva, workingDays, policies, timeline), prisma, settings, policies };
  };

  it('reads Casual 10 and Sick 4 from the versioned policy, 14 in total', async () => {
    const { service, settings } = rig();
    expect(await service.getYearlyAllocation('emp-1', 2026, LeaveType.CASUAL)).toBe(10);
    expect(await service.getYearlyAllocation('emp-1', 2026, LeaveType.SICK)).toBe(4);
    expect(await service.getYearlyAllocation('emp-1', 2026)).toBe(14);
    expect(settings.getLeaveQuotas).not.toHaveBeenCalled();
  });

  it('a different policy version is the only way to a different entitlement', async () => {
    const { service } = rig([], { ...POLICY, casualLeaveAllocation: 12, sickLeaveAllocation: 6 });
    expect(await service.getYearlyAllocation('emp-1', 2026, LeaveType.CASUAL)).toBe(12);
    expect(await service.getYearlyAllocation('emp-1', 2026, LeaveType.SICK)).toBe(6);
  });

  it('interns follow the same versioned policy (no one-day-per-month hard-code)', async () => {
    const { service, prisma } = rig();
    prisma.user.findUnique.mockResolvedValue({ role: { name: 'INTERN' } });
    const casual = await service.getLeaveBalance('intern-1', 2026, LeaveType.CASUAL, new Date('2026-10-12T06:30:00.000Z'));
    const sick = await service.getLeaveBalance('intern-1', 2026, LeaveType.SICK, new Date('2026-10-12T06:30:00.000Z'));
    expect(casual.allocation).toBe(10);
    expect(sick.allocation).toBe(4);
    const range = prisma.leaveRequest.findMany.mock.calls[0][0].where.startDate;
    expect(range.gte.toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(range.lte.toISOString().slice(0, 10)).toBe('2027-03-31');
  });

  it('uses TVA financial-year bounds for balances', async () => {
    const { service, prisma } = rig();
    await service.getLeaveBalance('emp-1', 2026, LeaveType.CASUAL);
    const range = prisma.leaveRequest.findMany.mock.calls[0][0].where.startDate;
    expect(range.gte.toISOString().slice(0, 10)).toBe('2026-03-31'); // 1 Apr IST start
    expect(range.lte.toISOString().slice(0, 10)).toBe('2027-03-31');
  });

  it('never cross-consumes: Casual rows draw Casual, Sick and historical Emergency rows draw Sick', async () => {
    const at = { startDate: new Date('2026-08-03T00:00:00.000Z'), endDate: new Date('2026-08-03T00:00:00.000Z'), isHalfDay: false, status: 'APPROVED' };
    const rows = [
      { ...at, id: 'c', type: LeaveType.CASUAL },
      { ...at, id: 's', type: LeaveType.SICK },
      { ...at, id: 'e', type: LeaveType.EMERGENCY },
      { ...at, id: 'ef', type: LeaveType.CASUAL, fundingBucket: 'CASUAL', submissionMode: 'EMERGENCY' },
      { ...at, id: 'u', type: LeaveType.UNPAID },
      { ...at, id: 'co', type: LeaveType.COMP_OFF },
    ];
    const casual = await rig(rows).service.getLeaveBalance('emp-1', 2026, LeaveType.CASUAL);
    const sick = await rig(rows).service.getLeaveBalance('emp-1', 2026, LeaveType.SICK);
    expect(casual).toMatchObject({ allocation: 10, approved: 2, balance: 8 });
    expect(sick).toMatchObject({ allocation: 4, approved: 2, balance: 2 });
  });

  it('no total ever reaches 18, even with the retired Emergency column still set', async () => {
    const { service } = rig();
    const total = await service.getLeaveBalance('emp-1', 2026);
    expect(total.allocation).toBe(14);
  });

  it('an underfunded request is saved and flagged, never refused for balance', async () => {
    const { service } = rig();
    jest.spyOn(service, 'getLeaveBalance').mockResolvedValue({
      allocation: 10, approved: 10, pending: 0, balance: 0, bucket: 'CASUAL', setupStatus: 'RESOLVED', unmeasuredRequests: 0,
    });
    await expect(service.validateLeaveRequest('emp-1', '2026-08-03', '2026-08-03', false, LeaveType.CASUAL))
      .resolves.toMatchObject({ insufficient: true });
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
