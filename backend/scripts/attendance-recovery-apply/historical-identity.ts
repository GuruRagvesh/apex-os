import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';

/**
 * A historical identity for a FORMER employee, so recovered attendance has a User to attach to.
 *
 * Every attendance table requires a userId, and there is no person entity independent of User. Apex
 * already keeps former staff as INACTIVE users (login and token validation both reject isActive=false),
 * so that is the pattern used. It is created only when it is provably safe, and the minimum is created:
 *
 *   name, employeeId, employment type, role      from the Employee Master (the authoritative source)
 *   email        a reserved, undeliverable placeholder (@former-employee.invalid)
 *   password     a bcrypt hash of 48 random bytes that are discarded at once: nobody knows it
 *   isActive     false
 *
 * NOT set: department, joining date, last working date, manager. Setting them would be HR master data
 * the recovery has no mandate to write, and the recovered facts do not need them.
 *
 * LIVES IN scripts/, like the attendance writer: not compiled into the application, imported by nothing.
 */

export const IDENTITY_CONFIRM_PHRASE = 'CREATE STAGING HISTORICAL IDENTITIES';

export interface FormerEmployeeMaster {
  employeeId: string;
  name: string;
  /** Employee Master "Employee Type": Employee / intern / Consultant. */
  employeeType: string;
  designation: string | null;
}
export interface ExistingUser { id: string; name: string; employeeId: string | null; email: string; isActive: boolean }

export type IdentityRefusal =
  | 'NO_NAME'
  | 'EMPLOYEE_ID_ALREADY_ASSIGNED'
  | 'NAME_ALREADY_EXISTS'
  | 'EMAIL_ALREADY_EXISTS'
  | 'FIRST_NAME_ONLY_ACCOUNT_EXISTS'
  | 'ROLE_NOT_FOUND';

export interface IdentityPlan {
  ok: boolean;
  code?: IdentityRefusal;
  reason?: string;
  data?: { email: string; name: string; roleName: string; employeeId: string; employmentType: string; designation: string | null; isActive: false };
}

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const ROLE_FOR_TYPE: Record<string, { role: string; employmentType: string }> = {
  employee: { role: 'EMPLOYEE', employmentType: 'Full-time' },
  consultant: { role: 'EMPLOYEE', employmentType: 'Consultant' },
  intern: { role: 'INTERN', employmentType: 'Intern' },
};

export function placeholderEmail(employeeId: string): string {
  return `${employeeId.toLowerCase()}@former-employee.invalid`;
}

/** Decides whether a historical identity can be created. Pure; every refusal is a code, never a guess. */
export function planHistoricalIdentity(m: FormerEmployeeMaster, users: ExistingUser[], roleNames: string[]): IdentityPlan {
  const refuse = (code: IdentityRefusal, reason: string): IdentityPlan => ({ ok: false, code, reason });
  const name = m.name.trim();
  if (!name) return refuse('NO_NAME', 'the Employee Master record has no name');
  if (users.some((u) => u.employeeId === m.employeeId)) return refuse('EMPLOYEE_ID_ALREADY_ASSIGNED', `${m.employeeId} already belongs to an Apex user`);
  if (users.some((u) => norm(u.name) === norm(name))) return refuse('NAME_ALREADY_EXISTS', 'an Apex user already has this exact name; map that user instead of creating another');
  const email = placeholderEmail(m.employeeId);
  if (users.some((u) => u.email.toLowerCase() === email)) return refuse('EMAIL_ALREADY_EXISTS', 'the placeholder email is taken');
  // A first-name-only account ("Vishal") is the usual shape of an existing identity for the same person.
  // Creating a second one would be a duplicate, so a human must decide.
  const first = norm(name).split(' ')[0];
  if (users.some((u) => norm(u.name) === first && first.length >= 3)) {
    return refuse('FIRST_NAME_ONLY_ACCOUNT_EXISTS', `an Apex user is named just "${first}"; this may be the same person, so no second identity is created`);
  }
  const map = ROLE_FOR_TYPE[m.employeeType.trim().toLowerCase()];
  if (!map || !roleNames.includes(map.role)) return refuse('ROLE_NOT_FOUND', `no Apex role for employee type "${m.employeeType}"`);
  return { ok: true, data: { email, name, roleName: map.role, employeeId: m.employeeId, employmentType: map.employmentType, designation: m.designation?.trim() || null, isActive: false } };
}

/** Production needs its own phrase, proof of the exact production database, AND a verified pre-change backup. */
export const PRODUCTION_IDENTITY_CONFIRM_PHRASE = 'CREATE PRODUCTION HISTORICAL IDENTITIES';

export interface IdentityGuard {
  appEnv: string | undefined;
  stagingIdentityProven: boolean;
  confirmation: string;
  /** Production only: the exact production host and database were proven. */
  productionIdentityProven?: boolean;
  /** Production only: key of the verified pre-change backup. */
  verifiedBackupKey?: string;
}
export class IdentityRefused extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); this.name = 'IdentityRefused'; }
}
export function assertIdentityCreationAllowed(g: IdentityGuard): void {
  const env = (g.appEnv ?? '').trim();
  if (env === 'production') {
    if (g.productionIdentityProven !== true) throw new IdentityRefused('PRODUCTION_IDENTITY_NOT_PROVEN', 'the exact production database was not proven');
    if (!g.verifiedBackupKey) throw new IdentityRefused('BACKUP_NOT_VERIFIED', 'no verified pre-change backup was supplied');
    if (g.confirmation !== PRODUCTION_IDENTITY_CONFIRM_PHRASE) throw new IdentityRefused('CONFIRMATION_MISSING', 'the approval phrase was not supplied');
    return;
  }
  if (env !== 'staging') throw new IdentityRefused('APP_ENV_NOT_STAGING', 'historical identities are created in staging or (with a verified backup) production only');
  if (g.stagingIdentityProven !== true) throw new IdentityRefused('STAGING_IDENTITY_NOT_PROVEN', 'the exact active staging database was not proven');
  if (g.confirmation !== IDENTITY_CONFIRM_PHRASE) throw new IdentityRefused('CONFIRMATION_MISSING', 'the approval phrase was not supplied');
}

/** The slice of a Prisma transaction used. Reads to re-check, and ONE create. */
export interface IdentityTx {
  user: {
    findMany: (args: any) => Promise<any[]>;
    create: (args: { data: any; select: { id: true } }) => Promise<{ id: string }>;
  };
  role: { findMany: (args: any) => Promise<Array<{ id: string; name: string }>> };
}
export interface IdentityDb { $transaction: <T>(fn: (tx: IdentityTx) => Promise<T>, options?: any) => Promise<T> }

export interface CreatedIdentity { employeeId: string; userId: string }

export async function createHistoricalIdentities(db: IdentityDb, plans: Array<NonNullable<IdentityPlan['data']>>, guard: IdentityGuard): Promise<CreatedIdentity[]> {
  assertIdentityCreationAllowed(guard);
  if (plans.length === 0) throw new IdentityRefused('NOTHING_TO_CREATE', 'no identities were supplied');
  return db.$transaction(async (tx) => {
    const roles = await tx.role.findMany({ select: { id: true, name: true } });
    const out: CreatedIdentity[] = [];
    for (const p of plans) {
      // Re-checked INSIDE the transaction that would write: the plan may be minutes old.
      const clash = await tx.user.findMany({ where: { OR: [{ employeeId: p.employeeId }, { email: p.email }] }, select: { id: true } });
      if (clash.length) throw new IdentityRefused('RACE_COLLISION', `${p.employeeId} or its placeholder email appeared since planning`);
      const roleId = roles.find((r) => r.name === p.roleName)?.id;
      if (!roleId) throw new IdentityRefused('ROLE_NOT_FOUND', p.roleName);
      // The plaintext exists only in this expression and is never stored, returned or logged.
      const password = await bcrypt.hash(randomBytes(48).toString('hex'), 10);
      const created = await tx.user.create({
        data: { email: p.email, name: p.name, password, roleId, isActive: false, employeeId: p.employeeId, employmentType: p.employmentType, designation: p.designation },
        select: { id: true },
      });
      out.push({ employeeId: p.employeeId, userId: created.id });
    }
    return out;
  }, { timeout: 60_000 });
}
