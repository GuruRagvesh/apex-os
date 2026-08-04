# Repository Map

**Status:** Canonical
**Date:** 2026-08-04
**Branch:** `chore/repo-compartmentalization-audit`
**Base commit:** `d3f0490`
**Scope:** Repository structure only. No runtime code, schema, or deployment
configuration was moved or modified to produce this map.

---

## Top-level layout

| Path | Contents | Moved during compartmentalization? |
| --- | --- | --- |
| `backend/` | NestJS application. | No — Markdown documentation only. |
| `frontend/` | Next.js 14 application. | No. |
| `e2e/` | End-to-end test project. | No. |
| `docs/` | All project documentation. | Created/reorganised. |
| `.github/` | PR and issue templates. | Created. |
| `README.md` | Repository entry point. | No. |
| `package.json`, `package-lock.json` | Root manifests. | No. |
| `render.yaml` | Render deployment definition. | No. |
| `.gitignore` | Ignore rules. | No. |

---

## Backend architecture

`backend/src/modules/` is already compartmentalised by responsibility. This
structure was preserved as-is.

| Compartment | Modules |
| --- | --- |
| `core/` | `auth`, `users`, `roles`, `departments` |
| `operations/` | `tickets`, `projects`, `leave`, `notifications`, `comments`, `team` |
| `platform/` | `workday`, `scheduler`, `dashboard`, `analytics`, `settings`, `gateway`, `health`, `email`, `uploads`, `events`, `automation`, `task-types`, `backup-vault` |
| `business/` | `sales-crm` |
| `ai/` | AI-assisted features |

Shared code lives in `backend/src/common/` (services, guards, utilities) and
`backend/src/shared/` (constants, guards). `backend/src/prisma/` holds the
Prisma service wrapper.

### Data layer

- Schema: `backend/prisma/schema.prisma` — 46 models.
- Migrations: `backend/prisma/migrations/` — 33 migrations.
- Seed and repair scripts: `backend/prisma/seed.ts`, `backend/prisma/reset-seed.ts`,
  `backend/prisma/scripts/` — see "Executable files requiring investigation".

### Tests

- `backend/test/unit/` — unit specs.
- `backend/test/integration/` — integration specs (require a live database).
- `backend/test/helpers/` — shared test helpers.
- `e2e/` — separate end-to-end project.

---

## Frontend architecture

The frontend is mid-transition between two organisational styles. Both are
currently in use and both are correct for their era:

| Path | Style |
| --- | --- |
| `frontend/app/` | Next.js App Router routes, grouped as `(auth)`, `(dashboard)`, `(workspaces)`. |
| `frontend/components/` | Shared and feature components, grouped by area (`workday/`, `tickets/`, `home/`, `ui/`, `layout/`, `sales-crm/`). |
| `frontend/modules/` | Newer feature-module structure (e.g. `modules/operations/tickets/`). |
| `frontend/lib/` | Shared utilities and the API client (`lib/api.ts`). |
| `frontend/hooks/`, `frontend/store/`, `frontend/styles/`, `frontend/public/` | Hooks, Zustand stores, styles, static assets. |

### Standing policy

> New feature development should prefer modular feature locations. Existing
> stable runtime code moves only when actively modified, tested and reviewed.

A one-time "move everything into modules" refactor is explicitly **not**
planned. The mixed state is accepted and migrated incrementally.

---

## Generated and ignored paths

Not tracked in Git; safe to delete and regenerate locally:

```
node_modules/            backend/node_modules/
backend/dist/            frontend/.next/
backend/tsconfig.tsbuildinfo
frontend/tsconfig.tsbuildinfo
frontend/next-env.d.ts
backend/.env
```

---

## Root executable utilities requiring a separate script-safety audit

These remain at the repository root and were **not** moved during
compartmentalization. Moving an executable file can break any script,
deployment step, or documentation that references it by path, so they are
deferred to their own audit.

```
production-smoke-test.js
verify-endpoints.js
```

---

## Executable files requiring investigation

These are tracked under `backend/` and were **not** moved, renamed, or modified.
Several are capable of destructive database operations. Before any of them is
moved, renamed, or removed, each needs: package-script reference checks, import
checks, environment-guard checks, dry-run support confirmation, and production
database protection confirmation.

| File | Concern |
| --- | --- |
| `backend/wipe.ts` | Name implies destructive data operation. |
| `backend/prisma/seed.ts` | Contains destructive deletes; must never run against production. |
| `backend/prisma/reset-seed.ts` | Reset/seed; destructive. |
| `backend/prisma/scripts/fix-production-data.ts` | Production data mutation. |
| `backend/tva_execute_repair.js` | Data repair execution. |
| `backend/tva_repair.js` | Data repair. |
| `backend/tva_anomaly_scan.js` | Data scan. |
| `backend/scripts/repair-workday-sessions.ts` | Workday data repair. |
| `backend/scripts/repair-worksession-date-shift.ts` | Workday date-shift repair. |
| `backend/fix-specs.js`, `backend/fix-specs-2.js` | Purpose not evident from name. |
| `backend/test-bug2.ts`, `backend/test-bug2-prisma.ts` | Purpose not evident from name. |
| `backend/audit_assignees.ts`, `backend/audit_relations.ts`, `backend/audit_sequence.ts`, `backend/check_logs.ts` | Ad hoc audit scripts. |
| `backend/generate_policy_decision.js`, `backend/generate_tva_reports.js` | Report generators. |
| `backend/seed-test-sessions.ts` | Test data seeding. |

---

## Why runtime code was not moved

1. **Import breakage.** Moving `frontend/components/**` or `backend/src/**`
   changes hundreds of import specifiers at once, with no functional benefit.
2. **Deployment expectations.** `render.yaml` sets `rootDir: backend`, and the
   Vercel project expects the current frontend layout. Restructuring these is a
   deployment change, not a documentation change.
3. **Workspace fragility.** This repository has known npm workspace-resolution
   issues; relocating package manifests risks making them worse.
4. **Prisma coupling.** Schema and migration paths are referenced by build and
   deploy commands (`npx prisma migrate deploy`).
5. **Risk isolation.** Documentation moves are trivially reversible. Runtime
   moves are not. Mixing them into one change would make the whole change
   risky to review and to revert.

The repository's actual problem was hundreds of Markdown reports at the root —
not the source layout. That is what this work addressed.
