# shared/ui — design-system primitives

**Status:** Partially migrated. 11 primitives compartmentalised 2026-08-06.
**Debt added:** none.

Application-wide presentational components: used across features, owned by no
feature. Everything here is a **relocation of ownership** — no component API,
markup, styling or behaviour changed.

---

## The bar for living here

A component belongs in `shared/ui` only when **all** of these hold:

1. it is used by multiple platform components, **or** is a genuine
   design-system primitive;
2. it contains no feature-specific business logic;
3. it does not depend on a platform component;
4. it does not import a feature store, a feature API adapter, or anything under
   the legacy `frontend/` root.

Rule 4 is not advisory — `shared/` sits below every platform, so
`shared-no-legacy-frontend` rejects it with **no exemption mechanism**. That is
what decided several cases below.

## Compartmentalised here (11 files)

| Component | Previous consumers |
| --- | --- |
| `breadcrumb` | projects + 2 legacy routes |
| `empty-state` | projects + 1 legacy route |
| `user-avatar` | 3 legacy (settings, sidebar, topbar) |
| `QuickActionPalette` | dashboard + dashboard layout |
| `AnnouncementBroadcast` | dashboard |
| `CommandModal` | dashboard |
| `CommandCard` | dashboard |
| `HoverPreview` | required by `CommandCard` |
| `KpiCapsuleStrip` | dashboard |
| `KpiCapsule` | required by `KpiCapsuleStrip` |
| `staging-banner` | root layout |

Every one had **zero** legacy dependencies before the move, and still does.
`HoverPreview` and `KpiCapsule` came along because their siblings import them
directly; leaving them behind would have created a `shared/ → frontend/` edge.

## Public API

| Specifier | Purpose |
| --- | --- |
| `@apex/shared-ui` | Module entry — re-exports every primitive |
| `@apex/shared-ui/components/<name>` | Exact per-component subpath |

**Consumers use the subpaths, not the barrel.** This is not a style preference,
it was measured. Routing every consumer through `@apex/shared-ui` made a route
that needs one primitive load all eleven:

| Route | Baseline | Via barrel | Via subpath |
| --- | --- | --- | --- |
| `/projects` | 153 kB | 203 kB | **153 kB** |
| `/leave` | 149 kB | 207 kB | **149 kB** |
| `/settings` | 154 kB | 212 kB | **154 kB** |
| `/teams/[id]` | 145 kB | 196 kB | **145 kB** |
| `/departments/[id]` | 147 kB | 198 kB | **147 kB** |
| `/projects/[id]` | 158 kB | 209 kB | **158 kB** |

~50 kB on six routes. The subpaths returned every one to baseline exactly.

The eleven subpaths are declared in `publicSubpaths.specifiers` as an **exact
allowlist**, matched on the original import specifier. A twelfth file dropped
into `frontend/components/` is private until it is declared, and the same
component spelled `@apex/shared-ui/frontend/components/<name>` is rejected —
both proved by self-tests.

## What did not move

### Blocked by rule 4 — they need `cn`

`skeleton` (5 consumers), `multi-select`, `status-badge` are genuine primitives
and would otherwise qualify. All three import `cn` from `frontend/lib/utils.ts`.
`shared/` may not import the legacy frontend root, and there is deliberately no
exemption for it, so they cannot move until `cn` lives in `shared/utilities`.

`skeleton` having five consumers makes it the most valuable single item still
outside this module. Extracting `cn` is the unlock.

### Blocked by rule 2 — feature logic

| Component | Why |
| --- | --- |
| `QuickActionDock` | imports `auth.store`, `lib/api`, and `components/workday/BreakModal` — a feature component |
| `cold-start-banner` | calls `api.get('/auth/me')` |
| `command-palette` | imports `auth.store` and `ticketsApi`/`projectsApi`/`teamApi` |
| `HighPriorityTicketsPreview` | tickets-specific |
| `LeavesApprover` | leave-specific |
| `DownloadScreenshotButton` | depends on `lib/download-screenshot` |

The last three have zero consumers. They were **not deleted** — dead-code
removal is a separate decision from compartmentalisation.

## Debt effect

This phase **added no debt** and removed some by moving imports to their real
owner:

| Identifier | Before | After |
| --- | --- | --- |
| `DEBT-P4-DASHBOARD-LEGACY-FRONTEND` | 15 | **10** |
| `DEBT-P3-PROJECTS-LEGACY-FRONTEND` | 9 | **7** |
| Repository total | 27 | **20** |

Both allowlists were tightened at the same time: `frontend/components/ui/` is
gone from the dashboard's entry, and `empty-state.tsx` / `breadcrumb.tsx` from
the Projects entry, so the retired coupling cannot silently reappear.

## Dependency rules

```
platforms/*  → shared/ui
apps/*       → shared/ui
shared/ui    → (nothing internal today)
```

`shared/ui` must never import `platforms/**`, `backend/**`, a feature store, a
feature API adapter, or the legacy `frontend/` root. Self-tests cover each.

Everything here is browser-only. If a server-side primitive is ever added,
split `index.ts` into explicit frontend and backend entry points rather than
widening the barrel — the same constraint `shared/auth` carries.
