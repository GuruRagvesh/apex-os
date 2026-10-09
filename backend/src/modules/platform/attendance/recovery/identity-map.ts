/**
 * Employee identity for recovery: employeeId → the current User.id.
 *
 *   0 current users  → MISSING_REFERENCE
 *   1 current user   → RESOLVED
 *   2+               → CONFLICT
 *
 * Exact match on employeeId only. Never by name, never by email, never by a
 * historic UUID, and never by creating a user. (employeeId is @unique today, so
 * CONFLICT should be unreachable; it is still handled, because a recovery tool
 * must not assume the constraint it would be the first to violate.)
 */

export type IdentityResolution =
  | { state: 'RESOLVED'; userId: string }
  | { state: 'MISSING_REFERENCE' }
  | { state: 'CONFLICT'; userIds: string[] };

export type EmployeeIndex = Map<string, string[]>;

export function buildEmployeeIndex(users: Array<{ id: string; employeeId: string | null }>): EmployeeIndex {
  const index: EmployeeIndex = new Map();
  for (const u of users) {
    if (!u.employeeId) continue;
    index.set(u.employeeId, [...(index.get(u.employeeId) ?? []), u.id]);
  }
  return index;
}

export function resolveEmployee(employeeId: string | null | undefined, index: EmployeeIndex): IdentityResolution {
  if (!employeeId) return { state: 'MISSING_REFERENCE' };
  const hits = index.get(employeeId) ?? [];
  if (hits.length === 1) return { state: 'RESOLVED', userId: hits[0] };
  if (hits.length === 0) return { state: 'MISSING_REFERENCE' };
  return { state: 'CONFLICT', userIds: [...hits].sort() };
}
