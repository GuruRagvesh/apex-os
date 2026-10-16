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
}

export interface RetentionInput {
  /** Protected rows per category, with each row's business date. */
  protectedDates: Partial<Record<RetentionCategory | 'PAYROLL', Date[]>>;
  rules: RetentionRuleRow[];
  activeLegalHolds: number;
  now: Date;
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
    const usable = !!rule && rule.active && !!rule.approvedAt && Number.isInteger(rule.retentionMonths) && (rule.retentionMonths as number) > 0;
    if (!usable) {
      categories[category] = { rows: dates.length, reason: REASON.POLICY_NOT_CONFIGURED };
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
