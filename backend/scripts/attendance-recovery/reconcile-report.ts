/**
 * September recovery dry run: classify every employee-day, count what a
 * missing-only recovery WOULD insert, and compare Monthly Register figures.
 *
 * Pure. It reuses the existing recovery domain unchanged (classifyDay,
 * checkReferences, evaluateDamage) and the existing payroll arithmetic
 * (summarise); it adds no second bundle format and no second calculation.
 *
 * The vocabulary here has no UPDATE and no DELETE: `wouldUpdate` and
 * `wouldDelete` are the literal 0, so a count that is not zero cannot be built.
 */
import { classifyDay, legacySessionOnlyMonths } from '../../src/modules/platform/attendance/recovery/reconcile-classify';
import { checkReferences, type ReferenceContext } from '../../src/modules/platform/attendance/recovery/reference-check';
import { resolveEmployee, type EmployeeIndex } from '../../src/modules/platform/attendance/recovery/identity-map';
import { DEFAULT_DAMAGE_LIMITS, evaluateDamage, type DamageDecision, type DamageLimits } from '../../src/modules/platform/attendance/recovery/damage-limits';
import { presenceMinutes, summarise, type DayFacts, type EmployeeMeta, type PayrollSummaryRow } from '../../src/modules/platform/attendance/reports/payroll-aggregation';
import type { AttendanceDayBundle, DayClassification, RecoveryTombstone } from '../../src/modules/platform/attendance/recovery/recovery.types';
import type { Side, TargetFacts } from './side-reader';

export type Bucket =
  | 'IDENTICAL'
  | 'SOURCE_ONLY'
  | 'SOURCE_ONLY_BLOCKED'
  | 'TARGET_ONLY'
  | 'DIFFERENT'
  | 'INVALID_REFERENCE';

export const BUCKETS: readonly Bucket[] = ['IDENTICAL', 'SOURCE_ONLY', 'SOURCE_ONLY_BLOCKED', 'TARGET_ONLY', 'DIFFERENT', 'INVALID_REFERENCE'];

/**
 * IN_SYNC → IDENTICAL, RECOVERY_ONLY → SOURCE_ONLY (eligible), PRODUCTION_ONLY →
 * TARGET_ONLY, DIFFERENT → DIFFERENT, MISSING_REFERENCE / INVALID_BUNDLE →
 * INVALID_REFERENCE. A source-only day that exists but is not eligible
 * (tombstoned, settled month, not finalized, legacy format, id taken) is
 * SOURCE_ONLY_BLOCKED, so it is neither counted as insertable nor hidden.
 */
export function bucketOf(c: Pick<DayClassification, 'state'>): Bucket {
  switch (c.state) {
    case 'IN_SYNC': return 'IDENTICAL';
    case 'DIFFERENT': return 'DIFFERENT';
    case 'PRODUCTION_ONLY': return 'TARGET_ONLY';
    case 'RECOVERY_ONLY': return 'SOURCE_ONLY';
    case 'MISSING_REFERENCE':
    case 'INVALID_BUNDLE': return 'INVALID_REFERENCE';
    default: return 'SOURCE_ONLY_BLOCKED';
  }
}

export interface DayVerdict {
  key: string;
  employeeId: string;
  businessDate: string;
  bucket: Bucket;
  state: DayClassification['state'];
  reasons: string[];
  differingFields: string[];
}

export interface TableCounts { dailyAttendance: number; workSessions: number; breakLogs: number; punchEvidence: number; regularizations: number }
const zero = (): TableCounts => ({ dailyAttendance: 0, workSessions: 0, breakLogs: 0, punchEvidence: 0, regularizations: 0 });
const addInto = (acc: TableCounts, b: AttendanceDayBundle) => {
  acc.dailyAttendance += b.dailyAttendance ? 1 : 0;
  acc.workSessions += b.workSessions.length;
  acc.breakLogs += b.breakLogs.length;
  acc.punchEvidence += b.punchEvidence.length;
  acc.regularizations += b.regularizations.length;
};
export const countBundles = (bundles: Iterable<AttendanceDayBundle>): TableCounts => {
  const acc = zero();
  for (const b of bundles) addInto(acc, b);
  return acc;
};

export interface ReconcileInput {
  companyToday: string;
  source: Map<string, AttendanceDayBundle>;
  sourceProblems: Map<string, string[]>;
  target: Map<string, AttendanceDayBundle>;
  targetEmployeeIndex: EmployeeIndex;
  referenceContext: ReferenceContext;
  tombstones: RecoveryTombstone[];
  monthClose: Map<string, string>;
  idCollisions: Map<string, string[]>;
  limits?: DamageLimits;
}

export interface ReconcileReport {
  verdicts: DayVerdict[];
  buckets: Record<Bucket, number>;
  /** Reason code → number of days, for blocked / invalid / different days. */
  reasonCounts: Record<string, number>;
  /** Differing field path → number of DIFFERENT days. */
  differingFieldCounts: Record<string, number>;
  wouldInsert: TableCounts;
  wouldUpdate: 0;
  wouldDelete: 0;
  damage: { decision: DamageDecision; reasons: string[]; percent: number | null };
  perMonth: Array<{ month: string; targetDays: number; sourceDays: number }>;
}

export function reconcile(input: ReconcileInput): ReconcileReport {
  const keys = [...new Set([...input.source.keys(), ...input.target.keys()])].sort();

  const monthStats = new Map<string, { dailyAttendance: number; workSessions: number }>();
  for (const b of input.source.values()) {
    const m = b.businessDate.slice(0, 7);
    const s = monthStats.get(m) ?? { dailyAttendance: 0, workSessions: 0 };
    s.dailyAttendance += b.dailyAttendance ? 1 : 0;
    s.workSessions += b.workSessions.length;
    monthStats.set(m, s);
  }
  const legacyMonths = legacySessionOnlyMonths([...monthStats].map(([month, s]) => ({ month, ...s })));

  const verdicts: DayVerdict[] = [];
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
  const reasonCounts: Record<string, number> = {};
  const differingFieldCounts: Record<string, number> = {};
  const wouldInsert = zero();

  for (const key of keys) {
    const recovery = input.source.get(key) ?? null;
    const current = input.target.get(key) ?? null;
    const sample = (recovery ?? current)!;
    const verdict = classifyDay({
      employeeId: sample.employeeId,
      businessDate: sample.businessDate,
      current,
      recovery,
      recoveryProblems: input.sourceProblems.get(key),
      identity: resolveEmployee(sample.employeeId, input.targetEmployeeIndex),
      references: recovery ? checkReferences(recovery, input.referenceContext) : { missing: [], review: [] },
      tombstones: input.tombstones,
      companyToday: input.companyToday,
      monthCloseStatus: input.monthClose.get(sample.businessDate.slice(0, 7)) ?? null,
      idCollisions: input.idCollisions.get(key),
      legacyMonth: legacyMonths.has(sample.businessDate.slice(0, 7)),
    });
    const bucket = bucketOf(verdict);
    buckets[bucket] += 1;
    verdicts.push({ key, employeeId: verdict.employeeId, businessDate: verdict.businessDate, bucket, state: verdict.state, reasons: verdict.reasons, differingFields: verdict.differingFields });

    if (bucket === 'SOURCE_ONLY' && recovery) addInto(wouldInsert, recovery);
    if (bucket === 'SOURCE_ONLY_BLOCKED' || bucket === 'INVALID_REFERENCE') {
      for (const r of verdict.reasons) reasonCounts[`${bucket}:${r}`] = (reasonCounts[`${bucket}:${r}`] ?? 0) + 1;
    }
    if (bucket === 'DIFFERENT') for (const f of verdict.differingFields) differingFieldCounts[f] = (differingFieldCounts[f] ?? 0) + 1;
  }

  const daDaysByMonth = (bundles: Map<string, AttendanceDayBundle>) => {
    const out = new Map<string, number>();
    for (const b of bundles.values()) if (b.dailyAttendance) out.set(b.businessDate.slice(0, 7), (out.get(b.businessDate.slice(0, 7)) ?? 0) + 1);
    return out;
  };
  const sourceDays = daDaysByMonth(input.source);
  const targetDays = daDaysByMonth(input.target);
  const months = [...new Set([...sourceDays.keys(), ...targetDays.keys()])].sort();
  const damage = evaluateDamage(
    {
      proposedEmployeeDays: buckets.SOURCE_ONLY,
      historicalEmployeeDays: [...targetDays.values()].reduce((a, b) => a + b, 0),
      months: months.map((month) => ({ month, currentDays: targetDays.get(month) ?? 0, recoveryDays: sourceDays.get(month) ?? 0 })),
    },
    input.limits ?? DEFAULT_DAMAGE_LIMITS,
  );

  return {
    verdicts,
    buckets,
    reasonCounts,
    differingFieldCounts,
    wouldInsert,
    wouldUpdate: 0,
    wouldDelete: 0,
    damage,
    perMonth: months.map((month) => ({ month, targetDays: targetDays.get(month) ?? 0, sourceDays: sourceDays.get(month) ?? 0 })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Monthly Register comparison — the same summarise() the register uses.
// ─────────────────────────────────────────────────────────────────────────────

export interface RegisterTotals extends PayrollSummaryRow {
  presenceMinutes: number;
  workedMinutes: number;
  breakMinutes: number;
  /** Employee-days stored with no DailyAttendance (no register line at all). */
  daysWithoutRecord: number;
}

export function registerFor(side: Pick<Side, 'bundles' | 'users' | 'departmentNameById' | 'leaveTypeById'>): Map<string, RegisterTotals> {
  const userByEmployee = new Map(side.users.filter((u) => u.employeeId).map((u) => [u.employeeId as string, u]));
  const perEmployee = new Map<string, { facts: DayFacts[]; noRecord: number }>();

  for (const b of side.bundles.values()) {
    const slot = perEmployee.get(b.employeeId) ?? { facts: [], noRecord: 0 };
    perEmployee.set(b.employeeId, slot);
    const da = b.dailyAttendance;
    if (!da) { slot.noRecord += 1; continue; }
    const manualRecoveryIds = new Set(b.regularizations.filter((g) => g.entrySource === 'MANUAL_RECOVERY').map((g) => g.id));
    slot.facts.push({
      userId: userByEmployee.get(b.employeeId)?.id ?? '',
      date: b.businessDate,
      status: da.status,
      evaluationState: da.evaluationState,
      punchInAt: da.punchInAt,
      punchOutAt: da.punchOutAt,
      punchInSource: null,
      punchOutSource: null,
      workedMinutes: da.workedMinutes,
      breakMinutes: da.breakMinutes,
      lateMinutes: da.lateMinutes,
      leaveDeducted: da.leaveDeducted,
      lwpDeducted: da.lwpDeducted,
      leaveType: da.leaveRequestId ? (side.leaveTypeById.get(da.leaveRequestId) ?? null) : null,
      exceptionFlags: da.exceptionFlags,
      regularizationId: da.lastRegularizationId,
      viaManualRecovery: da.lastRegularizationId ? manualRecoveryIds.has(da.lastRegularizationId) : false,
      sessionSpanMinutes: null,
    });
  }

  const out = new Map<string, RegisterTotals>();
  for (const [employeeId, { facts, noRecord }] of perEmployee) {
    const user = userByEmployee.get(employeeId);
    const meta: EmployeeMeta = {
      id: user?.id ?? employeeId,
      employeeId,
      name: user?.name ?? employeeId,
      department: user?.departmentId ? (side.departmentNameById.get(user.departmentId) ?? null) : null,
    };
    out.set(employeeId, {
      ...summarise(meta, facts),
      presenceMinutes: facts.reduce((n, d) => n + (presenceMinutes(d) ?? 0), 0),
      workedMinutes: facts.reduce((n, d) => n + d.workedMinutes, 0),
      breakMinutes: facts.reduce((n, d) => n + d.breakMinutes, 0),
      daysWithoutRecord: noRecord,
    });
  }
  return out;
}

export const REGISTER_FIELDS = ['workingDays', 'present', 'absent', 'halfDays', 'casualLeave', 'emergencyLeave', 'compOff', 'lateDays', 'unresolvedDays', 'presenceMinutes', 'workedMinutes', 'breakMinutes'] as const;
export type RegisterField = (typeof REGISTER_FIELDS)[number];

export interface RegisterDelta {
  employeeId: string;
  name: string;
  source: Partial<Record<RegisterField, number>> | null;
  target: Partial<Record<RegisterField, number>> | null;
  mismatchedFields: RegisterField[];
}

const pick = (r: RegisterTotals | undefined): Partial<Record<RegisterField, number>> | null =>
  r ? Object.fromEntries(REGISTER_FIELDS.map((f) => [f, r[f]])) as Partial<Record<RegisterField, number>> : null;

/** Per-employee source vs target register figures. An employee absent from one side is reported as null, not as zeros. */
export function compareRegisters(source: Map<string, RegisterTotals>, target: Map<string, RegisterTotals>): RegisterDelta[] {
  const ids = [...new Set([...source.keys(), ...target.keys()])].sort();
  return ids.map((employeeId) => {
    const s = source.get(employeeId);
    const t = target.get(employeeId);
    const mismatchedFields = REGISTER_FIELDS.filter((f) => (s?.[f] ?? null) !== (t?.[f] ?? null));
    return { employeeId, name: (s ?? t)!.name, source: pick(s), target: pick(t), mismatchedFields };
  });
}
