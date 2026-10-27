/**
 * F&F settlement state rules (correction 6). Pure.
 *
 *   NOT_STARTED ──(separated ∧ all items settled ∧ no pending request)──► READY_FOR_RELEASE
 *   NOT_STARTED ──(separated ∧ deadline passed ∧ items open)──► ON_HOLD_REVIEW_REQUIRED
 *   ON_HOLD_REVIEW_REQUIRED ──(all settled ∧ no pending request)──► READY_FOR_RELEASE
 *   READY_FOR_RELEASE ──(an item reopened or a request raised)──► NOT_STARTED / ON_HOLD
 *   READY_FOR_RELEASE ──Admin release + payment reference──► RELEASED
 *
 * Never READY or RELEASED before separation. Release is always an explicit
 * Admin/Super Admin action. Nothing here forfeits pay, blacklists anyone or
 * creates an adjustment.
 */

import { SETTLED_CLEARANCE } from '../exit/clearance-defaults';

export type FnfState = 'NOT_STARTED' | 'ON_HOLD_REVIEW_REQUIRED' | 'READY_FOR_RELEASE' | 'RELEASED' | 'CANCELLED';

export interface FnfInput {
  state: FnfState;
  separated: boolean;
  /** Company "today" (YYYY-MM-DD). */
  today: string;
  deadlineOn: string;
  itemStatuses: string[];
  pendingRequests: number;
}

export interface FnfEvaluation {
  state: FnfState;
  holdReason: string | null;
  changed: boolean;
}

export const HOLD_REASON = {
  CLEARANCE_INCOMPLETE: 'CLEARANCE_INCOMPLETE',
  ADJUSTMENT_PENDING: 'ADJUSTMENT_PENDING',
} as const;

export function allSettled(statuses: string[]): boolean {
  return statuses.length > 0 && statuses.every((s) => (SETTLED_CLEARANCE as readonly string[]).includes(s));
}

export function evaluateFnf(input: FnfInput): FnfEvaluation {
  const keep = (state: FnfState, holdReason: string | null): FnfEvaluation => ({ state, holdReason, changed: state !== input.state });
  if (input.state === 'RELEASED' || input.state === 'CANCELLED') return { state: input.state, holdReason: null, changed: false };
  if (!input.separated) return keep('NOT_STARTED', null);

  const settled = allSettled(input.itemStatuses);
  if (settled && input.pendingRequests === 0) return keep('READY_FOR_RELEASE', null);

  const overdue = input.today > input.deadlineOn;
  if (overdue) {
    return keep('ON_HOLD_REVIEW_REQUIRED', settled ? HOLD_REASON.ADJUSTMENT_PENDING : HOLD_REASON.CLEARANCE_INCOMPLETE);
  }
  // Within the deadline and not ready: still in progress. A settlement that
  // was READY and lost readiness (a pending request) goes back to NOT_STARTED.
  return keep(input.state === 'ON_HOLD_REVIEW_REQUIRED' ? 'ON_HOLD_REVIEW_REQUIRED' : 'NOT_STARTED', input.state === 'ON_HOLD_REVIEW_REQUIRED' ? HOLD_REASON.CLEARANCE_INCOMPLETE : null);
}

/** Whether Release may be pressed right now. */
export function releaseProblem(input: { state: FnfState; separated: boolean; itemStatuses: string[]; pendingRequests: number }): string | null {
  if (input.state === 'RELEASED') return 'This settlement was already released.';
  if (input.state === 'CANCELLED') return 'This settlement was cancelled because the resignation was withdrawn.';
  if (!input.separated) return 'F&F can be released only after the employee has separated (after the end of the last working day).';
  if (!allSettled(input.itemStatuses)) return 'Every clearance item must be done, waived or not applicable before release.';
  if (input.pendingRequests > 0) return 'An F&F adjustment request is still waiting for a decision.';
  if (input.state !== 'READY_FOR_RELEASE') return 'This settlement is not ready for release yet.';
  return null;
}

export const FNF_ADJUSTMENT_KINDS = ['ATTENDANCE', 'MISCONDUCT', 'ASSET_RECOVERY', 'NOTICE_RECOVERY', 'OTHER'] as const;

/**
 * Controlled reason codes per kind, with the employee-safe text shown for
 * APPROVED adjustments (D7). Internal notes and references are never shown
 * to the employee.
 */
export const FNF_REASONS: Record<string, { kind: (typeof FNF_ADJUSTMENT_KINDS)[number]; employeeText: string }> = {
  UNPAID_ABSENCE: { kind: 'ATTENDANCE', employeeText: 'Unpaid absence' },
  ATTENDANCE_CORRECTION: { kind: 'ATTENDANCE', employeeText: 'Attendance correction' },
  POLICY_BREACH: { kind: 'MISCONDUCT', employeeText: 'Company policy deduction' },
  ASSET_NOT_RETURNED: { kind: 'ASSET_RECOVERY', employeeText: 'Company asset not returned' },
  ASSET_DAMAGE: { kind: 'ASSET_RECOVERY', employeeText: 'Company asset damage' },
  NOTICE_SHORTFALL: { kind: 'NOTICE_RECOVERY', employeeText: 'Notice period shortfall' },
  NOTICE_BUYOUT: { kind: 'NOTICE_RECOVERY', employeeText: 'Notice period buyout' },
  REIMBURSEMENT: { kind: 'OTHER', employeeText: 'Reimbursement' },
  BONUS_OR_INCENTIVE: { kind: 'OTHER', employeeText: 'Bonus or incentive' },
  LEAVE_ENCASHMENT: { kind: 'OTHER', employeeText: 'Leave encashment' },
  OTHER_ADJUSTMENT: { kind: 'OTHER', employeeText: 'Other adjustment' },
  REVERSAL: { kind: 'OTHER', employeeText: 'Correction of an earlier adjustment' },
};

export function adjustmentProblem(input: { kind: string; direction: string; amount: unknown; currency: string; reasonCode: string; reference: string }): string | null {
  if (!(FNF_ADJUSTMENT_KINDS as readonly string[]).includes(input.kind)) return 'Choose an adjustment type.';
  if (input.direction !== 'DEBIT' && input.direction !== 'CREDIT') return 'Choose debit or credit.';
  const amount = typeof input.amount === 'number' ? input.amount : Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100 || amount >= 1e10) {
    return 'Amount must be a positive number with at most two decimals.';
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) return 'Currency must be a three-letter code such as INR.';
  const reason = FNF_REASONS[input.reasonCode];
  if (!reason) return 'Choose a reason from the list.';
  if (input.reasonCode !== 'REVERSAL' && reason.kind !== input.kind) return 'That reason does not match the adjustment type.';
  if (!input.reference.trim()) return 'A supporting reference is required.';
  return null;
}
