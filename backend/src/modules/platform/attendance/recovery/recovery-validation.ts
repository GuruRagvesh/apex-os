import { evaluateDamage, DEFAULT_DAMAGE_LIMITS, type DamageLimits } from './damage-limits';
import { resolveEmployee } from './identity-map';
import { classifyDay, legacySessionOnlyMonths } from './reconcile-classify';
import { checkReferences, type ReferenceContext } from './reference-check';
import type { ParsedRecoveryDocument } from './recovery-document';
import type { AttendanceDayBundle, DayClassification, RecoveryTombstone } from './recovery.types';

/**
 * Validation of an Apex Historical Recovery file against the target database's
 * current facts. Pure: the caller supplies every fact; nothing is read or written.
 *
 * The recovery route is STRICTER than the existing HR correction import, whose
 * approved CHANGE rows may revise a day. Here:
 *
 *   NEW      (eligible RECOVERY_ONLY)                         → POTENTIALLY_RECOVERABLE
 *   MATCH    (IN_SYNC)                                        → NO_ACTION
 *   CHANGE   (DIFFERENT)                                      → MANUAL_REVIEW  (never overwrite)
 *   CONFLICT (MISSING_REFERENCE / MANUAL_REVIEW / LEGACY)      → MANUAL_REVIEW
 *   INVALID  (INVALID_BUNDLE)                                 → REJECT
 *
 * The NEW/MATCH/CHANGE/CONFLICT/INVALID vocabulary is the existing
 * AttendanceImportRow classification, so a later phase can store these verdicts
 * in the existing import tables instead of a parallel import engine.
 *
 * Repeat sources: a file whose SHA-256 matches a recovery batch that was already
 * APPLIED or PARTIALLY_APPLIED is ALREADY_IMPORTED and is not classified again.
 * (The ordinary correction import keeps its current repeat behaviour.)
 */

export type ImportRowClass = 'NEW' | 'MATCH' | 'CHANGE' | 'CONFLICT' | 'INVALID';
export type RecoveryRowAction = 'POTENTIALLY_RECOVERABLE' | 'NO_ACTION' | 'MANUAL_REVIEW' | 'REJECT';

export function importClassOf(c: DayClassification): ImportRowClass {
  switch (c.state) {
    case 'RECOVERY_ONLY':
      return c.eligibility === 'AUTO_REPAIR_ELIGIBLE' ? 'NEW' : 'CONFLICT';
    case 'IN_SYNC':
      return 'MATCH';
    case 'DIFFERENT':
      return 'CHANGE';
    case 'INVALID_BUNDLE':
      return 'INVALID';
    default:
      // MISSING_REFERENCE, MANUAL_REVIEW, LEGACY_FORMAT — and PRODUCTION_ONLY,
      // which a recovery file cannot produce, falls here rather than anywhere permissive.
      return 'CONFLICT';
  }
}

export function recoveryActionOf(cls: ImportRowClass): RecoveryRowAction {
  return ({ NEW: 'POTENTIALLY_RECOVERABLE', MATCH: 'NO_ACTION', CHANGE: 'MANUAL_REVIEW', CONFLICT: 'MANUAL_REVIEW', INVALID: 'REJECT' } as const)[cls];
}

export type RepeatState = 'NEW_SOURCE' | 'PREVIOUSLY_UPLOADED' | 'ALREADY_IMPORTED';

export function assessRecoverySourceRepeat(
  sourceFileSha256: string,
  priorRecoveryBatches: Array<{ reference: string; fileSha256: string; status: string }>,
): { state: RepeatState; batches: string[] } {
  const same = priorRecoveryBatches.filter((b) => b.fileSha256 === sourceFileSha256);
  const applied = same.filter((b) => b.status === 'APPLIED' || b.status === 'PARTIALLY_APPLIED');
  if (applied.length) return { state: 'ALREADY_IMPORTED', batches: applied.map((b) => b.reference) };
  if (same.length) return { state: 'PREVIOUSLY_UPLOADED', batches: same.map((b) => b.reference) };
  return { state: 'NEW_SOURCE', batches: [] };
}

export interface RecoveryValidationContext extends ReferenceContext {
  companyToday: string;
  /** Current target bundles keyed `${employeeId}|${businessDate}`. */
  currentBundles: Map<string, AttendanceDayBundle>;
  tombstones: RecoveryTombstone[];
  /** month (YYYY-MM) → AttendanceMonthClose.status */
  monthCloseStatus: Map<string, string>;
  /**
   * Ids already used in the target, and the day that uses them:
   *   `WorkSession:<id>`, `BreakLog:<id>`, `AttendanceRegularization:<id>`,
   *   `AttendancePunchEvidence:<employeeId>|<idempotencyKey>`  →  `${employeeId}|${businessDate}`
   */
  takenIds: Map<string, string>;
  historicalEmployeeDays: number;
  /** month → employee-days with DailyAttendance in the target. */
  currentDaysByMonth: Map<string, number>;
  priorRecoveryBatches: Array<{ reference: string; fileSha256: string; status: string }>;
  damageLimits?: DamageLimits;
}

export interface ValidationItem {
  index: number;
  employeeId: string | null;
  businessDate: string | null;
  classification: DayClassification;
  importClass: ImportRowClass;
  recoveryAction: RecoveryRowAction;
}

export interface RecoveryValidationResult {
  sourceFileSha256: string;
  fileProblems: string[];
  repeat: { state: RepeatState; batches: string[] };
  items: ValidationItem[];
  summary: {
    employeeDays: number;
    employeesMatched: number;
    newEmployeeDays: number;
    identical: number;
    differentOrConflict: number;
    missingReferences: number;
    invalid: number;
    legacy: number;
    proposedForInsertion: number;
    legacyMonths: string[];
  };
  damage: ReturnType<typeof evaluateDamage>;
}

export function validateRecoveryDocument(doc: ParsedRecoveryDocument, ctx: RecoveryValidationContext): RecoveryValidationResult {
  const repeat = assessRecoverySourceRepeat(doc.sourceFileSha256, ctx.priorRecoveryBatches);
  const emptySummary = {
    employeeDays: 0, employeesMatched: 0, newEmployeeDays: 0, identical: 0, differentOrConflict: 0,
    missingReferences: 0, invalid: 0, legacy: 0, proposedForInsertion: 0, legacyMonths: [] as string[],
  };
  if (doc.fileProblems.length || repeat.state === 'ALREADY_IMPORTED') {
    return { sourceFileSha256: doc.sourceFileSha256, fileProblems: doc.fileProblems, repeat, items: [], summary: emptySummary, damage: evaluateDamage({ proposedEmployeeDays: 0, historicalEmployeeDays: ctx.historicalEmployeeDays, months: [] }, ctx.damageLimits ?? DEFAULT_DAMAGE_LIMITS) };
  }

  // Legacy months are a property of the SOURCE: sessions recorded, no DailyAttendance at all.
  const perMonth = new Map<string, { dailyAttendance: number; workSessions: number }>();
  for (const p of doc.bundles) {
    if (!p.bundle) continue;
    const m = p.bundle.businessDate.slice(0, 7);
    const s = perMonth.get(m) ?? { dailyAttendance: 0, workSessions: 0 };
    s.dailyAttendance += p.bundle.dailyAttendance ? 1 : 0;
    s.workSessions += p.bundle.workSessions.length;
    perMonth.set(m, s);
  }
  const legacyMonths = legacySessionOnlyMonths([...perMonth].map(([month, s]) => ({ month, ...s })));

  const items: ValidationItem[] = [];
  const matched = new Set<string>();
  for (const p of doc.bundles) {
    const b = p.bundle;
    const employeeId = b?.employeeId ?? null;
    const businessDate = b?.businessDate ?? null;
    let classification: DayClassification;
    if (!b || p.problems.length) {
      classification = {
        employeeId: employeeId ?? '', businessDate: businessDate ?? '', state: 'INVALID_BUNDLE', eligibility: 'NOT_APPLICABLE',
        action: 'REJECT', reasons: p.problems.length ? [...p.problems] : ['UNREADABLE'], differingFields: [], currentHash: null, recoveryHash: p.hash,
      };
    } else {
      const identity = resolveEmployee(b.employeeId, ctx.employeeIndex);
      if (identity.state === 'RESOLVED') matched.add(b.employeeId);
      const key = `${b.employeeId}|${b.businessDate}`;
      const collisions: string[] = [];
      const taken = (k: string) => { const home = ctx.takenIds.get(k); if (home && home !== key) collisions.push(k); };
      for (const s of b.workSessions) taken(`WorkSession:${s.id}`);
      for (const x of b.breakLogs) taken(`BreakLog:${x.id}`);
      for (const g of b.regularizations) taken(`AttendanceRegularization:${g.id}`);
      for (const e of b.punchEvidence) taken(`AttendancePunchEvidence:${b.employeeId}|${e.idempotencyKey}`);
      classification = classifyDay({
        employeeId: b.employeeId,
        businessDate: b.businessDate,
        current: ctx.currentBundles.get(key) ?? null,
        recovery: b,
        identity,
        references: checkReferences(b, ctx),
        tombstones: ctx.tombstones,
        companyToday: ctx.companyToday,
        monthCloseStatus: ctx.monthCloseStatus.get(b.businessDate.slice(0, 7)) ?? null,
        idCollisions: collisions,
        legacyMonth: legacyMonths.has(b.businessDate.slice(0, 7)),
      });
    }
    const importClass = importClassOf(classification);
    items.push({ index: p.index, employeeId, businessDate, classification, importClass, recoveryAction: recoveryActionOf(importClass) });
  }

  const count = (pred: (i: ValidationItem) => boolean) => items.filter(pred).length;
  const proposed = count((i) => i.importClass === 'NEW');
  const recoveryDaysByMonth = new Map<string, number>();
  for (const i of items) {
    if (i.importClass === 'NEW' && i.businessDate) recoveryDaysByMonth.set(i.businessDate.slice(0, 7), (recoveryDaysByMonth.get(i.businessDate.slice(0, 7)) ?? 0) + 1);
  }
  const damage = evaluateDamage({
    proposedEmployeeDays: proposed,
    historicalEmployeeDays: ctx.historicalEmployeeDays,
    months: [...recoveryDaysByMonth].map(([month, recoveryDays]) => ({ month, recoveryDays, currentDays: ctx.currentDaysByMonth.get(month) ?? 0 })),
  }, ctx.damageLimits ?? DEFAULT_DAMAGE_LIMITS);

  return {
    sourceFileSha256: doc.sourceFileSha256,
    fileProblems: [],
    repeat,
    items,
    summary: {
      employeeDays: items.length,
      employeesMatched: matched.size,
      newEmployeeDays: proposed,
      identical: count((i) => i.importClass === 'MATCH'),
      differentOrConflict: count((i) => i.importClass === 'CHANGE' || (i.importClass === 'CONFLICT' && i.classification.state === 'MANUAL_REVIEW')),
      missingReferences: count((i) => i.classification.state === 'MISSING_REFERENCE'),
      invalid: count((i) => i.importClass === 'INVALID'),
      legacy: count((i) => i.classification.state === 'LEGACY_FORMAT'),
      proposedForInsertion: proposed,
      legacyMonths: [...legacyMonths].sort(),
    },
    damage,
  };
}
