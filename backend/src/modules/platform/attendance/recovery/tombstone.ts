import type { AttendanceDayBundle, RecoveryTombstone } from './recovery.types';

/**
 * Tombstones stop deliberately removed attendance from being resurrected.
 *
 * A backup or mirror still holds a record that a human removed on purpose. Seen
 * from reconciliation alone, that is indistinguishable from data loss
 * (RECOVERY_ONLY). A tombstone is the durable statement "this was removed
 * intentionally", and any match makes the bundle ineligible for repair.
 *
 * Matching is by the business identity (employeeId + businessDate) plus:
 *   DAY                       — the whole day, any content
 *   <type> with recordId null — any record of that type in the bundle
 *   <type> with recordId      — that exact record (PUNCH_EVIDENCE: idempotencyKey)
 */
export function matchingTombstones(bundle: AttendanceDayBundle, tombstones: RecoveryTombstone[]): RecoveryTombstone[] {
  const relevant = tombstones.filter((t) => t.employeeId === bundle.employeeId && t.businessDate === bundle.businessDate);
  return relevant.filter((t) => {
    const has = (ids: string[]) => (t.recordId === null ? ids.length > 0 : ids.includes(t.recordId));
    switch (t.recordType) {
      case 'DAY':
        return true;
      case 'DAILY_ATTENDANCE':
        return bundle.dailyAttendance !== null;
      case 'WORK_SESSION':
        return has(bundle.workSessions.map((s) => s.id));
      case 'BREAK_LOG':
        return has(bundle.breakLogs.map((b) => b.id));
      case 'PUNCH_EVIDENCE':
        return has(bundle.punchEvidence.map((e) => e.idempotencyKey));
      case 'REGULARIZATION':
        return has(bundle.regularizations.map((g) => g.id));
      default:
        // An unknown tombstone type blocks rather than being ignored.
        return true;
    }
  });
}
