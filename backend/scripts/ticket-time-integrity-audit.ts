/**
 * Ticket timer integrity audit (read-only).
 *
 *   DATABASE_URL=postgresql://…@127.0.0.1:55432/apex_os_attendance_integration \
 *     npm run ticket-time:audit -- [--json] [--stale-hours=12] [--sample=20] [--now=ISO]
 *
 * Exit codes: 0 CLEAN, 2 VIOLATIONS_FOUND, 1 configuration/query/runtime failure.
 *
 * Refuses anything but the dedicated loopback integration database. There is no
 * production override and no repair mode; see
 * docs/operations/monitoring/ticket-time-integrity-audit.md.
 */
import {
  AuditConfigError,
  EXIT_FAILURE,
  assertAuditTarget,
  exitCodeFor,
  formatHuman,
  parseArgs,
  redactSecrets,
  runReadOnlyAudit,
} from './lib/ticket-time-integrity';

// Captured before Prisma is loaded: Prisma may fall back to .env files when the
// variable is absent, and the audit must only ever use what it was handed.
const DATABASE_URL = process.env.DATABASE_URL;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  assertAuditTarget(DATABASE_URL);

  // Loaded only after the URL has passed the gate.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } }, log: [] });
  try {
    const report = await runReadOnlyAudit(prisma, args.options);
    process.stdout.write((args.json ? JSON.stringify(report, null, 2) : formatHuman(report)) + '\n');
    return exitCodeFor(report);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const kind = err instanceof AuditConfigError ? 'refused' : 'failed';
    const message = redactSecrets(err instanceof Error ? err.message : String(err), DATABASE_URL);
    process.stderr.write(`ticket-time audit ${kind}: ${message}\n`);
    process.exit(EXIT_FAILURE);
  });
