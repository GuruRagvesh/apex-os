import { protectedReason } from '../../scripts/attendance/phase3-attendance-reconcile';

describe('Phase 3 historical reconciliation preservation rules', () => {
  const unresolved = { evaluationState: 'NEEDS_REVIEW', locked: false, revision: 0, lastRegularizationId: null, leaveRequestId: null, status: 'MISSING_PUNCH' };

  it('may update a missing result or an unresolved one', () => {
    expect(protectedReason(null, null)).toBeNull();
    expect(protectedReason(unresolved, 'OPEN')).toBeNull();
  });

  it('never touches a payroll-closed month, even for a missing day', () => {
    expect(protectedReason(null, 'FINALIZED')).toBe('PAYROLL_CLOSED');
    expect(protectedReason(unresolved, 'SENT')).toBe('PAYROLL_CLOSED');
  });

  it('never touches finalized, locked or manually corrected results', () => {
    expect(protectedReason({ ...unresolved, evaluationState: 'FINALIZED' }, null)).toBe('FINALIZED');
    expect(protectedReason({ ...unresolved, locked: true }, null)).toBe('LOCKED');
    expect(protectedReason({ ...unresolved, revision: 1 }, null)).toBe('MANUALLY_CORRECTED');
    expect(protectedReason({ ...unresolved, lastRegularizationId: 'reg-1' }, null)).toBe('MANUALLY_CORRECTED');
  });

  it('never touches a day decided by approved leave, or one already resolved', () => {
    expect(protectedReason({ ...unresolved, leaveRequestId: 'lv-1', status: 'LEAVE' }, null)).toBe('APPROVED_LEAVE');
    expect(protectedReason({ ...unresolved, evaluationState: 'CALCULATED', status: 'PRESENT' }, null)).toBe('ALREADY_RESOLVED');
  });
});
