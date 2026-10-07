/**
 * Phase 6D release blocker against real PostgreSQL: department detail.
 *
 * Before the fix, GET /departments/:id (DepartmentsService.findOne) answered
 * any signed-in user, and read members with a Prisma `include`, which returns
 * every User column: password hash, salary, bank, account number, PAN,
 * Aadhaar. The department list leaked the same through its team-lead row.
 *
 * Now: admins and HR company-wide; a manager or team lead for a department
 * they manage; everyone else 403. Members are read through an explicit safe
 * select.
 *
 * Real: Prisma, PostgreSQL, DepartmentsService, AccessPolicyService.
 * Refuses to run unless DATABASE_URL is the dedicated loopback integration
 * database (see db-guard.ts).
 */
import { PrismaService } from '../../src/prisma/prisma.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { DepartmentsService } from '../../src/modules/core/departments/departments.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';

const D1 = 'd-t19-ops';
const D2 = 'd-t19-other';
const D3 = 'd-t19-managed';
const SA = 'u-t19-super';
const ADM = 'u-t19-admin';
const MGR = 'u-t19-manager';
const TL = 'u-t19-lead';
const E = 'u-t19-employee';
const HR = 'u-t19-hr';
const I = 'u-t19-intern';
const GONE = 'u-t19-inactive';

const ROLE_OF: Record<string, string> = {
  [SA]: 'SUPER_ADMIN', [ADM]: 'ADMIN', [MGR]: 'MANAGER', [TL]: 'TEAM_LEAD', [E]: 'EMPLOYEE', [HR]: 'EMPLOYEE', [I]: 'INTERN', [GONE]: 'EMPLOYEE',
};
const DEPT_OF: Record<string, string> = { [SA]: D1, [ADM]: D1, [MGR]: D1, [TL]: D1, [E]: D1, [HR]: D2, [I]: D1, [GONE]: D1 };
const actor = (id: string) => ({ id, role: { name: ROLE_OF[id] }, departmentId: DEPT_OF[id], isHR: id === HR });

/** Every confidential User column, and the values seeded into them. */
const SECRET_FIELDS = ['password', 'ctcAnnual', 'basicSalary', 'salaryStructure', 'bankName', 'accountNumber', 'ifscCode', 'accountHolderName', 'paymentMode', 'panNumber', 'aadhaarNumber', 'uanNumber', 'hrNotes', 'taxRegime'];
const SECRET_VALUES = ['$2a$10$not-a-real-hash', 'CTC-1200000', 'BASIC-50000', 'STRUCT-X', 'BANK-NAME-X', 'ACC-998877', 'IFSC0001X', 'HOLDER-X', 'NEFT-X', 'ABCDE1234F', '9999-8888-7777', 'UAN-100200300', 'confidential note', 'NEW-REGIME-X'];

async function status(p: Promise<unknown>): Promise<number> {
  try { await p; return 200; } catch (e: any) { return typeof e?.getStatus === 'function' ? e.getStatus() : 500; }
}

function expectNoSecrets(value: unknown) {
  const json = JSON.stringify(value);
  for (const v of SECRET_VALUES) expect(json).not.toContain(v);
  for (const f of SECRET_FIELDS) expect(json).not.toMatch(new RegExp(`"${f}"\\s*:`));
}

describe('T19 department detail is scoped and carries no confidential fields (PostgreSQL)', () => {
  let prisma: PrismaService;
  let departments: DepartmentsService;

  beforeAll(async () => {
    assertIsolatedDatabase();
    prisma = new PrismaService();
    await prisma.$connect();
    await assertServerIdentity(prisma as any);
    departments = new DepartmentsService(prisma, new AccessPolicyService(prisma));

    await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles, departments RESTART IDENTITY CASCADE`);
    await prisma.department.createMany({ data: [{ id: D1, name: 'T19 Operations' }, { id: D2, name: 'T19 Other' }, { id: D3, name: 'T19 Managed' }] as any });
    const roleIds: Record<string, string> = {};
    for (const [name, level] of [['SUPER_ADMIN', 0], ['ADMIN', 1], ['MANAGER', 2], ['TEAM_LEAD', 3], ['EMPLOYEE', 4], ['INTERN', 5]] as const) {
      roleIds[name] = (await prisma.role.create({ data: { id: `r-t19-${name.toLowerCase()}`, name, level } as any })).id;
    }
    for (const id of Object.keys(ROLE_OF)) {
      await prisma.user.create({
        data: {
          id, roleId: roleIds[ROLE_OF[id]], name: id, departmentId: DEPT_OF[id], email: `${id}@integration.invalid`,
          password: SECRET_VALUES[0], isActive: id !== GONE, isHR: id === HR, currentStatus: 'OFFLINE',
          ctcAnnual: SECRET_VALUES[1], basicSalary: SECRET_VALUES[2], salaryStructure: SECRET_VALUES[3], bankName: SECRET_VALUES[4],
          accountNumber: SECRET_VALUES[5], ifscCode: SECRET_VALUES[6], accountHolderName: SECRET_VALUES[7], paymentMode: SECRET_VALUES[8],
          panNumber: SECRET_VALUES[9], aadhaarNumber: SECRET_VALUES[10], uanNumber: SECRET_VALUES[11], hrNotes: SECRET_VALUES[12], taxRegime: SECRET_VALUES[13],
        } as any,
      });
    }
    await prisma.managerDeptAccess.create({ data: { managerId: MGR, departmentId: D3, accessLevel: 'FULL' } as any });
  });

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`TRUNCATE TABLE users, roles, departments RESTART IDENTITY CASCADE`);
    await prisma?.$disconnect();
  });

  it.each([
    ['SUPER_ADMIN, any department', SA, D2, 200],
    ['ADMIN, any department', ADM, D3, 200],
    ['HR (company-wide), another department', HR, D1, 200],
    ['MANAGER, own department', MGR, D1, 200],
    ['MANAGER, department they head', MGR, D3, 200],
    ['MANAGER, another department', MGR, D2, 403],
    ['TEAM_LEAD, own department', TL, D1, 200],
    ['TEAM_LEAD, another department', TL, D2, 403],
    ['EMPLOYEE, own department', E, D1, 403],
    ['EMPLOYEE, another department', E, D2, 403],
    ['INTERN, own department', I, D1, 403],
    ['no user at all', '', D1, 403],
  ])('detail and head lookup: %s', async (_label, who, dept, want) => {
    const user = who ? actor(who) : undefined;
    expect(await status(departments.findOne(dept, user))).toBe(want);
    expect(await status(departments.getManagers(dept, user))).toBe(want);
  });

  it('an unknown department is 404 (and is not revealed to be missing before access is checked for real ids)', async () => {
    expect(await status(departments.findOne('d-missing', actor(ADM)))).toBe(404);
  });

  it('the detail lists active members with safe fields only: no password hash, salary, bank, PAN or Aadhaar', async () => {
    const dept: any = await departments.findOne(D1, actor(ADM));
    expect(dept.users.map((u: any) => u.id).sort()).toEqual([ADM, E, I, MGR, SA, TL].sort());
    expectNoSecrets(dept);
    for (const u of dept.users) {
      expect(Object.keys(u).sort()).toEqual(['_count', 'avatar', 'departmentId', 'email', 'id', 'isActive', 'name', 'role'].sort());
    }
    expect(dept.teamLead).toEqual(expect.objectContaining({ id: expect.any(String), role: expect.objectContaining({ name: expect.any(String) }) }));
  });

  it('the department list carries no confidential fields for any viewer', async () => {
    for (const who of [SA, ADM, MGR, TL, E, HR]) expectNoSecrets(await departments.findAll(actor(who)));
  });
});
