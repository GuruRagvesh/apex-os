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
 *   DATABASE_URL          the target database
 *   APP_ENV               "staging" or "production", declared explicitly
 *
 * For APP_ENV=production the identity is proved with the same guard the
 * database backup uses -- EXPECTED_PRODUCTION_DB_HOST and
 * EXPECTED_PRODUCTION_DB_NAME must be supplied independently from the provider
 * dashboard and must both match the parsed DATABASE_URL. There is one
 * definition of "this is production" in the codebase and this script does not
 * add a second. An APP_ENV that is neither is refused rather than guessed.
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

import { randomUUID } from 'crypto';
import { PolicyStatus, PrismaClient, Prisma } from '@prisma/client';
import { assertProductionTarget, mask, TargetRefused } from './backup/backup-identity';
import {
  OFFICIAL_HOLIDAYS_2026,
  OFFICIAL_HOLIDAY_CALENDAR_NAME,
  OFFICIAL_HOLIDAY_COUNT_2026,
  OFFICIAL_HOLIDAY_FINANCIAL_YEAR,
  type OfficialHoliday,
} from '../src/modules/platform/attendance/calendar/official-holidays-2026';

const APPLY = process.argv.includes('--apply');

function fail(reason: string): never {
  console.error(`\nIMPORT ABORTED: ${reason}\n`);
  process.exit(1);
}

export type ImportEnvironment = 'staging' | 'production';

export interface ImportTarget {
  environment: ImportEnvironment;
  host: string;
  database: string;
}

/**
 * Proves which database this import may write to.
 *
 * Production reuses assertProductionTarget, the guard the database backup
 * already depends on, so "this is production" has one definition rather than
 * two that can drift apart. Staging keeps the positive assertion the preflight
 * uses. Anything else is refused: an unrecognised APP_ENV could name any
 * database at all, and a writer must never be easier to point somewhere than
 * the read-only script that reports where it is pointing.
 *
 * Returns the identity instead of printing it, so the caller decides what is
 * safe to show and callers under test observe no console output.
 */
export function assertImportTarget(env: NodeJS.ProcessEnv): ImportTarget {
  const appEnv = (env.APP_ENV ?? '').trim().toLowerCase();

  if (appEnv === 'production') {
    // Throws TargetRefused on any of: missing DATABASE_URL, missing expected
    // host/name, a non-production marker, or a host/database mismatch.
    const identity = assertProductionTarget(env);
    return { environment: 'production', host: identity.host, database: identity.database };
  }

  if (appEnv !== 'staging') {
    throw new TargetRefused(
      `APP_ENV is "${appEnv || '(unset)'}". Declare "staging" or "production" explicitly; ` +
        'an ambiguous environment is refused rather than guessed.',
    );
  }

  const url = env.DATABASE_URL ?? '';
  if (!url) throw new TargetRefused('DATABASE_URL is not set.');

  const expectedHost = (env.EXPECTED_STAGING_DB_HOST ?? '').trim();
  const expectedName = (env.EXPECTED_STAGING_DB_NAME ?? '').trim();

  // Same independently-known identity the preflight demands. An importer that
  // writes rows must not be easier to point at a database than the read-only
  // script that checks which database it is.
  if (!expectedHost || !expectedName) {
    throw new TargetRefused(
      'EXPECTED_STAGING_DB_HOST and EXPECTED_STAGING_DB_NAME must both be set, read ' +
        'from Render by a human.',
    );
  }

  for (const marker of [/dpg-d8259omk1jcs73e37fbg/i, /apex_db_dugl/i, /prod\.technoedge/i]) {
    if (marker.test(url) || marker.test(expectedHost) || marker.test(expectedName)) {
      throw new TargetRefused(
        `APP_ENV says staging but the target matches a known production marker (${marker}).`,
      );
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TargetRefused('DATABASE_URL could not be parsed.');
  }
  const host = parsed.hostname;
  const database = parsed.pathname.replace(/^\//, '');

  if (host !== expectedHost) {
    throw new TargetRefused('Host mismatch between DATABASE_URL and EXPECTED_STAGING_DB_HOST.');
  }
  if (database !== expectedName) {
    throw new TargetRefused(
      'Database mismatch between DATABASE_URL and EXPECTED_STAGING_DB_NAME.',
    );
  }

  return { environment: 'staging', host, database };
}

export interface ActiveCalendarRow {
  id: string;
  name: string;
  financialYear: string;
  effectiveTo: Date | null;
}

export interface CalendarVerdict {
  ok: boolean;
  reason: string | null;
}

/**
 * Decides whether the ACTIVE calendars leave a single unambiguous answer.
 *
 * Two different resolvers have to be satisfied and they ask different
 * questions, so both are checked:
 *
 *   bootstrap-production-attendance  ACTIVE rows for THIS financial year;
 *                                    more than one and it refuses to choose.
 *   BusinessCalendarService (BL-5)   ACTIVE rows whose effective window covers
 *                                    the date, across EVERY financial year;
 *                                    more than one resolves AMBIGUOUS and every
 *                                    working-day question turns BLOCKED.
 *
 * An existing calendar that is not the approved one is a conflict, never
 * something to deactivate: retiring somebody else's live policy is a decision
 * for whoever owns it.
 */
export function assessActiveCalendars(
  activeThisYear: ActiveCalendarRow[],
  activeOtherYearsStillOpen: ActiveCalendarRow[],
  approvedCalendarId: string | null,
): CalendarVerdict {
  if (activeThisYear.length > 1) {
    const names = activeThisYear.map((c) => `${c.name} (${c.id})`).join(', ');
    return {
      ok: false,
      reason:
        `${activeThisYear.length} ACTIVE calendars already exist for ` +
        `${OFFICIAL_HOLIDAY_FINANCIAL_YEAR}: ${names}. The resolver cannot say which ` +
        'one governs a date. Resolve this by hand; this importer will not choose.',
    };
  }

  const [existing] = activeThisYear;
  if (existing && existing.id !== approvedCalendarId) {
    return {
      ok: false,
      reason:
        `An ACTIVE calendar "${existing.name}" (${existing.id}) already governs ` +
        `${OFFICIAL_HOLIDAY_FINANCIAL_YEAR}, and it is not the approved one. Adding a ` +
        'second would make every working-day question ambiguous, and deactivating ' +
        'a live policy is not this script\'s decision.',
    };
  }

  if (!existing && activeOtherYearsStillOpen.length > 0) {
    // Creating ours would make two calendars cover the same dates at runtime,
    // even though the bootstrap -- which filters by financial year -- would
    // report everything as fine.
    const names = activeOtherYearsStillOpen
      .map((c) => `${c.name} (${c.financialYear})`)
      .join(', ');
    return {
      ok: false,
      reason:
        `ACTIVE calendars from other financial years have no end date and would ` +
        `still cover these dates: ${names}. Creating another ACTIVE calendar would ` +
        'resolve AMBIGUOUS in BusinessCalendarService and block every working-day ' +
        'question. Close those windows first.',
    };
  }

  return { ok: true, reason: null };
}

export interface ImportPlan {
  toCreate: OfficialHoliday[];
  duplicates: string[];
  conflicts: Array<{ date: string; existing: string; approved: string }>;
  extra: Array<{ date: string; name: string }>;
}

/**
 * Works out what an import would change, without touching anything.
 *
 * A date that already holds the same name is a duplicate and is skipped. A
 * date holding a DIFFERENT name is a conflict and stops the run: somebody
 * edited it deliberately, or the approved source moved, and either way a human
 * decides rather than this script. Rows in the database that are absent from
 * the approved list are reported and never removed.
 */
export function planImport(
  approved: readonly OfficialHoliday[],
  existing: Array<{ date: Date; name: string }>,
): ImportPlan {
  const byDate = new Map(existing.map((h) => [h.date.toISOString().slice(0, 10), h] as const));

  const toCreate: OfficialHoliday[] = [];
  const duplicates: string[] = [];
  const conflicts: Array<{ date: string; existing: string; approved: string }> = [];

  for (const holiday of approved) {
    const found = byDate.get(holiday.date);
    if (!found) {
      toCreate.push(holiday);
    } else if (found.name === holiday.name) {
      duplicates.push(holiday.date);
    } else {
      conflicts.push({ date: holiday.date, existing: found.name, approved: holiday.name });
    }
  }

  const approvedDates = new Set(approved.map((h) => h.date));
  const extra = existing
    .filter((h) => !approvedDates.has(h.date.toISOString().slice(0, 10)))
    .map((h) => ({ date: h.date.toISOString().slice(0, 10), name: h.name }));

  return { toCreate, duplicates, conflicts, extra };
}

/** UTC-midnight encoding, matching TVAService.companyDateOnly for @db.Date. */
function businessDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * BL-4 first-version convention: a V1 policy is the root of its own series,
 * so its immutable family key is its id. This imported calendar is immediately
 * live, therefore ACTIVE is authoritative and isActive mirrors it.
 */
export function buildFirstVersionCalendarCreateInput(
  id: string,
): Prisma.HolidayCalendarUncheckedCreateInput {
  return {
    id,
    policyKey: id,
    version: 1,
    status: PolicyStatus.ACTIVE,
    isActive: true,
    financialYear: OFFICIAL_HOLIDAY_FINANCIAL_YEAR,
    name: OFFICIAL_HOLIDAY_CALENDAR_NAME,
  };
}

/**
 * Executes the already conflict-checked write as a bounded batch transaction.
 * Prisma runs both statements in one database transaction without keeping an
 * interactive transaction context alive across 17 sequential round trips.
 */
export async function writeHolidayImport(
  prisma: PrismaClient,
  existingCalendarId: string | null,
  holidays: typeof OFFICIAL_HOLIDAYS_2026,
) {
  const calendarId = existingCalendarId ?? randomUUID();
  const holidayWrite = prisma.holiday.createMany({
    data: holidays.map((holiday) => ({
      calendarId,
      date: businessDate(holiday.date),
      name: holiday.name,
      isOptional: false,
    })),
  });

  if (existingCalendarId) {
    const [inserted] = await prisma.$transaction([holidayWrite]);
    return { calendarId, created: inserted.count };
  }

  const [, inserted] = await prisma.$transaction([
    prisma.holidayCalendar.create({
      data: buildFirstVersionCalendarCreateInput(calendarId),
    }),
    holidayWrite,
  ]);
  return { calendarId, created: inserted.count };
}

async function main() {
  console.log('-- Official 2026 holiday import ------------------------------');
  console.log(`  mode            : ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);

  let target: ImportTarget;
  try {
    target = assertImportTarget(process.env);
  } catch (err: any) {
    fail(err?.message ?? String(err));
  }

  // Masked: enough to confirm the right database, not enough to reconstruct a
  // connection string from a pasted log.
  console.log(`  environment     : ${target!.environment}`);
  console.log(`  target host     : ${mask(target!.host)}`);
  console.log(`  target database : ${mask(target!.database)}`);

  if (target!.environment === 'production' && !APPLY) {
    console.log('  note            : production writes also require --apply');
  }

  // A guard against an accidental edit to the approved list itself.
  if (OFFICIAL_HOLIDAYS_2026.length !== OFFICIAL_HOLIDAY_COUNT_2026) {
    fail(
      `The approved source has ${OFFICIAL_HOLIDAYS_2026.length} rows but should have ` +
        `${OFFICIAL_HOLIDAY_COUNT_2026}. Somebody has edited an approved document.`,
    );
  }

  const prisma = new PrismaClient();
  try {
    // Every ACTIVE calendar, so both resolvers can be judged before writing.
    const activeCalendars = await prisma.holidayCalendar.findMany({
      where: { status: PolicyStatus.ACTIVE },
      select: { id: true, name: true, financialYear: true, effectiveTo: true },
    });

    const activeThisYear = activeCalendars.filter(
      (c) => c.financialYear === OFFICIAL_HOLIDAY_FINANCIAL_YEAR,
    );
    const activeOtherYearsStillOpen = activeCalendars.filter(
      (c) => c.financialYear !== OFFICIAL_HOLIDAY_FINANCIAL_YEAR && c.effectiveTo === null,
    );

    const approved = activeThisYear.find((c) => c.name === OFFICIAL_HOLIDAY_CALENDAR_NAME) ?? null;

    console.log(`\n  financial year  : ${OFFICIAL_HOLIDAY_FINANCIAL_YEAR}`);
    console.log(`  calendar        : ${OFFICIAL_HOLIDAY_CALENDAR_NAME}`);
    console.log(`  calendar exists : ${approved ? `yes (${approved.id})` : 'no -- would be created'}`);
    console.log(`  ACTIVE this FY  : ${activeThisYear.length}`);
    console.log(`  ACTIVE open, other FY: ${activeOtherYearsStillOpen.length}`);

    const verdict = assessActiveCalendars(
      activeThisYear,
      activeOtherYearsStillOpen,
      approved?.id ?? null,
    );
    if (!verdict.ok) fail(verdict.reason!);

    const existing = approved
      ? await prisma.holiday.findMany({
          where: { calendarId: approved.id },
          select: { date: true, name: true },
        })
      : [];

    const plan = planImport(OFFICIAL_HOLIDAYS_2026, existing);

    console.log(`\n  approved rows   : ${OFFICIAL_HOLIDAYS_2026.length}`);
    console.log(`  already present : ${plan.duplicates.length}`);
    console.log(`  to create       : ${plan.toCreate.length}`);
    console.log(`  conflicts       : ${plan.conflicts.length}`);
    console.log(`  extra in db     : ${plan.extra.length} (left untouched -- never deleted)`);

    if (plan.toCreate.length > 0) {
      console.log('\n  Rows that would be created:');
      for (const h of plan.toCreate) console.log(`    + ${h.date}  ${h.name}`);
    }
    if (plan.extra.length > 0) {
      console.log('\n  Rows present in the database but NOT in the approved source:');
      for (const h of plan.extra) console.log(`    ? ${h.date}  ${h.name}`);
      console.log('    (reported only. This importer never deletes.)');
    }

    if (plan.conflicts.length > 0) {
      console.log('\n  CONFLICTS -- the same date holds a different name:');
      for (const c of plan.conflicts) {
        console.log(`    ! ${c.date}  db="${c.existing}"  approved="${c.approved}"`);
      }
      fail(
        'Refusing to overwrite existing holiday facts. Resolve each conflict by hand, ' +
          'then re-run.',
      );
    }

    const expectedFinal = existing.length + plan.toCreate.length;
    console.log(`\n  expected final count for this calendar: ${expectedFinal}`);

    if (!APPLY) {
      console.log('\nDRY RUN COMPLETE. Nothing was written.');
      console.log('Re-run with --apply once the rows above are correct.\n');
      return;
    }

    if (plan.toCreate.length === 0 && approved) {
      console.log('\nNothing to do -- the calendar already matches the approved source.\n');
      return;
    }

    // One bounded batch transaction: calendar + all approved rows, or none.
    const result = await writeHolidayImport(prisma, approved?.id ?? null, plan.toCreate);

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

    // The whole point of the run: exactly one ACTIVE calendar this financial
    // year, so the bootstrap and BL-5 both resolve a single answer.
    const activeAfter = await prisma.holidayCalendar.findMany({
      where: { status: PolicyStatus.ACTIVE, financialYear: OFFICIAL_HOLIDAY_FINANCIAL_YEAR },
      select: { id: true, name: true },
    });
    if (activeAfter.length !== 1) {
      fail(
        `Expected exactly 1 ACTIVE calendar for ${OFFICIAL_HOLIDAY_FINANCIAL_YEAR} after ` +
          `import, found ${activeAfter.length}. Attendance would resolve ` +
          `${activeAfter.length === 0 ? 'MISSING' : 'AMBIGUOUS'}.`,
      );
    }

    console.log(`\n  ACTIVE calendars for ${OFFICIAL_HOLIDAY_FINANCIAL_YEAR}: 1 (${activeAfter[0].id})`);
    console.log('\nIMPORT COMPLETE. Every approved row verified present.\n');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\nImport failed:', err?.message ?? err);
    process.exit(1);
  });
}
