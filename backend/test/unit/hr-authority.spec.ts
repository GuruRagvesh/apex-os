import { UsersService } from '../../src/modules/core/users/users.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { CANONICAL_ROLES, CANONICAL_ROLE_COUNT, ROLES } from '../../src/shared/constants/roles';

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
        update: jest.fn(async ({ data }: any) => {
          updates.push(data);
          return { id: 'u-1', password: 'hash', ...data };
        }),
      },
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

describe('the role level still decides whose leave HR may approve', () => {
  // Why appointing HR is TWO fields, not one. In LeaveAccessService the ladder
  // check runs BEFORE the isHrOrAdmin bypass:
  //
  //   if (approver.role.level >= targetUser.role.level) throw
  //   if (isHrOrAdmin(approver)) return
  //
  // so an INTERN-level HR user is refused before the flag is ever consulted.
  const blocks = (approverLevel: number, targetLevel: number) => approverLevel >= targetLevel;

  const level = (name: string) => CANONICAL_ROLES.find((r) => r.name === name)!.level;

  it('an INTERN-level HR user could approve nobody, flag or not', () => {
    for (const target of ['MANAGER', 'TEAM_LEAD', 'EMPLOYEE', 'INTERN']) {
      expect(blocks(level('INTERN'), level(target))).toBe(true);
    }
  });

  it('a MANAGER-level HR user can approve everyone below management', () => {
    for (const target of ['TEAM_LEAD', 'EMPLOYEE', 'INTERN']) {
      expect(blocks(level('MANAGER'), level(target))).toBe(false);
    }
  });

  it('and still cannot approve their own level or above', () => {
    for (const target of ['MANAGER', 'ADMIN', 'SUPER_ADMIN']) {
      expect(blocks(level('MANAGER'), level(target))).toBe(true);
    }
  });
});
