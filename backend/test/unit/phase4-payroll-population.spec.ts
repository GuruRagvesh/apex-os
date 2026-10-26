import { gatherPopulation, unresolvedSetup, UNRESOLVED_STATEMENT } from '../../src/modules/platform/attendance/reports/payroll-population';

const GTE = new Date('2026-09-01T00:00:00Z');
const LTE = new Date('2026-09-30T00:00:00Z');
const emp = (id: string, name = id) => ({ id, name, employeeId: `TE-${id}`, department: { name: 'Eng' } });

function db(over: any = {}) {
  const users: any[] = over.users ?? [];
  return {
    user: {
      findMany: jest.fn(async ({ where, select }: any) => {
        if (where.isActive === true) return users.filter((u) => u.isActive).map((u) => (select.name ? emp(u.id) : { id: u.id }));
        if (where.employmentPeriods) return users.filter((u) => !u.isActive && u.overlaps).map((u) => ({ id: u.id }));
        if (where.id?.in && select.joiningDate) return users.filter((u) => where.id.in.includes(u.id));
        if (where.id?.in) return users.filter((u) => where.id.in.includes(u.id)).map((u) => emp(u.id));
        return [];
      }),
    },
    dailyAttendance: {
      groupBy: jest.fn(async () => over.attendance ?? []),
      findMany: jest.fn(async () => over.leaveDays ?? []),
    },
    leaveRequest: { findMany: jest.fn(async () => over.pendingLeave ?? []) },
    employeeAttendanceProfile: { findFirst: jest.fn(async () => over.profile ?? null) },
  };
}

describe('Phase 4 payroll population (mid-month leavers, legacy users)', () => {
  it('uses the legacy active-only population for a month finalized before Phase 4', async () => {
    const d = db({ users: [{ id: 'a', isActive: true }, { id: 'gone', isActive: false, overlaps: true }] });
    const out = await gatherPopulation(d, GTE, LTE, null);
    expect(out.employees.map((e: any) => e.id)).toEqual(['a']);
    expect(out.employmentRecordReview).toEqual([]);
  });

  it('includes an inactive person whose employment overlaps the month', async () => {
    const d = db({ users: [{ id: 'a', isActive: true }, { id: 'leaver', isActive: false, overlaps: true }] });
    const out = await gatherPopulation(d, GTE, LTE, 'phase4-v1');
    expect(out.employees.map((e: any) => e.id).sort()).toEqual(['a', 'leaver']);
  });

  it('places a legacy inactive user with no employment rows by joining/leaving dates and attendance', async () => {
    const d = db({
      users: [{ id: 'legacy', isActive: false, joiningDate: new Date('2025-01-01'), lastWorkingDate: new Date('2026-09-15'), _count: { employmentPeriods: 0 } }],
      attendance: [{ userId: 'legacy', _count: { _all: 10 } }],
    });
    const out = await gatherPopulation(d, GTE, LTE, 'phase4-v1');
    expect(out.employees.map((e: any) => e.id)).toEqual(['legacy']);
    expect(out.employmentRecordReview).toEqual([]);
  });

  it('lists an unplaceable inactive user for review instead of dropping them or counting them', async () => {
    const d = db({
      users: [{ id: 'mystery', isActive: false, name: 'Mystery', joiningDate: null, lastWorkingDate: null, _count: { employmentPeriods: 0 } }],
      attendance: [{ userId: 'mystery', _count: { _all: 4 } }],
    });
    const out = await gatherPopulation(d, GTE, LTE, 'phase4-v1');
    expect(out.employees).toEqual([]);
    expect(out.employmentRecordReview).toEqual([expect.objectContaining({ userId: 'mystery', reasonCode: 'EMPLOYMENT_RECORD_INCOMPLETE', attendanceDays: 4 })]);
  });
});

describe('Phase 4 unresolved setup-pending leave', () => {
  const employees = [emp('a', 'Asha'), emp('b', 'Bala')];

  it('is empty when nothing is pending', async () => {
    const s = await unresolvedSetup(db(), GTE, LTE, employees as any);
    expect(s).toMatchObject({ employees: 0, settlements: 0, excludedDayUnits: 0, items: [], statement: UNRESOLVED_STATEMENT });
  });

  it('excludes only the pending leave days, naming dates, units and the missing setup', async () => {
    const d = db({
      pendingLeave: [{ id: 'l1', halfDayType: null, halfDaySession: null }, { id: 'l2', halfDayType: 'FIRST_HALF', halfDaySession: 'FIRST_HALF' }],
      leaveDays: [
        { userId: 'a', date: new Date('2026-09-02'), leaveRequestId: 'l1' },
        { userId: 'a', date: new Date('2026-09-03'), leaveRequestId: 'l1' },
        { userId: 'b', date: new Date('2026-09-10'), leaveRequestId: 'l2' },
      ],
      profile: { assignedLeavePolicyId: null, assignedHolidayCalendarId: 'cal' },
    });
    const s = await unresolvedSetup(d, GTE, LTE, employees as any);
    expect(s.employees).toBe(2);
    expect(s.settlements).toBe(2);
    expect(s.excludedDayUnits).toBe(2.5);
    const a = s.items.find((i) => i.userId === 'a')!;
    expect(a).toMatchObject({ dates: ['2026-09-02', '2026-09-03'], excludedDayUnits: 2, missingSetup: ['POLICY'], reasonCode: 'LEAVE_SETTLEMENT_PENDING' });
    expect(s.statement).toMatch(/not counted as paid or unpaid/);
  });

  it('its fingerprint changes when the unresolved set changes, so a stale acknowledgement is refused', async () => {
    const one = db({ pendingLeave: [{ id: 'l1' }], leaveDays: [{ userId: 'a', date: new Date('2026-09-02'), leaveRequestId: 'l1' }] });
    const two = db({ pendingLeave: [{ id: 'l1' }], leaveDays: [{ userId: 'a', date: new Date('2026-09-02'), leaveRequestId: 'l1' }, { userId: 'a', date: new Date('2026-09-04'), leaveRequestId: 'l1' }] });
    const f1 = (await unresolvedSetup(one, GTE, LTE, employees as any)).fingerprint;
    const f2 = (await unresolvedSetup(two, GTE, LTE, employees as any)).fingerprint;
    expect(f1).not.toBe(f2);
    expect((await unresolvedSetup(one, GTE, LTE, employees as any)).fingerprint).toBe(f1);
  });
});
