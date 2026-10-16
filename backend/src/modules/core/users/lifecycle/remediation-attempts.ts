/**
 * Append-only remediation history for lifecycle operations.
 *
 * Every failure, verification, retry and resolution of a lifecycle operation
 * appends one row to lifecycle_remediation_attempts (the table refuses UPDATE
 * and DELETE by trigger), and the operation row caches the latest summary in
 * `remediation`. Rows carry codes and the sanitized payload only.
 */

import { randomUUID } from 'crypto';
import { RemediationResult, sanitizeRemediation } from '../../../../common/remediation';

export type AttemptPhase = 'FAILURE' | 'VERIFICATION' | 'INSTRUCTION' | 'RETRY' | 'RESOLUTION';

export interface AttemptInput {
  operationId: string;
  /** Null once the person is gone: no user id survives a permanent deletion. */
  subjectUserId: string | null;
  phase: AttemptPhase;
  outcome: 'BLOCKED' | 'FAILED' | 'PASSED' | 'PENDING' | 'RESOLVED';
  actorId: string;
  remediation: RemediationResult;
}

const MAX_RACE_RETRIES = 3;

/** Appends one attempt and refreshes the operation's latest summary. Never throws into the caller's error path. */
export async function recordLifecycleAttempt(db: any, input: AttemptInput): Promise<boolean> {
  const remediation = sanitizeRemediation({ ...input.remediation, operationId: input.operationId });
  for (let i = 0; i < MAX_RACE_RETRIES; i++) {
    try {
      const last = await db.lifecycleRemediationAttempt.aggregate({ where: { operationId: input.operationId }, _max: { attemptNo: true } });
      const attemptNo = (last._max.attemptNo ?? 0) + 1;
      await db.lifecycleRemediationAttempt.create({
        data: {
          id: randomUUID(),
          operationKind: 'LIFECYCLE',
          operationId: input.operationId,
          lifecycleOperationId: input.operationId,
          subjectUserId: input.subjectUserId,
          attemptNo,
          code: remediation.code,
          phase: input.phase,
          outcome: input.outcome,
          actorId: input.actorId,
          remediation: remediation as any,
        },
      });
      await db.userLifecycleOperation.update({ where: { id: input.operationId }, data: { remediation: remediation as any } });
      await notifyActor(db, input, remediation, attemptNo);
      return true;
    } catch (err: any) {
      if (err?.code === 'P2002') continue; // a concurrent attempt took this number
      return false;
    }
  }
  return false;
}

/**
 * Puts the diagnosis in the acting administrator's Notification Center (Phase
 * 2, A5). Codes and the registry's own copy only; never a provider handle. A
 * resolution is not a problem to report. Best effort: a failure here never
 * changes the operation's outcome.
 */
async function notifyActor(db: any, input: AttemptInput, remediation: RemediationResult, attemptNo: number) {
  if (input.outcome === 'RESOLVED' || input.outcome === 'PASSED' || !input.actorId) return;
  try {
    await db.notification.create({
      data: {
        userId: input.actorId,
        title: remediation.title || 'Lifecycle action needs attention',
        message: remediation.problem || 'A user lifecycle operation could not complete.',
        type: remediation.severity === 'BLOCKING' ? 'ERROR' : 'WARNING',
        link: '/users',
        entityType: 'UserLifecycleOperation',
        entityId: input.operationId,
        dedupeKey: `lifecycle-remediation:${input.operationId}:${attemptNo}`,
      },
    });
  } catch {
    // The attempt history is the record of truth; the notification is a convenience.
  }
}

/** Client view of the history for one operation, oldest first. */
export async function listLifecycleAttempts(db: any, operationId: string) {
  const rows = await db.lifecycleRemediationAttempt.findMany({ where: { operationId }, orderBy: { attemptNo: 'asc' } });
  return rows.map((r: any) => ({
    attemptNo: r.attemptNo,
    code: r.code,
    phase: r.phase,
    outcome: r.outcome,
    actorId: r.actorId,
    serverAt: r.serverAt instanceof Date ? r.serverAt.toISOString() : r.serverAt,
    remediation: sanitizeRemediation(r.remediation),
  }));
}
