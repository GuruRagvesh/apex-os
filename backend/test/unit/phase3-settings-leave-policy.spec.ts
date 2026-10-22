import { SettingsService } from '../../src/modules/platform/settings/settings.service';

/**
 * Phase 3: the Settings Center lists the leave version that governs today in
 * each series through the continuity resolver, never an ACTIVE-only read, and
 * shows Casual and Sick (Emergency is a submission mode, not a pool).
 */
describe('Phase 3: Settings Center leave policy versions', () => {
  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
  };
  const row = (over: Record<string, unknown>) => ({
    name: 'Leave', policyKey: 'LEAVE', financialYear: '2026-2027', effectiveTo: null,
    totalPaidLeaves: 14, casualLeaveAllocation: 10, sickLeaveAllocation: 4, ...over,
  });

  function service(rows: any[]) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma: any = {
      leavePolicy: { findMany },
      appSetting: { findUnique: jest.fn().mockResolvedValue({ key: 'attendance_v2', value: { leaveAuthorityEnabled: true } }) },
    };
    return { svc: new SettingsService(prisma, { log: jest.fn() } as any), findMany };
  }

  it('reads every governing status, not ACTIVE alone', async () => {
    const { svc, findMany } = service([]);
    await svc.getActiveLeavePolicies();
    expect(findMany.mock.calls[0][0].where).toEqual({ status: { in: ['ACTIVE', 'SUPERSEDED', 'SCHEDULED'] } });
  });

  it('returns one governing version per series, by date, with Casual and Sick', async () => {
    const { svc } = service([
      row({ id: 'old', version: 1, status: 'ACTIVE', effectiveFrom: new Date('2020-12-01T00:00:00.000Z') }),
      // Took over two days ago; the settle job has not run yet.
      row({ id: 'due', version: 2, status: 'SCHEDULED', effectiveFrom: day(-2), sickLeaveAllocation: 5 }),
      row({ id: 'future', version: 3, status: 'SCHEDULED', effectiveFrom: day(30) }),
      row({ id: 'other', policyKey: 'LEAVE-B', version: 1, status: 'ACTIVE', effectiveFrom: new Date('2021-01-01T00:00:00.000Z') }),
    ]);
    const out = await svc.getActiveLeavePolicies();
    expect(out.leaveAuthorityEnabled).toBe(true);
    expect(out.policies.map((p: any) => p.id).sort()).toEqual(['due', 'other']);
    const due = out.policies.find((p: any) => p.id === 'due') as any;
    expect(due.sickLeaveAllocation).toBe(5);
    expect(due).not.toHaveProperty('emergencyLeaveAllocation');
  });
});
