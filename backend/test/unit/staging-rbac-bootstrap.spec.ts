import { readFileSync } from 'fs';
import { resolve } from 'path';
import { planCanonicalRoles } from '../../scripts/bootstrap-staging-rbac';
import { CANONICAL_ROLES, CANONICAL_ROLE_COUNT } from '../../src/shared/constants/roles';

// The staging database has zero Role rows, and User.roleId is non-nullable, so
// nothing can be created there until the ladder exists. These tests are about
// the two ways that could go wrong: creating the wrong ladder, or "repairing"
// an existing one and silently changing who may approve whose leave.

const SOURCE = readFileSync(
  resolve(__dirname, '../../scripts/bootstrap-staging-rbac.ts'),
  'utf8',
);

const LADDER = CANONICAL_ROLES.map((r, i) => ({ id: `r${i}`, name: r.name, level: r.level }));

/**
 * The script with comments stripped.
 *
 * The negative assertions below must test what the CODE does, not what the
 * prose mentions — this file explains why it avoids `deleteMany` and
 * `prisma/seed.ts`, and a naive grep would flag those explanations as if they
 * were calls.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('canonical role ladder', () => {
  it('is the six roles the repository already defines, at the recorded levels', () => {
    expect(CANONICAL_ROLES).toHaveLength(CANONICAL_ROLE_COUNT);
    expect(CANONICAL_ROLES.map((r) => [r.name, r.level])).toEqual([
      ['SUPER_ADMIN', 0],
      ['ADMIN', 1],
      ['MANAGER', 2],
      ['TEAM_LEAD', 3],
      ['EMPLOYEE', 4],
      ['INTERN', 5],
    ]);
  });

  it('is shared with the existing seed rather than duplicated', () => {
    const seed = readFileSync(resolve(__dirname, '../../prisma/seed.ts'), 'utf8');
    expect(seed).toMatch(/CANONICAL_ROLES/);
    // The old inline array is gone, so the two cannot drift apart.
    expect(seed).not.toMatch(/name: 'SUPER_ADMIN', level: 0/);
  });
});

describe('RBAC foundation planning', () => {
  it('plans all six roles against an empty table', () => {
    const plan = planCanonicalRoles([]);

    expect(plan.toCreate).toHaveLength(6);
    expect(plan.toCreate.map((r) => r.name)).toEqual([
      'SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEAD', 'EMPLOYEE', 'INTERN',
    ]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.alreadyCorrect).toEqual([]);
  });

  it('plans nothing when the ladder is already complete and correct', () => {
    const plan = planCanonicalRoles(LADDER);

    expect(plan.toCreate).toEqual([]);
    expect(plan.alreadyCorrect).toHaveLength(6);
    expect(plan.conflicts).toEqual([]);
  });

  it('plans only the missing roles from a partial ladder', () => {
    const partial = LADDER.filter((r) => ['ADMIN', 'EMPLOYEE'].includes(r.name));
    const plan = planCanonicalRoles(partial);

    expect(plan.alreadyCorrect.sort()).toEqual(['ADMIN', 'EMPLOYEE']);
    expect(plan.toCreate.map((r) => r.name).sort()).toEqual([
      'INTERN', 'MANAGER', 'SUPER_ADMIN', 'TEAM_LEAD',
    ]);
    expect(plan.conflicts).toEqual([]);
  });

  it('treats a wrong level as a conflict, never a repair', () => {
    const plan = planCanonicalRoles([
      { id: 'r', name: 'MANAGER', level: 4 },
    ]);

    // Level decides who may approve whose leave. Rewriting it would change
    // authority without anybody deciding that.
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatch(/MANAGER exists with level 4.*says 2/s);
    expect(plan.toCreate.map((r) => r.name)).not.toContain('MANAGER');
  });

  it('reports non-canonical roles without touching them', () => {
    const plan = planCanonicalRoles([
      ...LADDER,
      { id: 'x', name: 'CONTRACTOR', level: 7 },
    ]);

    expect(plan.extra.map((r) => r.name)).toEqual(['CONTRACTOR']);
    expect(plan.conflicts).toEqual([]);
    expect(plan.toCreate).toEqual([]);
  });

  it('matches role names case-insensitively rather than duplicating them', () => {
    const plan = planCanonicalRoles([{ id: 'r', name: 'manager', level: 2 }]);

    expect(plan.alreadyCorrect).toContain('MANAGER');
    expect(plan.toCreate.map((r) => r.name)).not.toContain('MANAGER');
  });
});

describe('RBAC bootstrap safety', () => {
  it('requires an explicit --apply to write', () => {
    expect(SOURCE).toMatch(/const APPLY = process\.argv\.includes\('--apply'\)/);
    expect(SOURCE).toMatch(/if \(!APPLY\)/);
    expect(SOURCE).toMatch(/DRY RUN COMPLETE\. Nothing was written\./);
  });

  it('demands a positive staging assertion, not merely a non-production one', () => {
    expect(SOURCE).toMatch(/appEnv !== 'staging'/);
    expect(SOURCE).toMatch(/EXPECTED_STAGING_DB_HOST/);
    expect(SOURCE).toMatch(/EXPECTED_STAGING_DB_NAME/);
    expect(SOURCE).toMatch(/Host mismatch/);
    expect(SOURCE).toMatch(/Database mismatch/);
  });

  it('rejects known production identifiers', () => {
    expect(SOURCE).toMatch(/dpg-d8259omk1jcs73e37fbg/);
    expect(SOURCE).toMatch(/known production marker/);
  });

  it('never deletes or updates a role', () => {
    // The whole point: this script only ever INSERTS.
    expect(CODE).not.toMatch(/role\.delete/);
    expect(CODE).not.toMatch(/deleteMany/);
    expect(CODE).not.toMatch(/role\.update/);
    expect(CODE).not.toMatch(/role\.upsert/);
    expect(CODE).toMatch(/prisma\.role\.create/);
  });

  it('never invokes the broad seed', () => {
    // seed.ts carries unconditional deleteMany calls against users, projects
    // and tickets. Obtaining six rows must not cost the rest of the database.
    expect(CODE).not.toMatch(/seed\.ts/);
    expect(CODE).not.toMatch(/require\(.*seed/);
    expect(CODE).not.toMatch(/from '.*seed'/);
  });

  it('creates the ladder in one transaction and verifies it afterwards', () => {
    expect(SOURCE).toMatch(/prisma\.\$transaction\(/);
    expect(SOURCE).toMatch(/Verification failed/);
  });

  it('creates only roles, leaving users and attendance configuration alone', () => {
    for (const forbidden of [
      'prisma.user.create',
      'prisma.department.create',
      'prisma.attendancePolicy.create',
      'prisma.shiftPolicy.create',
      'prisma.leavePolicy.create',
      'prisma.employeeAttendanceProfile.create',
    ]) {
      expect(CODE).not.toContain(forbidden);
    }
  });
});
