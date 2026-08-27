/**
 * Staging identity gate + read-only activation preflight (BL-2B).
 *
 * Run this BEFORE any migration, import or flag change. It does two jobs:
 *
 *   1. Proves the database it is pointed at is staging and is NOT production.
 *      It refuses to continue on anything ambiguous, and it never prints a
 *      credential.
 *   2. Reads (only reads) the legacy policy, calendar and profile data, and
 *      reports what would make attendance activation ambiguous.
 *
 * It performs NO writes of any kind. There is no --apply flag, because there is
 * nothing here to apply.
 *
 *   npx ts-node scripts/staging-preflight.ts
 *
 * Required environment:
 *   DATABASE_URL              the staging database
 *   APP_ENV=staging           positive assertion, not an absence of "production"
 *   EXPECTED_STAGING_DB_HOST  the staging host, read from Render by a human
 *   EXPECTED_STAGING_DB_NAME  the staging database name, likewise
 *
 * The last two are the point of this gate. Checking that the connected database
 * matches the one named in DATABASE_URL proves only that the connection went
 * where the URL pointed — it says nothing about whether that URL is staging.
 * So the operator must supply the expected host and database name INDEPENDENTLY,
 * from the Render dashboard, and the script asserts all three agree. If they are
 * not supplied, this script stops rather than inferring "looks like staging"
 * from a connection string or a service name.
 *
 * Why a POSITIVE assertion rather than only a production deny-list: the existing
 * HRMS seed guards by pattern-matching the URL against /render\.com/i, which
 * matches staging too — it would refuse a legitimate staging run, and more
 * importantly "does not look like production" is not the same claim as "is
 * staging". The deny-list is kept below as an additional defence, not as proof.
 */

import { PrismaClient } from '@prisma/client';

/** Production identifiers already recorded in this repository's seed guard. */
const KNOWN_PRODUCTION_MARKERS = [/dpg-d8259omk1jcs73e37fbg/i, /prod\.technoedge/i];

interface TargetIdentity {
  host: string;
  database: string;
  port: string;
  sslMode: string;
}

/** Parses the connection string for reporting. Never returns user or password. */
function describeTarget(url: string): TargetIdentity | null {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      database: parsed.pathname.replace(/^\//, ''),
      port: parsed.port || '5432',
      sslMode: parsed.searchParams.get('sslmode') ?? 'unspecified',
    };
  } catch {
    return null;
  }
}

function fail(reason: string): never {
  console.error('\nSTAGING IDENTITY: FAILED');
  console.error(`Reason: ${reason}`);
  console.error('No database work was performed.\n');
  process.exit(1);
}

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  const appEnv = (process.env.APP_ENV ?? '').toLowerCase();
  const expectedHost = (process.env.EXPECTED_STAGING_DB_HOST ?? '').trim();
  const expectedName = (process.env.EXPECTED_STAGING_DB_NAME ?? '').trim();

  console.log('── Staging identity gate ──────────────────────────────────────');

  if (!url) fail('DATABASE_URL is not set.');

  // Independently-known identity, or nothing happens. This is the rule that
  // stops "the service is called staging, so this must be staging".
  if (!expectedHost || !expectedName) {
    fail(
      'EXPECTED_STAGING_DB_HOST and EXPECTED_STAGING_DB_NAME must both be set, read ' +
        'from the Render dashboard by a human. Without them the staging host and ' +
        'database are not independently known, and this script will not let Prisma ' +
        'near the database.',
    );
  }

  const target = describeTarget(url);
  if (!target) fail('DATABASE_URL could not be parsed.');

  // Reported without credentials, deliberately: enough to recognise the target,
  // nothing that could be reused.
  console.log(`  host      : ${target.host}`);
  console.log(`  database  : ${target.database}`);
  console.log(`  port      : ${target.port}`);
  console.log(`  sslmode   : ${target.sslMode}`);
  console.log(`  APP_ENV   : ${appEnv || '(unset)'}`);

  if (!appEnv) {
    fail(
      'APP_ENV is not set. An unset environment is exactly the ambiguity this ' +
        'gate exists to catch — this repo has already seen a health endpoint ' +
        'report the wrong environment for that reason.',
    );
  }
  if (appEnv !== 'staging') {
    fail(`APP_ENV is "${appEnv}", not "staging".`);
  }

  // Two independent facts must agree: what the URL points at, and what a human
  // read off Render.
  if (target.host !== expectedHost) {
    fail(
      `Host mismatch. DATABASE_URL points at "${target.host}" but the expected ` +
        `staging host is "${expectedHost}".`,
    );
  }
  if (target.database !== expectedName) {
    fail(
      `Database mismatch. DATABASE_URL names "${target.database}" but the expected ` +
        `staging database is "${expectedName}".`,
    );
  }
  console.log(`  expected  : ${expectedHost} / ${expectedName}  (supplied independently)`);

  // Additional defence, not proof.
  const marker = KNOWN_PRODUCTION_MARKERS.find((m) => m.test(url));
  if (marker) {
    fail(`The connection string matches a known production marker (${marker}).`);
  }
  for (const m of KNOWN_PRODUCTION_MARKERS) {
    if (m.test(expectedHost) || m.test(expectedName)) {
      fail(`The supplied "staging" identity itself matches a production marker (${m}).`);
    }
  }

  // ── Read-only fingerprint ──────────────────────────────────────────────
  // Only now, after the environment has positively asserted staging.
  const prisma = new PrismaClient();
  try {
    const [fingerprint] = await prisma.$queryRawUnsafe<any[]>(
      `SELECT current_database() AS database,
              current_user       AS role,
              version()          AS version,
              inet_server_port() AS port`,
    );

    console.log('\n── Live fingerprint (read-only) ───────────────────────────────');
    console.log(`  current_database : ${fingerprint.database}`);
    console.log(`  current_user     : ${fingerprint.role}`);
    console.log(`  server           : ${String(fingerprint.version).split(' on ')[0]}`);

    // The live server must agree with BOTH the URL and the independently
    // supplied name. Matching the URL alone would only prove the connection
    // went where the URL pointed.
    if (fingerprint.database !== expectedName) {
      fail(
        `The connected database is "${fingerprint.database}" but the expected staging ` +
          `database is "${expectedName}". Something is redirecting the connection.`,
      );
    }
    for (const m of KNOWN_PRODUCTION_MARKERS) {
      if (m.test(String(fingerprint.database))) {
        fail(`The connected database name matches a production marker (${m}).`);
      }
    }

    console.log('\nSTAGING IDENTITY: PASSED');

    await dataPreflight(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile readiness applicability
//
// A missing assignment is only a blocker where the runtime would actually look
// for it. The attendance context resolver reads assignedShift, holiday calendar
// and weekly-off ONLY inside its `coverage === 'COVERED'` branch, and an EXEMPT
// employee never enters that branch — so demanding those rows from an exempt
// profile invents a blocker the runtime does not have.
//
// assignedLeavePolicyId is weaker still: it blocks NOBODY. There is no
// MISSING_LEAVE_POLICY in ContextBlockedReason, and daily-context.service marks
// its lookup "deliberately NOT blocking", because a day with no leave request is
// finalizable without a leave policy. It is reported here for COVERED employees
// as readiness for the leave features, never as an attendance blocker.
//
// The rules below mirror EmployeeTimelineService.resolveCoverage exactly. If
// that resolver changes, this must change with it.
// ─────────────────────────────────────────────────────────────────────────────

export type ProfileApplicability = 'COVERED' | 'EXEMPT' | 'NO_PROFILE';

export interface ProfileReadinessRow {
  email: string;
  userName: string;
  roleName: string | null;
  hasProfile: boolean;
  category: string | null;
  attendanceRequired: boolean | null;
  assignedShiftId: string | null;
  assignedHolidayCalendarId: string | null;
  assignedWeeklyOffPolicyId: string | null;
  assignedLeavePolicyId: string | null;
  assignedAttendanceLocationId: string | null;
}

/** Mirrors EmployeeTimelineService.resolveCoverage for an employed user. */
export function classifyProfile(row: ProfileReadinessRow): ProfileApplicability {
  if (!row.hasProfile) return 'NO_PROFILE';
  if (row.category === 'MANAGEMENT_EXEMPT') return 'EXEMPT';
  if (row.attendanceRequired === false) return 'EXEMPT';
  return 'COVERED';
}

export interface ReadinessAssessment {
  total: number;
  covered: number;
  exempt: number;
  missingProfile: number;
  /** Counted over COVERED profiles only — the ones the runtime interrogates. */
  missing: {
    shift: number;
    calendar: number;
    weeklyOff: number;
    leavePolicy: number;
    location: number;
  };
  /** Exempt profiles lacking each assignment. Reported, never blocking. */
  exemptWithout: {
    shift: number;
    calendar: number;
    weeklyOff: number;
    leavePolicy: number;
  };
  /** Identity of every profile with no leave policy, so the operator can see who. */
  withoutLeavePolicy: Array<{
    email: string;
    userName: string;
    roleName: string | null;
    applicability: ProfileApplicability;
    category: string | null;
    attendanceRequired: boolean | null;
  }>;
}

export function assessProfileReadiness(rows: ProfileReadinessRow[]): ReadinessAssessment {
  const out: ReadinessAssessment = {
    total: rows.length,
    covered: 0,
    exempt: 0,
    missingProfile: 0,
    missing: { shift: 0, calendar: 0, weeklyOff: 0, leavePolicy: 0, location: 0 },
    exemptWithout: { shift: 0, calendar: 0, weeklyOff: 0, leavePolicy: 0 },
    withoutLeavePolicy: [],
  };

  for (const row of rows) {
    const applicability = classifyProfile(row);

    if (applicability === 'NO_PROFILE') {
      out.missingProfile += 1;
    } else if (applicability === 'EXEMPT') {
      out.exempt += 1;
      if (!row.assignedShiftId) out.exemptWithout.shift += 1;
      if (!row.assignedHolidayCalendarId) out.exemptWithout.calendar += 1;
      if (!row.assignedWeeklyOffPolicyId) out.exemptWithout.weeklyOff += 1;
      if (!row.assignedLeavePolicyId) out.exemptWithout.leavePolicy += 1;
    } else {
      out.covered += 1;
      if (!row.assignedShiftId) out.missing.shift += 1;
      if (!row.assignedHolidayCalendarId) out.missing.calendar += 1;
      if (!row.assignedWeeklyOffPolicyId) out.missing.weeklyOff += 1;
      if (!row.assignedLeavePolicyId) out.missing.leavePolicy += 1;
      if (!row.assignedAttendanceLocationId) out.missing.location += 1;
    }

    if (applicability !== 'NO_PROFILE' && !row.assignedLeavePolicyId) {
      out.withoutLeavePolicy.push({
        email: row.email,
        userName: row.userName,
        roleName: row.roleName,
        applicability,
        category: row.category,
        attendanceRequired: row.attendanceRequired,
      });
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-only data preflight
// ─────────────────────────────────────────────────────────────────────────────

type Severity = 'PASS' | 'WARNING' | 'BLOCKER';
const findings: Array<{ severity: Severity; check: string; detail: string }> = [];

function record(severity: Severity, check: string, detail: string) {
  findings.push({ severity, check, detail });
}

async function dataPreflight(prisma: PrismaClient) {
  console.log('\n── Activation preflight (read-only) ───────────────────────────');

  // A. Policy families with more than one active row.
  //
  // BL-4 gave every policy a policyKey series. If a series has two ACTIVE
  // versions, the versioned resolver cannot say which one governs a date — and
  // BL-5's strict mode will report AMBIGUOUS rather than guess.
  for (const [label, table] of [
    ['AttendancePolicy', 'attendance_policies'],
    ['ShiftPolicy', 'shift_policies'],
    ['LeavePolicy', 'leave_policies'],
    ['HolidayCalendar', 'holiday_calendars'],
  ] as const) {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "policyKey", COUNT(*)::int AS active
         FROM "${table}"
        WHERE "status" = 'ACTIVE'
        GROUP BY "policyKey"
       HAVING COUNT(*) > 1`,
    );
    if (rows.length > 0) {
      record(
        'BLOCKER',
        `${label}: duplicate ACTIVE versions`,
        rows.map((r) => `${r.policyKey} has ${r.active} active`).join('; '),
      );
    } else {
      record('PASS', `${label}: one ACTIVE version per series`, 'ok');
    }
  }

  // B. Calendars / weekly-off policies that could each serve as a company
  //    default. Two candidates with no employee assignment is AMBIGUOUS.
  const activeCalendars = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*)::int AS n FROM "holiday_calendars" WHERE "status" = 'ACTIVE'`,
  );
  const activeWeeklyOff = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*)::int AS n FROM "weekly_off_policies" WHERE "isActive" = true`,
  );
  record(
    activeCalendars[0].n > 1 ? 'WARNING' : 'PASS',
    'HolidayCalendar: company-default candidates',
    `${activeCalendars[0].n} active`,
  );
  record(
    activeWeeklyOff[0].n > 1 ? 'WARNING' : 'PASS',
    'WeeklyOffPolicy: company-default candidates',
    `${activeWeeklyOff[0].n} active`,
  );

  // C. Employee profiles whose effective ranges overlap. BL-3 resolves the
  //    latest, so an overlap silently hides one of them.
  const overlaps = await prisma.$queryRawUnsafe<any[]>(
    `SELECT a."userId", COUNT(*)::int AS n
       FROM "employee_attendance_profiles" a
       JOIN "employee_attendance_profiles" b
         ON a."userId" = b."userId" AND a.id <> b.id
      WHERE a."effectiveFrom" <= COALESCE(b."effectiveTo", 'infinity'::timestamp)
        AND COALESCE(a."effectiveTo", 'infinity'::timestamp) >= b."effectiveFrom"
      GROUP BY a."userId"`,
  );
  record(
    overlaps.length > 0 ? 'WARNING' : 'PASS',
    'EmployeeAttendanceProfile: overlapping effective ranges',
    overlaps.length > 0 ? `${overlaps.length} employee(s)` : 'none',
  );

  // D-G. Per-employee readiness.
  //
  // Read row by row rather than as one aggregate COUNT, because whether an
  // assignment is required depends on the profile's own coverage, and because
  // "2 profiles are missing a leave policy" is not actionable without knowing
  // which two.
  const profileRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT u.email                          AS email,
            u.name                           AS user_name,
            r.name                           AS role_name,
            (p.id IS NOT NULL)               AS has_profile,
            p."category"                     AS category,
            p."attendanceRequired"           AS attendance_required,
            p."assignedShiftId"              AS assigned_shift_id,
            p."assignedHolidayCalendarId"    AS assigned_holiday_calendar_id,
            p."assignedWeeklyOffPolicyId"    AS assigned_weekly_off_policy_id,
            p."assignedLeavePolicyId"        AS assigned_leave_policy_id,
            p."assignedAttendanceLocationId" AS assigned_attendance_location_id
       FROM "users" u
       LEFT JOIN "roles" r ON r.id = u."roleId"
       LEFT JOIN LATERAL (
         SELECT * FROM "employee_attendance_profiles" ep
          WHERE ep."userId" = u.id
          ORDER BY ep."effectiveFrom" DESC
          LIMIT 1
       ) p ON true
      WHERE u."isActive" = true`,
  );

  const assessment = assessProfileReadiness(
    profileRows.map((x) => ({
      email: x.email,
      userName: x.user_name,
      roleName: x.role_name ?? null,
      hasProfile: Boolean(x.has_profile),
      category: x.category ?? null,
      attendanceRequired: x.attendance_required ?? null,
      assignedShiftId: x.assigned_shift_id ?? null,
      assignedHolidayCalendarId: x.assigned_holiday_calendar_id ?? null,
      assignedWeeklyOffPolicyId: x.assigned_weekly_off_policy_id ?? null,
      assignedLeavePolicyId: x.assigned_leave_policy_id ?? null,
      assignedAttendanceLocationId: x.assigned_attendance_location_id ?? null,
    })),
  );

  record(
    assessment.missingProfile > 0 ? 'BLOCKER' : 'PASS',
    'Employees without an attendance profile',
    `${assessment.missingProfile} of ${assessment.total} active`,
  );
  record(
    'PASS',
    'Profile coverage split',
    `${assessment.covered} covered, ${assessment.exempt} exempt, ` +
      `${assessment.missingProfile} without a profile`,
  );

  // Shift, calendar and weekly-off block only a COVERED employee: those are the
  // three the context resolver demands, and only inside its COVERED branch.
  for (const [label, value] of [
    ['shift', assessment.missing.shift],
    ['holiday calendar', assessment.missing.calendar],
    ['weekly-off policy', assessment.missing.weeklyOff],
  ] as const) {
    record(
      value > 0 ? 'BLOCKER' : 'PASS',
      `Covered profiles without an assigned ${label}`,
      `${value} of ${assessment.covered} covered`,
    );
  }

  // Leave policy blocks nobody. A covered employee without one cannot use the
  // V2 leave entitlement path, so entitlement functionality would be incomplete
  // -- worth a warning. BL-5 attendance itself still resolves, so it is not a
  // reason to hold activation.
  record(
    assessment.missing.leavePolicy > 0 ? 'WARNING' : 'PASS',
    'Covered profiles without an assigned leave policy',
    `${assessment.missing.leavePolicy} of ${assessment.covered} covered` +
      ' (not blocking: no MISSING_LEAVE_POLICY exists in the context resolver)',
  );

  if (assessment.exemptWithout.leavePolicy > 0) {
    record(
      'PASS',
      'Exempt profiles without a leave policy',
      `${assessment.exemptWithout.leavePolicy} — expected; exempt profiles are ` +
        'never asked for one',
    );
  }

  // Section 1 of the brief: say WHICH profiles, not just how many. Identity
  // fields only, no secrets.
  if (assessment.withoutLeavePolicy.length > 0) {
    console.log('\n  Profiles with no assigned leave policy:');
    for (const x of assessment.withoutLeavePolicy) {
      console.log(
        `    ${x.applicability.padEnd(10)} ${x.email}  (${x.userName})  ` +
          `role=${x.roleName ?? 'none'}  category=${x.category ?? 'none'}  ` +
          `attendanceRequired=${x.attendanceRequired}`,
      );
    }
  }
  // Only a problem where geofencing is actually enforced.
  const geofenced = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*)::int AS n FROM "attendance_policies"
      WHERE "geoFenceEnabled" = true AND "status" = 'ACTIVE'`,
  );
  record(
    geofenced[0].n > 0 && assessment.missing.location > 0 ? 'BLOCKER' : 'PASS',
    'Covered profiles without a location while geofencing is on',
    `${assessment.missing.location} without location, ${geofenced[0].n} geofenced polic(ies)`,
  );

  // H-J. Existing volumes, so a migration backfill's blast radius is known
  //      before it runs rather than after.
  const leaveByStatus = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "status", COUNT(*)::int AS n FROM "leave_requests" GROUP BY "status"`,
  );
  record(
    'PASS',
    'LeaveRequest rows by status (LH-2 backfill scope)',
    leaveByStatus.map((x) => `${x.status}=${x.n}`).join(' ') || 'none',
  );

  const daily = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*)::int AS n, MIN("date") AS from_date, MAX("date") AS to_date
       FROM "daily_attendance"`,
  );
  record(
    'PASS',
    'DailyAttendance existing rows',
    daily[0].n === 0
      ? 'none (expected: nothing has ever written this table)'
      : `${daily[0].n} rows, ${daily[0].from_date} to ${daily[0].to_date}`,
  );

  const regs = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*)::int AS n FROM "attendance_regularizations"`,
  );
  record(
    'PASS',
    'AttendanceRegularization existing rows',
    `${regs[0].n} (expected: 0, the model was dormant)`,
  );

  // ── Report ────────────────────────────────────────────────────────────
  const order: Severity[] = ['BLOCKER', 'WARNING', 'PASS'];
  for (const severity of order) {
    for (const f of findings.filter((x) => x.severity === severity)) {
      console.log(`  [${f.severity.padEnd(7)}] ${f.check}: ${f.detail}`);
    }
  }

  const blockers = findings.filter((f) => f.severity === 'BLOCKER').length;
  const warnings = findings.filter((f) => f.severity === 'WARNING').length;

  console.log(`\n  ${blockers} blocker(s), ${warnings} warning(s)`);
  // Deliberately says nothing about migrations. This script checks configuration
  // readiness; whether migrations are outstanding is a separate question with a
  // separate answer (`npx prisma migrate status`). Conflating the two made this
  // line misleading as soon as the migrations were already applied.
  console.log(
    blockers === 0
      ? '\nPREFLIGHT: CLEAR.\nAttendance staging configuration passes readiness checks.'
      : '\nPREFLIGHT: BLOCKED. Resolve the blockers above before activating attendance.',
  );
}

// Only run when invoked directly, so the applicability layer above can be unit
// tested without this script connecting to anything.
if (require.main === module) {
  main().catch((err) => {
    console.error('\nPreflight failed to complete:', err?.message ?? err);
    process.exit(1);
  });
}
