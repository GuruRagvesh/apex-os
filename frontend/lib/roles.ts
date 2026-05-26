/**
 * Apex OS — canonical role definitions for the frontend.
 *
 * Single source of truth for all role-name strings used in:
 *   - Page-level access guards
 *   - Sidebar visibility checks
 *   - Analytics/settings access checks
 *   - API request filtering
 *
 * Must stay in sync with backend/src/shared/constants/roles.ts and the
 * Role records seeded in the database. Do NOT add values here without
 * adding them to the backend constant and the DB seed simultaneously.
 *
 * Stage 2 — Role and Permission Stabilization
 */

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
 * Ordered hierarchy (lower index = higher privilege).
 * Use for "can this role see what that role sees?" checks.
 */
export const ROLE_HIERARCHY: RoleName[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.TEAM_LEAD,
  ROLES.EMPLOYEE,
  ROLES.INTERN,
];

/** Returns true if roleA has equal or higher privilege than roleB. */
export function roleAtLeast(roleA: string, roleB: RoleName): boolean {
  const idxA = ROLE_HIERARCHY.indexOf(roleA as RoleName);
  const idxB = ROLE_HIERARCHY.indexOf(roleB);
  if (idxA === -1) return false; // unknown role has no privilege
  return idxA <= idxB;
}

/**
 * Helper: returns the role name string from a user object regardless
 * of whether role is stored as an object { name } or a plain string.
 * Zustand sometimes hydrates either form depending on the API response.
 */
export function getRoleName(role: unknown): RoleName | '' {
  if (!role) return '';
  if (typeof role === 'string') return role as RoleName;
  if (typeof role === 'object' && 'name' in (role as object)) {
    return (role as { name: string }).name as RoleName;
  }
  return '';
}
