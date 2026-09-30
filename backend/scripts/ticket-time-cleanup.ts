/**
 * Ticket timer cleanup (Phase 2D1). Dry run by default.
 *
 *   DATABASE_URL=postgresql://…@127.0.0.1:55432/apex_os_attendance_integration \
 *     npm run ticket-time:cleanup -- [--json] [--sample=20] [--now=ISO]
 *
 *   … -- --apply --confirm-database=apex_os_attendance_integration
 *
 * Exit codes: 0 CLEAN (dry run) or APPLIED/CLEAN (apply); 2 CHANGES_REQUIRED
 * (dry run found rows to close); 1 refused, failed or rolled back.
 *
 * Refuses anything but the dedicated loopback integration database. There is
 * no production override. See docs/operations/deployment/TICKET_TIMER_GUARDRAIL_RELEASE.md.
 */
import { AUDIT_DB_NAME, AuditConfigError, assertAuditTarget, redactSecrets } from './lib/ticket-time-integrity';
import {
  CLEANUP_EXIT_FAILURE,
  cleanupExitCode,
  formatCleanup,
  parseCleanupArgs,
  runCleanupApply,
  runCleanupDryRun,
} from './lib/ticket-time-cleanup';

// Captured before Prisma is loaded, which may otherwise fall back to .env files.
const DATABASE_URL = process.env.DATABASE_URL;

async function main(): Promise<number> {
  const args = parseCleanupArgs(process.argv.slice(2), AUDIT_DB_NAME);
  assertAuditTarget(DATABASE_URL);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } }, log: [] });
  try {
    const report = args.apply
      ? await runCleanupApply(prisma, args.options)
      : await runCleanupDryRun(prisma, args.options);
    process.stdout.write((args.json ? JSON.stringify(report, null, 2) : formatCleanup(report)) + '\n');
    return cleanupExitCode(report);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const kind = err instanceof AuditConfigError ? 'refused' : 'failed (no changes were kept)';
    const message = redactSecrets(err instanceof Error ? err.message : String(err), DATABASE_URL);
    process.stderr.write(`ticket-time cleanup ${kind}: ${message}\n`);
    process.exit(CLEANUP_EXIT_FAILURE);
  });
