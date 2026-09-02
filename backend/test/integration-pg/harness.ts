/**
 * The PostgreSQL-backed test harness.
 *
 * Everything here is REAL except two things that reach outside the process:
 * the object vault (R2) and any mail transport. The Prisma client is real, the
 * NestJS injector is real, the attendance evaluator is real, and the advisory
 * locks are taken in a real PostgreSQL server. That is the entire point of
 * these suites -- the doubles used up to Phase 5C proved the code agreed with
 * itself, which is a different claim from the database agreeing with it.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { CommonModule } from '../../src/common/common.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AttendanceImportModule } from '../../src/modules/platform/attendance/import/attendance-import.module';
import { AttendanceImportService } from '../../src/modules/platform/attendance/import/attendance-import.service';
import { AttendanceImportApplyService } from '../../src/modules/platform/attendance/import/attendance-import-apply.service';
import { DailyAttendanceEvaluatorService } from '../../src/modules/platform/attendance/evaluation/daily-attendance-evaluator.service';
import { BackupVaultService } from '../../src/modules/platform/backup-vault/backup-vault.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';

/**
 * The vault double.
 *
 * Substituted rather than exercised because it is the one dependency that
 * leaves the machine. It still records what it was asked to store, so a test
 * can assert the object key was built from the batch id and not from a
 * user-controlled filename.
 */
export class RecordingVault {
  readonly archived: Array<{ key: string; bytes: number; contentType: string }> = [];

  async archiveToVault(key: string, buffer: Buffer, contentType: string) {
    this.archived.push({ key, bytes: buffer.byteLength, contentType });
    return { key, etag: 'test-etag', size: buffer.byteLength };
  }

  async presignedUrl() {
    return 'https://vault.invalid/not-a-real-object';
  }
}

export interface Harness {
  moduleRef: TestingModule;
  prisma: PrismaService;
  imports: AttendanceImportService;
  apply: AttendanceImportApplyService;
  evaluator: DailyAttendanceEvaluatorService;
  vault: RecordingVault;
  identity: Record<string, string>;
  close: () => Promise<void>;
}

export async function buildHarness(): Promise<Harness> {
  // Gate one: the connection string. Before Prisma is even constructed.
  assertIsolatedDatabase();

  const vault = new RecordingVault();

  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), CommonModule, AttendanceImportModule],
  })
    .overrideProvider(BackupVaultService)
    .useValue(vault)
    .compile();

  const prisma = moduleRef.get(PrismaService);
  await prisma.$connect();

  // Gate two: ask the server who it is. A URL states an intention; only the
  // server states a fact.
  const identity = await assertServerIdentity(prisma as any);

  return {
    moduleRef,
    prisma,
    imports: moduleRef.get(AttendanceImportService),
    apply: moduleRef.get(AttendanceImportApplyService),
    evaluator: moduleRef.get(DailyAttendanceEvaluatorService),
    vault,
    identity,
    close: async () => {
      await prisma.$disconnect();
      await moduleRef.close();
    },
  };
}

/**
 * A second, independent connection.
 *
 * Required for the lock proofs: two transactions on ONE pooled connection
 * cannot contend, so a contention test written against a single client proves
 * nothing at all.
 */
export function rawClient(): PrismaClient {
  assertIsolatedDatabase();
  return new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
}

// ── Fixtures ────────────────────────────────────────────────────────────────

export const FY = '2026-2027';
/** A Friday, mid-month, deliberately not near a boundary. */
export const DATE = '2026-08-14';
export const MONTH = '2026-08';

const t = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00.000Z`);

/**
 * Wipes every table these suites touch, in dependency order.
 *
 * Guarded by the same identity check as everything else: a truncate is the
 * one operation where being wrong about the database is unrecoverable.
 */
export async function resetFixtures(prisma: PrismaService) {
  await assertServerIdentity(prisma as any);
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      attendance_import_rows,
      attendance_import_batches,
      attendance_regularizations,
      daily_attendance,
      attendance_month_closes,
      leave_requests,
      employee_attendance_profiles,
      shift_policies,
      leave_policies,
      attendance_policies,
      weekly_off_policies,
      holidays,
      holiday_calendars,
      operational_events,
      users,
      roles
    RESTART IDENTITY CASCADE
  `);
}

export interface SeededEmployee {
  id: string;
  employeeId: string;
  name: string;
}

export interface Seed {
  actors: { operator: any; hr: any; admin: any };
  employees: Record<string, SeededEmployee>;
  holidayCalendarId: string;
  weeklyOffPolicyId: string;
  shiftPolicyId: string;
  attendancePolicyId: string;
  leavePolicyId: string;
}

/**
 * Builds a complete, synthetic company.
 *
 * Nothing here is copied from production. Names are obviously fictional and
 * the employee ids are outside any real series, so a row that somehow escaped
 * into a real system would be recognisable on sight rather than plausible.
 */
export async function seedCompany(prisma: PrismaService): Promise<Seed> {
  await resetFixtures(prisma);

  const roles = [
    { id: 'r-super', name: 'SUPER_ADMIN', level: 0 },
    { id: 'r-admin', name: 'ADMIN', level: 1 },
    { id: 'r-manager', name: 'MANAGER', level: 2 },
    { id: 'r-lead', name: 'TEAM_LEAD', level: 3 },
    { id: 'r-employee', name: 'EMPLOYEE', level: 4 },
    { id: 'r-intern', name: 'INTERN', level: 5 },
  ];
  await prisma.role.createMany({ data: roles });

  const attendancePolicy = await prisma.attendancePolicy.create({
    data: {
      policyKey: 'ATT-DEFAULT',
      version: 1,
      status: 'ACTIVE',
      effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
      financialYear: FY,
      name: 'Integration Attendance Policy',
      isActive: true,
      minimumWorkingMinutes: 540,
      regularizationEnabled: true,
    } as any,
  });

  const shift = await prisma.shiftPolicy.create({
    data: {
      policyKey: 'SHIFT-GENERAL',
      version: 1,
      status: 'ACTIVE',
      effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
      attendancePolicyId: attendancePolicy.id,
      name: 'General Shift',
      category: 'REGULAR_EMPLOYEE',
      startTime: '09:30',
      endTime: '18:30',
    } as any,
  });

  const weeklyOff = await prisma.weeklyOffPolicy.create({
    data: {
      name: 'Integration Weekly Off',
      isActive: true,
      everySunday: true,
      secondSaturday: true,
      fourthSaturday: true,
      effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    } as any,
  });

  const calendar = await prisma.holidayCalendar.create({
    data: {
      policyKey: 'CAL-DEFAULT',
      version: 1,
      status: 'ACTIVE',
      effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
      financialYear: FY,
      name: 'Integration Holiday Calendar',
      isActive: true,
    } as any,
  });

  const leavePolicy = await prisma.leavePolicy.create({
    data: {
      policyKey: 'LEAVE-DEFAULT',
      version: 1,
      status: 'ACTIVE',
      effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
      financialYear: FY,
      name: 'Integration Leave Policy',
      isActive: true,
    } as any,
  });

  const mkUser = async (
    id: string,
    employeeId: string | null,
    name: string,
    roleId: string,
    extra: Record<string, any> = {},
  ) => {
    await prisma.user.create({
      data: {
        id,
        employeeId,
        email: `${id}@integration.invalid`,
        name,
        password: 'not-a-real-hash',
        roleId,
        joiningDate: new Date('2026-04-01T00:00:00.000Z'),
        ...extra,
      } as any,
    });
    return { id, employeeId: employeeId ?? '', name };
  };

  // Actors. Three distinct people, because maker/checker is only meaningful
  // when the maker and the checker are genuinely different rows.
  const operator = await mkUser('u-operator', 'TE-900', 'Ops Operator', 'r-manager', {
    isAttendanceDataOperator: true,
  });
  const hr = await mkUser('u-hr', 'TE-901', 'HR Checker', 'r-manager', { isHR: true });
  const admin = await mkUser('u-admin', 'TE-902', 'Admin Applier', 'r-admin', {});

  const employees: Record<string, SeededEmployee> = {};
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  for (let i = 0; i < letters.length; i++) {
    const letter = letters[i];
    employees[letter] = await mkUser(
      `u-emp-${letter.toLowerCase()}`,
      `TE-01${i}`,
      `Employee ${letter}`,
      'r-employee',
    );
  }

  // Everyone who can appear on a register needs a profile, or the evaluator
  // reports UNRESOLVED rather than an attendance answer.
  const everyone = [operator, hr, admin, ...Object.values(employees)];
  await prisma.employeeAttendanceProfile.createMany({
    data: everyone.map((u) => ({
      userId: u.id,
      category: 'REGULAR_EMPLOYEE' as any,
      attendanceRequired: true,
      effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
      assignedShiftId: shift.id,
      assignedHolidayCalendarId: calendar.id,
      assignedWeeklyOffPolicyId: weeklyOff.id,
      assignedLeavePolicyId: leavePolicy.id,
    })) as any,
  });

  return {
    actors: {
      operator: { id: operator.id, role: { name: 'MANAGER' }, isAttendanceDataOperator: true },
      hr: { id: hr.id, role: { name: 'MANAGER' }, isHR: true },
      admin: { id: admin.id, role: { name: 'ADMIN' } },
    },
    employees,
    holidayCalendarId: calendar.id,
    weeklyOffPolicyId: weeklyOff.id,
    shiftPolicyId: shift.id,
    attendancePolicyId: attendancePolicy.id,
    leavePolicyId: leavePolicy.id,
  };
}

/**
 * A captured attendance day, with the evidence that produced it.
 *
 * The punch evidence is not decoration. DailyAttendance is DERIVED: the
 * evaluator rebuilds the day from punch evidence, work sessions and any
 * approved correction, and never reads the previous row's punch times. A
 * fixture that wrote only the derived row would therefore describe a day that
 * cannot exist -- and a punch-out-only correction against it would appear to
 * erase the punch in, because there was never anything behind it.
 *
 * No latitude, photo or device metadata: this is a synthetic fixture, and
 * inventing capture evidence is exactly what the design forbids.
 */
export async function givenAttendance(
  prisma: PrismaService,
  userId: string,
  date: string,
  fields: Record<string, any> = {},
) {
  const punchIn = fields.punchInAt === undefined ? t(date, '04:05') : fields.punchInAt;
  const punchOut = fields.punchOutAt === undefined ? t(date, '13:10') : fields.punchOutAt;
  const businessDate = new Date(`${date}T00:00:00.000Z`);

  const evidence = async (type: 'PUNCH_IN' | 'PUNCH_OUT', at: Date | null) => {
    if (!at) return null;
    const row = await prisma.attendancePunchEvidence.create({
      data: {
        userId,
        type: type as any,
        businessDate,
        serverOccurredAt: at,
        idempotencyKey: `fixture-${userId}-${date}-${type}`,
      } as any,
    });
    return row.id;
  };

  const punchInEvidenceId = fields.punchInEvidenceId ?? (await evidence('PUNCH_IN', punchIn));
  const punchOutEvidenceId = fields.punchOutEvidenceId ?? (await evidence('PUNCH_OUT', punchOut));

  return prisma.dailyAttendance.create({
    data: {
      userId,
      date: businessDate,
      status: 'PRESENT',
      evaluationState: 'CALCULATED',
      revision: 1,
      ...fields,
      punchInAt: punchIn,
      punchOutAt: punchOut,
      punchInEvidenceId,
      punchOutEvidenceId,
      sourceFingerprint: fields.sourceFingerprint ?? `fp-${userId}-${date}-1`,
    } as any,
  });
}

/** Fully approved leave -- the only kind attendance is allowed to believe. */
export async function givenApprovedLeave(
  prisma: PrismaService,
  userId: string,
  from: string,
  to: string,
  type = 'CASUAL',
) {
  return prisma.leaveRequest.create({
    data: {
      userId,
      type: type as any,
      status: 'APPROVED',
      approvalStage: 'COMPLETE',
      startDate: new Date(`${from}T00:00:00.000Z`),
      endDate: new Date(`${to}T23:59:59.000Z`),
      reason: 'Integration fixture leave',
    } as any,
  });
}

// ── Import files ────────────────────────────────────────────────────────────

export interface FileRow {
  employeeId: string;
  name?: string;
  date: string;
  status: string;
  punchIn?: string;
  punchOut?: string;
  halfDay?: string;
  leaveType?: string;
  reason?: string;
}

/**
 * Builds a real CSV in the template's shape.
 *
 * A real file rather than a pre-parsed array, so the parser, the normaliser
 * and the classifier are all genuinely exercised.
 */
export function csvFile(rows: FileRow[]): Buffer {
  const header = 'Employee ID,Employee Name,Date,Status,Punch In,Punch Out,Half Day,Leave Type,Reason';
  const body = rows.map((r) =>
    [
      r.employeeId,
      r.name ?? '',
      r.date,
      r.status,
      r.punchIn ?? '',
      r.punchOut ?? '',
      r.halfDay ?? '',
      r.leaveType ?? '',
      r.reason ?? 'Integration fixture correction',
    ].join(','),
  );
  return Buffer.from([header, ...body].join('\r\n'), 'utf8');
}
