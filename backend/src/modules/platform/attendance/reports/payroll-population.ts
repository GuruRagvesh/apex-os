import { createHash } from 'crypto';

/**
 * Who belongs in a month's payroll, and which leave days are left out (Phase 4,
 * correction 11 and issue 1).
 *
 * RULE VERSIONS. A month finalized before Phase 4 has reportRuleVersion NULL
 * and is always rebuilt with the LEGACY population (active users only), so its
 * stored data fingerprint never changes. Every other render uses PHASE4_V1.
 */
export const PAYROLL_RULE_PHASE4 = 'phase4-v1';

export type RuleVersion = typeof PAYROLL_RULE_PHASE4 | null;

/** The rule a render of this month must use. */
export function ruleVersionFor(close: { status?: string | null; reportRuleVersion?: string | null } | null): RuleVersion {
  if (close && (close.status === 'FINALIZED' || close.status === 'SENT')) {
    return close.reportRuleVersion === PAYROLL_RULE_PHASE4 ? PAYROLL_RULE_PHASE4 : null;
  }
  return PAYROLL_RULE_PHASE4;
}

const employeeSelect = { id: true, name: true, employeeId: true, department: { select: { name: true } } };

export interface Population {
  employees: Array<{ id: string; name: string; employeeId: string | null; department: { name: string } | null }>;
  /** Inactive people with attendance in the month whose dates cannot place them. Not in totals. */
  employmentRecordReview: Array<{ userId: string; name: string; employeeId: string | null; reasonCode: 'EMPLOYMENT_RECORD_INCOMPLETE'; attendanceDays: number }>;
}

/**
 * PHASE4_V1: active users, plus inactive users whose employment overlaps the
 * month. Overlap is read from EmploymentPeriod; a legacy inactive user with no
 * period rows is included when joiningDate <= monthEnd, lastWorkingDate is
 * null or >= monthStart, and they have attendance rows in the month. Anyone
 * else inactive with attendance in the month is listed for review, never
 * silently dropped and never counted.
 */
export async function gatherPopulation(db: any, gte: Date, lte: Date, rule: RuleVersion): Promise<Population> {
  if (rule === null) {
    const employees = await db.user.findMany({ where: { isActive: true }, select: employeeSelect, orderBy: { name: 'asc' } });
    return { employees, employmentRecordReview: [] };
  }
  const [active, overlapping, withAttendance] = await Promise.all([
    db.user.findMany({ where: { isActive: true, isSystemAccount: false }, select: { id: true } }),
    db.user.findMany({
      where: { isActive: false, isSystemAccount: false, employmentPeriods: { some: { startDate: { lte }, OR: [{ endDate: null }, { endDate: { gte } }] } } },
      select: { id: true },
    }),
    db.dailyAttendance.groupBy({ by: ['userId'], where: { date: { gte, lte } }, _count: { _all: true } }),
  ]);
  const include = new Set<string>([...active.map((u: any) => u.id), ...overlapping.map((u: any) => u.id)]);
  const attendanceCount = new Map<string, number>(withAttendance.map((r: any) => [r.userId, r._count._all]));
  const candidates = [...attendanceCount.keys()].filter((id) => !include.has(id));
  const review: Population['employmentRecordReview'] = [];
  if (candidates.length > 0) {
    const rows = await db.user.findMany({
      where: { id: { in: candidates }, isSystemAccount: false },
      select: { id: true, name: true, employeeId: true, joiningDate: true, lastWorkingDate: true, _count: { select: { employmentPeriods: true } } },
    });
    for (const u of rows) {
      const noPeriods = (u._count?.employmentPeriods ?? 0) === 0;
      const placed = noPeriods && !!u.joiningDate && u.joiningDate <= lte && (!u.lastWorkingDate || u.lastWorkingDate >= gte);
      if (placed) include.add(u.id);
      else review.push({ userId: u.id, name: u.name, employeeId: u.employeeId, reasonCode: 'EMPLOYMENT_RECORD_INCOMPLETE', attendanceDays: attendanceCount.get(u.id) ?? 0 });
    }
  }
  const employees = await db.user.findMany({ where: { id: { in: [...include] } }, select: employeeSelect, orderBy: { name: 'asc' } });
  return { employees, employmentRecordReview: review.sort((a, b) => a.name.localeCompare(b.name)) };
}

export const UNRESOLVED_STATEMENT = 'The listed leave days were not counted as paid or unpaid in these totals.';

export interface UnresolvedItem {
  userId: string;
  name: string;
  employeeId: string | null;
  reasonCode: 'LEAVE_SETTLEMENT_PENDING';
  leaveRequestIds: string[];
  dates: string[];
  excludedDayUnits: number;
  missingSetup: Array<'POLICY' | 'CALENDAR' | 'BALANCE'>;
}

export interface UnresolvedSummary {
  employees: number;
  settlements: number;
  excludedDayUnits: number;
  items: UnresolvedItem[];
  statement: string;
  fingerprint: string;
}

/**
 * Setup-pending leave OUTCOMES in the month: approved leave saved while leave
 * setup was missing, whose funding is not settled. Only those days' paid-leave
 * and LWP units are left out; every other row of the employee stays in the
 * totals. Nothing here invents a paid or unpaid outcome.
 */
export async function unresolvedSetup(db: any, gte: Date, lte: Date, employees: Population['employees']): Promise<UnresolvedSummary> {
  const ids = employees.map((e) => e.id);
  // DailyAttendance carries leaveRequestId without a relation, so this is two reads.
  const pending = ids.length
    ? await db.leaveRequest.findMany({
        where: { userId: { in: ids }, status: 'APPROVED', setupStatus: 'POLICY_SETUP_PENDING', fundingOutcome: null, startDate: { lte }, endDate: { gte } },
        select: { id: true, halfDayType: true, halfDaySession: true },
      })
    : [];
  const leaveById = new Map<string, any>(pending.map((l: any) => [l.id, l]));
  const days = leaveById.size
    ? await db.dailyAttendance.findMany({
        where: { userId: { in: ids }, date: { gte, lte }, leaveRequestId: { in: [...leaveById.keys()] } },
        select: { userId: true, date: true, leaveRequestId: true },
        orderBy: [{ userId: 'asc' }, { date: 'asc' }],
      })
    : [];
  const byUser = new Map<string, any[]>();
  for (const d of days) byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d]);
  const meta = new Map(employees.map((e) => [e.id, e]));
  const items: UnresolvedItem[] = [];
  for (const [userId, rows] of byUser) {
    const first = rows[0].date as Date;
    const profile = await db.employeeAttendanceProfile.findFirst({
      where: { userId, effectiveFrom: { lte: first }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: first } }] },
      orderBy: { effectiveFrom: 'desc' },
      select: { assignedLeavePolicyId: true, assignedHolidayCalendarId: true },
    });
    const missing: UnresolvedItem['missingSetup'] = [];
    if (!profile?.assignedLeavePolicyId) missing.push('POLICY');
    if (!profile?.assignedHolidayCalendarId) missing.push('CALENDAR');
    if (missing.length === 0) missing.push('BALANCE');
    const half = (r: any) => {
      const l = leaveById.get(r.leaveRequestId);
      return !!(l?.halfDaySession || l?.halfDayType === 'FIRST_HALF' || l?.halfDayType === 'SECOND_HALF');
    };
    const e = meta.get(userId)!;
    items.push({
      userId, name: e.name, employeeId: e.employeeId, reasonCode: 'LEAVE_SETTLEMENT_PENDING',
      leaveRequestIds: [...new Set(rows.map((r) => r.leaveRequestId as string))].sort(),
      dates: rows.map((r) => (r.date as Date).toISOString().slice(0, 10)),
      excludedDayUnits: rows.reduce((n, r) => n + (half(r) ? 0.5 : 1), 0),
      missingSetup: missing,
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
  const settlements = new Set(items.flatMap((i) => i.leaveRequestIds)).size;
  const excludedDayUnits = items.reduce((n, i) => n + i.excludedDayUnits, 0);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(items.map((i) => [i.userId, i.leaveRequestIds, i.dates, i.excludedDayUnits])))
    .digest('hex');
  return { employees: items.length, settlements, excludedDayUnits, items, statement: UNRESOLVED_STATEMENT, fingerprint };
}
