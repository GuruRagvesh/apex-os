# Core Organization — departments

**Status:** Frontend compartmentalised. Backend deferred.
**Compartmentalised:** 2026-08-07
**Debt identifier:** `DEBT-P11-CORE-ORGANIZATION-DEPARTMENTS-LEGACY-FRONTEND` (2 imports)

The first `core/organization` compartment. Two screens carrying **eight
mutations** between them — the most write-heavy component relocated so far,
which is why its authorization gate and every mutation are pinned by contract
tests rather than trusted.

**Source correspondence.** Both screens differ from their route files by exactly
two edits each — the `useAuthStore` import path and the component identifier.
Neither had any trailing whitespace, so nothing else changed at all.

---

## Ownership

This component owns department administration: the department directory and the
per-department record, including membership, team lead assignment and
Department Head assignment.

**Compartmentalised here (2 files):**

| Area | Contents |
| --- | --- |
| `frontend/screens/DepartmentsScreen.tsx` | 273 lines — directory, create, delete |
| `frontend/screens/DepartmentDetailScreen.tsx` | 711 lines — detail, rename, members, team lead, Department Head, teams and ticket rollups |

### It administers departments; it does not own roles or hierarchy

The map assigns `core/organization/roles` and `core/organization/hierarchy`
their own components — neither has migrated. `rolesApi` is consumed here only to
resolve the `TEAM_LEAD` role id when promoting a member; that does not make the
roles registry Departments-owned.

## Browser routes

```
/departments
/departments/[id]
```

**Unchanged.** Both route files stay under
`frontend/app/(dashboard)/(platform)/departments/` as thin adapters:

```tsx
import DepartmentsScreen from '@apex/core-organization-departments/screens/DepartmentsScreen';

export default function DepartmentsPage() {
  return <DepartmentsScreen />;
}
```

`DepartmentDetailScreen` reads its id from `useParams()`, exactly as the route
file did, so no prop contract was introduced. Neither route exported `metadata`
and neither reads a query string.

## Public API

| Specifier | Purpose |
| --- | --- |
| `@apex/core-organization-departments` | Component entry — exports both screens |
| `@apex/core-organization-departments/screens/DepartmentsScreen` | Exact screen subpath |
| `@apex/core-organization-departments/screens/DepartmentDetailScreen` | Exact screen subpath |

**The routes use the subpaths, not the barrel** — the rule Projects, Core Users
administration and Profiles all follow. 273 and 711 lines behind one barrel
would mean each route loads both screens. With subpaths, `/departments` measured
6.54 kB / 144 kB against a 6.55 kB / 144 kB baseline (the 10-byte drop is module
graph, not content) and `/departments/[id]` was **identical** at 9.2 kB / 147 kB.

The subpaths are an **exact allowlist**: a third file dropped into
`frontend/screens/` is still private, and a self-test proves it.

## What changed — exactly two edits per screen

1. **`useAuthStore` import path:** `@/store/auth.store` → `@apex/core-identity`.
2. **Component identifiers:** `DepartmentsPage` → `DepartmentsScreen`,
   `DepartmentDetailPage` → `DepartmentDetailScreen`. The route adapters keep
   the original page names.

A self-test asserts the destructure is still exactly
`const { user, hasHydrated } = useAuthStore();` on **both** screens.
**`hasHydrated` is load-bearing here**: every query on both screens is gated
`enabled: hasHydrated && isAdmin`, so losing it would fire admin-only requests
before the store rehydrates.

## Authorization — pinned, not touched

Both screens gate on the same expression and share the same denial screen:

```ts
const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];
const isAdmin = ADMIN_ROLES.includes(user?.role?.name ?? '');
```

`!hasHydrated` → spinner. `!isAdmin` → "admin-only" card pointing at Team. Every
query carries `enabled: hasHydrated && isAdmin`. A self-test requires all five
of those expressions verbatim on both screens.

The detail screen's manager candidate filter is pinned separately, because its
own comment says it must track the backend:

```ts
// Candidates for Department Manager assignment — must match backend's MANAGER_ASSIGNABLE_ROLES
['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(u.role?.name)
```

### Observation, not fixed

The frontend restricts these screens to ADMIN/SUPER_ADMIN, while the backend
carries `departments.manager-access.spec.ts` — manager access exists
server-side. The frontend is therefore **more** restrictive than the backend,
which is fail-safe rather than fail-open. That makes it a product/UX question,
not a security defect, and it was deliberately left alone. It predates this
phase.

## Mutations — all eight preserved

| Screen | Mutation | Call |
| --- | --- | --- |
| List | create | `departmentsApi.create(data)` |
| List | delete | `departmentsApi.remove(id)` |
| Detail | rename | `departmentsApi.patch(id, data)` |
| Detail | add member | `usersApi.update(userId, { departmentId: id })` |
| Detail | remove member | `usersApi.update(userId, { departmentId: null })` |
| Detail | set team lead | `usersApi.update(userId, { roleId: tlRole.id })` |
| Detail | add Department Head | `departmentsApi.addManager(id, userId)` |
| Detail | remove Department Head | `departmentsApi.removeManager(id, userId)` |

A self-test pins every call, every invalidated query key
(`departments`, `department`, `department-managers`, `users`, `roles`, `teams`)
and every success toast — and fails if the mutation count drifts from 2 on the
list screen and 6 on the detail screen.

The provisional Department Head labelling is preserved as-is, including its
`Legacy Department Manager / Lead` fallback and the comment explaining that
`ManagerDeptAccess` is the source of truth once an assignment exists.

## What did not move

| Kept | Owner |
| --- | --- |
| `departmentsApi` in `lib/api.ts` | **14 consumers** across tickets, kanban, teams, settings, projects and three `core/users` components |
| `usersApi`, `rolesApi` | Application-wide; roles belongs to `core/organization/roles` |
| `teamsApi` | **`workforce/teams`** — also used by both teams screens |

Nothing else was eligible. Both screens have **zero local imports**: the
`Avatar` helper, `ADMIN_ROLES`, `STATUS_COLORS`, `PRIORITY_COLORS` and every
modal are inline and moved with the files. No dynamic `import()`, no
`require()`, no relative imports.

> The detail screen's local `Avatar` overlaps with
> `@apex/shared-ui/components/user-avatar`. It was **not** substituted —
> swapping a component for a similar one is a behaviour change dressed as
> tidying.

### `DEBT-P11-CORE-ORGANIZATION-DEPARTMENTS-LEGACY-FRONTEND`

**2 imports** — one per screen, both naming `frontend/lib/api.ts`.

Notably there is **no `lib/utils.ts` coupling**: `STATUS_COLORS` and
`PRIORITY_COLORS` are declared locally in the detail screen rather than imported,
so unlike the `core/users` siblings this component never needed it. A self-test
proves `@/lib/utils` is rejected here. `Breadcrumb` already came from
`@apex/shared-ui/components/breadcrumb` before this phase began.

## Backend

**Not migrated.** `backend/src/modules/core/departments/*` (3 files) and
`backend/test/unit/departments.manager-access.spec.ts` stay put, as do
`core/roles/*` and `hierarchy-approval.service.ts` which the map assigns to
sibling components. Backend slices are blocked until the Render deployment root
moves.

## Behaviour — preserved, not touched

Who can view, create, edit or delete; manager assignment; role checks; status
handling; query keys; mutation payloads; invalidation; modal state; disabled
states; endpoints; toast strings; validation; navigation; loading and error
states are all unchanged.

## Validation requirements

```bash
npm run architecture:test    # boundary + authorization-gate + mutation self-tests
npm run architecture:check   # live scan; debt reported, not hidden
cd frontend && npm run build # 38/38 static pages; /departments 144 kB, /departments/[id] 147 kB
```

Manual checks not performed by this phase: directory loads for admin, denial
screen for non-admin, create department, delete department, rename inline, add
and remove members, set team lead, assign and remove Department Head, and the
teams/ticket rollups on the detail screen.
