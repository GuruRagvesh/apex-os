/**
 * Historical identity for a former employee: only when provably safe, minimal, inactive, unusable for login.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcryptjs';
import {
  IDENTITY_CONFIRM_PHRASE, PRODUCTION_IDENTITY_CONFIRM_PHRASE, createHistoricalIdentities, planHistoricalIdentity, placeholderEmail, type ExistingUser, type FormerEmployeeMaster, type IdentityGuard,
} from '../../scripts/attendance-recovery-apply/historical-identity';

const ROLES = ['ADMIN', 'EMPLOYEE', 'INTERN', 'MANAGER', 'SUPER_ADMIN', 'TEAM_LEAD'];
const m = (over: Partial<FormerEmployeeMaster> = {}): FormerEmployeeMaster => ({ employeeId: 'OWN0018', name: 'Balendu Anand', employeeType: 'Employee', designation: null, ...over });
const user = (over: Partial<ExistingUser> = {}): ExistingUser => ({ id: 'u1', name: 'Someone Else', employeeId: null, email: 'someone@example.com', isActive: true, ...over });

describe('planning', () => {
  it('plans an inactive, minimal identity with an undeliverable placeholder email', () => {
    const p = planHistoricalIdentity(m(), [user()], ROLES);
    expect(p.ok).toBe(true);
    expect(p.data).toEqual({ email: 'own0018@former-employee.invalid', name: 'Balendu Anand', roleName: 'EMPLOYEE', employeeId: 'OWN0018', employmentType: 'Full-time', designation: null, isActive: false });
    expect(placeholderEmail('OWN0018')).toMatch(/\.invalid$/);
  });

  it.each([
    ['Consultant', 'EMPLOYEE', 'Consultant'],
    ['intern', 'INTERN', 'Intern'],
  ])('maps Employee Master type "%s" to role %s without inventing a role', (type, role, employmentType) => {
    expect(planHistoricalIdentity(m({ employeeType: type }), [], ROLES).data).toMatchObject({ roleName: role, employmentType });
  });

  it('never sets department, joining date or leaving date: no HR master data is written', () => {
    expect(Object.keys(planHistoricalIdentity(m(), [], ROLES).data!).sort()).toEqual(['designation', 'email', 'employeeId', 'employmentType', 'isActive', 'name', 'roleName']);
  });

  it.each([
    ['the Employee ID is already assigned', [user({ employeeId: 'OWN0018' })], m(), 'EMPLOYEE_ID_ALREADY_ASSIGNED'],
    ['an Apex user already has that exact name', [user({ name: 'balendu  ANAND' })], m(), 'NAME_ALREADY_EXISTS'],
    ['the placeholder email is taken', [user({ email: 'OWN0018@former-employee.invalid' })], m(), 'EMAIL_ALREADY_EXISTS'],
    ['a first-name-only account exists (possible same person)', [user({ name: 'Vishal', isActive: false })], m({ employeeId: 'OWN0028', name: 'Vishal Bornare' }), 'FIRST_NAME_ONLY_ACCOUNT_EXISTS'],
    ['the master has no name', [], m({ name: ' ' }), 'NO_NAME'],
    ['the employee type has no Apex role', [], m({ employeeType: 'Director' }), 'ROLE_NOT_FOUND'],
  ])('refuses when %s', (_l, users, master, code) => {
    expect(planHistoricalIdentity(master, users as ExistingUser[], ROLES).code).toBe(code);
  });

  it('does not treat a longer name that merely starts the same way as a first-name-only account', () => {
    expect(planHistoricalIdentity(m({ employeeId: 'OWN0028', name: 'Vishal Bornare' }), [user({ name: 'Vishal Patel' })], ROLES).ok).toBe(true);
  });
});

describe('creating', () => {
  const guard = (over: Partial<IdentityGuard> = {}): IdentityGuard => ({ appEnv: 'staging', stagingIdentityProven: true, confirmation: IDENTITY_CONFIRM_PHRASE, ...over });
  const plan = planHistoricalIdentity(m(), [], ROLES).data!;
  const fakeDb = (clash: any[] = []) => {
    const created: any[] = [];
    const tx = {
      role: { findMany: jest.fn(async () => ROLES.map((name, i) => ({ id: `r${i}`, name }))) },
      user: { findMany: jest.fn(async () => clash), create: jest.fn(async (a: any) => { created.push(a.data); return { id: `new-${created.length}` }; }) },
    };
    return { db: { $transaction: async (fn: any) => fn(tx) } as any, tx, created };
  };

  it.each([
    ['development', { appEnv: 'development' }, 'APP_ENV_NOT_STAGING'],
    ['unset APP_ENV', { appEnv: undefined }, 'APP_ENV_NOT_STAGING'],
    ['unproven staging identity', { stagingIdentityProven: false }, 'STAGING_IDENTITY_NOT_PROVEN'],
    ['no approval phrase', { confirmation: '' }, 'CONFIRMATION_MISSING'],
    ['production without proof of the production database', { appEnv: 'production', confirmation: PRODUCTION_IDENTITY_CONFIRM_PHRASE, verifiedBackupKey: 'k' }, 'PRODUCTION_IDENTITY_NOT_PROVEN'],
    ['production without a verified backup', { appEnv: 'production', confirmation: PRODUCTION_IDENTITY_CONFIRM_PHRASE, productionIdentityProven: true }, 'BACKUP_NOT_VERIFIED'],
    ['production with the staging phrase', { appEnv: 'production', productionIdentityProven: true, verifiedBackupKey: 'k' }, 'CONFIRMATION_MISSING'],
    ['production, proof of staging only', { appEnv: 'production', confirmation: PRODUCTION_IDENTITY_CONFIRM_PHRASE, verifiedBackupKey: 'k' }, 'PRODUCTION_IDENTITY_NOT_PROVEN'],
  ])('refuses with %s before touching anything', async (_l, over, code) => {
    const f = fakeDb();
    await expect(createHistoricalIdentities(f.db, [plan], guard(over as any))).rejects.toMatchObject({ code });
    expect(f.tx.user.create).not.toHaveBeenCalled();
  });

  it('creates in production only with proof of the database, a verified backup key and the production phrase', async () => {
    const f = fakeDb();
    const r = await createHistoricalIdentities(f.db, [plan], guard({ appEnv: 'production', productionIdentityProven: true, verifiedBackupKey: 'database/daily/x.dump', confirmation: PRODUCTION_IDENTITY_CONFIRM_PHRASE }));
    expect(r).toHaveLength(1);
    expect(f.created[0]).toMatchObject({ isActive: false, employeeId: 'OWN0018' });
  });

  it('creates an INACTIVE user whose password is an unknown bcrypt hash', async () => {
    const f = fakeDb();
    const r = await createHistoricalIdentities(f.db, [plan], guard());
    expect(r).toEqual([{ employeeId: 'OWN0018', userId: 'new-1' }]);
    const data = f.created[0];
    expect(data).toMatchObject({ isActive: false, employeeId: 'OWN0018', email: 'own0018@former-employee.invalid', name: 'Balendu Anand' });
    expect(data.password).toMatch(/^\$2[aby]\$10\$/);
    expect(data.password).toHaveLength(60);
    expect(await bcrypt.compare('', data.password)).toBe(false);
    expect(Object.keys(data).sort()).toEqual(['designation', 'email', 'employeeId', 'employmentType', 'isActive', 'name', 'password', 'roleId']);
  });

  it('two identities never share a password hash', async () => {
    const f = fakeDb();
    await createHistoricalIdentities(f.db, [plan, { ...plan, employeeId: 'OWN0043', email: 'own0043@former-employee.invalid', name: 'Sahil Waykar' }], guard());
    expect(f.created[0].password).not.toBe(f.created[1].password);
  });

  it('re-checks for a collision INSIDE the transaction and creates nothing if one appeared', async () => {
    const f = fakeDb([{ id: 'appeared' }]);
    await expect(createHistoricalIdentities(f.db, [plan], guard())).rejects.toMatchObject({ code: 'RACE_COLLISION' });
    expect(f.tx.user.create).not.toHaveBeenCalled();
  });

  it('can only create: no update, delete or upsert, no raw SQL, and no other model', () => {
    const c = fs.readFileSync(path.join(__dirname, '../../scripts/attendance-recovery-apply/historical-identity.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(c.match(/\.(update|updateMany|upsert|delete|deleteMany|createMany)\s*\(|\$executeRaw|\$queryRaw/)).toBeNull();
    expect((c.match(/\.create\(/g) ?? []).length).toBe(1);
    expect(c).not.toMatch(/dailyAttendance|workSession|attendancePunchEvidence|breakLog|attendanceRegularization/);
  });

  it('is not imported by anything in src/ (unreachable from the running application)', () => {
    const hits: string[] = [];
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.ts$/.test(e.name) && /historical-identity/.test(fs.readFileSync(p, 'utf8'))) hits.push(p); } };
    walk(path.join(__dirname, '../../src'));
    expect(hits).toEqual([]);
  });
});
