# shared/auth/

Authentication and authorization primitives used by every platform.

**Status: Phase 0 — empty scaffold.** Live code is
`backend/src/shared/{guards,decorators,constants,interfaces}/` and
`frontend/lib/roles.ts`.

## Why guards live here and not in `core/identity`

Every controller in every platform uses `JwtAuthGuard` and `RolesGuard`. If
they lived in `platforms/core/identity/authorization`, then `operations`,
`workforce`, `business` and `system` would each import `core/` for a decorator
— coupling the entire system to one component for something that is
infrastructure, not a core business rule.

The *policy* (who may see which department's data) stays in
`core/identity/authorization`. The *mechanism* (a guard that reads a JWT) is
here.

## May live here

- `JwtAuthGuard`, `RolesGuard`, `AppThrottlerGuard`.
- `@Roles()`, `@CurrentUser()` decorators.
- The role-name constant — exactly six roles: `SUPER_ADMIN`, `ADMIN`,
  `MANAGER`, `TEAM_LEAD`, `EMPLOYEE`, `INTERN`.
- `UserPayload` interface.
- Frontend role helpers.

## Must not live here

- Scope resolution — which departments a manager may see is
  `core/identity/authorization`.
- User lookup or persistence — that is `core/users`.
- Login, token issuance, password recovery — that is
  `core/identity/authentication`.

## A note on `isHR`

`isHR` is a boolean on `User`, independent of role. Any guard or helper here
that considers it must treat it as a modifier, not a seventh role. There is a
known open inconsistency where a route guard checks role only while the service
layer honours `isHR` — resolve that before this module is relied upon for
leave-approval decisions.

## Dependency direction

```
platforms/* → shared/auth
apps/*      → shared/auth
shared/auth → shared/contracts (types only)
```

Never imports `platforms/` or `apps/`.
