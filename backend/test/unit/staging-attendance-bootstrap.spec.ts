import { PolicyDecisionAction, PolicyStatus } from '@prisma/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  buildPolicyObjects,
  MANAGEMENT_POLICY_GAPS,
  STAGING_ATTENDANCE_V2,
  validateStagingEnvironment,
} from '../../scripts/bootstrap-staging-attendance-e2e';

describe('staging Attendance E2E bootstrap', () => {
  it('keeps unresolved consequences in review and geofencing off without an explicit location', () => {
    const objects = buildPolicyObjects({
      financialYear: '2026-2027',
      effectiveFrom: new Date('2026-08-21T00:00:00.000Z'),
      attendancePolicyId: 'attendance-v1',
      shiftId: 'shift-v1',
      leavePolicyId: 'leave-v1',
      managerId: 'manager',
      hrId: 'hr',
      geofenceEnabled: false,
    });

    expect(objects.attendancePolicy).toMatchObject({
      policyKey: 'attendance-v1',
      version: 1,
      status: PolicyStatus.ACTIVE,
      isActive: true,
      minimumWorkingMinutes: 540,
      permittedBreakMinutes: 60,
      minimumEffectiveWorkMinutes: null,
      geoFenceEnabled: false,
      locationCaptureRequired: true,
      afterPunchWindowAction: PolicyDecisionAction.REQUIRE_REVIEW,
      insufficientHoursAction: PolicyDecisionAction.REQUIRE_REVIEW,
      automaticHalfDayEnabled: false,
    });
    expect(objects.shift).toMatchObject({
      startTime: '09:30', endTime: '18:30', graceMinutes: 60, minimumWorkingMinutes: 540,
    });
    expect(objects.leavePolicy).toMatchObject({
      casualLeaveAllocation: 10,
      emergencyLeaveAllocation: 4,
      combinedPoolTypes: [],
      firstHalfInEarliest: '09:30',
      firstHalfInLatest: '10:30',
      firstHalfRequiredPresenceMinutes: 240,
      secondHalfInEarliest: '14:00',
      secondHalfInLatest: '14:30',
      secondHalfOutTime: '18:30',
      compOffExpiryDays: 30,
    });
    for (const policy of [objects.attendancePolicy, objects.shift, objects.leavePolicy]) {
      expect(policy).toMatchObject({
        policyKey: policy.id,
        version: 1,
        status: PolicyStatus.ACTIVE,
        isActive: true,
      });
    }
  });

  it('keeps Comp Off auto-earning off while its duration threshold is unresolved', () => {
    expect(MANAGEMENT_POLICY_GAPS.compOffAutomaticGrant).toMatch(/automatic earning remains disabled/);
  });

  it('enables only E2E features and leaves automatic/official processing off', () => {
    expect(STAGING_ATTENDANCE_V2).toEqual({
      punchEvidenceEnabled: true,
      leaveAuthorityEnabled: true,
      leaveApprovalEnabled: true,
      regularizationEnabled: true,
      shadowEnabled: false,
      automaticEvaluationEnabled: false,
      officialWriteEnabled: false,
    });
  });

  it('requires positive staging identity and rejects the known production marker', () => {
    const safe = {
      APP_ENV: 'staging',
      DATABASE_URL: 'postgresql://user:secret@staging.example/apex_staging',
      EXPECTED_STAGING_DB_HOST: 'staging.example',
      EXPECTED_STAGING_DB_NAME: 'apex_staging',
    } as NodeJS.ProcessEnv;
    expect(validateStagingEnvironment(safe)).toEqual({
      host: 'staging.example', database: 'apex_staging',
    });
    expect(() => validateStagingEnvironment({
      ...safe,
      DATABASE_URL: 'postgresql://user:secret@dpg-d8259omk1jcs73e37fbg.example/apex_staging',
      EXPECTED_STAGING_DB_HOST: 'dpg-d8259omk1jcs73e37fbg.example',
    })).toThrow(/production/);
  });

  it('keeps apply explicit, atomic, conflict-refusing, and delete-free', () => {
    const source = readFileSync(
      resolve(__dirname, '../../scripts/bootstrap-staging-attendance-e2e.ts'),
      'utf8',
    );

    expect(source).toContain("process.argv.includes('--apply')");
    expect(source).toContain('if (!APPLY)');
    expect(source).toContain('await prisma.$transaction(operations)');
    expect(source).toContain('conflicts.length > 0');
    expect(source).not.toMatch(/prisma\.[A-Za-z]+\.delete(?:Many)?\s*\(/);
    expect(source).toContain('prisma.leavePolicy.create');
    expect(source).not.toMatch(/prisma\.compOffCredit\.create/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Authority resolution.
//
// The dry run failed closed on staging with "Required role EMPLOYEE does not
// exist". That was the bootstrap demanding role NAMES, when Apex decides
// authority from three separate things — the level ladder, the isHR flag, and
// department access — only the first of which is a role at all.
// ─────────────────────────────────────────────────────────────────────────────

import { resolveAuthorityRoles } from '../../scripts/bootstrap-staging-attendance-e2e';

const LADDER = [
  { id: 'r0', name: 'SUPER_ADMIN', level: 0 },
  { id: 'r1', name: 'ADMIN', level: 1 },
  { id: 'r2', name: 'MANAGER', level: 2 },
  { id: 'r3', name: 'TEAM_LEAD', level: 3 },
  { id: 'r4', name: 'EMPLOYEE', level: 4 },
  { id: 'r5', name: 'INTERN', level: 5 },
];

describe('bootstrap authority resolution', () => {
  it('uses the conventional roles when a conventionally seeded database has them', () => {
    const a = resolveAuthorityRoles(LADDER);
    expect(a.problems).toEqual([]);
    expect(a.baselineRole?.name).toBe('EMPLOYEE');
    expect(a.approverRole?.name).toBe('MANAGER');
    expect(a.hrRole?.name).toBe('ADMIN');
  });

  it('works without an EMPLOYEE role by taking the least privileged that exists', () => {
    const a = resolveAuthorityRoles([
      { id: 'r1', name: 'ADMIN', level: 1 },
      { id: 'r2', name: 'MANAGER', level: 2 },
      { id: 'r9', name: 'STAFF', level: 9 },
    ]);
    expect(a.problems).toEqual([]);
    expect(a.baselineRole?.name).toBe('STAFF');
    expect(a.approverRole?.name).toBe('MANAGER');
  });

  it('needs no ADMIN role, because HR authority is the isHR flag', () => {
    const a = resolveAuthorityRoles([
      { id: 'r3', name: 'TEAM_LEAD', level: 3 },
      { id: 'r4', name: 'EMPLOYEE', level: 4 },
    ]);
    // The HR user still needs SOME role because User.roleId is non-nullable,
    // but isHrOrAdmin() is satisfied by isHR=true alone.
    expect(a.problems).toEqual([]);
    expect(a.hrRole).not.toBeNull();
    expect(a.approverRole?.name).toBe('TEAM_LEAD');
  });

  it('picks an approver that outranks the employee on the level ladder', () => {
    const a = resolveAuthorityRoles(LADDER);
    // LeaveAccessService throws when approver.level >= target.level, so an
    // approver at or below the employee would be refused at approval time.
    expect(a.approverRole!.level).toBeLessThan(a.baselineRole!.level);
  });

  it('fails closed when no role can approve, instead of taking the first row', () => {
    const a = resolveAuthorityRoles([
      { id: 'x1', name: 'CONTRACTOR', level: 4 },
      { id: 'x2', name: 'VISITOR', level: 5 },
    ]);
    expect(a.approverRole).toBeNull();
    expect(a.problems.join(' ')).toMatch(/No role can act as reporting manager/);
    // Neither unqualified role was quietly promoted into the approver slot.
    expect(a.problems.length).toBeGreaterThan(0);
  });

  it('refuses an approver-named role that does not outrank the employee', () => {
    // A MANAGER sitting at or below the employee cannot approve, whatever it
    // is called.
    const a = resolveAuthorityRoles([
      { id: 'm', name: 'MANAGER', level: 4 },
      { id: 'e', name: 'EMPLOYEE', level: 4 },
    ]);
    expect(a.approverRole).toBeNull();
    expect(a.problems.join(' ')).toMatch(/level below the employee baseline/);
  });

  it('reports a clear problem for an empty roles table', () => {
    const a = resolveAuthorityRoles([]);
    expect(a.baselineRole).toBeNull();
    expect(a.problems).toEqual(['No roles exist in this database.']);
  });

  it('no longer demands roles literally named EMPLOYEE, MANAGER or ADMIN', () => {
    const source = readFileSync(
      resolve(__dirname, '../../scripts/bootstrap-staging-attendance-e2e.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/Required role \$\{name\} does not exist/);
    expect(source).not.toMatch(/roleByName\.get\('(EMPLOYEE|MANAGER|ADMIN)'\)/);
  });

  it('generates the same plan twice, so a dry run can be compared to the apply', () => {
    const source = readFileSync(
      resolve(__dirname, '../../scripts/bootstrap-staging-attendance-e2e.ts'),
      'utf8',
    );
    // randomUUID() made every dry run report different "identities" for users
    // that did not exist yet.
    expect(source).toMatch(/const stableId = /);
    expect(source).not.toMatch(/email\)\?\.id \?\? randomUUID\(\)/);
  });
});

const BOOTSTRAP_SRC = readFileSync(
  resolve(__dirname, '../../scripts/bootstrap-staging-attendance-e2e.ts'),
  'utf8',
);
const BOOTSTRAP_CODE = BOOTSTRAP_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('bootstrap runtime contract', () => {
  // The apply failed on `carryForwardEnabled` / `maxCarryForward`: fields that
  // exist in no Prisma model. They compiled because the payload builder returned
  // an unannotated literal AND scripts/ sat outside the typechecked program, so
  // nothing ever compared the payload against the real create input.
  it('writes no field the LeavePolicy model does not have', () => {
    const schema = readFileSync(resolve(__dirname, '../../prisma/schema.prisma'), 'utf8');
    const model = /model LeavePolicy \{([\s\S]*?)\n\}/.exec(schema);
    expect(model).not.toBeNull();
    const columns = new Set(
      model![1]
        .split('\n')
        .map((line) => line.trim().split(/\s+/)[0])
        .filter((name) => /^[a-z][A-Za-z0-9]*$/.test(name)),
    );
    expect(columns.has('totalPaidLeaves')).toBe(true); // the extractor really works

    const objects = buildPolicyObjects({
      financialYear: '2026-2027',
      effectiveFrom: new Date('2026-08-21T00:00:00.000Z'),
      attendancePolicyId: 'a',
      shiftId: 's',
      leavePolicyId: 'l',
      managerId: 'm',
      hrId: 'h',
      geofenceEnabled: false,
    });

    const unknown = Object.keys(objects.leavePolicy).filter((k) => !columns.has(k));
    expect(unknown).toEqual([]);
  });

  it('does not reintroduce the carry-forward fields management never confirmed', () => {
    expect(BOOTSTRAP_CODE).not.toMatch(/carryForwardEnabled/);
    expect(BOOTSTRAP_CODE).not.toMatch(/maxCarryForward/);
  });

  // `satisfies` restores excess-property checking on a literal, but NOT on
  // properties arriving through a spread -- verified directly against tsc. So
  // every partial that gets spread into a payload is annotated at its own
  // definition site, and every complete payload carries `satisfies`.
  it('statically pins every payload to its real Prisma create input', () => {
    for (const pin of [
      /satisfies Prisma\.AttendancePolicyUncheckedCreateInput/,
      /satisfies Prisma\.ShiftPolicyUncheckedCreateInput/,
      /satisfies Prisma\.LeavePolicyUncheckedCreateInput/,
      /satisfies Prisma\.EmployeeAttendanceProfileUncheckedCreateInput\[\]/,
      /lifecycle = \(id: string\): PolicyLifecycle/,
      /profileBase: Pick<\s*Prisma\.EmployeeAttendanceProfileUncheckedCreateInput/,
      /weeklyDesired: Pick<\s*Prisma\.WeeklyOffPolicyUncheckedCreateInput/,
    ]) {
      expect(BOOTSTRAP_SRC).toMatch(pin);
    }
    expect(BOOTSTRAP_CODE).not.toMatch(/as any/);
  });

  it('is inside a typechecked program, which is what actually catches this', () => {
    // The `satisfies` above is inert unless something actually compiles scripts/.
    const cfg = JSON.parse(
      readFileSync(resolve(__dirname, '../../tsconfig.scripts.json'), 'utf8'),
    );
    expect(cfg.include).toContain('scripts/**/*');
    expect(cfg.compilerOptions.noEmit).toBe(true);

    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'));
    expect(pkg.scripts['typecheck:scripts']).toContain('tsconfig.scripts.json');

    // The main build still excludes scripts/, which is why the second program exists.
    const main = JSON.parse(readFileSync(resolve(__dirname, '../../tsconfig.json'), 'utf8'));
    expect(main.include).toEqual(['src/**/*']);
  });

  it('queues writes so every foreign key already exists when it is used', () => {
    const order = [...BOOTSTRAP_CODE.matchAll(/operations\.push\(prisma\.(\w+)\./g)].map(
      (m) => m[1],
    );
    expect(order).toEqual([
      'department',
      'user',
      'managerDeptAccess',
      'attendancePolicy',
      'shiftPolicy',
      'weeklyOffPolicy',
      'leavePolicy',
      'appSetting',
      'appSetting',
      'employeeAttendanceProfile',
    ]);
    // Users need the department; ManagerDeptAccess needs the manager and the
    // department; the profiles need every policy above them.
    expect(order.indexOf('user')).toBeGreaterThan(order.indexOf('department'));
    expect(order.indexOf('managerDeptAccess')).toBeGreaterThan(order.indexOf('user'));
    expect(order.indexOf('shiftPolicy')).toBeGreaterThan(order.indexOf('attendancePolicy'));
    expect(order.indexOf('employeeAttendanceProfile')).toBe(order.length - 1);
  });

  it('builds the payloads once, so a dry run cannot differ from the apply', () => {
    // Both paths read the same `policyObjects` / `desiredProfiles`; the apply adds
    // no second builder that could drift from what the dry run printed.
    expect(BOOTSTRAP_CODE.match(/export function buildPolicyObjects\(/g) ?? []).toHaveLength(1);
    expect(BOOTSTRAP_CODE.match(/buildPolicyObjects\(\{/g) ?? []).toHaveLength(1);
    expect(BOOTSTRAP_CODE.match(/const desiredProfiles = \[/g) ?? []).toHaveLength(1);
    expect(BOOTSTRAP_CODE).toMatch(/const operations: Prisma\.PrismaPromise<unknown>\[\] = \[\]/);
  });

  it('still refuses to write without passwords, before any row is queued', () => {
    const gate = BOOTSTRAP_CODE.indexOf('must be supplied with at least 12 characters');
    const firstWrite = BOOTSTRAP_CODE.indexOf('operations.push(');
    expect(gate).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(gate);
    expect(BOOTSTRAP_CODE).toMatch(/password\.length < 12/);
  });
});
