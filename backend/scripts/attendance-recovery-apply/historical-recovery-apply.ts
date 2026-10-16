import { assessSettlement, businessMonthOf, describeBlocked } from '../../src/modules/platform/attendance/evaluation/attendance-settlement';
import { lockAttendanceMonth } from '../../src/modules/platform/attendance/evaluation/attendance-month-lock';
import type { AttendanceDayBundle } from '../../src/modules/platform/attendance/recovery/recovery.types';
import type { RecoveryFlags } from '../../src/modules/platform/attendance/recovery/recovery-flags';
import { toDailyAttendanceCreate } from '../../src/modules/platform/attendance/recovery/historical-recovery';

/**
 * The insert-only writer for RECOVERY_IMPORT of historical attendance facts.
 *
 * LIVES IN scripts/, NOT src/, ON PURPOSE. The recovery module's own safety test
 * asserts that nothing under src/.../recovery can write, and that invariant stays
 * true. This file is not compiled into the application and is imported by no
 * controller, scheduler or service, so the running app cannot reach it; it is
 * called, deliberately, by a person-run script after an explicit approval. It
 * refuses unless EVERY guard below passes.
 *
 * What it can do: INSERT one DailyAttendance row per approved employee-day.
 * What it cannot do, by construction (a test scans this file for each):
 *   - update or upsert a row            - delete a row
 *   - create a WorkSession, BreakLog, PunchEvidence or Regularization
 *   - run the attendance evaluator      - touch R2 or any vault
 *   - read or consult attendance/shift policy
 *
 * An employee-day that already has a DailyAttendance row is SKIPPED, never
 * overwritten: the existing Apex record wins, re-checked inside the transaction
 * that would write, because the preview that classified it may be minutes old.
 */

export const HISTORICAL_APPLY_CONFIRM_PHRASE = 'APPLY STAGING HISTORICAL WAVE 1';

export type HistoricalApplyRefusal =
  | 'APP_ENV_NOT_STAGING'
  | 'RECOVERY_NOT_ENABLED'
  | 'STAGING_IDENTITY_NOT_PROVEN'
  | 'CONFIRMATION_MISSING'
  | 'NOTHING_TO_APPLY'
  | 'MONTH_SETTLED'
  | 'NOT_A_RECOVERED_DAY';

export class HistoricalApplyRefused extends Error {
  constructor(readonly code: HistoricalApplyRefusal, message: string) {
    super(`${code}: ${message}`);
    this.name = 'HistoricalApplyRefused';
  }
}

export interface HistoricalApplyGuard {
  /** process.env.APP_ENV. Must be exactly "staging". Production has no path here. */
  appEnv: string | undefined;
  /** From the stored recovery configuration. All default OFF. */
  flags: RecoveryFlags;
  /** The caller has proven the exact active staging host + database (checkStagingIdentity.ok). */
  stagingIdentityProven: boolean;
  /** The operator's exact phrase. */
  confirmation: string;
}

export interface HistoricalInsert {
  /** Apex User.id the approved Employee ID resolved to. */
  userId: string;
  bundle: AttendanceDayBundle;
}

/** The slice of a Prisma transaction this module uses. Narrow on purpose. */
export interface HistoricalApplyTx {
  // The month advisory lock is taken by the existing lockAttendanceMonth(tx), which
  // owns its own statement; this module names no raw-SQL capability.
  attendanceMonthClose: { findUnique: (args: any) => Promise<{ status: string } | null> };
  dailyAttendance: {
    findUnique: (args: any) => Promise<{ id: string } | null>;
    create: (args: { data: any }) => Promise<unknown>;
  };
}
export interface HistoricalApplyDb {
  $transaction: <T>(fn: (tx: HistoricalApplyTx) => Promise<T>, options?: any) => Promise<T>;
}

export function assertHistoricalApplyAllowed(guard: HistoricalApplyGuard): void {
  if ((guard.appEnv ?? '').trim() !== 'staging') {
    throw new HistoricalApplyRefused('APP_ENV_NOT_STAGING', 'historical recovery apply exists for staging only');
  }
  if (guard.flags.ATTENDANCE_RECOVERY_ENABLED !== true) {
    throw new HistoricalApplyRefused('RECOVERY_NOT_ENABLED', 'ATTENDANCE_RECOVERY_ENABLED is OFF');
  }
  if (guard.stagingIdentityProven !== true) {
    throw new HistoricalApplyRefused('STAGING_IDENTITY_NOT_PROVEN', 'the exact active staging database was not proven');
  }
  if (guard.confirmation !== HISTORICAL_APPLY_CONFIRM_PHRASE) {
    throw new HistoricalApplyRefused('CONFIRMATION_MISSING', 'the explicit approval phrase was not supplied');
  }
}

export interface HistoricalApplyResult {
  inserted: number;
  skippedExisting: number;
  /** employeeId|date of every row that was written. */
  insertedKeys: string[];
  skippedKeys: string[];
}

export async function applyHistoricalRecovery(
  db: HistoricalApplyDb,
  inserts: HistoricalInsert[],
  guard: HistoricalApplyGuard,
): Promise<HistoricalApplyResult> {
  assertHistoricalApplyAllowed(guard);
  if (inserts.length === 0) throw new HistoricalApplyRefused('NOTHING_TO_APPLY', 'no approved employee-days were supplied');
  for (const i of inserts) {
    if (!i.bundle.dailyAttendance || i.bundle.dailyAttendance.calculationReason !== 'HISTORICAL_RECOVERY_IMPORT') {
      throw new HistoricalApplyRefused('NOT_A_RECOVERED_DAY', `${i.bundle.employeeId} ${i.bundle.businessDate} is not a recovered historical day`);
    }
  }

  const byMonth = new Map<string, HistoricalInsert[]>();
  for (const i of inserts) byMonth.set(businessMonthOf(i.bundle.businessDate), [...(byMonth.get(businessMonthOf(i.bundle.businessDate)) ?? []), i]);

  const result: HistoricalApplyResult = { inserted: 0, skippedExisting: 0, insertedKeys: [], skippedKeys: [] };

  // One transaction per month: the month lock is per month, and a failure leaves
  // earlier months complete and later ones untouched rather than half-written.
  for (const [month, rows] of [...byMonth].sort(([a], [b]) => a.localeCompare(b))) {
    await db.$transaction(async (tx) => {
      await lockAttendanceMonth(tx, month);

      // A bulk operation is refused by ANY settled month (finalized or sent).
      const monthClose = await tx.attendanceMonthClose.findUnique({ where: { month }, select: { status: true } });
      const settlement = assessSettlement({ day: null, monthClose }, 'BULK_IMPORT');
      if (settlement.blocked.length > 0) {
        throw new HistoricalApplyRefused('MONTH_SETTLED', `${month}: ${describeBlocked(settlement.blocked)}`);
      }

      for (const r of rows) {
        const key = `${r.bundle.employeeId}|${r.bundle.businessDate}`;
        const date = new Date(`${r.bundle.businessDate}T00:00:00.000Z`);
        const existing = await tx.dailyAttendance.findUnique({ where: { userId_date: { userId: r.userId, date } }, select: { id: true } });
        if (existing) {
          // The existing Apex record wins. Never overwritten, never merged.
          result.skippedExisting += 1;
          result.skippedKeys.push(key);
          continue;
        }
        await tx.dailyAttendance.create({ data: toDailyAttendanceCreate(r.userId, r.bundle.dailyAttendance!) });
        result.inserted += 1;
        result.insertedKeys.push(key);
      }
    }, { timeout: 120_000 });
  }
  return result;
}
