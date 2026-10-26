/**
 * Phase 4 retention readiness report. READ-ONLY.
 *
 * Lists every protected record category (ATTENDANCE, LEAVE, PAYROLL) as
 * OK, MISSING, INACTIVE, INVALID or LEGACY_UNAPPROVED, and says whether turning
 * on `compliance.retentionDefaultDeny` would block deletion today. It never
 * writes, never seeds a period and never invents one.
 *
 *   npm run phase4:retention:readiness
 *
 * Run it against the environment you intend to enable default-deny in, review
 * the output, and only then turn the switch on in Settings -> Compliance.
 */
import { PrismaClient } from '@prisma/client';
import { computeReadiness } from '../../src/modules/core/users/transitions/compliance/retention-proposals.service';

async function main() {
  const prisma = new PrismaClient();
  try {
    const report = await computeReadiness(prisma);
    const host = (() => {
      try {
        const u = new URL(process.env.DATABASE_URL ?? '');
        return `${u.hostname}${u.port ? `:${u.port}` : ''}/${u.pathname.replace(/^\//, '')}`;
      } catch {
        return '(unparseable DATABASE_URL)';
      }
    })();
    console.log(`Retention readiness for ${host}`);
    console.log(`Default-deny currently: ${report.defaultDenyOn ? 'ON' : 'OFF'}`);
    for (const c of report.categories) {
      const period = c.health === 'OK' ? (c.noExpiry ? 'retain indefinitely' : `${c.retentionMonths} months`) : '-';
      console.log(`  ${c.category.padEnd(11)} ${c.health.padEnd(18)} version ${String(c.version ?? '-').padEnd(3)} ${period}`);
    }
    console.log(report.ready
      ? 'READY: every protected category has an approved, active rule.'
      : 'NOT READY: enabling default-deny now would block Permanent Delete for the categories above that are not OK.');
    process.exitCode = report.ready ? 0 : 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Readiness check failed:', err?.message ?? err);
  process.exit(1);
});
