/**
 * APEX OS — WorkSession date-shift dry-run audit
 * ─────────────────────────────────────────────────────────────────────────
 * READ-ONLY. Detects WorkSession rows affected by the one-day-early date
 * bug fixed in commit ac0ce02: WorkSession.date (a @db.Date column) was
 * written using TVAService.companyDayStart(), whose real midnight-IST
 * instant falls on the *previous* UTC calendar day (IST is UTC+5:30) —
 * Prisma reads/writes @db.Date columns using a Date's UTC calendar date,
 * so every affected row's stored date is exactly one day earlier than the
 * true IST business day.
 *
 * This script contains NO update / updateMany / delete / deleteMany /
 * create / upsert calls anywhere. It only reads (findMany) and prints a
 * report. NO DATA IS MODIFIED BY THIS SCRIPT.
 *
 * Run:
 *   npx ts-node scripts/audit-worksession-date-shift.ts
 * ─────────────────────────────────────────────────────────────────────────
 */

import { PrismaClient } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';

const prisma = new PrismaClient();
const TIMEZONE = process.env.COMPANY_TIMEZONE || 'Asia/Kolkata';

function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().split('T')[0];
}

async function main() {
  console.log('='.repeat(72));
  console.log('APEX OS — WorkSession date-shift dry-run audit');
  console.log('READ-ONLY SCRIPT — contains no write/update/delete calls.');
  console.log(`Company timezone: ${TIMEZONE}`);
  console.log('='.repeat(72));

  const totalRows = await prisma.workSession.count();
  console.log(`\nWorkSession table row count: ${totalRows}`);

  const sessions = await prisma.workSession.findMany({
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    include: { user: { select: { name: true, email: true } } },
  });

  const scanned = sessions.length;
  const affected: Array<{
    sessionId: string;
    userId: string;
    userName: string;
    userEmail: string;
    storedDate: string;
    expectedCompanyDate: string;
    startWorkAt: string;
    logoutAt: string | null;
    status: string;
    confidence: 'HIGH';
  }> = [];
  let skippedMissingStart = 0;
  let otherMismatch = 0;
  let correct = 0;

  for (const s of sessions) {
    if (!s.startWorkAt) {
      skippedMissingStart++;
      continue;
    }

    const storedDate = s.date instanceof Date
      ? formatInTimeZone(s.date, 'UTC', 'yyyy-MM-dd')
      : String(s.date).split('T')[0];
    const expectedDate = formatInTimeZone(s.startWorkAt, TIMEZONE, 'yyyy-MM-dd');

    if (storedDate === expectedDate) {
      correct++;
      continue;
    }

    const isExactlyOneDayEarly = addDaysToDateStr(storedDate, 1) === expectedDate;

    if (isExactlyOneDayEarly) {
      affected.push({
        sessionId: s.id,
        userId: s.userId,
        userName: s.user?.name ?? 'Unknown',
        userEmail: s.user?.email ?? 'Unknown',
        storedDate,
        expectedCompanyDate: expectedDate,
        startWorkAt: s.startWorkAt.toISOString(),
        logoutAt: s.logoutAt ? s.logoutAt.toISOString() : null,
        status: s.status,
        confidence: 'HIGH',
      });
    } else {
      otherMismatch++;
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total sessions scanned: ${scanned}`);
  console.log(`Affected (exactly one day early, HIGH confidence): ${affected.length}`);
  console.log(`Skipped — missing startWorkAt (cannot determine expected date): ${skippedMissingStart}`);
  console.log(`Other mismatch (NOT the 1-day-early pattern — not counted as affected): ${otherMismatch}`);
  console.log(`Correct (stored date already matches expected company date): ${correct}`);

  console.log(`\n--- Affected rows (up to 100 shown; full list in JSON below) ---`);
  for (const row of affected.slice(0, 100)) {
    console.log(
      `${row.userName} <${row.userEmail}> | stored=${row.storedDate} expected=${row.expectedCompanyDate} ` +
      `| start=${row.startWorkAt} end=${row.logoutAt ?? 'null'} | status=${row.status} | confidence=${row.confidence}`,
    );
  }
  if (affected.length > 100) {
    console.log(`... and ${affected.length - 100} more (see full JSON below)`);
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log('NO DATA WAS MODIFIED. This script is read-only (dry-run report only).');
  console.log('='.repeat(72));

  console.log('\n--- FULL JSON REPORT ---');
  console.log(JSON.stringify(
    { scanned, affectedCount: affected.length, skippedMissingStart, otherMismatch, correct, affected },
    null,
    2,
  ));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
