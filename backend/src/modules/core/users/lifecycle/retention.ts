/**
 * The retention / legal-hold gate for permanent deletion.
 *
 * An explicit ACTIVE, approved rule with a positive number of months is
 * enforced until that many months have passed since the person's newest
 * protected record. Missing configuration is reported as
 * POLICY_NOT_CONFIGURED, but is not itself a legal/retention instruction and
 * therefore does not block deletion once the verified archive and hold gates
 * pass. Nothing here writes rules or holds, and no caller can override an
 * applicable approved period or a legal hold.
 */

import { HANDLERS, RetentionCategory } from './dependency-matrix';
import { REASON, RETENTION_CLASSIFICATION_VERSION, RETENTION_RESULT, ReasonCode, RetentionResult } from './lifecycle-codes';

export interface RetentionRuleRow {
  category: string;
  retentionMonths: number | null;
  active: boolean;
  approvedAt: Date | null;
  /** Phase 4. NULL/absent = a legacy row, read exactly as before. */
  status?: 'ACTIVE' | 'INACTIVE' | null;
  noExpiry?: boolean;
  policyReference?: string | null;
}

export interface RetentionInput {
  /** Protected rows per category, with each row's business date. */
  protectedDates: Partial<Record<RetentionCategory | 'PAYROLL', Date[]>>;
  rules: RetentionRuleRow[];
  activeLegalHolds: number;
  now: Date;
  /**
   * Phase 4 (D1), per environment via compliance.retentionDefaultDeny: a
   * missing, inactive or invalid rule for a protected category BLOCKS deletion
   * instead of only warning. Off by default.
   */
  defaultDeny?: boolean;
}

/** Why a category's rule is or is not usable (readiness report vocabulary). */
export type RuleHealth = 'OK' | 'MISSING' | 'INACTIVE' | 'INVALID' | 'LEGACY_UNAPPROVED';

export function ruleHealth(rule: RetentionRuleRow | undefined): RuleHealth {
  if (!rule) return 'MISSING';
  if (rule.status === 'INACTIVE') return 'INACTIVE';
  if (rule.status === 'ACTIVE') {
    const periodOk = rule.noExpiry ? rule.retentionMonths === null : Number.isInteger(rule.retentionMonths) && (rule.retentionMonths as number) > 0;
    return rule.approvedAt && periodOk && (rule.policyReference ?? '').trim() ? 'OK' : 'INVALID';
  }
  // Legacy (status NULL): the Phase 1 reading.
  if (!rule.active) return 'INACTIVE';
  if (!rule.approvedAt) return 'LEGACY_UNAPPROVED';
  return Number.isInteger(rule.retentionMonths) && (rule.retentionMonths as number) > 0 ? 'OK' : 'INVALID';
}

export interface RetentionEvaluation {
  classificationVersion: string;
  result: RetentionResult;
  /** Per category: why it is held or released. Codes only. */
  categories: Record<string, { rows: number; reason: ReasonCode | 'RELEASED'; eligibleOn?: string }>;
  allowsDeletion: boolean;
}

export const RETENTION_CATEGORIES: (RetentionCategory | 'PAYROLL')[] = ['ATTENDANCE', 'LEAVE', 'PAYROLL'];

/** Matrix handlers whose rows are protected, by category. */
export function protectedHandlerKeys(): Record<RetentionCategory, string[]> {
  const out: Record<RetentionCategory, string[]> = { ATTENDANCE: [], LEAVE: [] };
  for (const h of HANDLERS) if (h.retention) out[h.retention].push(h.key);
  return out;
}

function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
}

export function evaluateRetention(input: RetentionInput): RetentionEvaluation {
  const categories: RetentionEvaluation['categories'] = {};
  let anyProtected = false;
  let anyHeld = false;

  for (const category of RETENTION_CATEGORIES) {
    const dates = input.protectedDates[category] ?? [];
    if (dates.length === 0) continue;
    anyProtected = true;
    const rule = input.rules.find((r) => r.category === category);
    // An inactive, unapproved or NULL/non-positive period is not a policy.
    const usable = ruleHealth(rule) === 'OK';
    if (!usable) {
      categories[category] = { rows: dates.length, reason: input.defaultDeny ? REASON.RETENTION_POLICY_REQUIRED : REASON.POLICY_NOT_CONFIGURED };
      if (input.defaultDeny) anyHeld = true;
      continue;
    }
    if (rule!.status === 'ACTIVE' && rule!.noExpiry) {
      categories[category] = { rows: dates.length, reason: REASON.RETAINED_INDEFINITELY };
      anyHeld = true;
      continue;
    }
    const newest = dates.reduce((a, b) => (b > a ? b : a));
    const eligibleOn = addMonths(newest, rule!.retentionMonths as number);
    if (eligibleOn > input.now) {
      categories[category] = { rows: dates.length, reason: REASON.PERIOD_NOT_ELAPSED, eligibleOn: eligibleOn.toISOString().slice(0, 10) };
      anyHeld = true;
    } else {
      categories[category] = { rows: dates.length, reason: 'RELEASED' };
    }
  }

  let result: RetentionResult;
  if (input.activeLegalHolds > 0) result = RETENTION_RESULT.LEGAL_HOLD;
  else if (anyHeld) result = RETENTION_RESULT.RETENTION_PERIOD_ACTIVE;
  else if (anyProtected) result = RETENTION_RESULT.RETENTION_APPROVED_FOR_DELETION;
  else result = RETENTION_RESULT.NO_HOLD;

  return {
    classificationVersion: RETENTION_CLASSIFICATION_VERSION,
    result,
    categories,
    allowsDeletion: result === RETENTION_RESULT.NO_HOLD || result === RETENTION_RESULT.RETENTION_APPROVED_FOR_DELETION,
  };
}

/** The business date of a protected row: the most meaningful date it carries. */
export function protectedRowDate(row: any): Date {
  for (const k of ['date', 'businessDate', 'startDate', 'endDate', 'loginAt', 'startAt', 'occurredAt', 'serverOccurredAt', 'effectiveFrom', 'createdAt']) {
    const v = row?.[k];
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  }
  return new Date(0);
}

/** The AppSetting key for default-deny retention (D1). Off unless set to true. */
export const RETENTION_DEFAULT_DENY_KEY = 'compliance.retentionDefaultDeny';

export async function retentionDefaultDeny(db: any): Promise<boolean> {
  const row = await db.appSetting.findUnique({ where: { key: RETENTION_DEFAULT_DENY_KEY }, select: { value: true } });
  return row?.value === true;
}

/** The refusal for a retention evaluation that does not allow deletion. */
export function retentionRefusal(e: RetentionEvaluation): [ReasonCode, string] {
  const reasons = Object.values(e.categories).map((c) => c.reason);
  if (reasons.includes(REASON.RETENTION_POLICY_REQUIRED)) {
    return [REASON.RETENTION_POLICY_REQUIRED, 'Permanent deletion needs an approved retention rule for every protected record category.'];
  }
  if (reasons.includes(REASON.RETAINED_INDEFINITELY)) {
    return [REASON.RETENTION_BLOCKED, 'Permanent deletion is blocked: an approved retention rule keeps these records indefinitely.'];
  }
  return [REASON.RETENTION_BLOCKED, 'Permanent deletion is blocked by a record-retention requirement.'];
}

/**
 * Exit cases that block Archive and Permanent Delete (D8, correction 7):
 * NOTICE_RUNNING, CLEARANCE_IN_PROGRESS, and CLEARED while F&F is not
 * RELEASED. WITHDRAWN and COMPLETED never block.
 */
export async function countOpenExitCases(db: any, userId: string): Promise<number> {
  return db.exitCase.count({
    where: {
      userId,
      OR: [
        { state: { in: ['NOTICE_RUNNING', 'CLEARANCE_IN_PROGRESS'] } },
        { state: 'CLEARED', OR: [{ settlement: null }, { settlement: { state: { not: 'RELEASED' } } }] },
      ],
    },
  });
}
