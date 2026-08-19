# Core Organization — roles

**Status:** Component established. API ownership lands next; backend deferred.
**Established:** 2026-08-19

The roles registry: the list of roles, their names, their hierarchy `level` and
their descriptions. This is the *entity* domain, not the enforcement domain --
see the boundary note below, which is the most important thing on this page.

---

## Why this component exists

It was not invented to satisfy a debt record. Four independent sources named
this owner before the component was created:

| Source | Evidence |
| --- | --- |
| Prisma | `model Role { id, name @unique, level, description }` — a real DB entity, not a static enum |
| Prisma | `model UserRoleAssignment { userId, roleId, departmentId?, teamId?, isPrimary }` — RBAC with department and team scoping |
| Backend | `backend/src/modules/core/roles/` — dedicated controller, `RolesService` and module; mutations guarded by `@Roles(ADMIN, SUPER_ADMIN)` |
| Migration map | `backend/src/modules/core/roles/*` → `platforms/core/organization/roles/backend/` |

The departments sibling also names it: that component's own `index.ts` says
"The roles registry belongs to core/organization/roles".

The path follows the established convention — backend `core/departments` maps
to frontend `platforms/core/organization/departments`, so backend `core/roles`
maps here.

## This component owns the registry. It does not own enforcement.

That distinction decides what may and may not move here.

| Concern | Owner |
| --- | --- |
| Role records: list, create, update, delete | **here** |
| Role hierarchy (`level`) as data | **here** |
| Deciding whether a request is allowed | `shared/auth` — `guards/roles.guard.ts` |
| The static `ROLES` vocabulary used by guards | `shared/auth` — `constants/roles.ts` |
| Assigning a role to a user | `core/users` — `User.roleId`, `users.service` |
| Login, sessions, tokens | `core/identity` |

Authorization enforcement is already separated in the codebase and stays that
way. Nothing in this component may read a request, inspect a caller or decide
permission.

## Public API

| Specifier | Purpose |
| --- | --- |
| `@apex/core-organization-roles` | Component entry |

`@apex/core-organization-roles/api` follows in the next commit, when `rolesApi`
moves here from `frontend/lib/api.ts`.

## Frontend scope today

There are **no screens**. No roles administration UI exists in the application;
the four current consumers all call `rolesApi.getAll()` to populate a dropdown.
`create`, `update` and `remove` exist as transport with zero frontend callers —
they are preserved verbatim under R100 rather than dropped, because the backend
exposes them and an admin surface may be built later.

That is why this component has no `frontend/screens/` folder. An empty one
would be symmetry for its own sake.

## Backend

**Not migrated.** `backend/src/modules/core/roles/` stays put. Backend slices
are blocked until the Render deployment root moves. The map already records the
destination.

## Behaviour

Nothing runtime changed when this component was created. It is a boundary and a
document; the first code arrives with the API.
