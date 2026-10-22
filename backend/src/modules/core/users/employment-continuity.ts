import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { closeProfilesAt } from '../../platform/attendance/timeline/profile-continuity';

/**
 * The one lifecycle-safe way to take a person out of active employment
 * (decision D11, correction 12). Callers name the reason; ordinary
 * administrative deactivation never goes through resignation logic, and
 * resignation never goes through plain deactivation.
 *
 * Both run inside the CALLER'S transaction, after the caller has locked the
 * user row, and write their audit event in that same transaction.
 */

export type DeactivationReason = 'DEACTIVATION';

export interface DeactivateInput {
  userId: string;
  reason: DeactivationReason;
  /** Company "today": the last day the attendance profile covers. */
  lastDay: string;
  actorId: string | null;
  now: Date;
  source: string;
}

/**
 * Ordinary, reversible deactivation (PUT isActive:false, DELETE /users/:id).
 * The EmploymentPeriod stays OPEN, because Reactivate continues the same
 * employment; the attendance profile ends today so no absence is generated for
 * the inactive gap; sessions are revoked so no token outlives the change.
 */
export async function deactivateUser(tx: Prisma.TransactionClient | any, input: DeactivateInput): Promise<{ profilesClosed: number }> {
  await tx.user.update({
    where: { id: input.userId },
    data: { isActive: false, employmentState: 'DEACTIVATED', scheduledActivationOn: null, sessionsRevokedAt: input.now },
  });
  const profilesClosed = await closeProfilesAt(tx, input.userId, input.lastDay, input.actorId);
  await cancelWaitingHandoffs(tx, input.userId, input.now);
  await writeAudit(tx, {
    actorId: input.actorId ?? input.userId,
    entityType: 'User',
    entityId: input.userId,
    action: 'USER_DEACTIVATED',
    toState: 'DEACTIVATED',
    metadata: { reason: input.reason, source: input.source, profilesClosed },
  });
  return { profilesClosed };
}

export interface SeparateInput {
  userId: string;
  exitCaseId: string;
  lastWorkingDay: string;
  actorId: string | null;
  now: Date;
  source: 'SCHEDULER' | 'RECONCILIATION' | 'AUTH_CHECK' | 'MANUAL';
}

export interface SeparationEffects {
  periodsClosed: number;
  profilesClosed: number;
  handoffsCancelled: number;
  pushDisabled: number;
}

/**
 * Resignation separation (correction 4): everything in one commit.
 * lastWorkingDate, the EmploymentPeriod closed with RESIGNATION, the profile
 * closed at the LWD, access off, every session revoked (there are no refresh
 * tokens: a JWT is checked against sessionsRevokedAt), unfinished phone
 * handoffs cancelled, push subscriptions disabled, and the audit event. The
 * caller moves the exit case and re-evaluates F&F in the same transaction and
 * disconnects sockets after commit.
 */
export async function separateEmployment(tx: Prisma.TransactionClient | any, input: SeparateInput): Promise<SeparationEffects> {
  const lwd = new Date(`${input.lastWorkingDay}T00:00:00.000Z`);
  await tx.user.update({
    where: { id: input.userId },
    data: {
      lastWorkingDate: lwd,
      isActive: false,
      employmentState: 'DEACTIVATED',
      scheduledActivationOn: null,
      sessionsRevokedAt: input.now,
    },
  });
  const periods = await tx.employmentPeriod.updateMany({
    where: { userId: input.userId, endDate: null },
    data: { endDate: lwd, endReason: 'RESIGNATION' },
  });
  const profilesClosed = await closeProfilesAt(tx, input.userId, input.lastWorkingDay, input.actorId);
  const handoffsCancelled = await cancelWaitingHandoffs(tx, input.userId, input.now);
  const push = await tx.pushSubscription.updateMany({ where: { userId: input.userId, disabledAt: null }, data: { disabledAt: input.now } });
  await writeAudit(tx, {
    actorId: input.actorId ?? input.userId,
    entityType: 'ExitCase',
    entityId: input.exitCaseId,
    action: 'EMPLOYEE_SEPARATED',
    fromState: 'NOTICE_RUNNING',
    metadata: { source: input.source, periodsClosed: periods.count, profilesClosed, handoffsCancelled, pushDisabled: push.count },
  });
  return { periodsClosed: periods.count, profilesClosed, handoffsCancelled, pushDisabled: push.count };
}

async function cancelWaitingHandoffs(tx: any, userId: string, now: Date): Promise<number> {
  const out = await tx.attendancePunchHandoff.updateMany({ where: { userId, status: 'WAITING' }, data: { status: 'CANCELLED', cancelledAt: now } });
  return out.count;
}

/** An OperationalEvent inside the caller's transaction. Codes and ids only. */
export async function writeAudit(
  tx: any,
  e: { actorId: string; entityType: string; entityId: string; action: string; fromState?: string | null; toState?: string | null; metadata?: Record<string, unknown> },
): Promise<void> {
  await tx.operationalEvent.create({
    data: {
      id: randomUUID(),
      actorId: e.actorId,
      entityType: e.entityType,
      entityId: e.entityId,
      action: e.action,
      fromState: e.fromState ?? null,
      toState: e.toState ?? null,
      metadata: (e.metadata ?? {}) as any,
    },
  });
}
