# Core Identity — authentication

**Status:** State boundary only. The store itself has **not** moved.
**Created:** 2026-08-06
**Debt identifier:** `DEBT-P7-CORE-IDENTITY-AUTH-STORE` (1 import)

This phase created a **public boundary**, not a relocation. `frontend/store/auth.store.ts`
was not moved, not modified, and not wrapped.

---

## What this component publishes

One binding: `useAuthStore`, re-exported unchanged from the legacy store.

```ts
import { useAuthStore } from '@apex/core-identity';
```

`frontend/state/auth-store.adapter.ts` is a **single `export … from` line**. It is
not a wrapper. A self-test rejects `create(`, `persist(`, `useState`, `useEffect`,
`useMemo` and `zustand` appearing in it, because any of those would mean a second
store or a changed subscription — and a second Zustand store means a second
persisted state.

## Why the store did not move

Three reasons, in order of weight:

1. **29 legacy consumers** still import `@/store/auth.store` directly. Moving the
   store means rewriting all of them in one change.
2. **No frontend test covers authentication.** There is no test for login, logout,
   hydration or the 401 path anywhere in the repository. The only auth tests are
   backend (`auth.otp`, `auth.throttle`).
3. **Hydration timing is load-bearing.** `frontend/app/(dashboard)/layout.tsx`
   records the reason directly: *redirecting while `hasHydrated` is false is what
   logged users out on every refresh.* Twelve consumers gate on that flag.

Relocating under those conditions risks logging every user out. The adapter gets
the boundary benefit now and defers the risk to a staging-validated phase.

## The invisible contract

`auth.store` and `shared/auth` are coupled through **localStorage keys, with no
import between them**. Nothing in the type system or the import graph expresses
this:

| Key | `auth.store` | `shared/auth` client |
| --- | --- | --- |
| `apex_token` | writes on `setAuth`, removes on `logout` | reads per request; removes on 401 |
| `apex-auth` | Zustand `persist` name | removes on 401 |
| `apexMode` | removes on `logout` | — |
| `nexus_token` / `nexus_user` / `nexus-auth` | — | one-time migration + cleanup on module load |

On 401 the client clears both keys and hard-navigates to `/login?expired=true`,
bypassing Zustand entirely; the full page load then rehydrates from empty storage.
**Any future relocation must preserve this exactly.** Self-tests assert every key
literal and the redirect string on both sides.

## Consumers

**Migrated to `@apex/core-identity` (9 platform files):**

| Component | Files |
| --- | --- |
| `intelligence/dashboard` | `DashboardScreen`, `HomeHeader`, `RecentActivityFeed` |
| `operations/projects` | `ProjectsScreen`, `ProjectDetailScreen` |
| `core/users` | `UsersScreen`, `UserDetailScreen` |
| `business/sales-crm` | `auth-adapter.ts` |
| `workforce/leave` | `LeaveScreen` |

**Untouched (29 legacy files):** all `(auth)` routes, the dashboard layout, app
routes, components and hooks. They keep importing `@/store/auth.store` directly.
A self-test asserts that count is still 29 — if it moves, someone migrated legacy
authentication code without staging validation.

## Scope — what this component does NOT own yet

Login, password recovery, session and onboarding screens are all still legacy
routes. The map assigns them here (`authentication`) and to `core/identity/sessions`;
neither has migrated. `frontend/lib/roles.ts` goes to `shared/auth`, not here.

## Backend

**Not migrated.** `backend/src/modules/core/auth/` stays put; backend slices are
blocked until the Render deployment root moves.

## Invariants — asserted, not assumed

`frontend/store/auth.store.ts` is **byte-identical** to its pre-phase state
(SHA-256 verified), as are `shared/auth/**`, the dashboard layout and all five
auth routes. Self-tests additionally assert, in the real repository:

- persist name `apex-auth`, token key `apex_token`, `apexMode` cleanup
- `partialize`, `onRehydrateStorage`, `hasHydrated`, `setAuth`, `logout`, `updateUser`
- the store references no `@apex/` alias and no `platforms/` path
- every `shared/auth` key literal and the `/login?expired=true` redirect
- no platform file imports the legacy store except the adapter

## Removing `DEBT-P7-CORE-IDENTITY-AUTH-STORE`

Requires all three:

1. the 29 legacy consumers migrate to `@apex/core-identity`;
2. `auth.store.ts` moves byte-identical into `./frontend/state/`;
3. **staging validates** login, refresh-hydration, logout, expired-token 401
   redirect and the `nexus_*` key migration from a seeded legacy key.

One open item for that phase: the store has **no `'use client'` directive** and
calls `localStorage` at module scope inside `setAuth`/`logout`. It works today
only because every consumer is already a client component. Adding the directive
is a content change and needs explicit approval — it was deliberately not done
here.
