/**
 * Assigns an employee ID to every person who has none (Phase 2, B3).
 *
 *   DATABASE_URL=<target> npx ts-node --transpile-only scripts/employee-id/backfill-missing-employee-ids.ts
 *       -> dry run: counts only, nothing is written
 *   ... --execute --confirm-target=<host:port/database> [--rollback-file=<path>]
 *       -> writes, after the printed target matches the one confirmed
 *
 * Every ID comes from the Phase 1 allocator (apex_assign_employee_id), so a
 * number is never reused and malformed legacy codes elsewhere never break the
 * sequence. Each person is one short transaction: a run can be stopped and
 * started again, and a second run finds nothing left to do (idempotent).
 * People who already hold a code -- well-formed or not -- are never touched.
 *
 * A failure for one person opens an EMPLOYEE_ID_BACKFILL_FAILED setup issue
 * for the administrators and the run continues. The rollback file lists every
 * assignment made (user id and code) so the assignment can be undone; the
 * allocated numbers themselves stay retired, by design.
 *
 * Prints the host and database name, never a URL, user or password.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';

export interface BackfillResult {
  candidates: number;
  assigned: Array<{ userId: string; employeeId: string }>;
  alreadyAssigned: number;
  failed: Array<{ userId: string; reason: string }>;
}

type Db = Pick<PrismaClient, '$queryRaw' | '$transaction' | '$executeRaw'> & { userSetupIssue: any };

export async function findCandidates(prisma: Db): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "users"
    WHERE "employeeId" IS NULL AND COALESCE("isSystemAccount", false) = false
    ORDER BY "createdAt" ASC, "id" ASC
  `;
  return rows.map((r) => r.id);
}

export async function backfillMissingEmployeeIds(prisma: Db, opts: { execute: boolean }): Promise<BackfillResult> {
  const ids = await findCandidates(prisma);
  const result: BackfillResult = { candidates: ids.length, assigned: [], alreadyAssigned: 0, failed: [] };
  if (!opts.execute) return result;

  for (const userId of ids) {
    try {
      const outcome = await prisma.$transaction(async (tx: any) => {
        const before = await tx.$queryRaw`SELECT "employeeId" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
        if (!before[0]) return { skipped: true as const };
        if (before[0].employeeId) return { already: true as const };
        const allocated = await tx.$queryRaw`SELECT "apex_assign_employee_id"(${userId}, NULL) AS "employeeId"`;
        return { employeeId: allocated[0]?.employeeId as string };
      });
      if ('already' in outcome) result.alreadyAssigned += 1;
      else if ('employeeId' in outcome && outcome.employeeId) {
        result.assigned.push({ userId, employeeId: outcome.employeeId });
        await resolveIssue(prisma, userId);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'unknown error';
      result.failed.push({ userId, reason });
      await recordFailure(prisma, userId, reason).catch(() => undefined);
    }
  }
  return result;
}

async function recordFailure(prisma: Db, userId: string, reason: string) {
  const dedupeKey = `user:${userId}:EMPLOYEE_ID_BACKFILL_FAILED`;
  await prisma.userSetupIssue.upsert({
    where: { dedupeKey },
    create: {
      id: randomUUID(), userId, code: 'EMPLOYEE_ID_BACKFILL_FAILED', domain: 'ORGANIZATION',
      severity: 'WARNING', remediationClass: 'BACKEND_OPERATIONS', dedupeKey, details: { reason },
    },
    update: { status: 'OPEN', lastDetectedAt: new Date(), resolvedAt: null, details: { reason } },
  });
}

async function resolveIssue(prisma: Db, userId: string) {
  await prisma.userSetupIssue.updateMany({
    where: { dedupeKey: `user:${userId}:EMPLOYEE_ID_BACKFILL_FAILED`, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  });
}

function targetOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}/${u.pathname.replace(/^\//, '')}`;
  } catch {
    return '<unparseable>';
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const execute = args.includes('--execute');
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
  const prisma = new PrismaClient();
  try {
    const result = await backfillMissingEmployeeIds(prisma as any, { execute });
    console.log(`People without an employee ID: ${result.candidates}.`);
    if (!execute) {
      console.log('Dry run: nothing was written. Re-run with --execute --confirm-target=<target> to assign IDs.');
      return;
    }
    console.log(`Assigned: ${result.assigned.length}. Already had one (assigned meanwhile): ${result.alreadyAssigned}. Failed: ${result.failed.length}.`);
    const file = arg('rollback-file') ?? `employee-id-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(file, JSON.stringify({
      target,
      ranAt: new Date().toISOString(),
      note: 'Each entry was NULL before this run. Setting employeeId back to NULL undoes the assignment; the numbers stay retired.',
      assigned: result.assigned,
      failed: result.failed.map((f) => ({ userId: f.userId })),
    }, null, 2));
    console.log(`Rollback data written to ${file}.`);
    if (result.failed.length > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Backfill failed');
    process.exit(1);
  });
}
