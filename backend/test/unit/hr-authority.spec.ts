import { UsersService } from '../../src/modules/core/users/users.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { CANONICAL_ROLES, CANONICAL_ROLE_COUNT, ROLES } from '../../src/shared/constants/roles';
import { LeaveAccessService } from '../../src/common/services/leave-access.service';

/**
 * HR authority in Apex OS is a FLAG, not a role.
 *
 * This surprised a production correction: an account showing "Department: HR"
 * was assumed to have HR powers, and the fix was assumed to be "set role = HR".
 * There is no HR role in the canonical ladder, and every HR gate reads
 * `User.isHR` instead -- so that change would have granted nothing.
 *
 * These tests pin the model down so the next person does not have to rediscover
 * it, and so nobody is tempted to special-case an email address.
 */

const policy = new AccessPolicyService({} as any);

const user = (over: any = {}) => ({
  id: 'u-1',
  isHR: false,
  role: { name: ROLES.EMPLOYEE, level: 4 },
  ...over,
});

describe('there is no HR role, and that is deliberate', () => {
  it('the canonical ladder does not contain one', () => {
    const names = CANONICAL_ROLES.map((r) => r.name);

    expect(names).not.toContain('HR');
    expect(names).toEqual([
      'SUPER_ADMIN',
      'ADMIN',
      'MANAGER',
      'TEAM_LEAD',
      'EMPLOYEE',
      'INTERN',
    ]);
    expect(CANONICAL_ROLES).toHaveLength(CANONICAL_ROLE_COUNT);
  });

  it('a role literally named HR grants no HR authority', () => {
    // The trap. Creating a role called "HR" and assigning it would look right
    // in the UI and change nothing at all.
    expect(policy.isHrOrAdmin(user({ role: { name: 'HR', level: 2 } }))).toBe(false);
  });

  it('the isHR flag is what grants it', () => {
    expect(policy.isHrOrAdmin(user({ isHR: true }))).toBe(true);
  });

  it('grants it to admins too, by role', () => {
    expect(policy.isHrOrAdmin(user({ role: { name: ROLES.ADMIN, level: 1 } }))).toBe(true);
    expect(policy.isHrOrAdmin(user({ role: { name: ROLES.SUPER_ADMIN, level: 0 } }))).toBe(true);
  });

  it.each([ROLES.EMPLOYEE, ROLES.INTERN, ROLES.MANAGER, ROLES.TEAM_LEAD])(
    'refuses %s without the flag',
    (name) => {
      expect(policy.isHrOrAdmin(user({ role: { name, level: 3 } }))).toBe(false);
    },
  );

  it('refuses an absent or empty user rather than defaulting open', () => {
    expect(policy.isHrOrAdmin(null)).toBe(false);
    expect(policy.isHrOrAdmin(undefined)).toBe(false);
    expect(policy.isHrOrAdmin({} as any)).toBe(false);
  });
});

describe('authority is never granted to a named person', () => {
  it('no email address is COMPARED against anywhere in the backend', () => {
    // The correction that prompted this was for one real account.
    // `if (email === 'hr@...')` would have worked, and would have been
    // invisible the next time somebody else took the role.
    //
    // Deliberately narrow: an address in a Swagger @ApiProperty example or a
    // CSV import sample is documentation. An address in a COMPARISON is an
    // identity decision, and that is the thing being banned.
    // Walked in Node rather than shelled out to grep: the escaping needed to
    // pass this pattern through a template literal into a shell mangled it
    // into an invalid expression, which grep rejected and the try/catch
    // swallowed -- a test that passed because it never ran.
    const { readdirSync, statSync, readFileSync } = require('fs');
    const { join, resolve } = require('path');
    const root = resolve(__dirname, '../../src');

    const COMPARED_TO_EMAIL =
      /(===|!==|==|!=|\.includes\(|\.startsWith\(|\.endsWith\()\s*['"`][A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/;

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!full.endsWith('.ts')) continue;
        const src: string = readFileSync(full, 'utf8');
        if (COMPARED_TO_EMAIL.test(src)) {
          offenders.push(full.slice(root.length + 1).replace(/\\/g, '/'));
        }
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
  });

  it('the pattern it searches for actually matches one', () => {
    // Guards the guard. A regex that matches nothing would make the rule above
    // pass forever, silently.
    const COMPARED_TO_EMAIL =
      /(===|!==|==|!=|\.includes\(|\.startsWith\(|\.endsWith\()\s*['"`][A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/;

    expect(COMPARED_TO_EMAIL.test("if (user.email === 'hr@technoedgels.com') return true;")).toBe(
      true,
    );
    expect(COMPARED_TO_EMAIL.test('if (list.includes("hr@technoedgels.com")) return true;')).toBe(
      true,
    );
    // And does not flag documentation.
    expect(COMPARED_TO_EMAIL.test("@ApiProperty({ example: 'admin@technoedge.com' })")).toBe(false);
  });
});

describe('an administrator can appoint HR through the supported path', () => {
  function build() {
    const updates: any[] = [];
    const audit: any[] = [];
    const prisma: any = {
      user: {
        // Read when isHR is being set, to resolve the resulting base role.
        findUnique: jest.fn(async () => ({ roleId: 'role-employee' })),
        update: jest.fn(async ({ data }: any) => {
          updates.push(data);
          return { id: 'u-1', password: 'hash', ...data };
        }),
      },
      role: { findUnique: jest.fn(async () => ({ name: ROLES.EMPLOYEE })) },
    };
    const service = new UsersService(
      prisma,
      policy as any,
      { log: jest.fn(async (e: any) => void audit.push(e)) } as any,
      {} as any,
      {} as any,
    );
    return { service, updates, audit };
  }

  it('accepts isHR', async () => {
    const { service, updates } = build();
    await service.update('u-1', { isHR: true } as any, 'admin-1');

    expect(updates[0]).toEqual({ isHR: true });
  });

  it('records the grant as a privilege change, not an edit', async () => {
    const { service, audit } = build();
    await service.update('u-1', { isHR: true } as any, 'admin-1');

    expect(audit[0].action).toBe('USER_ROLE_CHANGED');
    expect(audit[0].metadata.isHR).toBe(true);
    expect(audit[0].actorId).toBe('admin-1');
  });

  it('records removal of HR authority just as loudly', async () => {
    const { service, audit } = build();
    await service.update('u-1', { isHR: false } as any, 'admin-1');

    expect(audit[0].action).toBe('USER_ROLE_CHANGED');
    expect(audit[0].metadata.isHR).toBe(false);
  });

  it('still calls an ordinary edit an edit', async () => {
    const { service, audit } = build();
    await service.update('u-1', { name: 'Shubham' }, 'admin-1');

    expect(audit[0].action).toBe('USER_UPDATED');
  });

  it('drops fields no administrator may set through this route', async () => {
    // The controller takes `@Body() body: any` and this used to reach Prisma
    // untouched, so PUT /users/:id could set any column on User. The
    // TypeScript signature looked like a restriction and enforced nothing.
    const { service, updates } = build();

    await service.update(
      'u-1',
      {
        name: 'Shubham',
        isHR: true,
        password: 'not-through-here',
        ctcAnnual: 9_999_999,
        basicSalary: 9_999_999,
        joiningDate: new Date(0),
        id: 'somebody-else',
      } as any,
      'admin-1',
    );

    expect(updates[0]).toEqual({ name: 'Shubham', isHR: true });
    for (const forbidden of ['password', 'ctcAnnual', 'basicSalary', 'joiningDate', 'id']) {
      expect(updates[0]).not.toHaveProperty(forbidden);
    }
  });

  it('does not write fields the caller never sent', async () => {
    // An undefined must not become a null that wipes a column.
    const { service, updates } = build();
    await service.update('u-1', { isHR: true, name: undefined } as any, 'admin-1');

    expect(Object.keys(updates[0])).toEqual(['isHR']);
  });
});


describe('HR authority works on an ordinary base role', () => {
  // THE CORRECTION. HR authority must not require promoting somebody to
  // MANAGER. The ladder check used to run before the HR bypass, so an HR user
  // on a junior base role was refused before their HR authority was consulted,
  // and the tempting fix was to make them a manager -- granting real authority
  // over teams, projects and tickets to satisfy a check that should never have
  // applied to them.
  //
  //   role       organisational seniority
  //   isHR       HR functional authority
  //   department organisational placement

  const leaveOf = (roleName: string, level: number) => ({
    id: 'leave-1',
    userId: 'target-1',
    status: 'PENDING',
    user: {
      id: 'target-1',
      departmentId: 'dept-eng',
      role: { name: roleName, level },
    },
  });

  function leaveService(approver: any) {
    const prisma: any = {
      user: { findUnique: jest.fn(async () => approver) },
      // Reached only on the non-HR path, where department scope is resolved.
      managerDeptAccess: { findMany: jest.fn(async () => []) },
    };
    const access = new AccessPolicyService(prisma);
    // hydrateUser reads the database; the approver under test is returned.
    jest.spyOn(access, 'hydrateUser').mockResolvedValue(approver as any);
    return new LeaveAccessService(prisma, access);
  }

  const HR_EMPLOYEE = {
    id: 'hr-1',
    isHR: true,
    departmentId: 'dept-hr',
    role: { name: ROLES.EMPLOYEE, level: 4 },
  };

  it('an EMPLOYEE with isHR can approve leave at every level below admin', async () => {
    const service = leaveService(HR_EMPLOYEE);

    for (const [name, level] of [
      [ROLES.MANAGER, 2],
      [ROLES.TEAM_LEAD, 3],
      [ROLES.EMPLOYEE, 4],
      [ROLES.INTERN, 5],
    ] as const) {
      await expect(
        service.assertCanApproveReject(HR_EMPLOYEE, leaveOf(name, level), 'approve'),
      ).resolves.toBeUndefined();
    }
  });

  it('and is not blocked by somebody on their own level', async () => {
    // The `>=` comparison refused even an equal level, so an HR employee could
    // not approve another employee.
    const service = leaveService(HR_EMPLOYEE);

    await expect(
      service.assertCanApproveReject(HR_EMPLOYEE, leaveOf(ROLES.EMPLOYEE, 4), 'approve'),
    ).resolves.toBeUndefined();
  });

  it('reaches outside their own department, because HR is company-wide', async () => {
    const service = leaveService(HR_EMPLOYEE);

    await expect(
      service.assertCanApproveReject(HR_EMPLOYEE, leaveOf(ROLES.EMPLOYEE, 4), 'approve'),
    ).resolves.toBeUndefined();
  });

  it('still cannot approve their own leave', async () => {
    // The one thing HR authority must never buy. Checked before everything.
    const service = leaveService(HR_EMPLOYEE);
    const ownLeave = { ...leaveOf(ROLES.EMPLOYEE, 4), userId: HR_EMPLOYEE.id };

    await expect(
      service.assertCanApproveReject(HR_EMPLOYEE, ownLeave, 'approve'),
    ).rejects.toThrow(/your own leave/i);
  });

  it('the same employee WITHOUT the flag is refused', async () => {
    const plain = { ...HR_EMPLOYEE, isHR: false };
    const service = leaveService(plain);

    await expect(
      service.assertCanApproveReject(plain, leaveOf(ROLES.INTERN, 5), 'approve'),
    ).rejects.toThrow(/do not have permission/i);
  });

  it('an INTERN with the flag also works, so authority never depends on seniority', async () => {
    const hrIntern = { ...HR_EMPLOYEE, role: { name: ROLES.INTERN, level: 5 } };
    const service = leaveService(hrIntern);

    await expect(
      service.assertCanApproveReject(hrIntern, leaveOf(ROLES.MANAGER, 2), 'approve'),
    ).resolves.toBeUndefined();
  });

  it('a MANAGER without the flag is still bound by the ladder', async () => {
    // The reorder must not loosen ordinary hierarchy for anyone else.
    const manager = {
      id: 'mgr-1',
      isHR: false,
      departmentId: 'dept-eng',
      role: { name: ROLES.MANAGER, level: 2 },
    };
    const service = leaveService(manager);

    await expect(
      service.assertCanApproveReject(manager, leaveOf(ROLES.MANAGER, 2), 'approve'),
    ).rejects.toThrow(/cannot approve/i);
    await expect(
      service.assertCanApproveReject(manager, leaveOf(ROLES.ADMIN, 1), 'approve'),
    ).rejects.toThrow(/cannot approve/i);
  });

  it('a MANAGER without the flag is still bound by department scope', async () => {
    const manager = {
      id: 'mgr-1',
      isHR: false,
      departmentId: 'dept-sales',
      role: { name: ROLES.MANAGER, level: 2 },
    };
    const service = leaveService(manager);

    await expect(
      service.assertCanApproveReject(manager, leaveOf(ROLES.EMPLOYEE, 4), 'approve'),
    ).rejects.toThrow(/outside your scope/i);
  });
});

describe('the HR flag grants HR authority and nothing else', () => {
  const hrEmployee = user({ isHR: true, departmentId: 'dept-hr' });

  it('gives the HR gate every attendance, payroll and recovery surface', () => {
    // All of them route through this one predicate: console, exception queue,
    // manual recovery HR finalization, payroll preview, month close, Finance
    // recipients.
    expect(policy.isHrOrAdmin(hrEmployee)).toBe(true);
  });

  it('denies all of it once the flag is off', () => {
    expect(policy.isHrOrAdmin(user({ isHR: false }))).toBe(false);
  });

  it('does not make them a manager of anybody', async () => {
    // Manager team ownership is resolved from the ROLE, never from the flag.
    const prisma: any = { managerDeptAccess: { findMany: jest.fn(async () => []) } };
    const scoped = new AccessPolicyService(prisma);

    expect(await scoped.managedDepartmentIds(hrEmployee as any)).toEqual(['dept-hr']);
    expect(prisma.managerDeptAccess.findMany).not.toHaveBeenCalled();
  });

  it('does not make them an admin', () => {
    expect(policy.isAdmin(hrEmployee)).toBe(false);
    expect(policy.isSuperAdmin(hrEmployee)).toBe(false);
  });

  it('a MANAGER without the flag gets no HR-only power', () => {
    const manager = user({ role: { name: ROLES.MANAGER, level: 2 }, isHR: false });

    expect(policy.isHrOrAdmin(manager)).toBe(false);
  });

  it('no ticket or project authority is keyed off the flag', () => {
    const { readdirSync, statSync, readFileSync } = require('fs');
    const { join, resolve } = require('path');
    const root = resolve(__dirname, '../../src');

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!full.endsWith('.ts')) continue;
        // Separator-agnostic: the pattern below does not care, and normalising
        // it here needs a backslash escape that is easy to mangle.
        const rel = full.slice(root.length + 1);
        if (!/ticket|project/i.test(rel)) continue;
        if (/\bisHR\b/.test(readFileSync(full, 'utf8'))) offenders.push(rel);
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
  });
});

describe('Admin authority is exactly what it was before the HR fix', () => {
  // The HR correction moved a bypass above the ladder. Using the combined
  // isHrOrAdmin() helper there would have swept Admin past the ladder too,
  // letting an ADMIN approve a SUPER_ADMIN's leave -- authority they never
  // had, expanded as a side effect of fixing something unrelated.
  //
  // These pin the pre-fix baseline: Admin is bound by the ladder and exempt
  // from department scope.

  const leaveOf = (roleName: string, level: number, departmentId = 'dept-eng') => ({
    id: 'leave-1',
    userId: 'target-1',
    status: 'PENDING',
    user: { id: 'target-1', departmentId, role: { name: roleName, level } },
  });

  function leaveService(approver: any) {
    const prisma: any = {
      user: { findUnique: jest.fn(async () => approver) },
      managerDeptAccess: { findMany: jest.fn(async () => []) },
    };
    const access = new AccessPolicyService(prisma);
    jest.spyOn(access, 'hydrateUser').mockResolvedValue(approver as any);
    return new LeaveAccessService(prisma, access);
  }

  const ADMIN = {
    id: 'admin-1',
    isHR: false,
    departmentId: 'dept-ops',
    role: { name: ROLES.ADMIN, level: 1 },
  };
  const SUPER = {
    id: 'sa-1',
    isHR: false,
    departmentId: 'dept-ops',
    role: { name: ROLES.SUPER_ADMIN, level: 0 },
  };

  it('an ADMIN still cannot approve a SUPER_ADMIN’s leave', async () => {
    // THE REGRESSION THIS FILE EXISTS TO PREVENT.
    const service = leaveService(ADMIN);

    await expect(
      service.assertCanApproveReject(ADMIN, leaveOf(ROLES.SUPER_ADMIN, 0), 'approve'),
    ).rejects.toThrow(/cannot approve/i);
  });

  it('an ADMIN still cannot approve another ADMIN’s leave', async () => {
    const service = leaveService(ADMIN);

    await expect(
      service.assertCanApproveReject(ADMIN, leaveOf(ROLES.ADMIN, 1), 'approve'),
    ).rejects.toThrow(/cannot approve/i);
  });

  it('a SUPER_ADMIN still cannot approve another SUPER_ADMIN’s leave', async () => {
    const service = leaveService(SUPER);

    await expect(
      service.assertCanApproveReject(SUPER, leaveOf(ROLES.SUPER_ADMIN, 0), 'approve'),
    ).rejects.toThrow(/cannot approve/i);
  });

  it('an ADMIN still approves everyone below them, in any department', async () => {
    // Admin remains exempt from department scope, as before.
    const service = leaveService(ADMIN);

    for (const [name, level] of [
      [ROLES.MANAGER, 2],
      [ROLES.TEAM_LEAD, 3],
      [ROLES.EMPLOYEE, 4],
      [ROLES.INTERN, 5],
    ] as const) {
      await expect(
        service.assertCanApproveReject(ADMIN, leaveOf(name, level, 'dept-somewhere-else'), 'approve'),
      ).resolves.toBeUndefined();
    }
  });

  it('a SUPER_ADMIN still approves an ADMIN', async () => {
    const service = leaveService(SUPER);

    await expect(
      service.assertCanApproveReject(SUPER, leaveOf(ROLES.ADMIN, 1), 'approve'),
    ).resolves.toBeUndefined();
  });

  it('neither can approve their own leave', async () => {
    for (const actor of [ADMIN, SUPER]) {
      const service = leaveService(actor);
      const own = { ...leaveOf(ROLES.ADMIN, 1), userId: actor.id };

      await expect(
        service.assertCanApproveReject(actor, own, 'approve'),
      ).rejects.toThrow(/your own leave/i);
    }
  });

  it('the bypass reads the HR flag, never the combined admin helper', () => {
    // Guards the distinction at the source: isHrOrAdmin() at the bypass point
    // is what silently expanded Admin, and it reads identically at a glance.
    const src: string = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/common/services/leave-access.service.ts'),
      'utf8',
    );
    const body = src.slice(src.indexOf('async assertCanApproveReject'));
    const upToLadder = body.slice(0, body.indexOf('role.level >='));

    expect(upToLadder).toContain('approver.isHR');
    expect(upToLadder).not.toContain('isHrOrAdmin(approver)) return');
  });
});

describe('HR ADMIN is a composed authority, not a seventh role', () => {
  // POLICY, set deliberately: the company's HR account holds ADMIN powers AND
  // the HR set.
  //
  //   ADMIN          ordinary administrator
  //   ADMIN + isHR   HR ADMIN
  //
  // The ladder stays at six entries. This composes from two facts already on
  // the account, so nothing downstream has to learn a new role name.

  const HR_ADMIN = user({ isHR: true, role: { name: ROLES.ADMIN, level: 1 } });

  it('is recognised as HR ADMIN', () => {
    expect(policy.isHrAdmin(HR_ADMIN)).toBe(true);
  });

  it('holds the union: every Admin power and every HR power', () => {
    expect(policy.isAdmin(HR_ADMIN)).toBe(true);
    expect(policy.isHrOrAdmin(HR_ADMIN)).toBe(true);
  });

  it.each([
    ['a plain ADMIN', user({ role: { name: ROLES.ADMIN, level: 1 } })],
    ['a plain SUPER_ADMIN', user({ role: { name: ROLES.SUPER_ADMIN, level: 0 } })],
    ['an EMPLOYEE with the flag', user({ isHR: true })],
    ['an ordinary EMPLOYEE', user()],
  ])('is not confused with %s', (_label, other) => {
    expect(policy.isHrAdmin(other as any)).toBe(false);
  });

  it('keeps a plain ADMIN exactly as it was', () => {
    const admin = user({ role: { name: ROLES.ADMIN, level: 1 } });

    expect(policy.isAdmin(admin)).toBe(true);
    expect(policy.isHrOrAdmin(admin)).toBe(true);
    expect(policy.isHrAdmin(admin)).toBe(false);
  });

  it.each([
    ['EMPLOYEE without the flag', user()],
    ['INTERN without the flag', user({ role: { name: ROLES.INTERN, level: 5 } })],
  ])('%s still has no HR authority', (_label, u) => {
    expect(policy.isHrOrAdmin(u as any)).toBe(false);
    expect(policy.isHrAdmin(u as any)).toBe(false);
  });
});

describe('leave authority: HR reaches ADMIN and below, never SUPER_ADMIN', () => {
  const leaveOf = (roleName: string, level: number, departmentId = 'dept-eng') => ({
    id: 'leave-1',
    userId: 'target-1',
    status: 'PENDING',
    user: { id: 'target-1', departmentId, role: { name: roleName, level } },
  });

  function svc(approver: any) {
    const prisma: any = {
      user: { findUnique: jest.fn(async () => approver) },
      managerDeptAccess: { findMany: jest.fn(async () => []) },
    };
    const access = new AccessPolicyService(prisma);
    jest.spyOn(access, 'hydrateUser').mockResolvedValue(approver as any);
    return new LeaveAccessService(prisma, access);
  }

  const HR_ADMIN = {
    id: 'hra-1',
    isHR: true,
    departmentId: 'dept-hr',
    role: { name: ROLES.ADMIN, level: 1 },
  };
  const HR_STAFF = {
    id: 'hr-1',
    isHR: true,
    departmentId: 'dept-hr',
    role: { name: ROLES.EMPLOYEE, level: 4 },
  };
  const PLAIN_ADMIN = {
    id: 'adm-1',
    isHR: false,
    departmentId: 'dept-ops',
    role: { name: ROLES.ADMIN, level: 1 },
  };

  // The grid, determined explicitly rather than left to fall out of the code.
  it.each([
    [ROLES.INTERN, 5, 'allowed'],
    [ROLES.EMPLOYEE, 4, 'allowed'],
    [ROLES.TEAM_LEAD, 3, 'allowed'],
    [ROLES.MANAGER, 2, 'allowed'],
    [ROLES.ADMIN, 1, 'allowed'],
    [ROLES.SUPER_ADMIN, 0, 'refused'],
  ])('HR ADMIN approving %s is %s', async (roleName, level, outcome) => {
    const call = svc(HR_ADMIN).assertCanApproveReject(
      HR_ADMIN,
      leaveOf(roleName as string, level as number, 'dept-anywhere'),
      'approve',
    );
    if (outcome === 'allowed') await expect(call).resolves.toBeUndefined();
    else await expect(call).rejects.toThrow(/cannot approve/i);
  });

  it('HR staff on an ordinary role reach exactly as far', async () => {
    for (const [name, level] of [
      [ROLES.INTERN, 5],
      [ROLES.EMPLOYEE, 4],
      [ROLES.TEAM_LEAD, 3],
      [ROLES.MANAGER, 2],
      [ROLES.ADMIN, 1],
    ] as const) {
      await expect(
        svc(HR_STAFF).assertCanApproveReject(HR_STAFF, leaveOf(name, level), 'approve'),
      ).resolves.toBeUndefined();
    }
  });

  it('and HR staff are stopped at SUPER_ADMIN too', async () => {
    // Closes a gap in the previous revision, where HR bypassed the ladder
    // unconditionally and could act on the account that administers the system.
    await expect(
      svc(HR_STAFF).assertCanApproveReject(HR_STAFF, leaveOf(ROLES.SUPER_ADMIN, 0), 'approve'),
    ).rejects.toThrow(/cannot approve/i);
  });

  it.each([
    ['HR ADMIN', HR_ADMIN],
    ['HR staff', HR_STAFF],
    ['a plain ADMIN', PLAIN_ADMIN],
  ])('%s still cannot approve their own leave', async (_label, actor) => {
    const own = { ...leaveOf(ROLES.EMPLOYEE, 4), userId: (actor as any).id };

    await expect(svc(actor).assertCanApproveReject(actor, own, 'approve')).rejects.toThrow(
      /your own leave/i,
    );
  });

  it('a plain ADMIN is unchanged: still bound by the ladder', async () => {
    // The flag is what buys ladder reach. Without it an administrator keeps
    // exactly the authority they always had.
    for (const [name, level] of [
      [ROLES.ADMIN, 1],
      [ROLES.SUPER_ADMIN, 0],
    ] as const) {
      await expect(
        svc(PLAIN_ADMIN).assertCanApproveReject(PLAIN_ADMIN, leaveOf(name, level), 'approve'),
      ).rejects.toThrow(/cannot approve/i);
    }
    await expect(
      svc(PLAIN_ADMIN).assertCanApproveReject(PLAIN_ADMIN, leaveOf(ROLES.MANAGER, 2), 'approve'),
    ).resolves.toBeUndefined();
  });

  it('a MANAGER without the flag keeps ladder and department scope', async () => {
    const mgr = {
      id: 'mgr-1',
      isHR: false,
      departmentId: 'dept-sales',
      role: { name: ROLES.MANAGER, level: 2 },
    };

    await expect(
      svc(mgr).assertCanApproveReject(mgr, leaveOf(ROLES.MANAGER, 2), 'approve'),
    ).rejects.toThrow(/cannot approve/i);
    await expect(
      svc(mgr).assertCanApproveReject(mgr, leaveOf(ROLES.EMPLOYEE, 4), 'approve'),
    ).rejects.toThrow(/outside your scope/i);
  });

  it('the bypass caps on the TARGET, not the approver', () => {
    // One rule serving both kinds of HR user. Guarded at the source because a
    // cap on the approver instead would silently re-break HR staff.
    const src: string = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/common/services/leave-access.service.ts'),
      'utf8',
    );
    const body = src.slice(src.indexOf('async assertCanApproveReject'));
    const upToLadder = body.slice(0, body.indexOf('role.level >='));

    expect(upToLadder).toMatch(
      /approver\.isHR && !this\.access\.isSuperAdmin\(targetUser\)\) return/,
    );
    expect(upToLadder).not.toContain('isHrOrAdmin(approver)) return');
  });
});

describe('HR authority may combine with any role except SUPER_ADMIN', () => {
  function build(roleName: string) {
    const updates: any[] = [];
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({ roleId: 'role-1' })),
        update: jest.fn(async ({ data }: any) => {
          updates.push(data);
          return { id: 'u-1', ...data };
        }),
      },
      role: { findUnique: jest.fn(async () => ({ name: roleName })) },
    };
    const service = new UsersService(
      prisma,
      policy as any,
      { log: jest.fn(async () => undefined) } as any,
      {} as any,
      {} as any,
    );
    return { service, updates };
  }

  it.each([ROLES.ADMIN, ROLES.MANAGER, ROLES.TEAM_LEAD, ROLES.EMPLOYEE, ROLES.INTERN])(
    'allows %s with HR authority',
    async (roleName) => {
      const { service, updates } = build(roleName);
      await service.update('u-1', { isHR: true } as any, 'sa-1');

      expect(updates[0]).toEqual({ isHR: true });
    },
  );

  it('refuses SUPER_ADMIN with HR authority', async () => {
    const { service, updates } = build(ROLES.SUPER_ADMIN);

    await expect(service.update('u-1', { isHR: true } as any, 'sa-1')).rejects.toThrow(
      /cannot be combined with SUPER_ADMIN/i,
    );
    expect(updates).toEqual([]);
  });

  it('refuses it when the same request also promotes them to SUPER_ADMIN', async () => {
    const { service, updates } = build(ROLES.SUPER_ADMIN);

    await expect(
      service.update('u-1', { roleId: 'role-sa', isHR: true } as any, 'sa-1'),
    ).rejects.toThrow(/cannot be combined with SUPER_ADMIN/i);
    expect(updates).toEqual([]);
  });

  it('always allows clearing the flag, including on a SUPER_ADMIN', async () => {
    const { service, updates } = build(ROLES.SUPER_ADMIN);
    await service.update('u-1', { isHR: false } as any, 'sa-1');

    expect(updates[0]).toEqual({ isHR: false });
  });

  it('promotes to ADMIN and grants HR in one call', async () => {
    // The exact production correction: INTERN to ADMIN with HR authority on.
    const { service, updates } = build(ROLES.ADMIN);
    await service.update('u-1', { roleId: 'role-admin', isHR: true } as any, 'sa-1');

    expect(updates[0]).toEqual({ roleId: 'role-admin', isHR: true });
  });

  it('still refuses to mass-assign anything else alongside it', async () => {
    const { service, updates } = build(ROLES.ADMIN);
    await service.update(
      'u-1',
      { isHR: true, password: 'no', ctcAnnual: 1, basicSalary: 2 } as any,
      'sa-1',
    );

    expect(updates[0]).toEqual({ isHR: true });
  });
});
