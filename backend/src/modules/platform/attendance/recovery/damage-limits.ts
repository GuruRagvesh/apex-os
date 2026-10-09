/**
 * Damage limits — how much recovery is allowed to propose before a human must
 * look, and when it must stop outright. Pure; computes a verdict, changes nothing.
 *
 *   proposed employee-days > manualApprovalAbove                 → MANUAL_APPROVAL_REQUIRED
 *   proposed / historical employee-days > hardStopPercent         → HARD_STOP
 *   a whole month has recovery days but NO current days           → HARD_STOP
 *     (that is not "a few lost rows"; it is either a disaster or the wrong
 *      database, and neither is something to repair automatically)
 *
 * With no historical attendance at all, any proposal is HARD_STOP: there is no
 * baseline against which "small" can be judged.
 */

export interface DamageLimits {
  manualApprovalAbove: number;
  hardStopPercent: number;
  wholeMonthLossIsHardStop: boolean;
}

export const DEFAULT_DAMAGE_LIMITS: DamageLimits = {
  manualApprovalAbove: 25,
  hardStopPercent: 5,
  wholeMonthLossIsHardStop: true,
};

/** Accepts only sane overrides; anything else falls back to the default. */
export function sanitizeDamageLimits(raw: unknown): DamageLimits {
  const r = (raw ?? {}) as Record<string, unknown>;
  const posInt = (v: unknown, d: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : d);
  const pct = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100 ? v : d);
  return {
    manualApprovalAbove: posInt(r.manualApprovalAbove, DEFAULT_DAMAGE_LIMITS.manualApprovalAbove),
    hardStopPercent: pct(r.hardStopPercent, DEFAULT_DAMAGE_LIMITS.hardStopPercent),
    wholeMonthLossIsHardStop: r.wholeMonthLossIsHardStop === false ? false : true,
  };
}

export interface DamageInput {
  /** Employee-days that would be written (eligible RECOVERY_ONLY). */
  proposedEmployeeDays: number;
  /** Employee-days of DailyAttendance currently stored for the historical period. */
  historicalEmployeeDays: number;
  /** Per month: employee-days with DailyAttendance in the target and in the recovery source. */
  months: Array<{ month: string; currentDays: number; recoveryDays: number }>;
}

export type DamageDecision = 'OK' | 'MANUAL_APPROVAL_REQUIRED' | 'HARD_STOP';

export function evaluateDamage(input: DamageInput, limits: DamageLimits = DEFAULT_DAMAGE_LIMITS): {
  decision: DamageDecision;
  reasons: string[];
  percent: number | null;
} {
  const reasons: string[] = [];
  let decision: DamageDecision = 'OK';
  const escalate = (d: DamageDecision) => {
    const rank = { OK: 0, MANUAL_APPROVAL_REQUIRED: 1, HARD_STOP: 2 };
    if (rank[d] > rank[decision]) decision = d;
  };

  const n = input.proposedEmployeeDays;
  let percent: number | null = null;
  if (n > 0) {
    if (input.historicalEmployeeDays <= 0) {
      escalate('HARD_STOP');
      reasons.push('NO_HISTORICAL_BASELINE');
    } else {
      percent = (n / input.historicalEmployeeDays) * 100;
      if (percent > limits.hardStopPercent) {
        escalate('HARD_STOP');
        reasons.push(`ABOVE_${limits.hardStopPercent}_PERCENT`);
      }
    }
    if (n > limits.manualApprovalAbove) {
      escalate('MANUAL_APPROVAL_REQUIRED');
      reasons.push(`ABOVE_${limits.manualApprovalAbove}_EMPLOYEE_DAYS`);
    }
  }
  if (limits.wholeMonthLossIsHardStop) {
    for (const m of input.months) {
      if (m.currentDays === 0 && m.recoveryDays > 0) {
        escalate('HARD_STOP');
        reasons.push(`WHOLE_MONTH_MISSING:${m.month}`);
      }
    }
  }
  return { decision, reasons, percent };
}
