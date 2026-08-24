/**
 * Minimal staging-only Attendance E2E configuration bootstrap.
 *
 *   npx ts-node scripts/bootstrap-staging-attendance-e2e.ts
 *   npx ts-node scripts/bootstrap-staging-attendance-e2e.ts --apply
 *
 * Dry-run is the default. Apply is an explicit, conflict-checked batch
 * transaction. This script never deletes or imports production data.
 */

import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import {
  AttendanceCategory,
  PolicyDecisionAction,
  PolicyStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { TVAService } from '../src/common/services/tva.service';
import { ATTENDANCE_V2_DEFAULTS } from '../src/modules/platform/attendance/punch/punch-evidence.types';
import {
  OFFICIAL_HOLIDAYS_2026,
  OFFICIAL_HOLIDAY_CALENDAR_NAME,
  OFFICIAL_HOLIDAY_FINANCIAL_YEAR,
} from '../src/modules/platform/attendance/calendar/official-holidays-2026';

const APPLY = process.argv.includes('--apply');

export const STAGING_E2E = {
  departmentName: 'Staging Attendance E2E',
  attendancePolicyName: 'Staging Attendance E2E Policy',
  shiftName: 'Staging Attendance E2E Regular Shift',
  weeklyOffName: 'Staging Attendance E2E Weekly Off',
  leavePolicyName: 'Staging Attendance E2E Leave Policy',
  users: {
    employee: {
      email: 'attendance-e2e-employee@apex.local',
      name: 'Staging Attendance Employee',
      employeeId: 'STG-ATT-E2E-EMP',
      role: 'EMPLOYEE',
      isHR: false,
    },
    manager: {
      email: 'attendance-e2e-manager@apex.local',
      name: 'Staging Attendance Manager',
      employeeId: 'STG-ATT-E2E-MGR',
      role: 'MANAGER',
      isHR: false,
    },
    hr: {
      email: 'attendance-e2e-hr@apex.local',
      name: 'Staging Attendance HR Admin',
      employeeId: 'STG-ATT-E2E-HR',
      role: 'ADMIN',
      isHR: true,
    },
  },
} as const;

export const STAGING_ATTENDANCE_V2 = {
  punchEvidenceEnabled: true,
  leaveAuthorityEnabled: true,
  leaveApprovalEnabled: true,
  regularizationEnabled: true,
  shadowEnabled: false,
  automaticEvaluationEnabled: false,
  officialWriteEnabled: false,
} as const;

export const MANAGEMENT_POLICY_GAPS = {
  compOffAutomaticGrant:
    'Comp Off automatic earning remains disabled because management has not specified a qualifying work-duration threshold.',
} as const;

export function validateStagingEnvironment(env: NodeJS.ProcessEnv) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  if ((env.APP_ENV ?? '').toLowerCase() !== 'staging') {
    throw new Error('APP_ENV must be staging.');
  }
  const expectedHost = (env.EXPECTED_STAGING_DB_HOST ?? '').trim();
  const expectedName = (env.EXPECTED_STAGING_DB_NAME ?? '').trim();
  if (!expectedHost || !expectedName) {
    throw new Error('EXPECTED_STAGING_DB_HOST and EXPECTED_STAGING_DB_NAME are required.');
  }
  for (const marker of [/dpg-d8259omk1jcs73e37fbg/i, /prod\.technoedge/i]) {
    if (marker.test(env.DATABASE_URL)) throw new Error('DATABASE_URL matches production.');
  }
  let parsed: URL;
  try {
    parsed = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('DATABASE_URL could not be parsed.');
  }
  const database = parsed.pathname.replace(/^\//, '');
  if (parsed.hostname !== expectedHost) throw new Error('Staging host does not match.');
  if (database !== expectedName) throw new Error('Staging database does not match.');
  return { host: parsed.hostname, database };
}

export function buildPolicyObjects(input: {
  financialYear: string;
  effectiveFrom: Date;
  attendancePolicyId: string;
  shiftId: string;
  leavePolicyId: string;
  managerId: string;
  hrId: string;
  geofenceEnabled: boolean;
}) {
  const lifecycle = (id: string) => ({
    id,
    policyKey: id,
    version: 1,
    status: PolicyStatus.ACTIVE,
    isActive: true,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    createdById: input.managerId,
    approvedById: input.hrId,
    approvedAt: input.effectiveFrom,
  });
  return {
    attendancePolicy: {
      ...lifecycle(input.attendancePolicyId),
      financialYear: input.financialYear,
      name: STAGING_E2E.attendancePolicyName,
      minimumWorkingMinutes: 540,
      permittedBreakMinutes: 60,
      minimumEffectiveWorkMinutes: null,
      lateExemptionEnabled: true,
      faceCaptureRequired: true,
      locationCaptureRequired: true,
      geoFenceEnabled: input.geofenceEnabled,
      regularizationEnabled: true,
      afterPunchWindowAction: PolicyDecisionAction.REQUIRE_REVIEW,
      insufficientHoursAction: PolicyDecisionAction.REQUIRE_REVIEW,
      automaticHalfDayEnabled: false,
    },
    shift: {
      ...lifecycle(input.shiftId),
      attendancePolicyId: input.attendancePolicyId,
      name: STAGING_E2E.shiftName,
      category: AttendanceCategory.REGULAR_EMPLOYEE,
      startTime: '09:30',
      endTime: '18:30',
      graceMinutes: 60,
      minimumWorkingMinutes: 540,
    },
    leavePolicy: {
      ...lifecycle(input.leavePolicyId),
      name: STAGING_E2E.leavePolicyName,
      financialYear: input.financialYear,
      totalPaidLeaves: 14,
      casualLeaveAllocation: 10,
      emergencyLeaveAllocation: 4,
      combinedPoolTypes: [],
      carryForwardEnabled: false,
      maxCarryForward: 0,
      holidaysExcluded: true,
      weeklyOffExcluded: true,
      firstHalfInEarliest: '09:30',
      firstHalfInLatest: '10:30',
      firstHalfRequiredPresenceMinutes: 240,
      secondHalfInEarliest: '14:00',
      secondHalfInLatest: '14:30',
      secondHalfOutTime: '18:30',
      compOffExpiryDays: 30,
    },
  };
}

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameFields(row: any, desired: any, fields: readonly string[]) {
  return fields.every((field) => sameJson(row?.[field] ?? null, desired?.[field] ?? null));
}

function dateOnly(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`);
}

function publicUser(user: any) {
  return user
    ? { id: user.id, email: user.email, name: user.name, role: user.role?.name, isHR: user.isHR }
    : null;
}

async function main() {
  console.log('── Staging Attendance E2E configuration ───────────────────────');
  console.log(`  mode            : ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
  const identity = validateStagingEnvironment(process.env);
  console.log(`  target host     : ${identity.host}`);
  console.log(`  target database : ${identity.database}`);

  const prisma = new PrismaClient();
  try {
    const tva = new TVAService(new ConfigService());
    const today = tva.companyToday();
    const effectiveFrom = dateOnly(today);
    const fy = tva.financialYear().label;
    if (fy !== OFFICIAL_HOLIDAY_FINANCIAL_YEAR) {
      throw new Error(
        `Current TVA financial year is ${fy}; the approved calendar is ${OFFICIAL_HOLIDAY_FINANCIAL_YEAR}.`,
      );
    }

    const explicitLocationId = (process.env.STAGING_E2E_ATTENDANCE_LOCATION_ID ?? '').trim();
    const targetEmails = Object.values(STAGING_E2E.users).map((u) => u.email);
    const [roles, department, targetUsers, safeCandidates, setting, calendars, locations] =
      await Promise.all([
        prisma.role.findMany({ where: { name: { in: ['EMPLOYEE', 'MANAGER', 'ADMIN'] } } }),
        prisma.department.findUnique({ where: { name: STAGING_E2E.departmentName } }),
        prisma.user.findMany({
          where: { email: { in: targetEmails } },
          include: { role: true },
        }),
        prisma.user.findMany({
          where: {
            OR: [
              { email: { endsWith: '@apex.local', mode: 'insensitive' } },
              { email: { contains: 'staging', mode: 'insensitive' } },
              { email: { contains: 'e2e', mode: 'insensitive' } },
            ],
          },
          include: { role: true },
          orderBy: { email: 'asc' },
        }),
        prisma.appSetting.findUnique({ where: { key: 'attendance_v2' } }),
        prisma.holidayCalendar.findMany({
          where: {
            financialYear: OFFICIAL_HOLIDAY_FINANCIAL_YEAR,
            name: OFFICIAL_HOLIDAY_CALENDAR_NAME,
          },
          include: { holidays: { orderBy: { date: 'asc' } } },
        }),
        prisma.attendanceLocation.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      ]);

    const conflicts: string[] = [];
    const roleByName = new Map(roles.map((r) => [r.name, r]));
    for (const name of ['EMPLOYEE', 'MANAGER', 'ADMIN']) {
      if (!roleByName.has(name)) conflicts.push(`Required role ${name} does not exist.`);
    }

    if (calendars.length !== 1) {
      conflicts.push(
        `Expected exactly one ${OFFICIAL_HOLIDAY_CALENDAR_NAME}; found ${calendars.length}.`,
      );
    }
    const calendar = calendars[0] ?? null;
    if (calendar) {
      if (calendar.status !== PolicyStatus.ACTIVE || !calendar.isActive) {
        conflicts.push('Approved HolidayCalendar is not ACTIVE.');
      }
      if (
        calendar.effectiveFrom > tva.companyDayEnd(effectiveFrom) ||
        (calendar.effectiveTo && calendar.effectiveTo < tva.companyDayStart(effectiveFrom))
      ) {
        conflicts.push('Approved HolidayCalendar is not effective on the TVA business date.');
      }
      const stored = calendar.holidays.map((h) => ({
        date: h.date.toISOString().slice(0, 10),
        name: h.name,
      }));
      if (!sameJson(stored, OFFICIAL_HOLIDAYS_2026)) {
        conflicts.push('Approved HolidayCalendar does not contain the exact 17 approved rows.');
      }
    }

    let selectedLocation: any = null;
    if (explicitLocationId) {
      selectedLocation = locations.find((l) => l.id === explicitLocationId) ?? null;
      if (!selectedLocation) {
        conflicts.push('Explicit STAGING_E2E_ATTENDANCE_LOCATION_ID is not an active location.');
      }
    }
    const geofenceEnabled = Boolean(selectedLocation);

    const ids: {
      department: string;
      employee: string;
      manager: string;
      hr: string;
      attendancePolicy: string;
      shift: string;
      weeklyOff: string;
      leavePolicy: string;
    } = {
      department: department?.id ?? randomUUID(),
      employee: targetUsers.find((u) => u.email === STAGING_E2E.users.employee.email)?.id ?? randomUUID(),
      manager: targetUsers.find((u) => u.email === STAGING_E2E.users.manager.email)?.id ?? randomUUID(),
      hr: targetUsers.find((u) => u.email === STAGING_E2E.users.hr.email)?.id ?? randomUUID(),
      attendancePolicy: randomUUID(),
      shift: randomUUID(),
      weeklyOff: randomUUID(),
      leavePolicy: randomUUID(),
    };

    const userByEmail = new Map(targetUsers.map((u) => [u.email, u]));
    const desiredUsers = {
      employee: {
        ...STAGING_E2E.users.employee,
        id: ids.employee,
        roleId: roleByName.get('EMPLOYEE')?.id,
        departmentId: ids.department,
        reportingManager: STAGING_E2E.users.manager.employeeId,
      },
      manager: {
        ...STAGING_E2E.users.manager,
        id: ids.manager,
        roleId: roleByName.get('MANAGER')?.id,
        departmentId: ids.department,
        reportingManager: null,
      },
      hr: {
        ...STAGING_E2E.users.hr,
        id: ids.hr,
        roleId: roleByName.get('ADMIN')?.id,
        departmentId: ids.department,
        reportingManager: null,
      },
    };

    for (const desired of Object.values(desiredUsers)) {
      const existing = userByEmail.get(desired.email);
      if (!existing) continue;
      const expected = {
        name: desired.name,
        employeeId: desired.employeeId,
        roleId: desired.roleId,
        departmentId: desired.departmentId,
        reportingManager: desired.reportingManager,
        isHR: desired.isHR,
        isActive: true,
      };
      if (!sameFields(existing, expected, Object.keys(expected))) {
        conflicts.push(`Existing staging user ${desired.email} conflicts with the E2E identity.`);
      }
      if (!existing.joiningDate || tva.companyBusinessDate(existing.joiningDate) > today) {
        conflicts.push(`Existing staging user ${desired.email} is not employed on ${today}.`);
      }
      if (existing.lastWorkingDate && tva.companyBusinessDate(existing.lastWorkingDate) < today) {
        conflicts.push(`Existing staging user ${desired.email} left before ${today}.`);
      }
    }

    const policyObjects = buildPolicyObjects({
      financialYear: fy,
      effectiveFrom,
      attendancePolicyId: ids.attendancePolicy,
      shiftId: ids.shift,
      leavePolicyId: ids.leavePolicy,
      managerId: ids.manager,
      hrId: ids.hr,
      geofenceEnabled,
    });
    const inForceNow = (row: { effectiveFrom: Date; effectiveTo: Date | null }) =>
      row.effectiveFrom <= tva.companyDayEnd(effectiveFrom) &&
      (!row.effectiveTo || row.effectiveTo >= tva.companyDayStart(effectiveFrom));

    const [attendanceRows, weeklyRows, leaveRows] = await Promise.all([
      prisma.attendancePolicy.findMany({ where: { status: PolicyStatus.ACTIVE } }),
      prisma.weeklyOffPolicy.findMany({ where: { isActive: true } }),
      prisma.leavePolicy.findMany({ where: { status: PolicyStatus.ACTIVE } }),
    ]);

    const attendanceFields = [
      'financialYear', 'minimumWorkingMinutes', 'permittedBreakMinutes',
      'minimumEffectiveWorkMinutes', 'lateExemptionEnabled', 'faceCaptureRequired',
      'locationCaptureRequired', 'geoFenceEnabled', 'regularizationEnabled',
      'afterPunchWindowAction', 'insufficientHoursAction', 'automaticHalfDayEnabled',
    ] as const;
    const compatibleAttendance = attendanceRows.filter((r) =>
      inForceNow(r) && sameFields(r, policyObjects.attendancePolicy, attendanceFields),
    );
    const namedAttendance = attendanceRows.find((r) => r.name === STAGING_E2E.attendancePolicyName);
    if (namedAttendance && !compatibleAttendance.some((r) => r.id === namedAttendance.id)) {
      conflicts.push('Named staging AttendancePolicy exists with different rules.');
    }
    if (compatibleAttendance.length > 1) conflicts.push('Several compatible AttendancePolicies exist.');
    const attendancePolicy = compatibleAttendance[0] ?? null;
    if (attendancePolicy) ids.attendancePolicy = attendancePolicy.id;

    const shiftDesired = { ...policyObjects.shift, attendancePolicyId: ids.attendancePolicy };
    const shiftRows = await prisma.shiftPolicy.findMany({
      where: { status: PolicyStatus.ACTIVE, attendancePolicyId: ids.attendancePolicy },
    });
    const shiftFields = [
      'attendancePolicyId', 'category', 'startTime', 'endTime', 'graceMinutes',
      'minimumWorkingMinutes',
    ] as const;
    const compatibleShifts = shiftRows.filter((r) =>
      inForceNow(r) && sameFields(r, shiftDesired, shiftFields),
    );
    const namedShift = shiftRows.find((r) => r.name === STAGING_E2E.shiftName);
    if (namedShift && !compatibleShifts.some((r) => r.id === namedShift.id)) {
      conflicts.push('Named staging ShiftPolicy exists with different rules.');
    }
    if (compatibleShifts.length > 1) conflicts.push('Several compatible ShiftPolicies exist.');
    const shift = compatibleShifts[0] ?? null;
    if (shift) ids.shift = shift.id;

    const weeklyDesired = {
      everySunday: true,
      secondSaturday: true,
      fourthSaturday: true,
    };
    const compatibleWeekly = weeklyRows.filter((r) =>
      inForceNow(r) && sameFields(r, weeklyDesired, Object.keys(weeklyDesired)),
    );
    const namedWeekly = weeklyRows.find((r) => r.name === STAGING_E2E.weeklyOffName);
    if (namedWeekly && !compatibleWeekly.some((r) => r.id === namedWeekly.id)) {
      conflicts.push('Named staging WeeklyOffPolicy exists with different rules.');
    }
    if (compatibleWeekly.length > 1) conflicts.push('Several compatible WeeklyOffPolicies exist.');
    if (weeklyRows.length > 0 && compatibleWeekly.length === 0) {
      conflicts.push('An active WeeklyOffPolicy exists with different rules; refusing a second default.');
    }
    const weeklyOff = compatibleWeekly[0] ?? null;
    if (weeklyOff) ids.weeklyOff = weeklyOff.id;

    const leaveFields = [
      'financialYear', 'totalPaidLeaves', 'casualLeaveAllocation',
      'emergencyLeaveAllocation', 'combinedPoolTypes', 'carryForwardEnabled',
      'maxCarryForward', 'holidaysExcluded', 'weeklyOffExcluded',
      'firstHalfInEarliest', 'firstHalfInLatest', 'firstHalfRequiredPresenceMinutes',
      'secondHalfInEarliest', 'secondHalfInLatest', 'secondHalfOutTime',
      'compOffExpiryDays',
    ] as const;
    const compatibleLeave = leaveRows.filter((r) =>
      inForceNow(r) && sameFields(r, policyObjects.leavePolicy, leaveFields),
    );
    const namedLeave = leaveRows.find((r) => r.name === STAGING_E2E.leavePolicyName);
    if (namedLeave && !compatibleLeave.some((r) => r.id === namedLeave.id)) {
      conflicts.push('Named staging LeavePolicy exists with different rules.');
    }
    if (compatibleLeave.length > 1) conflicts.push('Several compatible LeavePolicies exist.');
    const leavePolicy = compatibleLeave[0] ?? null;
    if (leavePolicy) ids.leavePolicy = leavePolicy.id;

    const currentSetting = (setting?.value as Record<string, unknown> | null) ?? null;
    let settingAction: 'CREATE' | 'UPDATE_SAFE_DEFAULTS' | 'REUSE' = 'CREATE';
    let nextSetting: Record<string, unknown> = { ...STAGING_ATTENDANCE_V2 };
    if (currentSetting) {
      const alreadyDesired = Object.entries(STAGING_ATTENDANCE_V2).every(
        ([key, value]) => (currentSetting[key] ?? (ATTENDANCE_V2_DEFAULTS as any)[key]) === value,
      );
      if (alreadyDesired) {
        settingAction = 'REUSE';
        nextSetting = currentSetting;
      } else {
        const safeDefaults = Object.keys(STAGING_ATTENDANCE_V2).every(
          (key) =>
            (currentSetting[key] ?? (ATTENDANCE_V2_DEFAULTS as any)[key]) ===
            (ATTENDANCE_V2_DEFAULTS as any)[key],
        );
        if (!safeDefaults) {
          conflicts.push('attendance_v2 contains non-default values that conflict with the E2E plan.');
        } else {
          settingAction = 'UPDATE_SAFE_DEFAULTS';
          nextSetting = { ...currentSetting, ...STAGING_ATTENDANCE_V2 };
        }
      }
    }

    const targetIds = [ids.employee, ids.manager, ids.hr];
    const [profiles, managerAccess] = await Promise.all([
      prisma.employeeAttendanceProfile.findMany({ where: { userId: { in: targetIds } } }),
      prisma.managerDeptAccess.findUnique({
        where: { managerId_departmentId: { managerId: ids.manager, departmentId: ids.department } },
      }),
    ]);
    if (managerAccess && managerAccess.accessLevel !== 'FULL') {
      conflicts.push('Existing manager department access is not FULL.');
    }

    const profileBase = {
      attendanceRequired: true,
      assignedShiftId: ids.shift,
      assignedLeavePolicyId: ids.leavePolicy,
      assignedHolidayCalendarId: calendar?.id ?? null,
      assignedWeeklyOffPolicyId: ids.weeklyOff,
      assignedAttendanceLocationId: selectedLocation?.id ?? null,
      effectiveFrom,
      effectiveTo: null,
      updatedById: ids.hr,
    };
    const desiredProfiles = [
      {
        ...profileBase,
        id: randomUUID(),
        userId: ids.employee,
        category: AttendanceCategory.REGULAR_EMPLOYEE,
        reportingManagerId: ids.manager,
        hrReviewerId: ids.hr,
      },
      {
        ...profileBase,
        id: randomUUID(),
        userId: ids.manager,
        category: AttendanceCategory.MANAGEMENT_EXEMPT,
        attendanceRequired: false,
        assignedLeavePolicyId: null,
        reportingManagerId: null,
        hrReviewerId: ids.hr,
      },
      {
        ...profileBase,
        id: randomUUID(),
        userId: ids.hr,
        category: AttendanceCategory.MANAGEMENT_EXEMPT,
        attendanceRequired: false,
        assignedLeavePolicyId: null,
        reportingManagerId: null,
        hrReviewerId: ids.hr,
      },
    ];
    const profileFields = [
      'userId', 'category', 'attendanceRequired', 'assignedShiftId', 'assignedLeavePolicyId',
      'assignedHolidayCalendarId', 'assignedWeeklyOffPolicyId', 'assignedAttendanceLocationId',
      'reportingManagerId', 'hrReviewerId', 'effectiveTo',
    ] as const;
    const profilesToCreate: typeof desiredProfiles = [];
    for (const desired of desiredProfiles) {
      const futureOrOpen = profiles.filter(
        (p) => p.userId === desired.userId && (!p.effectiveTo || p.effectiveTo >= effectiveFrom),
      );
      if (futureOrOpen.length === 0) {
        profilesToCreate.push(desired);
      } else if (
        futureOrOpen.length !== 1 ||
        !sameFields(futureOrOpen[0], desired, profileFields)
      ) {
        conflicts.push(`Attendance profile conflicts for user ${desired.userId}.`);
      }
    }

    console.log(`\n  TVA date/FY     : ${today} / ${fy}`);
    console.log('\n  existing staging-safe test users discovered:');
    if (safeCandidates.length === 0) console.log('    none');
    for (const user of safeCandidates) console.log(`    ${JSON.stringify(publicUser(user))}`);
    console.log('\n  target hierarchy:');
    console.log(`    Employee ${desiredUsers.employee.email} -> Manager ${desiredUsers.manager.email} -> HR/Admin ${desiredUsers.hr.email}`);
    console.log(`    department: ${STAGING_E2E.departmentName} (${department ? `reuse ${department.id}` : 'create'})`);
    console.log(`    manager access: FULL (${managerAccess ? 'reuse' : 'create'})`);
    console.log('\n  HolidayCalendar reused:');
    console.log(`    ${calendar?.id ?? 'BLOCKED'} — ${OFFICIAL_HOLIDAY_CALENDAR_NAME} — ${calendar?.holidays.length ?? 0} rows`);
    console.log('\n  attendance locations:');
    console.log(`    active: ${locations.length}`);
    for (const location of locations) console.log(`    ${location.id} — ${location.name}`);
    console.log(`    selected: ${selectedLocation?.id ?? 'none'}`);
    console.log(`    geofence safely enabled: ${geofenceEnabled ? 'YES (explicit location)' : 'NO'}`);
    console.log('    GPS capture required: YES (PE-2, independent of geofence enforcement)');
    console.log('\n  policy/config plan:');
    console.log(`    AttendancePolicy: ${attendancePolicy ? `REUSE ${attendancePolicy.id}` : `CREATE ${JSON.stringify({ ...policyObjects.attendancePolicy, id: '<generated>', policyKey: '<same generated id>' })}`}`);
    console.log(`    ShiftPolicy: ${shift ? `REUSE ${shift.id}` : `CREATE ${JSON.stringify({ ...shiftDesired, id: '<generated>', policyKey: '<same generated id>' })}`}`);
    console.log(`    WeeklyOffPolicy: ${weeklyOff ? `REUSE ${weeklyOff.id}` : `CREATE ${JSON.stringify({ id: '<generated>', name: STAGING_E2E.weeklyOffName, ...weeklyDesired, isActive: true, effectiveFrom })}`}`);
    console.log(`    LeavePolicy: ${leavePolicy ? `REUSE ${leavePolicy.id}` : `CREATE ${JSON.stringify({ ...policyObjects.leavePolicy, id: '<generated>', policyKey: '<same generated id>' })}`}`);
    console.log(`    Comp Off auto-grant: OFF — ${MANAGEMENT_POLICY_GAPS.compOffAutomaticGrant}`);
    console.log(`    attendance_v2: ${settingAction} ${JSON.stringify(STAGING_ATTENDANCE_V2)}`);
    console.log(`    EmployeeAttendanceProfile: ${profilesToCreate.length} create, ${3 - profilesToCreate.length} reuse`);
    console.log('\n  conflicts/blockers:');
    if (conflicts.length === 0) console.log('    none');
    for (const conflict of conflicts) console.log(`    BLOCKER: ${conflict}`);

    if (conflicts.length > 0) throw new Error(`${conflicts.length} conflict(s); refusing all writes.`);
    if (!APPLY) {
      console.log('\nDRY RUN COMPLETE. Nothing was written.');
      return;
    }

    const newUserKeys = (Object.keys(desiredUsers) as Array<keyof typeof desiredUsers>).filter(
      (key) => !userByEmail.has(desiredUsers[key].email),
    );
    const passwordEnv = {
      employee: 'STAGING_E2E_EMPLOYEE_PASSWORD',
      manager: 'STAGING_E2E_MANAGER_PASSWORD',
      hr: 'STAGING_E2E_HR_PASSWORD',
    } as const;
    const passwordHashes = new Map<string, string>();
    for (const key of newUserKeys) {
      const password = process.env[passwordEnv[key]] ?? '';
      if (password.length < 12) {
        throw new Error(`${passwordEnv[key]} must be supplied with at least 12 characters.`);
      }
      passwordHashes.set(key, await bcrypt.hash(password, 10));
    }

    const operations: Prisma.PrismaPromise<unknown>[] = [];
    if (!department) {
      operations.push(prisma.department.create({ data: { id: ids.department, name: STAGING_E2E.departmentName } }));
    }
    for (const key of newUserKeys) {
      const user = desiredUsers[key];
      operations.push(prisma.user.create({
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          password: passwordHashes.get(key)!,
          roleId: user.roleId!,
          departmentId: user.departmentId,
          employeeId: user.employeeId,
          reportingManager: user.reportingManager,
          isHR: user.isHR,
          isActive: true,
          mustChangePassword: false,
          joiningDate: effectiveFrom,
        },
      }));
    }
    if (!attendancePolicy) {
      operations.push(prisma.attendancePolicy.create({
        data: { ...policyObjects.attendancePolicy, id: ids.attendancePolicy, policyKey: ids.attendancePolicy },
      }));
    }
    if (!shift) {
      operations.push(prisma.shiftPolicy.create({
        data: { ...shiftDesired, id: ids.shift, policyKey: ids.shift, attendancePolicyId: ids.attendancePolicy },
      }));
    }
    if (!weeklyOff) {
      operations.push(prisma.weeklyOffPolicy.create({
        data: {
          id: ids.weeklyOff,
          name: STAGING_E2E.weeklyOffName,
          ...weeklyDesired,
          isActive: true,
          effectiveFrom,
        },
      }));
    }
    if (!leavePolicy) {
      operations.push(prisma.leavePolicy.create({
        data: {
          ...policyObjects.leavePolicy,
          id: ids.leavePolicy,
          policyKey: ids.leavePolicy,
        },
      }));
    }
    if (!managerAccess) {
      operations.push(prisma.managerDeptAccess.create({
        data: { managerId: ids.manager, departmentId: ids.department, accessLevel: 'FULL' },
      }));
    }
    for (const profile of profilesToCreate) {
      operations.push(prisma.employeeAttendanceProfile.create({ data: profile }));
    }
    if (settingAction === 'CREATE') {
      operations.push(prisma.appSetting.create({
        data: { key: 'attendance_v2', value: nextSetting as Prisma.InputJsonValue, updatedBy: ids.hr },
      }));
    } else if (settingAction === 'UPDATE_SAFE_DEFAULTS') {
      operations.push(prisma.appSetting.update({
        where: { key: 'attendance_v2' },
        data: { value: nextSetting as Prisma.InputJsonValue, updatedBy: ids.hr },
      }));
    }

    await prisma.$transaction(operations);
    console.log(`\nAPPLY COMPLETE. ${operations.length} atomic operation(s) committed.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nBOOTSTRAP ABORTED: ${error?.message ?? error}\n`);
    process.exit(1);
  });
}
