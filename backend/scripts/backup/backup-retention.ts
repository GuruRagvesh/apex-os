/**
 * Which backups the retention sweep may delete.
 *
 * Retention is the one routine job that destroys recovery points, so it is
 * written to be timid. Two rules do most of the work:
 *
 *   1. PRE_MIGRATION and MONTHLY are never deleted by the daily sweep. A
 *      pre-migration copy is the restore point for the riskiest thing we do,
 *      and monthly archives are the long-horizon history — neither should
 *      disappear because a daily rotation ran.
 *   2. Anything it cannot confidently classify is KEPT. An unrecognised object
 *      in the vault is not evidence that it is disposable.
 *
 * Selection is pure and has a dry-run caller, so what would be deleted can
 * always be read before anything is.
 */

import type { BackupType } from './backup-manifest';

export interface RetentionPolicy {
  dailyDays: number;
  weeklyDays: number;
  monthlyDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  dailyDays: 35,
  weeklyDays: 12 * 7,
  // Monthly archives are retained by the monthly job, not this one. The value
  // is recorded for reporting only; see keepReason below.
  monthlyDays: 365,
};

export interface VaultObject {
  key: string;
  type: BackupType | null;
  createdAt: string;
  byteSize: number;
}

export interface RetentionDecision {
  key: string;
  action: 'DELETE' | 'KEEP';
  reason: string;
  ageDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function classifyKey(key: string): BackupType | null {
  if (/\/pre-migration\//.test(key)) return 'PRE_MIGRATION';
  if (/\/monthly\//.test(key)) return 'MONTHLY';
  if (/\/weekly\//.test(key)) return 'WEEKLY';
  if (/\/daily\//.test(key)) return 'DAILY';
  return null;
}

export function planRetention(
  objects: VaultObject[],
  now: Date,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): RetentionDecision[] {
  return objects.map((o) => {
    const created = new Date(o.createdAt).getTime();
    const ageDays = Number.isFinite(created)
      ? Math.floor((now.getTime() - created) / DAY_MS)
      : Number.NaN;

    const type = o.type ?? classifyKey(o.key);

    if (!Number.isFinite(ageDays)) {
      return { key: o.key, action: 'KEEP', reason: 'Unreadable creation date', ageDays: 0 };
    }
    if (type === null) {
      return {
        key: o.key,
        action: 'KEEP',
        reason: 'Unrecognised object; the sweep does not delete what it cannot classify',
        ageDays,
      };
    }
    if (type === 'PRE_MIGRATION') {
      return {
        key: o.key,
        action: 'KEEP',
        reason: 'Pre-migration restore point, never deleted by the routine sweep',
        ageDays,
      };
    }
    if (type === 'MONTHLY') {
      return {
        key: o.key,
        action: 'KEEP',
        reason: 'Monthly archive, retained outside the daily rotation',
        ageDays,
      };
    }

    const limit = type === 'WEEKLY' ? policy.weeklyDays : policy.dailyDays;
    if (ageDays > limit) {
      return { key: o.key, action: 'DELETE', reason: `${type} older than ${limit} days`, ageDays };
    }
    return { key: o.key, action: 'KEEP', reason: `${type} within ${limit} days`, ageDays };
  });
}

/**
 * Refuses to delete everything.
 *
 * If a sweep believes the whole vault is expired, the likely cause is a wrong
 * clock or a misparsed date, not a genuinely empty retention window. Deleting
 * every recovery point is the one outcome that cannot be undone.
 */
export function assertRetentionSane(decisions: RetentionDecision[]): void {
  const deletes = decisions.filter((d) => d.action === 'DELETE');
  if (decisions.length > 0 && deletes.length === decisions.length) {
    throw new Error(
      'Retention would delete every object in the vault. Refusing: this is far more ' +
        'likely to be a clock or parsing fault than a real expiry.',
    );
  }
}
