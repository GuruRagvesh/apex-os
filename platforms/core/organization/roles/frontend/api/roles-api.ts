// Core Organization Roles — roles registry HTTP API.
//
// Moved verbatim from frontend/lib/api.ts. Every method name, argument,
// endpoint, verb, payload, unwrap and return value is unchanged: this is a
// transport relocation, not a refactor.
//
// WHY THIS COMPONENT OWNS IT
// --------------------------
// The roles registry is a real domain, evidenced independently of this move:
// a DB-backed Role entity with a hierarchy level, a UserRoleAssignment join
// model carrying department and team scope, a dedicated backend module at
// backend/src/modules/core/roles/ with admin-guarded mutations, and a
// migration-map entry sending that module to this component's backend/.
//
// REGISTRY, NOT ENFORCEMENT
// -------------------------
// This file moves role RECORDS over HTTP. It decides nothing. Authorization
// enforcement stays in shared/auth (roles.guard.ts and the static ROLES
// vocabulary in constants/roles.ts), and assigning a role to a user stays in
// core/users. Nothing here may read a request or grant permission.
//
// create, update and remove have ZERO frontend consumers today -- all four
// current callers use getAll() to populate a dropdown. They are preserved
// verbatim under R100 rather than dropped: the backend exposes them behind
// @Roles(ADMIN, SUPER_ADMIN), and a roles administration surface may be built
// later. Retiring them is a separate decision.
//
// Published as '@apex/core-organization-roles/api', never through the
// component root barrel, so a consumer that wants the registry never loads
// the authenticated client for anything else.

import { api, unwrap as r } from '@apex/shared-auth';

export const rolesApi = {
  getAll: () => r(api.get('/roles')),
  create: (data: any) => r(api.post('/roles', data)),
  update: (id: string, data: any) => r(api.put(`/roles/${id}`, data)),
  remove: (id: string) => r(api.delete(`/roles/${id}`)),
};
