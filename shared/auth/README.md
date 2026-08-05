# shared/auth/

Authentication and authorization primitives used by every platform.

**Status: partially migrated.** The **frontend authenticated HTTP client**
lives here as of Phase 2C. The backend half (guards, decorators, role
constants, `UserPayload`) is still `backend/src/shared/{guards,decorators,constants,interfaces}/`,
and `frontend/lib/roles.ts` has not moved.

## The authenticated HTTP client

`frontend/authenticated-api-client.ts` — moved verbatim from
`frontend/lib/api.ts` in Phase 2C. It owns, and is the only owner of:

- the single `axios.create()` for the application
- the resolved API base URL (`API_BASE_URL`)
- the `Bearer` token request interceptor
- the one-time `nexus_*` → `apex_*` localStorage key migration
- the 401 response handling: clears `apex_token` / `apex-auth`, redirects to
  `/login?expired=true` unless already under `/login`
- the 403 and array-message error normalisation
- `unwrap` — the typed helper reflecting that the response interceptor already
  returned `response.data`

**Singleton.** This must remain the only production `axios.create()`. A second
instance would silently drop the interceptors; a second registration would run
the 401 redirect twice. A self-test asserts both, and that the token keys, the
migration keys and the redirect string are unchanged.

**Why it is here and not in `core/identity`.** Same argument as the guards
below: attaching a token to a request is *mechanism*, used by every platform.
Login, token issuance and password recovery are *policy* and belong to
`core/identity/authentication`.

### Public entry point

```ts
import { api, unwrap, API_BASE_URL } from '@apex/shared-auth';
```

`shared/auth/index.ts` is the only importable path. Reaching into
`shared/auth/frontend/**` from outside the module is a boundary violation
(`shared-module-public-entry`), enforced for static imports, dynamic `import()`
and `require()`.

### A constraint for whoever migrates the backend half

`index.ts` currently does `export * from './frontend'`. When Nest guards land
here it must **stop** doing that — a guard importing `@apex/shared-auth` would
otherwise pull axios and browser-only localStorage code into the server bundle.
Split it into explicit frontend and backend entry points at that point.

### Dependency rules

`shared/auth` must not import `platforms/**`, `apps/**`, or the legacy
`frontend/**` and `backend/**` roots. Unlike `platforms/**`, there is **no**
exemption mechanism: this is new code with no migration history to carry, and
it has to stay importable from a process where `frontend/` does not exist.
Self-tests cover all of these.

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
