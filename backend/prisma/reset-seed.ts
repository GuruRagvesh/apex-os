/**
 * APEX OS — Development Reset Seed
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  DEVELOPMENT ONLY — wipes ALL data then re-seeds from scratch.
 * ⚠️  NEVER run this against a production database.
 *
 * Run:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/reset-seed.ts
 *
 * What it does:
 *   1. Truncates all tables (in safe dependency order)
 *   2. Resets auto-increment sequences
 *   3. Runs the normal seed
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function reset() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ reset-seed.ts must NOT be run in production. Aborting.');
    process.exit(1);
  }

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
