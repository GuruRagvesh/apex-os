# Workforce Teams — team-management

**Status:** Frontend compartmentalised. Backend deferred.
**Compartmentalised:** 2026-08-10
**Debt identifier:** `DEBT-P13-WORKFORCE-TEAMS-LEGACY-FRONTEND` (2 imports)

The first `workforce/teams` compartment.

**Source correspondence.** Each screen differs from its route file by exactly
two edits — the `useAuthStore` import path and the component identifier.
Neither had trailing whitespace, so nothing else changed.

---

## Ownership

This component owns team CRUD and membership.

| Area | Contents |
| --- | --- |
| `frontend/screens/TeamsScreen.tsx` | 367 lines — directory, create, rename, delete |
| `frontend/screens/TeamDetailScreen.tsx` | 381 lines — detail, rename, add/update/remove member |

### The `team.*` / `teams.*` split is real

The legacy folder mixes two different features under similar names, exactly as
the migration map warns:

| Legacy | Feature | Component |
| --- | --- | --- |
| `teams/page.tsx`, `teams/[id]/page.tsx` | team CRUD | **`team-management`** — here |
| `team/page.tsx` (850 ln) | reporting lines | `reporting-lines` — **not migrated** |

`reporting-lines` was deliberately skipped: it imports `workdayApi` and does
timezone-sensitive formatting via `formatInTimeZone`. That is attendance-engine
adjacent and deserves its own review rather than riding along in an architecture
batch. A self-test proves it cannot borrow this component's exemption if it
migrates later.

## Browser routes

```
/teams
/teams/[id]
```

**Unchanged.** Both route files stay as thin adapters importing their exact
screen subpath, so neither route loads the other screen. `TeamDetailScreen`
reads its id from `useParams()` exactly as the route file did.

## Public API

| Specifier | Purpose |
| --- | --- |
| `@apex/workforce-teams` | Component entry — exports both screens |
| `@apex/workforce-teams/screens/TeamsScreen` | Exact screen subpath |
| `@apex/workforce-teams/screens/TeamDetailScreen` | Exact screen subpath |

## What changed — two edits per screen

1. `useAuthStore` import path → `@apex/core-identity`.
2. Identifiers `TeamsPage` → `TeamsScreen`, `TeamDetailPage` → `TeamDetailScreen`.
   The route adapters keep the original page names.

## What did not move

| Kept | Owner |
| --- | --- |
| `teamsApi` in `lib/api.ts` | Also used by `core/organization/departments` to list a department's teams |
| `departmentsApi`, `usersApi` | Application-wide |
| `frontend/modules/operations/team/team.api.ts` | A one-line re-export shim of `@/lib/api` with zero importers. Retained, **not deleted** — same call as projects/leave/users. |
| `TeamPressurePanel.tsx` | The map assigns it to `reporting-lines`, but it **already moved into `intelligence/dashboard/overview`** during the Dashboard phase. That map row is stale; nothing to do here. |

### `DEBT-P13-WORKFORCE-TEAMS-LEGACY-FRONTEND`

**2 imports**, one per screen, both naming `lib/api.ts`. No `lib/utils` coupling,
and the detail screen already consumed `Breadcrumb` through
`@apex/shared-ui/components/breadcrumb` before this phase.

## Behaviour — preserved, not touched

Team creation, rename, deletion, member add/update/remove, role checks,
department scoping, query keys, mutation payloads, invalidation, toast strings,
validation, navigation and existing defects are all unchanged. Seven mutations
across the two screens, none altered.

## Validation requirements

```bash
npm run architecture:test
npm run architecture:check
cd frontend && npm run build # /teams ~6.93 kB / 145 kB, /teams/[id] ~7.55 kB / 145 kB
```

Manual checks not performed by this phase: team list per role, create, rename,
delete, detail load, add member, change member role, remove member.
