/**
 * Read-only report of numerically equivalent TE employee codes (spec §2.3).
 *
 *   DATABASE_URL=<the database to inspect>  *     npx ts-node --transpile-only scripts/employee-id/report-equivalent-codes.ts
 *
 * Lists every equivalence group across users.employeeId and
 * attendance_import_rows.rawEmployeeId -- spellings, counts, and whether two
 * different users hold the same number (which makes the lifecycle foundation
 * migration refuse to run) -- for a human to correct.
 *
 * There is NO write path and no execute mode: the queries run inside a
 * READ ONLY transaction, and the output goes to stdout only. Spellings are never
 * persisted. Prints the host and database name, never a URL, user or password.
 */
import { PrismaClient } from '@prisma/client';
import { equivalenceGroups, CodeSource } from './equivalent-codes';

async function main() {
  if (process.argv.some((a) => /^--(execute|apply|fix|write)/.test(a))) {
    console.error('This report has no write mode.');
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(2);
  }
  const target = (() => {
    try {
      const u = new URL(url);
      return `${u.hostname}:${u.port || '5432'}/${u.pathname.replace(/^\//, '')}`;
    } catch {
      return '<unparseable>';
    }
  })();
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const users = await tx.$queryRawUnsafe<{ id: string; code: string }[]>(
        `SELECT "id", "employeeId" AS code FROM "users" WHERE "employeeId" ~ '^TE-[0-9]{1,9}$'`,
      );
      const imports = await tx.$queryRawUnsafe<{ code: string }[]>(
        `SELECT "rawEmployeeId" AS code FROM "attendance_import_rows" WHERE "rawEmployeeId" ~ '^TE-[0-9]{1,9}$'`,
      );
      return [
        ...users.map((u): CodeSource => ({ source: 'users', code: u.code, userId: u.id })),
        ...imports.map((r): CodeSource => ({ source: 'attendance_import_rows', code: r.code })),
      ];
    });
    const groups = equivalenceGroups(rows);
    console.log(`Target: ${target}`);
    console.log(`Well-formed codes read: ${rows.length}. Equivalence groups: ${groups.length}. Blocking the migration: ${groups.filter((g) => g.blocksMigration).length}.`);
    for (const g of groups) {
      console.log(`
Number ${g.number}${g.blocksMigration ? '  << held by ' + g.distinctUsers + ' different users: correct before migrating' : ''}`);
      for (const s of g.spellings) console.log(`  ${s.code.padEnd(14)} users=${s.users} importRows=${s.importRows}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(String(err?.message ?? err).replace(/postgres(ql)?:\/\/[^\s'"`]+/gi, '<url>').split('
')[0]);
  process.exit(1);
});
