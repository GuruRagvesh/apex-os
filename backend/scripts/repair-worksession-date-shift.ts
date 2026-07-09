/**
 * APEX OS — WorkSession.date repair (one-day-early bug, fixed forward in ac0ce02)
 * ─────────────────────────────────────────────────────────────────────────────
 * Repairs WorkSession rows whose .date is exactly one day earlier than the
 * IST business date derived from startWorkAt — the exact deterministic
 * signature of the bug fixed going forward in commit ac0ce02 (WorkSession.date
 * is a @db.Date column; TVAService.companyDayStart()'s real midnight-IST
 * instant falls on the previous UTC calendar day, so Prisma stored every
 * affected row one day early).
 *
 * Confirmed via three independent read-only dry-run audits
 * (backend/scripts/audit-worksession-date-shift.ts):
 *   566 → 567 → 568 total rows, 386 affected and PERFECTLY STABLE across all
 *   three runs, 0 new affected rows after the fix went live in production.
 *
 * DEFAULT MODE IS DRY-RUN. No data is modified unless BOTH of the following
 * are true:
 *   1. --apply is passed on the command line, AND
 *   2. CONFIRM_WORKSESSION_DATE_REPAIR=true is set in the environment.
 * Missing either one blocks apply mode entirely — no partial-confirmation path.
 *
 * Apply mode writes ONLY WorkSession.date, one row at a time, using the exact
 * row IDs this script's own detection pass finds at run time (never a stale
 * list, never a blanket WHERE clause). It never touches startWorkAt, logoutAt,
 * status, breaks, userId, attendance events, or duration fields — the update
 * payload literally contains only { date: ... }.
 *
 * Run (dry-run, safe, default):
 *   npx ts-node scripts/repair-worksession-date-shift.ts
 *
 * Run (apply — DESTRUCTIVE, only after explicit human approval):
 *   CONFIRM_WORKSESSION_DATE_REPAIR=true npx ts-node scripts/repair-worksession-date-shift.ts --apply
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { PrismaClient } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';

const prisma = new PrismaClient();
const TIMEZONE = process.env.COMPANY_TIMEZONE || 'Asia/Kolkata';
const isApply = process.argv.includes('--apply');

function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().split('T')[0];
}

// Same encoding TVAService.companyDateOnly() uses: UTC midnight of the
// intended calendar date, so Prisma's @db.Date mapping reads it back
// correctly — never a real-offset conversion.
function companyDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

interface AffectedRow {
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
}

async function findAffectedRows(): Promise<{ scanned: number; affected: AffectedRow[] }> {
  const sessions = await prisma.workSession.findMany({
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    include: { user: { select: { name: true, email: true } } },
  });

  const affected: AffectedRow[] = [];

  for (const s of sessions) {
    // Same rule as the audit script: no startWorkAt means we cannot derive
    // an expected date reliably, so it is never treated as repairable here.
    if (!s.startWorkAt) continue;

    const storedDate = s.date instanceof Date
      ? formatInTimeZone(s.date, 'UTC', 'yyyy-MM-dd')
      : String(s.date).split('T')[0];
    const expectedDate = formatInTimeZone(s.startWorkAt, TIMEZONE, 'yyyy-MM-dd');

    if (storedDate === expectedDate) continue; // already correct

    const isExactlyOneDayEarly = addDaysToDateStr(storedDate, 1) === expectedDate;
    if (!isExactlyOneDayEarly) continue; // not this specific bug's signature

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
  }

  return { scanned: sessions.length, affected };
}

function printAffectedRows(affected: AffectedRow[], limit = 100) {
  for (const row of affected.slice(0, limit)) {
    console.log(
      `${row.userName} <${row.userEmail}> | sessionId=${row.sessionId} | ` +
      `stored=${row.storedDate} expected=${row.expectedCompanyDate} | ` +
      `start=${row.startWorkAt} end=${row.logoutAt ?? 'null'} | status=${row.status} | confidence=${row.confidence}`,
    );
  }
  if (affected.length > limit) {
    console.log(`... and ${affected.length - limit} more (see full JSON below)`);
  }
}

async function runDryRun() {
  console.log('='.repeat(72));
  console.log('APEX OS — WorkSession.date repair — DRY RUN (default mode)');
  console.log('No --apply flag detected. This run will NOT modify any data.');
  console.log('='.repeat(72));

  const { scanned, affected } = await findAffectedRows();

  console.log(`\nTotal sessions scanned: ${scanned}`);
  console.log(`Affected — would be repaired: ${affected.length}`);
  console.log(`\n--- Rows that WOULD be updated (up to 100 shown; full list in JSON below) ---`);
  printAffectedRows(affected);

  console.log(`\n${'='.repeat(72)}`);
  console.log('NO DATA WAS MODIFIED. This was a dry run.');
  console.log('To apply, re-run with --apply AND CONFIRM_WORKSESSION_DATE_REPAIR=true set.');
  console.log('='.repeat(72));

  console.log('\n--- FULL JSON REPORT ---');
  console.log(JSON.stringify({ scanned, affectedCount: affected.length, affected }, null, 2));
}

async function runApply() {
  if (process.env.CONFIRM_WORKSESSION_DATE_REPAIR !== 'true') {
    console.error('BLOCKED: --apply was passed but CONFIRM_WORKSESSION_DATE_REPAIR=true is not set.');
    console.error('Both are required to run apply mode. No data was modified.');
    process.exit(1);
  }

  console.log('='.repeat(72));
  console.log('APEX OS — WorkSession.date repair — APPLY MODE');
  console.log('Both --apply and CONFIRM_WORKSESSION_DATE_REPAIR=true are set.');
  console.log('This run WILL update WorkSession.date for affected rows.');
  console.log('Only the .date field is written — nothing else is touched.');
  console.log('='.repeat(72));

  const { scanned, affected } = await findAffectedRows();
  console.log(`\nTotal sessions scanned: ${scanned}`);
  console.log(`Rows attempted: ${affected.length}`);

  let updated = 0;
  const errors: Array<{ sessionId: string; error: string }> = [];

  for (const row of affected) {
    try {
      await prisma.workSession.update({
        where: { id: row.sessionId },
        data: { date: companyDateOnly(row.expectedCompanyDate) },
      });
      updated++;
    } catch (e: any) {
      errors.push({ sessionId: row.sessionId, error: e?.message ?? String(e) });
    }
  }

  console.log(`\nRows updated successfully: ${updated}`);
  console.log(`Rows failed: ${errors.length}`);
  if (errors.length > 0) {
    console.log('Failed rows:', JSON.stringify(errors, null, 2));
  }

  console.log(`\n--- Post-apply verification (re-scanning with the same rule) ---`);
  const verify = await findAffectedRows();
  console.log(`Remaining affected count: ${verify.affected.length}`);
  if (verify.affected.length > 0) {
    console.log('Remaining affected rows (should be empty if the repair fully succeeded):');
    printAffectedRows(verify.affected);
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log(`Apply complete. Attempted ${affected.length}, updated ${updated}, remaining affected ${verify.affected.length}.`);
  console.log('='.repeat(72));
}

async function main() {
  if (isApply) {
    await runApply();
  } else {
    await runDryRun();
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
