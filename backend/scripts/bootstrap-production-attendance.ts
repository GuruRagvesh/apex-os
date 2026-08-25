/**
 * Production Attendance enablement.
 *
 *   npx ts-node scripts/bootstrap-production-attendance.ts            # dry run
 *   npx ts-node scripts/bootstrap-production-attendance.ts --apply    # writes
 *
 * Prepares the REAL company attendance authority: one attendance policy, one
 * shift, one weekly-off policy, one leave policy, and an
 * EmployeeAttendanceProfile for every active employee who does not have one.
 *
 * It is NOT the staging bootstrap with the gate flipped. It reuses that
 * script's safety mechanisms and rejects its data choices:
 *
 *   - It creates NO users. It discovers the real ones.
 *   - It creates NO department. It uses the ones that exist.
 *   - It reuses an existing compatible policy rather than making a second one.
 *   - It refuses ambiguity instead of picking a winner.
 *
 * EXEMPTION IS NEVER INFERRED
 * ---------------------------
 * A MANAGEMENT_EXEMPT employee is outside attendance entirely: the context
 * resolver returns EXEMPT and no attendance is ever expected of them. Deciding
 * that from a role name or a job title would silently exempt people nobody
 * approved, and the mistake would be invisible until payroll.
 *
 * So exemption comes from exactly two places, both explicit:
 *
 *   1. An existing effective-dated profile already classified
 *      MANAGEMENT_EXEMPT. That is a decision somebody already recorded.
 *   2. PRODUCTION_EXEMPT_EMPLOYEE_IDS -- a deliberate, human-supplied list of
 *      employeeId values, approved by management for this run.
 *
 * Everyone else is REGULAR_EMPLOYEE and gets real coverage. Role, level, title
 * and name are never consulted for this decision.
 *
 * Required environment:
 *
 *   DATABASE_URL
 *   APP_ENV=production
 *   EXPECTED_PRODUCTION_DB_HOST   read from the Render dashboard by a human
 *   EXPECTED_PRODUCTION_DB_NAME   likewise
 *   PRODUCTION_EXEMPT_EMPLOYEE_IDS  optional, comma-separated employeeId list
 *
 * The two EXPECTED_* values are the point of the gate: that the connection
 * reached the database named in the URL proves only that the URL was followed.
 * The operator must supply the identity INDEPENDENTLY, and all three must agree.
 *
 * Writes nothing without --apply. Performs no delete, reset, seed or repair of
 * any kind, and never prints a credential.
 */

import { randomUUID } from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import {
  AttendanceCategory,
  PolicyDecisionAction,
  PolicyStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';

const APPLY = process.argv.includes('--apply');

/** Staging identifiers. Running this against staging would be a mistake too. */
const KNOWN_NON_PRODUCTION_MARKERS = [
  /dpg-d95pamvaqgkc73fdurig/i,
  /apex_os_staging/i,
  /staging/i,
];

/**
 * Stable ids, so a re-run after a partial failure reuses the same rows rather
 * than creating a parallel set. Distinct namespace from the staging script.
 */
const PRODUCTION_ID_NAMESPACE = 'd3f5a1c8-2b47-4e6a-9d10-7c3b5e8f2a94';
const stableId = (key: string) => uuidv5(`production-attendance:${key}`, PRODUCTION_ID_NAMESPACE);

/** The approved company policy. Every value here is management-decided. */
export const PRODUCTION_POLICY = {
  attendancePolicyName: 'TechnoEdge Attendance Policy',
  shiftName: 'TechnoEdge General Shift',
  weeklyOffName: 'TechnoEdge Weekly Off',
  leavePolicyName: 'TechnoEdge Leave Policy',

  punchInEarliest: '09:30',
  punchInLatest: '10:30',
  shiftStart: '09:30',
  shiftEnd: '18:30',
  /** Attendance SPAN, not effective work. Break is permitted inside it. */
  minimumWorkingMinutes: 540,
  permittedBreakMinutes: 60,
  /** Unset on purpose: management has not defined an effective-work floor. */
  minimumEffectiveWorkMinutes: null as number | null,

  casualLeaveAllocation: 10,
  emergencyLeaveAllocation: 4,
  compOffExpiryDays: 30,

  firstHalfInEarliest: '09:30',
  firstHalfInLatest: '10:30',
  firstHalfRequiredPresenceMinutes: 240,
  secondHalfInEarliest: '14:00',
  secondHalfInLatest: '14:30',
  secondHalfOutTime: '18:30',
} as const;

/**
 * Production feature flags at enablement.
 *
 * Employees get the interactive attendance experience immediately. The
 * scheduler stays off: switching on automatic official writes for the whole
 * company on minute one would produce a day of official attendance nobody has
 * inspected yet.
 */
export const PRODUCTION_ATTENDANCE_V2 = {
  punchEvidenceEnabled: true,
  leaveAuthorityEnabled: true,
  leaveApprovalEnabled: true,
  regularizationEnabled: true,
  automaticEvaluationEnabled: false,
  shadowEnabled: false,
  officialWriteEnabled: false,
} as const;

function fail(reason: string): never {
  console.error(`\nPRODUCTION ENABLEMENT ABORTED: ${reason}\n`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Exemption resolution
// ─────────────────────────────────────────────────────────────────────────────

export type CoverageDecision =
  | { category: 'MANAGEMENT_EXEMPT'; source: 'EXISTING_PROFILE' | 'APPROVED_INPUT' }
  | { category: 'REGULAR_EMPLOYEE'; source: 'DEFAULT_COVERED' };

export interface EmployeeFacts {
  id: string;
  employeeId: string | null;
  /** Category on an existing effective-dated profile, if there is one. */
  existingCategory: string | null;
}

/**
 * Decides one employee's coverage.
 *
 * Deliberately takes no role, level, title or name: there is no argument here
 * from which an exemption could be inferred, so it cannot be.
 */
export function decideCoverage(
  employee: EmployeeFacts,
  approvedExemptEmployeeIds: ReadonlySet<string>,
): CoverageDecision {
  if (employee.existingCategory === AttendanceCategory.MANAGEMENT_EXEMPT) {
    // Somebody already recorded this decision. Not re-litigated here.
    return { category: 'MANAGEMENT_EXEMPT', source: 'EXISTING_PROFILE' };
  }
  if (employee.employeeId && approvedExemptEmployeeIds.has(employee.employeeId)) {
    return { category: 'MANAGEMENT_EXEMPT', source: 'APPROVED_INPUT' };
  }
  return { category: 'REGULAR_EMPLOYEE', source: 'DEFAULT_COVERED' };
}

/** Parses the approved exemption list. Blank means nobody is exempt. */
export function parseApprovedExemptions(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Identity gate
// ─────────────────────────────────────────────────────────────────────────────

/** Masks a host for printing: keeps the shape, reveals no full address. */
export function maskIdentity(value: string): string {
  if (value.length <= 6) return '***';
  return `${value.slice(0, 3)}***${value.slice(-4)}`;
}

export function assertProductionTarget(env: NodeJS.ProcessEnv) {
  const appEnv = (env.APP_ENV ?? '').toLowerCase();
  const url = env.DATABASE_URL ?? '';
  const expectedHost = (env.EXPECTED_PRODUCTION_DB_HOST ?? '').trim();
  const expectedName = (env.EXPECTED_PRODUCTION_DB_NAME ?? '').trim();

  if (!url) fail('DATABASE_URL is not set.');
  if (appEnv !== 'production') {
    fail(`APP_ENV is "${appEnv || '(unset)'}", not "production".`);
  }
  if (!expectedHost || !expectedName) {
    fail(
      'EXPECTED_PRODUCTION_DB_HOST and EXPECTED_PRODUCTION_DB_NAME must both be ' +
        'set, read from the Render dashboard by a human. Supplying them from the ' +
        'connection string would prove nothing.',
    );
  }
  for (const marker of KNOWN_NON_PRODUCTION_MARKERS) {
    if (marker.test(url) || marker.test(expectedHost) || marker.test(expectedName)) {
      fail(`Target matches a non-production marker (${marker}). This is the production script.`);
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail('DATABASE_URL could not be parsed.');
  }
  const host = parsed!.hostname;
  const database = parsed!.pathname.replace(/^\//, '');
  if (host !== expectedHost) fail('Host mismatch between DATABASE_URL and EXPECTED_PRODUCTION_DB_HOST.');
  if (database !== expectedName) {
    fail('Database mismatch between DATABASE_URL and EXPECTED_PRODUCTION_DB_NAME.');
  }

  console.log(`  target host     : ${maskIdentity(host)}`);
  console.log(`  target database : ${maskIdentity(database)}`);
  return { host, database };
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy payloads
// ─────────────────────────────────────────────────────────────────────────────

export function buildProductionPolicies(input: {
  financialYear: string;
  effectiveFrom: Date;
  attendancePolicyId: string;
  shiftId: string;
  weeklyOffId: string;
  leavePolicyId: string;
  createdById: string;
}) {
  const lifecycle = (
    id: string,
  ): Pick<
    Prisma.AttendancePolicyUncheckedCreateInput,
    | 'id' | 'policyKey' | 'version' | 'status' | 'isActive'
    | 'effectiveFrom' | 'effectiveTo' | 'createdById'
  > => ({
    id,
    policyKey: id,
    version: 1,
    status: PolicyStatus.ACTIVE,
    isActive: true,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    createdById: input.createdById,
  });

  return {
    attendancePolicy: {
      ...lifecycle(input.attendancePolicyId),
      financialYear: input.financialYear,
      name: PRODUCTION_POLICY.attendancePolicyName,
      minimumWorkingMinutes: PRODUCTION_POLICY.minimumWorkingMinutes,
      permittedBreakMinutes: PRODUCTION_POLICY.permittedBreakMinutes,
      minimumEffectiveWorkMinutes: PRODUCTION_POLICY.minimumEffectiveWorkMinutes,
      lateExemptionEnabled: true,
      faceCaptureRequired: true,
      locationCaptureRequired: true,
      // Enabling a geofence needs approved coordinates, which are not a
      // decision this script may invent.
      geoFenceEnabled: false,
      regularizationEnabled: true,
      // A late arrival is reviewed by a human, never automatically penalised.
      afterPunchWindowAction: PolicyDecisionAction.REQUIRE_REVIEW,
      insufficientHoursAction: PolicyDecisionAction.REQUIRE_REVIEW,
      // Half day is an approval, never inferred from short hours.
      automaticHalfDayEnabled: false,
    } satisfies Prisma.AttendancePolicyUncheckedCreateInput,

    shift: {
      ...lifecycle(input.shiftId),
      attendancePolicyId: input.attendancePolicyId,
      name: PRODUCTION_POLICY.shiftName,
      category: AttendanceCategory.REGULAR_EMPLOYEE,
      startTime: PRODUCTION_POLICY.shiftStart,
      endTime: PRODUCTION_POLICY.shiftEnd,
      // 09:30 start with a 10:30 latest punch-in is a 60-minute window.
      graceMinutes: 60,
      minimumWorkingMinutes: PRODUCTION_POLICY.minimumWorkingMinutes,
    } satisfies Prisma.ShiftPolicyUncheckedCreateInput,

    weeklyOff: {
      id: input.weeklyOffId,
      name: PRODUCTION_POLICY.weeklyOffName,
      everySunday: true,
      secondSaturday: true,
      fourthSaturday: true,
      // No fifth-Saturday rule: management did not approve one.
      isActive: true,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
    } satisfies Prisma.WeeklyOffPolicyUncheckedCreateInput,

    leavePolicy: {
      ...lifecycle(input.leavePolicyId),
      financialYear: input.financialYear,
      name: PRODUCTION_POLICY.leavePolicyName,
      totalPaidLeaves: 14,
      casualLeaveAllocation: PRODUCTION_POLICY.casualLeaveAllocation,
      emergencyLeaveAllocation: PRODUCTION_POLICY.emergencyLeaveAllocation,
      // Empty on purpose: Casual and Emergency are separate pools and must not
      // cross-consume.
      combinedPoolTypes: [],
      lwpAfterBalanceExhausted: true,
      approvedLeavePriorityOverAbsent: true,
      holidaysExcluded: true,
      weeklyOffExcluded: true,
      firstHalfInEarliest: PRODUCTION_POLICY.firstHalfInEarliest,
      firstHalfInLatest: PRODUCTION_POLICY.firstHalfInLatest,
      firstHalfRequiredPresenceMinutes: PRODUCTION_POLICY.firstHalfRequiredPresenceMinutes,
      secondHalfInEarliest: PRODUCTION_POLICY.secondHalfInEarliest,
      secondHalfInLatest: PRODUCTION_POLICY.secondHalfInLatest,
      secondHalfOutTime: PRODUCTION_POLICY.secondHalfOutTime,
      compOffExpiryDays: PRODUCTION_POLICY.compOffExpiryDays,
    } satisfies Prisma.LeavePolicyUncheckedCreateInput,
  };
}

/** BL-5: exactly one candidate is an answer; more than one is ambiguity. */
function resolveSingle<T extends { id: string; name?: string }>(
  rows: T[],
  label: string,
  conflicts: string[],
): T | null {
  if (rows.length > 1) {
    conflicts.push(
      `${rows.length} active ${label} rows exist. The resolver cannot say which ` +
        'one governs a date, so this run will not add another.',
    );
    return null;
  }
  return rows[0] ?? null;
}

async function main() {
  console.log('\n── Production Attendance enablement ───────────────────────────');
  console.log(`  mode            : ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
  assertProductionTarget(process.env);

  const approvedExemptions = parseApprovedExemptions(process.env.PRODUCTION_EXEMPT_EMPLOYEE_IDS);
  console.log(`  approved exempt : ${approvedExemptions.size} employeeId(s) supplied`);

  const prisma = new PrismaClient();
  const conflicts: string[] = [];

  try {
    // ── Financial year and effective date ──────────────────────────────────
    const now = new Date();
    const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    const y = istNow.getUTCFullYear();
    const fyStartYear = istNow.getUTCMonth() + 1 >= 4 ? y : y - 1;
    const financialYear = `${fyStartYear}-${fyStartYear + 1}`;
    const effectiveFrom = new Date(
      `${istNow.toISOString().slice(0, 10)}T00:00:00.000Z`,
    );
    console.log(`  financial year  : ${financialYear}`);
    console.log(`  effective from  : ${effectiveFrom.toISOString().slice(0, 10)}`);

    // ── An actor for createdById. Never invented. ──────────────────────────
    const actor = await prisma.user.findFirst({
      where: { isActive: true, OR: [{ isHR: true }, { role: { level: { lte: 1 } } }] },
      orderBy: { role: { level: 'asc' } },
      select: { id: true, name: true },
    });
    if (!actor) {
      fail(
        'No active HR or admin user exists to attribute these policies to. ' +
          'This script will not create one.',
      );
    }

    const ids = {
      attendancePolicy: stableId('attendance-policy'),
      shift: stableId('shift'),
      weeklyOff: stableId('weekly-off'),
      leavePolicy: stableId('leave-policy'),
    };

    // ── Reuse existing authorities rather than adding a second one ─────────
    const [attendanceRows, weeklyRows, leaveRows, calendarRows] = await Promise.all([
      prisma.attendancePolicy.findMany({
        where: { status: PolicyStatus.ACTIVE, financialYear },
        select: { id: true, name: true },
      }),
      prisma.weeklyOffPolicy.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
      prisma.leavePolicy.findMany({
        where: { status: PolicyStatus.ACTIVE, financialYear },
        select: { id: true, name: true },
      }),
      prisma.holidayCalendar.findMany({
        where: { status: PolicyStatus.ACTIVE, financialYear },
        select: { id: true, name: true },
      }),
    ]);

    const existingAttendance = resolveSingle(attendanceRows, 'AttendancePolicy', conflicts);
    const existingWeekly = resolveSingle(weeklyRows, 'WeeklyOffPolicy', conflicts);
    const existingLeave = resolveSingle(leaveRows, 'LeavePolicy', conflicts);
    const existingCalendar = resolveSingle(calendarRows, 'HolidayCalendar', conflicts);

    if (existingAttendance) ids.attendancePolicy = existingAttendance.id;
    if (existingWeekly) ids.weeklyOff = existingWeekly.id;
    if (existingLeave) ids.leavePolicy = existingLeave.id;

    const shiftRows = await prisma.shiftPolicy.findMany({
      where: { status: PolicyStatus.ACTIVE, attendancePolicyId: ids.attendancePolicy },
      select: { id: true, name: true },
    });
    const existingShift = resolveSingle(shiftRows, 'ShiftPolicy', conflicts);
    if (existingShift) ids.shift = existingShift.id;

    if (!existingCalendar) {
      conflicts.push(
        `No ACTIVE HolidayCalendar for ${financialYear}. Import the approved 17 ` +
          'holidays with scripts/import-attendance-calendar-2026.ts first: without ' +
          'a calendar every working-day question resolves BLOCKED.',
      );
    }

    const policies = buildProductionPolicies({
      financialYear,
      effectiveFrom,
      attendancePolicyId: ids.attendancePolicy,
      shiftId: ids.shift,
      weeklyOffId: ids.weeklyOff,
      leavePolicyId: ids.leavePolicy,
      createdById: actor!.id,
    });

    console.log('\n  Policy authorities');
    for (const [label, existing] of [
      ['AttendancePolicy', existingAttendance],
      ['ShiftPolicy', existingShift],
      ['WeeklyOffPolicy', existingWeekly],
      ['LeavePolicy', existingLeave],
      ['HolidayCalendar', existingCalendar],
    ] as const) {
      console.log(
        `    ${label.padEnd(16)} ${existing ? `REUSE  ${existing.name}` : 'CREATE'}`,
      );
    }

    // ── Employees ──────────────────────────────────────────────────────────
    const employees = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, employeeId: true },
      orderBy: { name: 'asc' },
    });

    const profiles = await prisma.employeeAttendanceProfile.findMany({
      where: { userId: { in: employees.map((e) => e.id) } },
      select: { id: true, userId: true, category: true, effectiveTo: true },
      orderBy: { effectiveFrom: 'desc' },
    });

    const profileByUser = new Map<string, (typeof profiles)[number]>();
    const profileCount = new Map<string, number>();
    for (const p of profiles) {
      profileCount.set(p.userId, (profileCount.get(p.userId) ?? 0) + 1);
      if (!profileByUser.has(p.userId)) profileByUser.set(p.userId, p);
    }
    for (const [userId, count] of profileCount) {
      if (count > 1) {
        const who = employees.find((e) => e.id === userId);
        conflicts.push(
          `${who?.name ?? userId} has ${count} attendance profiles. Overlapping ` +
            'profiles hide one another, so this run will not add a third.',
        );
      }
    }

    const decisions = employees.map((e) => ({
      employee: e,
      existing: profileByUser.get(e.id) ?? null,
      decision: decideCoverage(
        { id: e.id, employeeId: e.employeeId, existingCategory: profileByUser.get(e.id)?.category ?? null },
        approvedExemptions,
      ),
    }));

    const toCreate = decisions.filter((d) => !d.existing);
    const covered = toCreate.filter((d) => d.decision.category === 'REGULAR_EMPLOYEE');
    const exempt = toCreate.filter((d) => d.decision.category === 'MANAGEMENT_EXEMPT');

    console.log('\n  Employees');
    console.log(`    active          : ${employees.length}`);
    console.log(`    already covered : ${decisions.length - toCreate.length} (profile exists, untouched)`);
    console.log(`    to create       : ${toCreate.length}`);
    console.log(`      covered       : ${covered.length}`);
    console.log(`      exempt        : ${exempt.length} (from the approved list only)`);

    if (exempt.length > 0) {
      console.log('\n    Exemptions being applied:');
      for (const d of exempt) {
        console.log(`      ${d.employee.employeeId ?? '(no id)'}  ${d.employee.name}  [${d.decision.source}]`);
      }
    }

    // An employeeId in the approved list that matches nobody is a typo, and a
    // typo here silently leaves somebody covered who was meant to be exempt.
    const matched = new Set(
      decisions
        .filter((d) => d.decision.source === 'APPROVED_INPUT')
        .map((d) => d.employee.employeeId!),
    );
    const unmatched = [...approvedExemptions].filter((id) => !matched.has(id));
    if (unmatched.length > 0) {
      conflicts.push(
        `PRODUCTION_EXEMPT_EMPLOYEE_IDS contains ${unmatched.length} value(s) matching ` +
          `no active employee: ${unmatched.join(', ')}. Fix the list rather than ` +
          'letting somebody stay covered by accident.',
      );
    }

    // ── attendance_v2 settings ─────────────────────────────────────────────
    const setting = await prisma.appSetting.findUnique({ where: { key: 'attendance_v2' } });
    const currentSetting = (setting?.value as Record<string, unknown> | null) ?? null;
    const settingAction = !setting ? 'CREATE' : 'UPDATE';
    const nextSetting: Record<string, unknown> = { ...(currentSetting ?? {}), ...PRODUCTION_ATTENDANCE_V2 };

    console.log('\n  attendance_v2 flags');
    for (const [k, v] of Object.entries(PRODUCTION_ATTENDANCE_V2)) {
      const from = currentSetting?.[k];
      console.log(`    ${k.padEnd(28)} ${from === undefined ? '(unset)' : String(from)} -> ${v}`);
    }

    // ── Refuse on ambiguity ────────────────────────────────────────────────
    if (conflicts.length > 0) {
      console.log('\n  CONFLICTS:');
      for (const c of conflicts) console.log(`    ! ${c}`);
      fail('Refusing to write while the picture is ambiguous. Resolve the above first.');
    }

    if (!APPLY) {
      console.log('\nDRY RUN COMPLETE. Nothing was written.');
      console.log('Re-run with --apply once the plan above is exactly what you intend.\n');
      return;
    }

    // ── Write ──────────────────────────────────────────────────────────────
    // Order matters: policies exist before the profiles that reference them.
    const operations: Prisma.PrismaPromise<unknown>[] = [];
    if (!existingAttendance) {
      operations.push(prisma.attendancePolicy.create({ data: policies.attendancePolicy }));
    }
    if (!existingShift) {
      operations.push(prisma.shiftPolicy.create({ data: policies.shift }));
    }
    if (!existingWeekly) {
      operations.push(prisma.weeklyOffPolicy.create({ data: policies.weeklyOff }));
    }
    if (!existingLeave) {
      operations.push(prisma.leavePolicy.create({ data: policies.leavePolicy }));
    }

    if (settingAction === 'CREATE') {
      operations.push(
        prisma.appSetting.create({
          data: { key: 'attendance_v2', value: nextSetting as Prisma.InputJsonValue, updatedBy: actor!.id },
        }),
      );
    } else {
      operations.push(
        prisma.appSetting.update({
          where: { key: 'attendance_v2' },
          data: { value: nextSetting as Prisma.InputJsonValue, updatedBy: actor!.id },
        }),
      );
    }

    for (const d of toCreate) {
      const isExempt = d.decision.category === 'MANAGEMENT_EXEMPT';
      operations.push(
        prisma.employeeAttendanceProfile.create({
          data: {
            id: randomUUID(),
            userId: d.employee.id,
            category: isExempt
              ? AttendanceCategory.MANAGEMENT_EXEMPT
              : AttendanceCategory.REGULAR_EMPLOYEE,
            attendanceRequired: !isExempt,
            // An exempt employee is never asked for a shift, calendar or
            // weekly-off, so none are assigned.
            assignedShiftId: isExempt ? null : ids.shift,
            assignedLeavePolicyId: isExempt ? null : ids.leavePolicy,
            assignedHolidayCalendarId: isExempt ? null : existingCalendar!.id,
            assignedWeeklyOffPolicyId: isExempt ? null : ids.weeklyOff,
            assignedAttendanceLocationId: null,
            reportingManagerId: null,
            hrReviewerId: null,
            effectiveFrom,
            effectiveTo: null,
            updatedById: actor!.id,
          } satisfies Prisma.EmployeeAttendanceProfileUncheckedCreateInput,
        }),
      );
    }

    await prisma.$transaction(operations);
    console.log(`\nAPPLY COMPLETE. ${operations.length} atomic operation(s) committed.`);
    console.log('Attendance is enabled for employees. The scheduler remains OFF.\n');
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when invoked directly, so the pure logic above can be unit tested.
if (require.main === module) {
  main().catch((error) => {
    console.error(`\nPRODUCTION ENABLEMENT FAILED: ${error?.message ?? error}\n`);
    process.exit(1);
  });
}
