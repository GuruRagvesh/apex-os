/**
 * Phase 6D release blocker over HTTP: GET /api/departments/:id and
 * /api/departments/:id/managers.
 *
 * The whole AppModule, real guards, real JWTs for the seeded integration roles.
 * Proves that roles outside the department are refused, and that no response
 * from the department endpoints ever carries a confidential User field --
 * including the bcrypt hashes of the seeded accounts themselves.
 *
 * Runs only against the dedicated isolated integration database.
 */
import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../helpers/app.helper';
import { bearerFor, clearTokenCache, RoleKey } from '../helpers/auth.helper';
import { INTEGRATION_DEPARTMENT } from '../helpers/integration-users';
import { PrismaService } from '../../src/prisma/prisma.service';

const OTHER_DEPT = 'Integration Other (department security)';
const SECRET_EMAIL = 'secret-member@integration.invalid';
const SECRETS = {
  password: '$2a$10$integration.secret.member.hash',
  ctcAnnual: 'CTC-7700000', basicSalary: 'BASIC-660000', salaryStructure: 'STRUCT-SECRET',
  bankName: 'BANK-SECRET', accountNumber: 'ACCT-11223344', ifscCode: 'IFSC-SECRET', accountHolderName: 'HOLDER-SECRET',
  paymentMode: 'MODE-SECRET', panNumber: 'PANXX9999Z', aadhaarNumber: '1111-2222-3333', uanNumber: 'UAN-SECRET',
  hrNotes: 'HR-NOTE-SECRET', taxRegime: 'REGIME-SECRET',
};

describe('Department detail: scoped, and never returns confidential fields (HTTP)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let prisma: PrismaService;
  let ownDeptId: string;
  let otherDeptId: string;

  const get = async (role: RoleKey, path: string) =>
    request(app.getHttpServer()).get(`/api${path}`).set('Authorization', await bearerFor(app, role));

  const expectNoSecrets = (body: unknown) => {
    const json = JSON.stringify(body);
    for (const v of Object.values(SECRETS)) expect(json).not.toContain(v);
    expect(json).not.toMatch(/"\$2[aby]\$\d\d\$/); // no bcrypt hash of any account
    for (const f of Object.keys(SECRETS)) expect(json).not.toMatch(new RegExp(`"${f}"\\s*:`));
  };

  beforeAll(async () => {
    ({ app, close } = await createTestApp());
    prisma = app.get(PrismaService);
    ownDeptId = (await prisma.department.findUniqueOrThrow({ where: { name: INTEGRATION_DEPARTMENT } })).id;
    otherDeptId = (await prisma.department.upsert({ where: { name: OTHER_DEPT }, update: {}, create: { name: OTHER_DEPT } })).id;
    const employeeRole = await prisma.role.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } });
    await prisma.user.upsert({
      where: { email: SECRET_EMAIL },
      update: { ...SECRETS, isActive: true, departmentId: ownDeptId },
      create: { email: SECRET_EMAIL, name: 'Secret Member', roleId: employeeRole.id, departmentId: ownDeptId, isActive: true, ...SECRETS } as any,
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: SECRET_EMAIL } });
    await prisma.department.deleteMany({ where: { name: OTHER_DEPT } });
    clearTokenCache();
    await close();
  });

  it.each([
    ['superadmin', 'own', 200], ['superadmin', 'other', 200],
    ['admin', 'own', 200], ['admin', 'other', 200],
    ['manager', 'own', 200], ['manager', 'other', 403],
    ['teamlead', 'own', 200], ['teamlead', 'other', 403],
    ['employee', 'own', 403], ['employee', 'other', 403],
    ['intern', 'own', 403], ['intern', 'other', 403],
  ] as Array<[RoleKey, 'own' | 'other', number]>)('%s → %s department: %i', async (role, which, want) => {
    const id = which === 'own' ? ownDeptId : otherDeptId;
    const detail = await get(role, `/departments/${id}`);
    expect(detail.status).toBe(want);
    const head = await get(role, `/departments/${id}/managers`);
    expect(head.status).toBe(want);
    expectNoSecrets(detail.body);
    expectNoSecrets(head.body);
  });

  it('without a token the detail is 401', async () => {
    await request(app.getHttpServer()).get(`/api/departments/${ownDeptId}`).expect(401);
  });

  it('an allowed detail lists members (the secret-carrying one included) with safe fields only', async () => {
    const res = await get('admin', `/departments/${ownDeptId}`);
    expect(res.status).toBe(200);
    const users: any[] = res.body.users ?? res.body.data?.users;
    const member = users.find((u) => u.email === SECRET_EMAIL);
    expect(member).toBeDefined();
    expect(Object.keys(member).sort()).toEqual(['_count', 'avatar', 'departmentId', 'email', 'id', 'isActive', 'name', 'role'].sort());
    expectNoSecrets(res.body);
  });

  it('the department list carries no confidential fields for any role', async () => {
    for (const role of ['superadmin', 'admin', 'manager', 'teamlead', 'employee', 'intern'] as RoleKey[]) {
      const res = await get(role, '/departments');
      expect(res.status).toBe(200);
      expectNoSecrets(res.body);
    }
  });
});
