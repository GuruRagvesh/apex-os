# Operations Projects — project-management

**Status:** Frontend compartmentalised. Backend deferred.
**Compartmentalised:** 2026-08-06
**Debt identifier:** `DEBT-P3-PROJECTS-LEGACY-FRONTEND` (9 imports)

The first slice compartmentalised outside Sales CRM. This was a **relocation of
ownership**, not a redesign: the two screens moved verbatim.

---

## Ownership

This component owns the project list and project detail surfaces: creation,
editing, deletion, member management, department scoping, ticket rollup and
activity feed for Operations Projects.

**Compartmentalised here (2 files):**

| Area | Contents |
| --- | --- |
| `frontend/screens/ProjectsScreen.tsx` | 290 lines — list, filters, create modal |
| `frontend/screens/ProjectDetailScreen.tsx` | 456 lines — detail, edit, delete, members, tickets, activity |

Nothing else in the repository was Projects-owned. See
[What did not move](#what-did-not-move).

## Browser routes

```
/projects
/projects/[id]
```

**Unchanged.** Both route files remain in `frontend/app/(dashboard)/(operations)/projects/`
as thin adapters:

```tsx
import ProjectsScreen from '@apex/operations-projects/screens/ProjectsScreen';

export default function ProjectsPage() {
  return <ProjectsScreen />;
}
```

`ProjectDetailScreen` reads its id from `useParams()`, exactly as the route file
did, so no prop contract was introduced.

## Public API

| Specifier | Purpose |
| --- | --- |
| `@apex/operations-projects` | Component entry — exports both screens |
| `@apex/operations-projects/screens/ProjectsScreen` | Exact screen subpath |
| `@apex/operations-projects/screens/ProjectDetailScreen` | Exact screen subpath |

**Why the routes use the subpaths, not the barrel.** Both screens behind one
barrel meant importing either one pulled both: `/projects` went 153 → 161 kB and
`/projects/[id]` 158 → 161 kB, and the two routes became byte-identical. Pointing
each route at its own screen returned both to baseline exactly. Same rule as the
Sales CRM API and stylesheet subpaths — **a barrel must not force a consumer to
load code it does not use.**

The subpaths are declared in `publicSubpaths.specifiers` as an **exact
allowlist**: another file dropped into `frontend/screens/` is still private, and
a self-test proves it.

## What did not move

Everything below failed the ownership test. None of it was Projects-owned, so
none of it could follow the screens without restructuring unrelated code.

| Kept in `frontend/` | Consumers | Why |
| --- | --- | --- |
| `projectsApi` in `lib/api.ts` | 5 — **4 not Projects** (tickets/new, users/[id], profile, command-palette) | An application-wide API group. Moving it would make four unrelated features import a Projects component. |
| `lib/utils.ts` | repo-wide | Holds `cn`, `formatDate`, `getInitials` used everywhere — and also `PROJECT_STATUS_LABELS` / `PROJECT_STATUS_COLORS`, which *are* Projects-owned. Splitting a shared utils module is unrelated-code restructuring. |
| `store/auth.store.ts` | repo-wide | Application-wide identity store, owned by `core/identity`. |
| `components/ui/empty-state.tsx` | 2 | Global UI primitive. |
| `components/ui/breadcrumb.tsx` | 3 | Global UI primitive. |
| `components/tickets/ticket-row.tsx` | 3 | Owned by **operations/tickets**, not Projects. |
| `modules/operations/projects/projects.api.ts` | **0** | A one-line re-export shim of `@/lib/api` with no importers, matching the leave/team/tickets/notifications pattern. Moving it into `platforms/` would create tracked debt for a file nobody uses. Left in place; not deleted. |

### `DEBT-P3-PROJECTS-LEGACY-FRONTEND`

9 imports across the 6 legacy targets above, scoped to
`frontend/screens/` only — a self-test proves a Projects file outside that
folder cannot reuse the exemption, and that an unallowlisted legacy path is
still rejected.

Each target has its own removal condition in `architecture-boundaries.json`.
The exemption shrinks as `core/identity`, `core/users`, `operations/tickets` and
`shared/ui` are compartmentalised — it is not removed in one step.

## Backend

**Not migrated.** `backend/src/modules/operations/projects/` (controller,
service, module) stays where it is. Backend slices are blocked until the Render
deployment root moves — see
[`../../../../../docs/operations/BACKEND_REPOSITORY_ROOT_DEPLOYMENT.md`](../../../../../docs/operations/BACKEND_REPOSITORY_ROOT_DEPLOYMENT.md).

## Known defects — preserved, not fixed

This phase moved files. It fixed nothing. These remain exactly as they were:

- project detail routes
- project edit / delete routes
- project member routes
- manager project-creation department selector mismatch

If any of these reproduce after the move, the cause predates it.

**Source correspondence:** `C100` against the original route files *before*
trailing-whitespace normalisation. `ProjectDetailScreen.tsx` then had six
trailing-space sequences removed (28 characters) so the commit carries no
`git diff --check` failures. Those six were two whitespace-only lines between
JSX siblings, two trailing spaces after `<button` before its attributes, and
two inside a `{}` expression — one of them outside a closing quote, so no
string literal changed. **Screen logic and rendered output: unchanged.**

## Validation requirements

```bash
npm run architecture:test    # boundary + subpath + debt-count self-tests
npm run architecture:check   # live scan; debt reported, not hidden
cd frontend && npm run build # 38/38 static pages; /projects 153 kB, /projects/[id] 158 kB
```

Manual checks not performed by this phase: project list load, create, detail
load, edit, delete, member add/remove, department scoping per role.
