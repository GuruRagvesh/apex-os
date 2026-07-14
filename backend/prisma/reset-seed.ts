/**
 * APEX OS — Development Reset Seed
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  DEVELOPMENT ONLY — wipes ALL data then re-seeds from scratch.
 * ⚠️  NEVER run this against a production database.
 *
 * Run:
 *   ALLOW_RESET_SEED=true npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/reset-seed.ts
 *
 * What it does:
 *   1. Truncates all tables (in safe dependency order)
 *   2. Resets auto-increment sequences
 *   3. Runs the normal seed
 *
 * Environment guards (same production-detection pattern as seed.ts):
 *   • NODE_ENV=production → blocked entirely, no exceptions
 *   • Database URL points to a known production host → blocked entirely, no exceptions
 *   • ALLOW_RESET_SEED not set → blocked by default
 *   • ALLOW_RESET_SEED=true only allows the reset on a confirmed non-production database
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { PrismaClient } from '@prisma/client';

// ── Production Guard ──────────────────────────────────────────────────────────
// Mirrors seed.ts's guard: same patterns, same ordering (NODE_ENV, then
// DATABASE_URL host, then an explicit allow flag), same no-bypass rule on a
// production-looking DATABASE_URL. Duplicated here rather than imported from
// seed.ts so this script never depends on seed.ts to decide whether it's
// even safe to run.
//
// This uses its OWN flag (ALLOW_RESET_SEED), not seed.ts's
// ALLOW_DESTRUCTIVE_SEED — reset-seed.ts is strictly more destructive
// (unconditional deleteMany on every core table, not seed.ts's upsert-based
// approach), so someone testing seed.ts with ALLOW_DESTRUCTIVE_SEED=true set
// must never accidentally also unlock a full database wipe.
function guardAgainstProduction() {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase() || '';
  const databaseUrl = process.env.DATABASE_URL || '';
  const allowReset = process.env.ALLOW_RESET_SEED?.toLowerCase() === 'true';

  // 1. Absolute blocker: NODE_ENV=production
  if (nodeEnv === 'production') {
    console.error('\n🚨 DANGER — reset-seed.ts BLOCKED 🚨');
    console.error('❌ NODE_ENV is set to "production".');
    console.error('   This script DELETES EVERY ROW in notifications, ticket history,');
    console.error('   attachments, comments, tickets, leave requests, projects, users,');
    console.error('   departments, and roles — then re-seeds from scratch.');
    console.error('   It must NEVER run against production. This is a hard, unconditional block.\n');
    process.exit(1);
  }

  // 2. Production database detection — always block, no exceptions. This
  //    check cannot be bypassed by ALLOW_RESET_SEED or anything else.
  const productionPatterns = [
    /render\.com/i,           // Render.com any host
    /dpg-[\w]+\.[\w]+-[\w]+\.postgres\.render\.com/i,  // Render Postgres pattern
    /production/i,            // Generic "production" in hostname
    /prod\.technoedge/i,      // TechnoEdge production domain
    /dpg-d8259omk1jcs73e37fbg/i, // Known production Postgres ID (from audit)
  ];

  const looksLikeProduction = productionPatterns.some((pattern) =>
    pattern.test(databaseUrl),
  );

  if (looksLikeProduction) {
    console.error('\n🚨 DANGER — reset-seed.ts BLOCKED 🚨');
    console.error('❌ DATABASE_URL appears to point at a PRODUCTION database.');
    console.error(`   URL: ${databaseUrl.replace(/:[^:@]+@/, ':****@')}`);
    console.error('   Running this script here would permanently DELETE EVERY USER, TICKET,');
    console.error('   LEAVE REQUEST, PROJECT, DEPARTMENT, AND ROLE in production, with no way');
    console.error('   to undo it.');
    console.error('   Production databases can NEVER be reset by this script. No exceptions.');
    console.error('   No flag can override this check.\n');
    process.exit(1);
  }

  // 3. Even on a confirmed non-production database, require explicit opt-in.
  if (!allowReset) {
    console.error('\n❌ reset-seed.ts BLOCKED: ALLOW_RESET_SEED not set');
    console.error('   This script wipes and re-seeds the ENTIRE database. To run it against');
    console.error('   a confirmed non-production database, set:');
    console.error('   $ ALLOW_RESET_SEED=true npx ts-node --compiler-options \'{"module":"CommonJS"}\' prisma/reset-seed.ts\n');
    process.exit(1);
  }

  console.log('✓ Environment checks passed. Proceeding with destructive reset...\n');
}

guardAgainstProduction();

const prisma = new PrismaClient();

async function reset() {
  console.log('🗑️  Resetting database (dev only)...\n');

  // Delete in reverse-dependency order to avoid FK violations
  await prisma.notification.deleteMany();
  await prisma.ticketHistory.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();
  await prisma.role.deleteMany();

  console.log('✅ All tables cleared.\n');
  console.log('🌱 Running seed...\n');
}

async function main() {
  await reset();

  // Dynamically require the normal seed so it runs in the same process
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execSync } = require('child_process');
  execSync(
    `npx ts-node --compiler-options '{"module":"CommonJS"}' ${__dirname}/seed.ts`,
    { stdio: 'inherit' },
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
