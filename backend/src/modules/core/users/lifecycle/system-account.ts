/**
 * The "Deleted account" principal: a row in `users` that is not a person.
 *
 * After a permanent deletion, shared records that require an author (ticket
 * creator, comment author, ticket history, audit actor) point here rather than
 * at a real administrator who never did that work.
 *
 * It can never sign in or appear as an employee: inactive, isSystemAccount,
 * no department or memberships, and a password value no bcrypt comparison can
 * match. Login, JWT, OTP, rehire, reactivation, archive and deletion all
 * refuse it, and user lists exclude it via humanUsersOnly().
 */

export const DELETED_ACCOUNT = {
  id: 'system-deleted-account',
  email: 'deleted-account@system.invalid',
  name: 'Deleted account',
  /** Not a bcrypt hash: bcrypt.compare() always returns false for it. */
  password: '!disabled-no-login!',
} as const;

/** The where-fragment every human-user list must include. */
export function humanUsersOnly(): { isSystemAccount: false } {
  return { isSystemAccount: false };
}

/**
 * Creates the principal if it is missing. Idempotent. The role is resolved by
 * name and must exist; nothing is guessed.
 */
export async function ensureDeletedAccount(db: any): Promise<void> {
  const existing = await db.user.findUnique({ where: { id: DELETED_ACCOUNT.id }, select: { id: true, isSystemAccount: true, isActive: true } });
  if (existing) {
    if (!existing.isSystemAccount || existing.isActive) {
      throw new Error('SYSTEM_ACCOUNT_INVALID');
    }
    return;
  }
  const role = await db.role.findUnique({ where: { name: 'INTERN' }, select: { id: true } });
  if (!role) throw new Error('SYSTEM_ACCOUNT_ROLE_MISSING');
  await db.user.create({
    data: {
      id: DELETED_ACCOUNT.id,
      email: DELETED_ACCOUNT.email,
      name: DELETED_ACCOUNT.name,
      password: DELETED_ACCOUNT.password,
      isActive: false,
      isSystemAccount: true,
      mustChangePassword: false,
      roleId: role.id,
      departmentId: null,
    },
  });
}
