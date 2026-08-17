# Core Users — administration

**Status:** Frontend compartmentalised. Backend deferred.
**Compartmentalised:** 2026-08-06
**Debt identifier:** `DEBT-P6-CORE-USERS-LEGACY-FRONTEND` (5 imports)

The first `core` compartment. A **relocation of ownership**, not a redesign:
both screens moved with no import rewrite needed.

**Source correspondence.** `UsersScreen.tsx` preserves the original screen
source exactly. `UserDetailScreen.tsx` matched the original screen source
before trailing-whitespace normalisation — fifteen pre-existing whitespace
sequences were removed; logic, strings, class names, component behaviour and
rendered output remain unchanged.

---

## Ownership

This component owns the **admin-facing** user surface: the user directory and
the per-user administration detail view — search, filter, role and department
assignment, activation and deactivation, backup download, and the read-only
rollups of a user's tickets, leave, projects and workday.

**Compartmentalised here (2 files):**

| Area | Contents |
| --- | --- |
| `frontend/screens/UsersScreen.tsx` | 661 lines — directory, search, filters, create, activate/deactivate |
| `frontend/screens/UserDetailScreen.tsx` | 683 lines — detail, edit, role/department, backup, cross-feature rollups |

### This component administers users. It does not own identity.

That distinction decides several things below. Login, sessions, tokens, the
auth store and role *policy* belong to `core/identity`. This component reads the
current user to decide what an administrator may see — it never defines who the
user is.

## Browser routes

```
/users
/users/[id]
```

**Unchanged.** Both route files stay under
`frontend/app/(dashboard)/(platform)/users/` as thin adapters:

```tsx
import UsersScreen from '@apex/core-users/screens/UsersScreen';

export default function UsersPage() {
  return <UsersScreen />;
}
```

`UserDetailScreen` reads its id from `useParams()`, exactly as the route file
did, so no prop contract was introduced.

## Public API

| Specifier | Purpose |
| --- | --- |
| `@apex/core-users` | Component entry — exports both screens |
| `@apex/core-users/screens/UsersScreen` | Exact screen subpath |
| `@apex/core-users/screens/UserDetailScreen` | Exact screen subpath |
| `@apex/core-users/api` | **Canonical `usersApi`** (25 methods, incl. `getDirectory`) — exact subpath, never the barrel |

### This component owns the canonical frontend `usersApi` (2026-08-12)

All 24 methods moved verbatim from `frontend/lib/api.ts` to
`frontend/api/users-api.ts`. There is now exactly **one** implementation.

The ruling rests on all three `core/users` components agreeing in their own
docs: this one owns `/users`, `/users/[id]` and "the user directory"; `profiles`
explicitly disclaims the directory; `change-requests` is scoped to the approvals
queue. Semantics agree — 13 of the 24 methods are administration operations,
including every destructive one (`permanentDelete`, `archiveAfterBackup`,
`deactivate`, `resetPassword`, `adminCorrectEmail`).

**`frontend/lib/api.ts` remains a compatibility surface, temporarily.** It
re-exports `usersApi` from here so its **16** existing consumers keep working
untouched. That is compatibility, not authority: the implementation lives here,
and consumers will be repointed to `@apex/core-users/api` incrementally.

**Canonical ownership is not full legacy retirement.** `frontend/lib/api.ts`
still exists, still exposes `usersApi`, and still counts as an original runtime
file. Primary does not move for this batch, and debt stays at 23 because every
one of those 16 consumers also imports other groups from the same statement.

### `GET /users/directory` is canonically owned here (2026-08-17)

`getDirectory` has now moved in, taking the method count to **25**. The
transport line is the one `teamApi` used, unchanged:

```ts
getDirectory: () => r(api.get('/users/directory')),
```

It sits next to `getAll` because they are siblings — `getAll` is the paginated
admin list, `getDirectory` the flat active-user directory the backend already
scopes by role. The other 24 methods keep their relative order.

`teamApi.getDirectory()` in `frontend/lib/api.ts` still exists and now
**delegates** here:

```ts
getDirectory: () => usersApi.getDirectory(),
```

That is temporary compatibility, not a second owner. There is exactly one
transport implementation of `/users/directory` in the frontend, and the façade
no longer issues the request itself.

`teamApi` is **not retired** and was **not moved**. `sendRequest`
(`POST /team/request`) stays exactly where it is — it belongs to a
reporting-lines domain that does not exist yet, so the two methods keep
different fates. `team/page.tsx` was not migrated and is byte-identical.

With the directory now public, `command-palette` has a public owner for all
four of its data dependencies — projects, tickets, auth and directory — so it
becomes eligible for a separate `apps/web` move. That move is not part of this
batch.

**Binary/multipart exceptions carried over, not introduced:** `downloadBackup`,
`uploadPhoto` and `uploadDocument` bypass the JSON axios instance, reading
`apex_token` from `localStorage` to build their own Authorization header. That
predates the move and was preserved byte-for-byte. It is not a pattern for new
code.

**The routes use the subpaths, not the barrel** — the same rule the Projects
component follows. Two screens behind one barrel means importing either loads
both; `/users` and `/users/[id]` measured 154 kB and 156 kB against identical
baselines, so nothing regressed. The subpaths are declared in
`publicSubpaths.specifiers` as an **exact allowlist**: another file dropped into
`frontend/screens/` is still private, and a self-test proves it.

## What did not move

| Kept | Owner |
| --- | --- |
| `/users/[id]/profile/page.tsx` (833 ln) | **`core/users/profiles`** per the map — a different component |
| `(dashboard)/profile/page.tsx` (558 ln) | **`core/users/profiles`** — self-service, not administration |
| `/admin/approvals/page.tsx` (194 ln) | **`core/users/change-requests`** per the map |
| `frontend/store/auth.store.ts` | `core/identity` — see the distinction above |
| `frontend/modules/core/users/users.api.ts` | A one-line re-export shim of `@/lib/api` with **zero importers**, matching the projects/leave/tickets pattern. Moving it would create tracked debt for a file nobody uses. Left in place; **not deleted**. |
| `usersApi`, `rolesApi`, `departmentsApi` in `lib/api.ts` | Application-wide API groups |
| `STATUS_COLORS`, `PRIORITY_COLORS` in `lib/utils.ts` | **operations/tickets** vocabulary, used to render a user's ticket rollup |

Only `/users` and `/users/[id]` were in scope. The `profiles` and
`change-requests` components remain unmigrated, so their screens stay put.

### `DEBT-P6-CORE-USERS-LEGACY-FRONTEND`

5 imports across three targets, scoped to this component's `frontend/` folder.
Each has its own removal condition in `architecture-boundaries.json`.

Both screens already consume `cn`, `formatDate` and `getInitials` from
`@apex/shared-utilities` — that coupling was retired by the Shared Utilities
phase before this one began, so the debt is 5 rather than 7.

## Backend

**Not migrated.** `backend/src/modules/core/users/` (controller, service,
module) stays put. Backend slices are blocked until the Render deployment root
moves.

Note the map's 🔒 warning on `users.service.ts`: it calls the OneDrive backup
vault during deactivation/anonymisation and refuses to anonymise on failure.
That cross-component dependency must become a published contract from
`system/backup` before the backend moves — it is not addressed here.

## Behaviour — preserved, not touched

Authentication, authorization, role checks, user visibility rules, department
and team scoping, creation and editing rules, endpoint paths, payloads,
response handling, query keys, pagination, filtering, sorting, validation,
copy, styling and existing defects are all unchanged. Neither screen required
an import rewrite. See [Source correspondence](#core-users--administration)
above for the exact provenance of each file.

## Validation requirements

```bash
npm run architecture:test    # boundary + subpath + debt-count self-tests
npm run architecture:check   # live scan; debt reported, not hidden
cd frontend && npm run build # 38/38 static pages; /users 154 kB, /users/[id] 156 kB
```

Manual checks not performed by this phase: directory load per role, search,
filter, create user, edit role/department, activate/deactivate, backup
download, and the ticket/leave/project/workday rollups on the detail screen.
