/**
 * Manual Attendance Recovery decision rules.
 *
 * Dependency-free on purpose: the frontend has no test runner, so these are
 * exercised from the backend suite, which cannot resolve the app's module
 * aliases. Transport lives in manual-recovery-api.ts.
 *
 * The last resort when neither the laptop nor the employee's phone can produce
 * evidence. Never reachable by an employee: the server refuses an actor who is
 * also the subject, and the UI does not render the control for them.
 */

export const RECOVERY_REASONS = [
  'SERVER_UNAVAILABLE',
  'EMPLOYEE_INTERNET_ISSUE',
  'DEVICE_NETWORK_ISSUE',
  'CAMERA_OR_LOCATION_UNAVAILABLE',
  'PUNCH_SUBMISSION_FAILED',
  'OTHER',
] as const;

export type RecoveryReason = (typeof RECOVERY_REASONS)[number];

export const REASON_LABEL: Record<RecoveryReason, string> = {
  SERVER_UNAVAILABLE: 'Apex OS was unavailable',
  EMPLOYEE_INTERNET_ISSUE: 'Employee internet issue',
  DEVICE_NETWORK_ISSUE: 'Device or network problem',
  CAMERA_OR_LOCATION_UNAVAILABLE: 'Camera or location unavailable',
  PUNCH_SUBMISSION_FAILED: 'Punch submission failed',
  OTHER: 'Other',
};

export type RecoveryAction = 'ADD_IN' | 'ADD_OUT' | 'CORRECT_IN' | 'CORRECT_OUT';

export const ACTION_LABEL: Record<RecoveryAction, string> = {
  ADD_IN: 'Add punch in',
  ADD_OUT: 'Add punch out',
  CORRECT_IN: 'Correct punch in',
  CORRECT_OUT: 'Correct punch out',
};

export interface ManualRecoveryDraft {
  userId: string;
  businessDate: string;
  action: RecoveryAction;
  /** Local time-of-day, HH:mm, in company time. */
  effectiveTime: string;
  recoveryReason: RecoveryReason;
  reason: string;
  employeeInformedAt: string;
}

/** Minimum explanation length. Mirrors the server so the UI fails first. */
export const MIN_EXPLANATION = 10;

export function isCorrection(action: RecoveryAction): boolean {
  return action === 'CORRECT_IN' || action === 'CORRECT_OUT';
}

export function isPunchIn(action: RecoveryAction): boolean {
  return action === 'ADD_IN' || action === 'CORRECT_IN';
}

/**
 * Which actions make sense given what already exists.
 *
 * An Add for a punch that exists would create a duplicate, and a Correct for
 * one that does not has nothing to correct. Offering either invites the server
 * to refuse something the UI should never have shown.
 */
export function availableActions(existing: {
  punchInAt: string | null;
  punchOutAt: string | null;
}): RecoveryAction[] {
  return [
    existing.punchInAt ? 'CORRECT_IN' : 'ADD_IN',
    existing.punchOutAt ? 'CORRECT_OUT' : 'ADD_OUT',
  ];
}

export interface DraftValidation {
  ok: boolean;
  errors: Partial<Record<keyof ManualRecoveryDraft, string>>;
}

/**
 * Validates before submitting.
 *
 * The server validates independently — this is a courtesy, not the boundary.
 * The explanation rule is deliberately the same on both sides: a recovery
 * whose justification is "n/a" is a punch nobody can defend later.
 */
export function validateDraft(draft: Partial<ManualRecoveryDraft>): DraftValidation {
  const errors: DraftValidation['errors'] = {};

  if (!draft.userId) errors.userId = 'Select an employee';
  if (!draft.businessDate) errors.businessDate = 'Select the business date';
  if (!draft.action) errors.action = 'Choose what is being recorded';
  if (!draft.effectiveTime || !/^\d{2}:\d{2}$/.test(draft.effectiveTime)) {
    errors.effectiveTime = 'Enter the actual punch time';
  }
  if (!draft.recoveryReason) errors.recoveryReason = 'Select why this could not be recorded';
  if (!draft.employeeInformedAt) {
    errors.employeeInformedAt = 'Record when the employee reported the problem';
  }
  if (!draft.reason || draft.reason.trim().length < MIN_EXPLANATION) {
    // OTHER is not a licence to skip the explanation -- it is the case that
    // needs one most, because the category says nothing.
    errors.reason = 'Explain what happened. This is the durable record.';
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

/** Combines a business date and company-time HH:mm into an instant. */
export function toInstant(businessDate: string, time: string): string {
  return new Date(`${businessDate}T${time}:00.000Z`).toISOString();
}
