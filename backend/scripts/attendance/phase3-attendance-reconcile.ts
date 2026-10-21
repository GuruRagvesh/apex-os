/**
 * Phase 3 historical attendance reconciliation (spec §12).
 *
 *   DATABASE_URL=<target> npx ts-node --transpile-only scripts/attendance/phase3-attendance-reconcile.ts \
 *       --from=2020-12-01 --to=2026-10-20
 *       -> dry run: counts and per-day proposals, nothing is written
 *   ... --execute --confirm-target=<host:port/database> [--checkpoint-file=<path>] [--rollback-file=<path>]
 *       -> writes, after the printed target matches the one confirmed
 *
 * Processes each employee independently and day by day through the ordinary
 * evaluator (the same code the scheduler uses), so a repaired policy, profile
 * or calendar is applied exactly as it would be live.
 *
 * MAY UPDATE ONLY:
 *   - missing results (no DailyAttendance row for an applicable day);
 *   - unresolved results (evaluationState NEEDS_REVIEW, never corrected);
 *   - days that were POLICY_SETUP_PENDING (never persisted) once the
 *     configuration resolves -- these are "missing" until then.
 *
 * NEVER CHANGES:
 *   - FINALIZED or locked results;
 *   - manually corrected results (revision > 0 or lastRegularizationId set);
 *   - days covered by approved historical leave (a leave-backed result);
 *   - payroll-closed months (AttendanceMonthClose FINALIZED or SENT);
 *   - inactive employment gaps (the evaluator returns no official result);
 *   - punch evidence (never written by this script at all).
 *
 * Resumable: the checkpoint file records each finished employee, and a rerun
 * skips them. Idempotent: an unchanged day is reported UNCHANGED, not rewritten.
 * The rollback file holds the before-image of every row this run changed (or
 * marks it CREATED), so each mutable correction can be reverted precisely.
 *
 * Prints host, port and database only -- never a URL, user or password.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { DailyAttendanceEvaluatorService } from '../../src/modules/platform/attendance/evaluation/daily-attendance-evaluator.service';
import { businessMonthOf } from '../../src/modules/platform/attendance/evaluation/attendance-settlement';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type DayOutcome = 'PROPOSED' | 'CHANGED' | 'UNCHANGED' | 'SKIPPED' | 'UNRESOLVED' | 'FAILED';

export interface ReconcileCounts {
  proposed: number;
  changed: number;
  unchanged: number;
  skipped: number;
  unresolved: number;
  failed: number;
}

/** Why an existing result must never be touched (null when it may be). */
export function protectedReason(
  row: { evaluationState?: string | null; locked?: boolean | null; revision?: number | null; lastRegularizationId?: string | null; leaveRequestId?: string | null; status?: string | null } | null,
  monthStatus: string | null | undefined,
): string | null {
  if (monthStatus === 'FINALIZED' || monthStatus === 'SENT') return 'PAYROLL_CLOSED';
  if (!row) return null;
  if (row.locked) return 'LOCKED';
  if (row.evaluationState === 'FINALIZED') return 'FINALIZED';
  if ((row.revision ?? 0) > 0 || row.lastRegularizationId) return 'MANUALLY_CORRECTED';
  if (row.leaveRequestId && (row.status === 'LEAVE' || row.status === 'LWP' || row.status === 'HALF_DAY')) return 'APPROVED_LEAVE';
  // Only unresolved results may be recalculated.
  if (row.evaluationState !== 'NEEDS_REVIEW') return 'ALREADY_RESOLVED';
  return null;
}

function targetOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}/${u.pathname.replace(/^\//, '')}`;
  } catch {
    return '<unparseable>';
  }
}

function* days(from: string, to: string) {
  const d = new Date(`${from}T12:00:00.000Z`);
  while (d.toISOString().slice(0, 10) <= to) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const execute = args.includes('--execute');
  const from = arg('from') ?? '2020-12-01';
  const to = arg('to');
  if (!to || !DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    console.error('Pass --from=yyyy-MM-dd and --to=yyyy-MM-dd (from <= to).');
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(2);
  }
  const target = targetOf(url);
  console.log(`Target: ${target}`);
  if (execute && arg('confirm-target') !== target) {
    console.error('Refusing to write: pass --confirm-target with exactly the target printed above.');
    process.exit(2);
  }

  const checkpointFile = arg('checkpoint-file') ?? `phase3-attendance-reconcile.checkpoint.json`;
  const done = new Set<string>(execute && existsSync(checkpointFile) ? JSON.parse(readFileSync(checkpointFile, 'utf8')).doneUserIds ?? [] : []);
  const rollbackFile = arg('rollback-file') ?? `phase3-attendance-reconcile-rollback-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const counts: ReconcileCounts = { proposed: 0, changed: 0, unchanged: 0, skipped: 0, unresolved: 0, failed: 0 };
  const skippedBy: Record<string, number> = {};
  const rollback: Array<{ userId: string; businessDate: string; before: any | 'CREATED' }> = [];
  const failures: Array<{ userId: string; businessDate: string; error: string }> = [];
  try {
    const prisma = app.get(PrismaService);
    const evaluator = app.get(DailyAttendanceEvaluatorService);
    const users = await prisma.user.findMany({ where: { isSystemAccount: false }, select: { id: true }, orderBy: { id: 'asc' } });
    const closes = await prisma.attendanceMonthClose.findMany({ select: { month: true, status: true } });
    const monthStatus = new Map(closes.map((c) => [c.month, c.status as string]));

    for (const user of users) {
      if (done.has(user.id)) continue;
      for (const businessDate of days(from, to)) {
        const date = new Date(`${businessDate}T00:00:00.000Z`);
        try {
          const existing = await prisma.dailyAttendance.findUnique({ where: { userId_date: { userId: user.id, date } } });
          const reason = protectedReason(existing, monthStatus.get(businessMonthOf(businessDate)));
          if (reason) {
            counts.skipped += 1;
            skippedBy[reason] = (skippedBy[reason] ?? 0) + 1;
            continue;
          }
          const result = await evaluator.evaluate(user.id, businessDate);
          // Not employed, exempt or still configuration-blocked: nothing to conclude.
          if (!result.official || result.status === null) {
            counts.unresolved += 1;
            continue;
          }
          if (existing && existing.sourceFingerprint === result.sourceFingerprint) {
            counts.unchanged += 1;
            continue;
          }
          counts.proposed += 1;
          if (!execute) continue;
          const out = await evaluator.evaluateAndPersist(user.id, businessDate);
          if (out.persisted) {
            counts.changed += 1;
            rollback.push({ userId: user.id, businessDate, before: existing ?? 'CREATED' });
          } else {
            counts.skipped += 1;
            skippedBy[out.reason] = (skippedBy[out.reason] ?? 0) + 1;
          }
        } catch (error) {
          counts.failed += 1;
          failures.push({ userId: user.id, businessDate, error: error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'unknown' });
        }
      }
      if (execute) {
        done.add(user.id);
        writeFileSync(checkpointFile, JSON.stringify({ target, from, to, doneUserIds: [...done] }, null, 2));
        writeFileSync(rollbackFile, JSON.stringify({ target, from, to, note: 'before = the row before this run (CREATED = delete the row to revert). Punch evidence is never touched.', rollback, failures }, null, 2));
      }
    }
  } finally {
    await app.close();
  }

  console.log(JSON.stringify({ dryRun: !execute, target, from, to, counts, skippedBy, failures: failures.length }, null, 2));
  if (execute) console.log(`Rollback data: ${rollbackFile}. Checkpoint: ${checkpointFile}.`);
  if (failures.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Reconciliation failed');
    process.exit(1);
  });
}
