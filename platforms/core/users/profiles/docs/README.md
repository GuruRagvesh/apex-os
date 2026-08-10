# Core Users — profiles

**Status:** Frontend compartmentalised. Backend deferred.
**Compartmentalised:** 2026-08-07
**Debt identifier:** `DEBT-P8-CORE-USERS-PROFILES-LEGACY-FRONTEND` (4 imports)

The second component in the `core/users` module, and the **first component in
the migration to consume authentication through a boundary** rather than
importing the legacy store directly.

**Source correspondence.** `UserProfileScreen.tsx` and `activity-item.tsx`
preserve their original sources exactly, apart from the two edits listed under
[What changed](#what-changed-exactly-three-things). `ProfileScreen.tsx` matched
its original before trailing-whitespace normalisation — eleven pre-existing
whitespace sequences (50 characters) were removed so the commit carries no
`git diff --check` failures; logic, strings, class names, component behaviour
and rendered output remain unchanged.

---

## Ownership

This component owns the two **profile** surfaces: the signed-in user's own
profile, and the per-employee profile record that HR and administrators use.

**Compartmentalised here (3 files):**

| Area | Contents |
| --- | --- |
| `frontend/screens/ProfileScreen.tsx` | 558 lines — self-service profile, ticket/leave/project rollups, change requests |
| `frontend/screens/UserProfileScreen.tsx` | 833 lines — six-tab employee record: personal, employment, access, payroll, documents, approvals |
| `frontend/components/activity-item.tsx` | 29 lines — activity-feed row, internal |

### This component owns profiles. It does not own the user directory.

`core/users/administration` owns `/users` and `/users/[id]` — search, filtering,
role and department assignment, activation. `core/users/change-requests` owns
the approvals queue. Three components, one module, three separate public
entries. A self-test proves Profiles cannot reach into administration's
internals, and that administration cannot borrow the Profiles allowlist.

## Browser routes

```
/profile                 the signed-in user
/users/[id]/profile      a specific employee
```

**Unchanged.** Both route files stay where they were as thin adapters:

```tsx
import ProfileScreen from '@apex/core-users-profiles/screens/ProfileScreen';

export default function ProfilePage() {
  return <ProfileScreen />;
}
```

`UserProfileScreen` reads its id from `useParams()` and its `from` / `deptId` /
`deptName` query parameters from `useSearchParams()`, exactly as the route file
did, so no prop contract was introduced. Neither route exported `metadata`, so
nothing had to stay behind.

## Public API

| Specifier | Purpose |
| --- | --- |
| `@apex/core-users-profiles` | Component entry — exports both screens |
| `@apex/core-users-profiles/screens/ProfileScreen` | Exact screen subpath |
| `@apex/core-users-profiles/screens/UserProfileScreen` | Exact screen subpath |

**Why `core-users-profiles` and not `core-user-profiles`.** Every alias in the
repository is assembled from real directory names — `sales-crm-leads`,
`system-public-site`, `core-users`. `core-user-profiles` would invent a `user`
segment that no directory has. `@apex/core-users` was already taken by
administration, so this follows the `sales-crm-leads` / `sales-crm-shared`
precedent: the only other case of two components inside one module.

**The routes use the subpaths, not the barrel** — the same rule Projects,
Core Users administration and System public-site follow. 558 and 833 lines
behind one barrel would mean each route loads both screens. With subpaths,
`/profile` measured 9.81 kB / 160 kB against a 9.8 kB / 160 kB baseline and
`/users/[id]/profile` 10.3 kB / 148 kB against an identical baseline.

`ActivityItem` is **not** published. ProfileScreen is its only consumer
repo-wide, and a self-test asserts neither barrel exports it.

## What changed — exactly three things

This was a relocation. Three edits were made, and nothing else:

1. **`useAuthStore` import path**, in both screens:
   `@/store/auth.store` → `@apex/core-identity`. The hook call, destructuring,
   selectors and hydration handling are untouched — a self-test asserts
   `useAuthStore()` is still called in both.
2. **`ActivityItem` import path** in `ProfileScreen`: `@/components/dashboard/activity-item`
   → `../components/activity-item`, following the file into this component.
3. **Component identifiers**, matching the file names:
   `ProfilePage` → `ProfileScreen`, `EmployeeProfilePage` → `UserProfileScreen`.
   The route adapters keep the original `ProfilePage` / `EmployeeProfilePage`
   names, so Next.js sees the same route component names it always did.

### First consumer of the Core Identity boundary

Before this component, `@apex/core-identity` had **zero importers** — the
adapter existed but nothing used it. These two screens are the first, which
means this commit is also the first practical exercise of that boundary.

The 29 legacy `@/store/auth.store` consumers recorded by the Core Identity
phase are now **27**: these two did not have their legacy import rewritten in
place, they left `frontend/` entirely. A self-test enforces that distinction —
an in-place rewrite of a file that stays in `frontend/` would still be an
unvalidated auth migration and is still rejected.

## What did not move

| Kept | Owner |
| --- | --- |
| `frontend/components/tickets/ticket-row.tsx` | **operations/tickets** — 4 importers, only one of which is Profiles |
| `frontend/components/dashboard/{category-chart,stat-card,ticket-trend-chart}.tsx` | analytics-following, per the Dashboard phase's finding |
| `frontend/modules/core/users/users.api.ts` | The map assigns it to `profiles/frontend/api/`, but it is a one-line re-export shim of `@/lib/api` with **zero importers**. Moving it would create tracked debt for a file nobody uses. Left in place; **not deleted**. |
| `usersApi`, `rolesApi`, `departmentsApi`, `changeRequestsApi` in `lib/api.ts` | Application-wide API groups; `changeRequestsApi` belongs to `core/users/change-requests` |
| `formatRelativeTime` in `lib/utils.ts` | Depends on `formatDate`, which already round-trips back from `@apex/shared-utilities` |
| `frontend/store/auth.store.ts` | `core/identity` — consumed through the boundary, not moved |

### Why `activity-item` moved but `ticket-row` did not

Both are legacy components consumed by `ProfileScreen`. The difference is the
consumer count. `activity-item` had **exactly one** importer repo-wide — this
screen — so leaving it behind would have created a debt entry **no future phase
could ever retire**: no other component will ever claim it. `ticket-row` has
four importers across tickets, projects and profiles, so it belongs to
`operations/tickets` and follows that component when it migrates.

The move is debt-neutral: it drops `@/components/dashboard/activity-item` and
picks up `@/lib/utils` for `formatRelativeTime`.

### `DEBT-P8-CORE-USERS-PROFILES-LEGACY-FRONTEND`

4 imports across three targets, scoped to this component's `frontend/` folder.
Each has its own removal condition in `architecture-boundaries.json`.

**`frontend/store/auth.store.ts` is deliberately absent from the allowlist**, so
a later edit to this component cannot re-cross that boundary. A self-test proves
a direct legacy auth-store import from Profiles is rejected.

`Skeleton` comes from `@apex/shared-ui/components/skeleton` and `getInitials`
from `@apex/shared-utilities`, so those couplings were already retired before
this phase began.

> `ProfileScreen` also defines its **own local** `getInitials`, distinct from
> the shared one. It was left exactly as it was. Deduplicating it would be a
> behaviour change disguised as tidying.

## Backend

**Not migrated.** `backend/src/modules/core/users/` stays put — the map assigns
the users controller/service/module to `profiles/backend/`, but backend slices
are blocked until the Render deployment root moves.

The map's 🔒 warning applies here too: `users.service.ts` calls the OneDrive
backup vault during deactivation/anonymisation and refuses to anonymise on
failure. That must become a published contract from `system/backup` before the
backend moves.

## Behaviour — preserved, not touched

Forms, validation, avatar and document upload, document verification and
deletion, password logic, role behaviour, manager/admin visibility,
`canEditAll` / `canSeePayroll` / `canSeeAccess` gating, the approvals tab gate,
change-request submission, endpoint paths, payloads, response handling, React
Query keys, error handling, toast messages, labels, copy, styling and existing
defects are all unchanged.

## Validation requirements

```bash
npm run architecture:test    # boundary + subpath + debt-count self-tests
npm run architecture:check   # live scan; debt reported, not hidden
cd frontend && npm run build # 38/38 static pages; /profile 160 kB, /users/[id]/profile 148 kB
```

Manual checks not performed by this phase: own-profile load, change-request
submission and cancellation, employee profile load per role, tab visibility per
role, field edit and save, payroll visibility, document upload, verify, reject
and delete, avatar rendering, and the `from` / `deptId` / `deptName` breadcrumb
context.
