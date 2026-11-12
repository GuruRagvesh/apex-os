// Default department view for Admin / Super Admin.
//
// When an admin switches it on (Home → "Default department"), every page and
// action works as if that department were the whole company: the admin keeps
// all powers, but only over that department's people and records (plus their
// own). Stored in the user's preferences; JwtStrategy copies the active
// department onto req.user as `viewDepartmentId` for every request.

export const VIEW_SCOPE_PREF = 'viewScope';

/** Request header (lower-case, as Node delivers it) a company-wide page sends so its requests are never narrowed. */
export const VIEW_SCOPE_HEADER = 'x-view-scope';

export interface ViewScopePreference {
  enabled: boolean;
  departmentId: string | null;
}

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

function roleOf(user: any): string {
  const role = user?.role;
  return typeof role === 'string' ? role : role?.name ?? '';
}

/** The department an admin has narrowed their view to, or null for the whole company. */
export function viewDepartmentOf(user: any): string | null {
  if (!ADMIN_ROLES.includes(roleOf(user))) return null;
  return typeof user?.viewDepartmentId === 'string' && user.viewDepartmentId ? user.viewDepartmentId : null;
}

/** The active department from a stored preferences object, or null. */
export function activeViewDepartment(prefs: any): string | null {
  const scope = prefs?.[VIEW_SCOPE_PREF];
  return scope?.enabled === true && typeof scope.departmentId === 'string' && scope.departmentId ? scope.departmentId : null;
}

export function isAdminRole(user: any): boolean {
  return ADMIN_ROLES.includes(roleOf(user));
}
