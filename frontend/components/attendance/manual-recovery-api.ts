import { api, unwrap as r } from '@apex/shared-auth';
import {
  isCorrection,
  isPunchIn,
  toInstant,
  type ManualRecoveryDraft,
} from './manual-recovery-rules';

/**
 * Manual Attendance Recovery transport.
 *
 * Nothing here sends location or photo fields. A manual entry has no evidence,
 * and the absence is the honest record.
 */

export * from './manual-recovery-rules';

export async function submitManualRecovery(draft: ManualRecoveryDraft) {
  const at = toInstant(draft.businessDate, draft.effectiveTime);

  return r(
    api.post('/attendance/regularization/manual-recovery', {
      userId: draft.userId,
      businessDate: draft.businessDate,
      // Exactly one side is sent; the other stays untouched.
      requestedPunchIn: isPunchIn(draft.action) ? at : null,
      requestedPunchOut: isPunchIn(draft.action) ? null : at,
      recoveryReason: draft.recoveryReason,
      reason: draft.reason.trim(),
      employeeInformedAt: draft.employeeInformedAt,
      correctExisting: isCorrection(draft.action),
    }),
  );
}
