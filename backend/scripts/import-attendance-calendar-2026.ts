/**
 * Official 2026 holiday calendar importer (BL-2B).
 *
 *   npx ts-node scripts/import-attendance-calendar-2026.ts            # dry run
 *   npx ts-node scripts/import-attendance-calendar-2026.ts --apply    # writes
 *
 * Dry run is the default and writes nothing. `--apply` is the only way to
 * change data, and even then the whole import runs in one transaction.
 *
 * Required environment:
 *   DATABASE_URL          the staging database
 *   APP_ENV=staging       positive assertion, same gate as staging-preflight
 *
 * Design commitments, all of them deliberate:
 *
 *  - It reads the approved source from official-holidays-2026.ts. It does not
 *    carry its own copy, and it does not consult any public holiday list.
 *  - It NEVER deletes. There is no delete-all-and-reinsert path, because that
 *    would destroy holiday rows other records may already reference.
 *  - A date that already exists with the SAME name is a duplicate and is
 *    skipped. A date that exists with a DIFFERENT name is a CONFLICT: the
 *    import refuses rather than overwriting somebody's edit.
 *  - The two Bhai Duj entries (10 and 11 November) are imported as two rows.
 *    They are not deduplicated by name.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import {
  OFFICIAL_HOLIDAYS_2026,
  OFFICIAL_HOLIDAY_CALENDAR_NAME,
  OFFICIAL_HOLIDAY_COUNT_2026,
  OFFICIAL_HOLIDAY_FINANCIAL_YEAR,
} from '../src/modules/platform/attendance/calendar/official-holidays-2026';

const APPLY = process.argv.includes('--apply');

function fail(reason: string): never {
  console.error(`\nIMPORT ABORTED: ${reason}\n`);
  process.exit(1);
}

/** Same positive staging assertion the preflight uses. */
function assertStaging() {
  const appEnv = (process.env.APP_ENV ?? '').toLowerCase();
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set.');
  if (appEnv !== 'staging') {
    fail(
      `APP_ENV is "${appEnv || '(unset)'}", not "staging". ` +
        'This importer only runs against a database that positively declares itself staging.',
    );
  }

  const url = process.env.DATABASE_URL;
  const expectedHost = (process.env.EXPECTED_STAGING_DB_HOST ?? '').trim();
  const expectedName = (process.env.EXPECTED_STAGING_DB_NAME ?? '').trim();

  // Same independently-known identity the preflight demands. An importer that
  // writes rows must not be easier to point at a database than the read-only
  // script that checks which database it is.
  if (!expectedHost || !expectedName) {
    fail(
      'EXPECTED_STAGING_DB_HOST and EXPECTED_STAGING_DB_NAME must both be set, read ' +
        'from Render by a human.',
    );
  }

  for (const marker of [/dpg-d8259omk1jcs73e37fbg/i, /prod\.technoedge/i]) {
    if (marker.test(url)) fail(`DATABASE_URL matches a known production marker (${marker}).`);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail('DATABASE_URL could not be parsed.');
  }
  const host = parsed!.hostname;
  const database = parsed!.pathname.replace(/^\//, '');
  if (host !== expectedHost) fail(`Host mismatch: "${host}" vs expected "${expectedHost}".`);
  if (database !== expectedName) {
    fail(`Database mismatch: "${database}" vs expected "${expectedName}".`);
  }

  console.log(`  target host     : ${host}`);
  console.log(`  target database : ${database}`);
}

/** UTC-midnight encoding, matching TVAService.companyDateOnly for @db.Date. */
function businessDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

async function main() {
  console.log('── Official 2026 holiday import ───────────────────────────────');
  console.log(`  mode            : ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
  assertStaging();

  // A guard against an accidental edit to the approved list itself.
  if (OFFICIAL_HOLIDAYS_2026.length !== OFFICIAL_HOLIDAY_COUNT_2026) {
    fail(
      `The approved source has ${OFFICIAL_HOLIDAYS_2026.length} rows but should have ` +
        `${OFFICIAL_HOLIDAY_COUNT_2026}. Somebody has edited an approved document.`,
    );
  }

  const prisma = new PrismaClient();
  try {
    const calendar = await prisma.holidayCalendar.findFirst({
      where: { financialYear: OFFICIAL_HOLIDAY_FINANCIAL_YEAR, name: OFFICIAL_HOLIDAY_CALENDAR_NAME },
    });

    console.log(`\n  calendar        : ${OFFICIAL_HOLIDAY_CALENDAR_NAME} (${OFFICIAL_HOLIDAY_FINANCIAL_YEAR})`);
    console.log(`  calendar exists : ${calendar ? `yes (${calendar.id})` : 'no — will be created'}`);

    const existing = calendar
      ? await prisma.holiday.findMany({ where: { calendarId: calendar.id } })
      : [];

    const byDate = new Map(
      existing.map((h) => [h.date.toISOString().slice(0, 10), h] as const),
    );

    const toCreate: typeof OFFICIAL_HOLIDAYS_2026[number][] = [];
    const duplicates: string[] = [];
    const conflicts: Array<{ date: string; existing: string; approved: string }> = [];

    for (const holiday of OFFICIAL_HOLIDAYS_2026) {
      const found = byDate.get(holiday.date);
      if (!found) {
        toCreate.push(holiday);
      } else if (found.name === holiday.name) {
        duplicates.push(holiday.date);
      } else {
        // Never silently overwritten: somebody edited this deliberately, or the
        // approved source changed. Either way a human decides, not this script.
        conflicts.push({ date: holiday.date, existing: found.name, approved: holiday.name });
      }
    }

    const extra = existing.filter(
      (h) => !OFFICIAL_HOLIDAYS_2026.some((o) => o.date === h.date.toISOString().slice(0, 10)),
    );

    console.log(`\n  approved rows   : ${OFFICIAL_HOLIDAYS_2026.length}`);
    console.log(`  already present : ${duplicates.length}`);
    console.log(`  to create       : ${toCreate.length}`);
    console.log(`  conflicts       : ${conflicts.length}`);
    console.log(`  extra in db     : ${extra.length} (left untouched — never deleted)`);

    if (toCreate.length > 0) {
      console.log('\n  Rows that would be created:');
      for (const h of toCreate) console.log(`    + ${h.date}  ${h.name}`);
    }
    if (extra.length > 0) {
      console.log('\n  Rows present in the database but NOT in the approved source:');
      for (const h of extra) {
        console.log(`    ? ${h.date.toISOString().slice(0, 10)}  ${h.name}`);
      }
      console.log('    (reported only. This importer never deletes.)');
    }

    if (conflicts.length > 0) {
      console.log('\n  CONFLICTS — the same date holds a different name:');
      for (const c of conflicts) {
        console.log(`    ! ${c.date}  db="${c.existing}"  approved="${c.approved}"`);
      }
      fail(
        'Refusing to overwrite existing holiday facts. Resolve each conflict by hand, ' +
          'then re-run.',
      );
    }

    const expectedFinal = existing.length + toCreate.length;
    console.log(`\n  expected final count for this calendar: ${expectedFinal}`);

    if (!APPLY) {
      console.log('\nDRY RUN COMPLETE. Nothing was written.');
      console.log('Re-run with --apply once the rows above are correct.\n');
      return;
    }

    if (toCreate.length === 0 && calendar) {
      console.log('\nNothing to do — the calendar already matches the approved source.\n');
      return;
    }

    // One transaction: either the whole approved calendar lands, or none of it.
    const result = await prisma.$transaction(async (tx) => {
      const target =
        calendar ??
        (await tx.holidayCalendar.create({
          data: {
            financialYear: OFFICIAL_HOLIDAY_FINANCIAL_YEAR,
            name: OFFICIAL_HOLIDAY_CALENDAR_NAME,
            isActive: true,
          } as Prisma.HolidayCalendarUncheckedCreateInput,
        }));

      let created = 0;
      for (const holiday of toCreate) {
        await tx.holiday.create({
          data: {
            calendarId: target.id,
            date: businessDate(holiday.date),
            name: holiday.name,
            isOptional: false,
          },
        });
        created += 1;
      }
      return { calendarId: target.id, created };
    });

    // Read back rather than trusting the write.
    const finalRows = await prisma.holiday.findMany({
      where: { calendarId: result.calendarId },
      orderBy: { date: 'asc' },
    });

    console.log(`\n  created         : ${result.created}`);
    console.log(`  final count     : ${finalRows.length}`);
    console.log('\n  Calendar as stored:');
    for (const h of finalRows) {
      console.log(`    ${h.date.toISOString().slice(0, 10)}  ${h.name}`);
    }

    const missing = OFFICIAL_HOLIDAYS_2026.filter(
      (o) => !finalRows.some((f) => f.date.toISOString().slice(0, 10) === o.date && f.name === o.name),
    );
    if (missing.length > 0) {
      fail(`Verification failed: ${missing.length} approved row(s) are not present after import.`);
    }

    console.log('\nIMPORT COMPLETE. Every approved row verified present.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\nImport failed:', err?.message ?? err);
  process.exit(1);
});
