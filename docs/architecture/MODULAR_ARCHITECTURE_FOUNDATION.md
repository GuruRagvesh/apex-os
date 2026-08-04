# Modular Architecture Foundation (Phase 0)

**Status:** Canonical
**Date:** 2026-08-04
**Branch:** `refactor/modular-architecture-foundation`
**Base commit:** `54c588a`
**Risk:** LOW–MEDIUM

---

## Objective

Establish an **empty but enforceable** architectural foundation for the
vertical-slice structure:

```
platform → module → component → frontend / backend / shared / tests / docs
```

Phase 0 creates the shell, the rules, and the machinery that enforces them.
It moves no runtime file and changes no production behaviour.

---

## Current live roots

**These remain the running applications. Nothing in Phase 0 changes that.**

| Root | Role |
| --- | --- |
| `frontend/` | Next.js app. Builds and deploys to Vercel. |
| `backend/` | NestJS API. Builds and deploys to Render. Serves production. |
| `e2e/` | Playwright suite. |

They are excluded from boundary enforcement and will enter it only as their
modules migrate.

## Future target roots

| Root | Role | State |
| --- | --- | --- |
| `apps/` | Composition shells (`web`, `api`, `e2e`) | Scaffold |
| `platforms/` | All feature code | Scaffold |
| `database/` | Schema, migrations, client, scripts | Scaffold |
| `shared/` | Cross-cutting code | Scaffold |

---

## Platform responsibilities

| Platform | Owns | Migration phase |
| --- | --- | --- |
| `core` | Identity, users, organization, settings | 3 |
| `workforce` | Attendance, leave, calendar, teams, employees | 5 🔒 |
| `operations` | Tickets, projects, task types | 4 |
| `intelligence` | Dashboard, analytics, reports, AI | 2 |
| `business` | Sales CRM | 1 (pilot) |
| `system` | Notifications, email, uploads, events, websocket, scheduler, health, backup, public site | 2 |

---

## Dependency direction

```
        apps/
          ↓
      platforms/
          ↓
       shared/
          ↓
   database/client
```

Downward only. Sideways between platforms is permitted through public entry
points, provided no cycle forms. `core` imports no other platform;
`intelligence` and `business` are leaves.

Full rules and examples: [`PUBLIC_API_CONVENTIONS.md`](PUBLIC_API_CONVENTIONS.md).

---

## Component template

Every component has the same internal shape — `frontend/`, `backend/`,
`shared/`, `tests/`, `docs/`, and a public `index.ts`. Folders are created only
when real files exist; the tree is a target, not a scaffold to stamp out.

Full shape and worked example: [`COMPONENT_TEMPLATE.md`](COMPONENT_TEMPLATE.md).

---

## Key decisions

### `shared/time/`

The Time/Value Authority — company-date resolution, timezone handling, elapsed
time — lives in `shared/time/`, not in a platform.

Attendance, tickets, SLA, scheduled jobs and analytics all need the same
answers. Placing it in `workforce/` would force `operations/tickets/sla` to
import `workforce/` for date arithmetic, creating a cycle the moment attendance
needs anything from tickets. It is a primitive, not a domain.

`shared/time` answers *what time is it*. Platforms decide *what that means*.

### `database/client/`

`PrismaModule` and `PrismaService` live in `database/client/`, at the bottom of
the dependency graph beside the schema they wrap. They are injected by nearly
every backend service and must be importable from any platform without a cycle.

### `apps/e2e/`

Playwright needs one project root: one config, one browser install, one entry
point. So the **runner** is centralized in `apps/e2e/`, while **specs stay with
their component** in `tests/e2e/`. The config points `testDir` into
`platforms/` to discover them.

### `platforms/system/public-site/`

The landing page, privacy policy and terms are real screens with no platform
affiliation. They live in `system/public-site` rather than `apps/web` so that
page implementation does not leak into the composition shell.

### Scheduler ownership

`system/scheduler` owns **generic cron infrastructure only** — registration,
scheduling utilities, run logging. It owns no jobs.

Each job lives with the feature whose data it touches:

| Job | Owner |
| --- | --- |
| `autoCloseMidnightSessions` | `workforce/attendance/workday/backend/jobs/` |
| `autoLogoutInactive` | `workforce/attendance/workday/backend/jobs/` |
| `workdayEndReminder` | `workforce/attendance/workday/backend/jobs/` |
| `setLeaveStatuses` | `workforce/leave/applications/backend/jobs/` |
| `checkScheduledTickets` | `operations/tickets/lifecycle/backend/jobs/` |

Today `scheduler.service.ts` imports `WorkdayService` directly and drives three
of the four Workday close paths. Splitting the jobs out **removes** that
`system → workforce` edge rather than re-encoding it as a contract. Workday
jobs then call the shared finalizer as a same-component call.

### Route-adapter principle

A route file maps a URL to a screen and does nothing else:

```tsx
// apps/web/app/attendance/page.tsx
export { WorkdayScreen as default } from '@apex/workforce/attendance/workday';
```

Layout, data fetching or conditional rendering in a route file belongs in the
component instead.

### Prisma centralization

One `schema.prisma`, one linear migration history, in `database/prisma/`. This
is a constraint, not a preference: Prisma resolves one schema, `migrate deploy`
applies one history, and per-platform schemas would make migration ordering
unresolvable. Components own repository adapters; never migrations or private
schemas.

---

## Migration phases

| Phase | Scope | Risk |
| --- | --- | --- |
| **0** | Foundation: shell, rules, validator, CI. No runtime move. | LOW–MED |
| 1 | Sales CRM leads pilot | LOW — flagged dark |
| 2 | `health`, `email`, `uploads`, `settings`, `analytics`, `reports`, `public-site` | LOW–MED |
| 3 | `auth`, `users`, `roles`, `departments`, `teams` | MED–HIGH |
| 4 | `projects`, `tickets` (component-by-component), `comments`, `task-types`, `notifications` | HIGH |
| 5 | `leave`, `calendar`, `attendance`, `idle`, scheduler job split | **HIGHEST** 🔒 |

Every migration PR must preserve browser URLs, API URLs, API response shapes,
Prisma schema, migration history, feature behaviour, and production environment
configuration.

Per-file targets: [`VERTICAL_SLICE_MIGRATION_MAP.md`](VERTICAL_SLICE_MIGRATION_MAP.md).

---

## Phase 0 scope

Delivered:

- `apps/`, `platforms/`, `database/`, `shared/` with a documented README in
  every directory — no `.gitkeep` placeholders.
- `architecture-boundaries.json` — layers, permitted and forbidden directions,
  public-entry rules, scan configuration.
- `scripts/architecture/validate-boundaries.mjs` — dependency validator, Node
  built-ins only, exit 0 clean / 1 on violations.
- `scripts/architecture/validate-boundaries.test.mjs` — 10 self-tests using
  temporary directories, cleaned up in a `finally` block.
- `tsconfig.architecture.json` — future path aliases, **inactive**.
- `.github/workflows/architecture-boundaries.yml` — CI on PRs and pushes to
  `main`/`staging`.
- Root `package.json` scripts: `architecture:check`, `architecture:test`.
- This document, `COMPONENT_TEMPLATE.md`, `PUBLIC_API_CONVENTIONS.md`.

## Phase 0 non-goals

Explicitly **not** done:

- No runtime file moved, renamed, or deleted.
- No import in the current applications changed.
- No dependency added; `package-lock.json` untouched.
- No Prisma schema, migration, or seed change.
- No deployment configuration change (`render.yaml`, `next.config.js`
  untouched).
- No `package.json` created under `apps/`, `platforms/`, `database/` or
  `shared/`.
- Path aliases **not** activated — `frontend/tsconfig.json` and
  `backend/tsconfig.json` do not extend `tsconfig.architecture.json`.
- `frontend/`, `backend/` and `e2e/` **not** added to boundary enforcement.

Aliases and enforcement activate **per migrated module**, not globally.

---

## Rollback strategy

Phase 0 is a single commit that adds files and touches nothing existing except
two script entries in the root `package.json`.

```bash
git revert <phase-0-sha>
```

Nothing to undo in the database, no deployment to roll back, no import to
restore. If the revert is clean, the repository is exactly as it was at
`54c588a`.

---

Related: [`VERTICAL_SLICE_MIGRATION_MAP.md`](VERTICAL_SLICE_MIGRATION_MAP.md) ·
[`COMPONENT_TEMPLATE.md`](COMPONENT_TEMPLATE.md) ·
[`PUBLIC_API_CONVENTIONS.md`](PUBLIC_API_CONVENTIONS.md) ·
[`REPOSITORY_MAP.md`](REPOSITORY_MAP.md)
