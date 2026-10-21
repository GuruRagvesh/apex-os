/** Read-only duplicate report required before the Phase 3 unique index. */
import { PrismaClient } from '@prisma/client';

export async function findDuplicateOpenCorrections(prisma: PrismaClient) {
  return prisma.$queryRaw<Array<{ userId: string; date: Date; count: bigint; ids: string[] }>>`
    SELECT "userId", "date", count(*) AS count, array_agg(id ORDER BY "createdAt", id) AS ids
      FROM "attendance_regularizations"
     WHERE status IN ('PENDING', 'STALE_REVIEW_REQUIRED', 'MANAGER_APPROVED')
     GROUP BY "userId", "date"
    HAVING count(*) > 1
     ORDER BY "date", "userId"
  `;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await findDuplicateOpenCorrections(prisma);
    console.log(JSON.stringify({ duplicateEmployeeDates: rows.length, rows: rows.map((x) => ({ ...x, count: Number(x.count), date: x.date.toISOString().slice(0, 10) })) }, null, 2));
    if (rows.length) process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch((e) => { console.error(e instanceof Error ? e.message : 'Preflight failed'); process.exit(1); });
