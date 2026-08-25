export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN:       'ADMIN',
  MANAGER:     'MANAGER',
  TEAM_LEAD:   'TEAM_LEAD',
  EMPLOYEE:    'EMPLOYEE',
  INTERN:      'INTERN',
} as const;

export type RoleName = typeof ROLES[keyof typeof ROLES];

/**
 * The canonical Apex OS role ladder.
 *
 * `level` is authority, and LOWER is more senior: LeaveAccessService refuses an
 * approval when `approver.role.level >= target.role.level`, so the ordering here
 * is not cosmetic — it decides who can approve whose leave.
 *
 * This is the single definition. `prisma/seed.ts` and the staging RBAC
 * initializer both read it, so a database cannot end up with two different
 * ideas of what MANAGER outranks.
 */
export interface CanonicalRole {
  name: RoleName;
  level: number;
  description: string;
}

export const CANONICAL_ROLES: readonly CanonicalRole[] = [
  { name: ROLES.SUPER_ADMIN, level: 0, description: 'Super administrator — unrestricted access' },
  { name: ROLES.ADMIN,       level: 1, description: 'Full system access' },
  { name: ROLES.MANAGER,     level: 2, description: 'Department management access' },
  { name: ROLES.TEAM_LEAD,   level: 3, description: 'Team oversight and task management' },
  { name: ROLES.EMPLOYEE,    level: 4, description: 'Standard employee access' },
  { name: ROLES.INTERN,      level: 5, description: 'Intern access' },
] as const;

/** Guards against an accidental edit changing the approved ladder size. */
export const CANONICAL_ROLE_COUNT = 6;
