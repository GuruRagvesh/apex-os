/**
 * Targeted repair for the six explicitly approved attendance-onboarding cases.
 *
 * Dry run (default):
 *   npx ts-node --transpile-only scripts/repair-production-attendance-six.ts
 *
 * Apply (requires the additional confirmation phrase below):
 *   npx ts-node --transpile-only scripts/repair-production-attendance-six.ts --apply
 *
 * Required environment:
 *   APP_ENV=production
 *   DATABASE_URL
 *   EXPECTED_PRODUCTION_DB_HOST
 *   EXPECTED_PRODUCTION_DB_NAME
 *   ATTENDANCE_REPAIR_TARGETS_JSON
 *   ATTENDANCE_REPAIR_TEMPLATE_USER_ID
 *   ATTENDANCE_REPAIR_ACTOR_ID
 *
 * ATTENDANCE_REPAIR_TARGETS_JSON is an array of exactly six objects:
 *   { "caseKey": "sherin", "id": "...", "email": "...", "joiningDate": "yyyy-MM-dd" }
 *
 * The tool never searches by display name and never discovers extra targets.
 * It reuses policy assignments from one separately approved, currently covered
 * employee. It creates no policies and updates no existing attendance profile.
 */

import { AttendanceCategory, PolicyStatus, Prisma, PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const APPLY_CONFIRMATION = 'REPAIR_EXACTLY_SIX_ATTENDANCE_USERS';
const EXPECTED_CASE_KEYS = new Set([
  'sherin',
  'dhruv',
  'vivek',
  'shruti',
  'tejas-goswami',
  'kanishk',
]);

export type RepairTarget = {
  caseKey: string;
  id: string;
  email: string;
  joiningDate: string;
};

type RepairEnvironment = Pick<
  NodeJS.ProcessEnv,
  | 'APP_ENV'
  | 'DATABASE_URL'
  | 'EXPECTED_PRODUCTION_DB_HOST'
  | 'EXPECTED_PRODUCTION_DB_NAME'
  | 'ATTENDANCE_REPAIR_TARGETS_JSON'
  | 'ATTENDANCE_REPAIR_TEMPLATE_USER_ID'
  | 'ATTENDANCE_REPAIR_ACTOR_ID'
  | 'ATTENDANCE_REPAIR_CONFIRM'
>;

type ProductionIdentityEnvironment = {
  APP_ENV?: string;
  DATABASE_URL?: string;
  EXPECTED_PRODUCTION_DB_HOST?: string;
  EXPECTED_PRODUCTION_DB_NAME?: string;
};

function abort(reason: string): never {
  throw new Error(`ATTENDANCE REPAIR ABORTED: ${reason}`);
}

function dateOnly(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    abort(`${label} must be a yyyy-MM-dd date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    abort(`${label} is not a real calendar date`);
  }
  return parsed;
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

export function maskEmail(value: string) {
  const [local, domain] = value.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}

export function parseRepairTargets(raw: string | undefined): RepairTarget[] {
  if (!raw) abort('ATTENDANCE_REPAIR_TARGETS_JSON is required');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    abort('ATTENDANCE_REPAIR_TARGETS_JSON is not valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length !== 6) {
    abort('ATTENDANCE_REPAIR_TARGETS_JSON must contain exactly six targets');
  }

  const targets = parsed.map((row, index) => {
    if (!row || typeof row !== 'object') abort(`target ${index + 1} must be an object`);
    const value = row as Record<string, unknown>;
    const target = {
      caseKey: String(value.caseKey ?? '').trim().toLowerCase(),
      id: String(value.id ?? '').trim(),
      email: normalizedEmail(String(value.email ?? '')),
      joiningDate: String(value.joiningDate ?? '').trim(),
    };
    if (!target.caseKey || !target.id || !target.email) {
      abort(`target ${index + 1} is missing caseKey, id, or email`);
    }
    dateOnly(target.joiningDate, `${target.caseKey}.joiningDate`);
    return target;
  });

  const keys = new Set(targets.map((target) => target.caseKey));
  if (keys.size !== EXPECTED_CASE_KEYS.size || [...EXPECTED_CASE_KEYS].some((key) => !keys.has(key))) {
    abort('target case keys must be exactly sherin, dhruv, vivek, shruti, tejas-goswami, and kanishk');
  }
  if (new Set(targets.map((target) => target.id)).size !== targets.length) {
    abort('target user ids must be unique');
  }
  if (new Set(targets.map((target) => target.email)).size !== targets.length) {
    abort('target emails must be unique');
  }
  return targets;
}

export function assertProductionIdentity(env: ProductionIdentityEnvironment) {
  if ((env.APP_ENV ?? '').toLowerCase() !== 'production') {
    abort('APP_ENV must be production');
  }
  if (!env.DATABASE_URL) abort('DATABASE_URL is required');
  if (!env.EXPECTED_PRODUCTION_DB_HOST || !env.EXPECTED_PRODUCTION_DB_NAME) {
    abort('independently verified production host and database name are required');
  }

  let target: URL;
  try {
    target = new URL(env.DATABASE_URL);
  } catch {
    abort('DATABASE_URL could not be parsed');
  }
  const databaseName = target.pathname.replace(/^\//, '').split('?')[0];
  if (target.hostname !== env.EXPECTED_PRODUCTION_DB_HOST.trim()) {
    abort('database host does not match EXPECTED_PRODUCTION_DB_HOST');
  }
  if (databaseName !== env.EXPECTED_PRODUCTION_DB_NAME.trim()) {
    abort('database name does not match EXPECTED_PRODUCTION_DB_NAME');
  }
  if (/localhost|127\.0\.0\.1|::1|staging/i.test(`${target.hostname}/${databaseName}`)) {
    abort('target looks local or non-production');
  }
}

function sameBusinessDate(value: Date, expected: string) {
  return value.toISOString().slice(0, 10) === expected;
}

function indiaBusinessDate(now = new Date()) {
  const india = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return new Date(`${india.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function isInForce(
  row: { effectiveFrom: Date; effectiveTo: Date | null },
  businessDate: Date,
) {
  return (
    row.effectiveFrom.getTime() <= businessDate.getTime() &&
    (!row.effectiveTo || row.effectiveTo.getTime() >= businessDate.getTime())
  );
}

async function main() {
  const env = process.env as RepairEnvironment;
  assertProductionIdentity(env);
  const targets = parseRepairTargets(env.ATTENDANCE_REPAIR_TARGETS_JSON);
  const templateUserId = (env.ATTENDANCE_REPAIR_TEMPLATE_USER_ID ?? '').trim();
  const actorId = (env.ATTENDANCE_REPAIR_ACTOR_ID ?? '').trim();
  if (!templateUserId) abort('ATTENDANCE_REPAIR_TEMPLATE_USER_ID is required');
  if (!actorId) abort('ATTENDANCE_REPAIR_ACTOR_ID is required');
  if (targets.some((target) => target.id === templateUserId)) {
    abort('the working template user cannot also be a repair target');
  }
  if (APPLY && env.ATTENDANCE_REPAIR_CONFIRM !== APPLY_CONFIRMATION) {
    abort(`--apply requires ATTENDANCE_REPAIR_CONFIRM=${APPLY_CONFIRMATION}`);
  }

  const prisma = new PrismaClient();
  try {
    const [actor, templateUser, users] = await Promise.all([
      prisma.user.findFirst({
        where: { id: actorId, isActive: true, role: { name: { in: ['ADMIN', 'SUPER_ADMIN'] } } },
        select: { id: true },
      }),
      prisma.user.findUnique({
        where: { id: templateUserId },
        select: {
          id: true,
          isActive: true,
          attendanceProfiles: {
            where: { effectiveTo: null },
            orderBy: { effectiveFrom: 'desc' },
          },
        },
      }),
      prisma.user.findMany({
        where: { id: { in: targets.map((target) => target.id) } },
        select: {
          id: true,
          email: true,
          name: true,
          isActive: true,
          joiningDate: true,
          attendanceProfiles: { select: { id: true } },
        },
      }),
    ]);

    if (!actor) abort('repair actor is not an active Admin or Super Admin');
    if (!templateUser?.isActive) abort('template user does not exist or is inactive');
    if (templateUser.attendanceProfiles.length !== 1) {
      abort('template user must have exactly one open attendance profile');
    }
    const template = templateUser.attendanceProfiles[0];
    if (template.category !== AttendanceCategory.REGULAR_EMPLOYEE || !template.attendanceRequired) {
      abort('template user is not a covered regular employee');
    }
    if (
      !template.assignedShiftId ||
      !template.assignedLeavePolicyId ||
      !template.assignedHolidayCalendarId ||
      !template.assignedWeeklyOffPolicyId
    ) {
      abort('template attendance profile is missing a required policy assignment');
    }

    const [shift, leavePolicy, calendar, weeklyOff, location] = await Promise.all([
      prisma.shiftPolicy.findUnique({
        where: { id: template.assignedShiftId },
        include: { attendancePolicy: true },
      }),
      prisma.leavePolicy.findUnique({ where: { id: template.assignedLeavePolicyId } }),
      prisma.holidayCalendar.findUnique({ where: { id: template.assignedHolidayCalendarId } }),
      prisma.weeklyOffPolicy.findUnique({ where: { id: template.assignedWeeklyOffPolicyId } }),
      template.assignedAttendanceLocationId
        ? prisma.attendanceLocation.findUnique({ where: { id: template.assignedAttendanceLocationId } })
        : Promise.resolve(null),
    ]);
    if (!shift || shift.status !== PolicyStatus.ACTIVE || !shift.isActive) abort('template shift is not active');
    if (
      !shift.attendancePolicy ||
      shift.attendancePolicy.status !== PolicyStatus.ACTIVE ||
      !shift.attendancePolicy.isActive
    ) {
      abort('template attendance policy is not active');
    }
    if (!leavePolicy || leavePolicy.status !== PolicyStatus.ACTIVE || !leavePolicy.isActive) {
      abort('template leave policy is not active');
    }
    if (!calendar || calendar.status !== PolicyStatus.ACTIVE || !calendar.isActive) {
      abort('template holiday calendar is not active');
    }
    if (!weeklyOff?.isActive) abort('template weekly-off policy is not active');
    if (shift.attendancePolicy.geoFenceEnabled && !location?.isActive) {
      abort('geofencing is enabled but the template attendance location is missing or inactive');
    }

    const today = indiaBusinessDate();
    for (const [label, policy] of [
      ['shift', shift],
      ['attendance policy', shift.attendancePolicy],
      ['leave policy', leavePolicy],
      ['holiday calendar', calendar],
      ['weekly-off policy', weeklyOff],
    ] as const) {
      if (!isInForce(policy, today)) abort(`template ${label} is not in force today`);
    }

    if (users.length !== targets.length) abort(`expected six target users but found ${users.length}`);
    const userById = new Map(users.map((user) => [user.id, user]));
    for (const target of targets) {
      const user = userById.get(target.id);
      if (!user) abort(`${target.caseKey} id did not match a user`);
      if (normalizedEmail(user.email) !== target.email) abort(`${target.caseKey} email did not match`);
      if (!user.isActive) abort(`${target.caseKey} is not active`);
      if (user.attendanceProfiles.length !== 0) {
        abort(`${target.caseKey} already has an attendance profile; refusing to overwrite it`);
      }
      if (user.joiningDate && !sameBusinessDate(user.joiningDate, target.joiningDate)) {
        abort(`${target.caseKey} already has a different joining date; refusing to overwrite it`);
      }
      const joining = dateOnly(target.joiningDate, `${target.caseKey}.joiningDate`);
      if (joining.getTime() > today.getTime()) {
        abort(`${target.caseKey} joining date is in the future`);
      }
      for (const [label, policy] of [
        ['shift', shift],
        ['attendance policy', shift.attendancePolicy],
        ['leave policy', leavePolicy],
        ['holiday calendar', calendar],
        ['weekly-off policy', weeklyOff],
      ] as const) {
        if (!isInForce(policy, joining)) {
          abort(`${target.caseKey} joining date is outside the approved ${label} window`);
        }
      }
      console.log(
        `${target.caseKey.padEnd(16)} ${maskEmail(user.email).padEnd(34)} ` +
          `${user.joiningDate ? 'preserve joining date' : 'set joining date'}; create profile`,
      );
    }

    if (!APPLY) {
      console.log('\nDRY RUN COMPLETE. Exactly six targets validated. No data was written.');
      return;
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM "users"
          WHERE id IN (${Prisma.join(targets.map((target) => target.id))})
          ORDER BY id
          FOR UPDATE
        `;

        const locked = await tx.user.findMany({
          where: { id: { in: targets.map((target) => target.id) } },
          select: {
            id: true,
            email: true,
            isActive: true,
            joiningDate: true,
            attendanceProfiles: { select: { id: true } },
          },
        });
        if (locked.length !== 6) abort('target set changed after locking');
        const lockedById = new Map(locked.map((user) => [user.id, user]));

        for (const target of targets) {
          const user = lockedById.get(target.id);
          if (
            !user ||
            !user.isActive ||
            normalizedEmail(user.email) !== target.email ||
            user.attendanceProfiles.length !== 0 ||
            (user.joiningDate && !sameBusinessDate(user.joiningDate, target.joiningDate))
          ) {
            abort(`${target.caseKey} changed after preflight; transaction will roll back`);
          }
          const joiningDate = dateOnly(target.joiningDate, `${target.caseKey}.joiningDate`);
          if (!user.joiningDate) {
            await tx.user.update({ where: { id: user.id }, data: { joiningDate } });
          }
          await tx.employeeAttendanceProfile.create({
            data: {
              userId: user.id,
              category: AttendanceCategory.REGULAR_EMPLOYEE,
              attendanceRequired: true,
              assignedShiftId: template.assignedShiftId,
              assignedLeavePolicyId: template.assignedLeavePolicyId,
              assignedHolidayCalendarId: template.assignedHolidayCalendarId,
              assignedWeeklyOffPolicyId: template.assignedWeeklyOffPolicyId,
              assignedAttendanceLocationId: template.assignedAttendanceLocationId,
              effectiveFrom: joiningDate,
              effectiveTo: null,
              updatedById: actor.id,
            },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    console.log('\nAPPLY COMPLETE. Exactly six users were repaired in one transaction.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  });
}
