# Vertical-Slice Migration Map

**Status:** Draft architecture decision map — **read-only. No file has been moved.**
**Date:** 2026-08-04
**Branch:** `docs/vertical-slice-migration-map`
**Base commit:** `0ad4bdc`
**Scope:** Target location for every tracked runtime file under the
Platform → Module → Component architecture.
**Owner:** Repository architect

---

## Purpose

This map exists so the foundation branch is not created until every tracked
runtime file has a known destination. It is planning only — it moves nothing,
changes no import, and touches no configuration.

**Counts.** 500 tracked runtime files:

| Area | Files |
| --- | --- |
| `backend/src/` | 113 |
| `backend/test/` | 54 |
| `backend/prisma/` | 48 |
| `backend/` root | 23 |
| `frontend/app/` | 47 |
| `frontend/components/` | 107 |
| `frontend/lib/` | 34 |
| `frontend/modules/` | 16 |
| `frontend/hooks/` | 7 |
| `frontend/store/`, `styles/`, `public/` | 11 |
| `frontend/` root | 9 |
| `e2e/` | 20 |

> **Status update (2026-08-12) — three dead legacy frontend files RETIRED.**
>
> Unlike the shim tree below, these were **real implementations** — they were
> deleted because nothing imports them, not because they were compatibility
> seams.
>
> | Retired | Ln | Evidence |
> | --- | --- | --- |
> | `frontend/components/ui/DownloadScreenshotButton.tsx` | 55 | zero references repo-wide |
> | `frontend/components/ui/HighPriorityTicketsPreview.tsx` | 156 | zero references repo-wide |
> | `frontend/lib/date-utils.ts` | 71 | zero path imports; all five exports unreferenced |
>
> **`shared/utilities/download-screenshot` is not orphaned.** It had two callers;
> `frontend/components/layout/topbar.tsx` is the surviving one, so the utility
> published in PR #30 keeps a live consumer.
>
> **`date-utils.ts` needed a second look.** A symbol scan showed `timeAgo` with
> two references — both turned out to be a `timeAgo` **declared locally** inside
> `platforms/intelligence/dashboard/overview/frontend/components/RecentActivityFeed.tsx`,
> not an import. The other four exports (`formatDateIST`, `formatDateTimeIST`,
> `formatTimeIST`, `normalizeDateInput`) had zero references. It is unrelated to
> `frontend/lib/company-date.ts`, which remains the protected business-date
> authority and was not touched.
>
> Primary **162 → 165 / 423**. Debt unchanged at 24 — nothing imported these.
>
> **Deliberately excluded from this batch, and why:**
>
> - `frontend/app/(dashboard)/(operations)/team/page.tsx` (850 ln) — the largest
>   remaining single relocation, but the `reporting-lines` note below already
>   defers it: it imports `workdayApi` and `formatInTimeZone`, so it is
>   attendance-engine adjacent and needs its own review.
> - ~~`frontend/components/dashboard/stat-card.tsx`~~ — **RETIRED 2026-08-12**;
>   see the status note under `intelligence/analytics`.
> - `frontend/components/workday/{IdlePopup,IdleWarningToast,SessionRecoveryModal}.tsx`
>   and `frontend/hooks/useIdleDetection.ts` — these also appear unreferenced, but
>   they are attendance/workday files and are out of scope for an architecture
>   batch. **Recorded here as a finding for the workday review, not acted on.**
> - `command-palette.tsx`, `QuickActionDock.tsx`, `sidebar.tsx` — live consumers,
>   but no proven owner yet. `QuickActionDock` **and `sidebar`** both import
>   `workdayApi`, so both are workday-coupled, not merely unowned.
>   `cold-start-banner.tsx` left this list on 2026-08-12 — see the `apps/web`
>   note below.
>
> **Status update (2026-08-12) — `apps/web` ESTABLISHED; `cold-start-banner`
> is its first occupant.**
>
> `frontend/components/ui/cold-start-banner.tsx` (46 ln) →
> `apps/web/components/cold-start-banner.tsx`. `git mv`, blob hash unchanged, so
> the body is byte-identical; the **only** edit inside the file is its import
> edge, `@/lib/api` → `@apex/shared-auth`. Published as the exact subpath
> `@apex/apps-web/components/cold-start-banner`. **No root barrel** was created
> here and none should be — a barrel would let a consumer pull unrelated shell
> code, the bundle trap this repository has hit repeatedly.
>
> **Owner is `apps/web`, and `shared/ui` is correctly excluded.** `shared/ui`'s
> own README blocks this file under *rule 2 — feature logic*, because it calls
> `api.get('/auth/me')`. That module holds presentation primitives with no
> behaviour, and the exclusion stands regardless of where the API client lives.
> The banner belongs to no feature: it detects a sleeping backend and shows a
> global notice, mounted once in the dashboard layout beside the other shell
> chrome. That is app-shell infrastructure UX.
>
> **No architecture rule was added or broadened.** The validator already enforced
> the full `apps` model — `shared → apps`, `database → apps` and
> `platforms → apps` are each forbidden, plus app-internal isolation. Only an
> alias was registered so the validator resolves the new specifier instead of
> treating it as a bare package. `apps/` now enters the scan: 205 → 206 files.
>
> **The original retires with no façade**: primary **167 → 168 / 423**, debt
> unchanged at 24. Its single consumer, `(dashboard)/layout.tsx`, changed by one
> import specifier.
>
> **Side finding, recorded not acted on:** this was the **last consumer of the raw
> `api` re-export** from `frontend/lib/api.ts`. That `export { api }` now has zero
> consumers. Removing it is a separate decision and was deliberately not bundled
> into this relocation; the comment there has been corrected to say so.
>   `useTheme.ts` was listed here in error — the `shared/` table already assigned
>   it to `shared/utilities`. **It has since MOVED there**; see the status note on
>   that row.
>
> **Status update (2026-08-12) — the dead `frontend/modules/` shim tree is RETIRED.**
>
> **12 of the 15 files were deleted.** All were proven dead before deletion: zero
> external importers anywhere in the repository — static imports, dynamic
> `import()`, `require()`, path aliases, relative paths, re-exports, tests,
> scripts, `tsconfig` paths and `next.config` all searched — and zero runtime
> side effects (the only non-export lines in the whole tree were type members and
> one `'use client'` directive).
>
> | Retired | What it was |
> | --- | --- |
> | `ai.api.ts`, `core/auth/auth.api.ts`, `core/users/users.api.ts`, `operations/leave/leave.api.ts`, `operations/notifications/notifications.api.ts`, `operations/projects/projects.api.ts`, `operations/team/team.api.ts`, `operations/tickets/tickets.api.ts`, `platform/reports/reports.api.ts` | 9 one-line `export … from '@/lib/api'` re-export shims |
> | `operations/tickets/components/TicketRow.tsx` | 5-line re-export of the U1-resolved canonical component |
> | `core/auth/auth.types.ts`, `operations/tickets/tickets.types.ts` | 2 dead type-only files |
>
> **Why the earlier "retained, not deleted" decisions are superseded.** Those
> rows were written when `frontend/lib/api.ts` was still the only home for these
> API groups, so a shim was at least a plausible future seam. That is no longer
> true: `ticketsApi` moved to `operations/tickets/lifecycle/frontend/api/` (PR #33)
> and `departmentsApi` to `core/organization/departments/frontend/api/` (PR #34),
> and the remaining groups are reachable directly from `lib/api.ts`. A shim with
> zero importers now provides **no compatibility value**, and **relocating one
> into its mapped component would manufacture a new legacy edge** — the component
> would import `@/lib/api` purely to re-export it. Deleting is the only action
> that neither strands dead code nor creates debt.
>
> `tickets.types.ts` was additionally **stale**: its `TicketStatus` declared
> `PENDING_APPROVAL` and `REJECTED`, which do not exist in the live union, and
> omitted `REVIEW`, which does. A dead and incorrect contract is safer removed
> than preserved.
>
> **3 files were KEPT** — `business/{finance,sales-crm,training-delivery}/index.ts`,
> the intentional empty `export {}` stubs. **D10 stands unchanged:** they stay
> until they have content. `sales-crm/index.ts` is not named in D10, but it is the
> same intentional-stub category, so it was kept for consistency rather than
> deleted to improve a metric; retiring it needs its own decision.
>
> Primary **150 → 162 / 423**. Debt unchanged at 24 — nothing imported these, so
> no exemption existed to retire. All 42 route First Load values byte-identical.

Every one is assigned below, or listed in [Unresolved assignments](#unresolved-assignments)
with the reason it is deferred to a later phase.

---

## Whole-Apex scoreboard

Exact tracked counts from `git ls-files`, not estimates. Runtime extensions
only (`.ts .tsx .js .jsx .mjs .cjs .css .json .prisma`).

**Last measured: 2026-08-10** (batch branch `compartmentalize/architecture-batch-2026-08-10`, Commit 3).

Two figures, because they answer different questions. Every component we create
adds 2-4 `index.ts` barrels regardless of how much legacy code moved, so the
footprint number flatters progress. **Legacy relocation is the honest metric**,
and its denominator is fixed at **423** so the percentage cannot drift by
adding scaffolding.

### Primary — legacy files relocated (denominator fixed at 423)

| | 2026-08-07 start | after 08-07 batch | after 08-10 batch |
| --- | --- | --- | --- |
| Legacy relocated | 61 | 73 | **77** |
| **Relocation** | **14.4%** | **17.3%** | **18.2%** |

### Secondary — target-architecture footprint

| | 2026-08-07 start | after 08-07 batch | after 08-10 batch |
| --- | --- | --- | --- |
| Runtime files in new architecture | 91 | 113 | **123** |
| of which barrels | 24 | 34 | 40 |
| of which adapters / extracted modules | 6 | 6 | 6 |
| Legacy remaining | 366 | 362 | 362 |
| Total tracked runtime | 457 | 475 | 485 |
| **Footprint** | **19.9%** | **23.8%** | **25.4%** |

Legacy remaining barely moves because almost every relocation leaves a thin
route adapter behind at the same path. The 08-10 batch left it exactly flat: all
four of its moves were route screens. The only non-route relocations to date are
`ApexLandingPage.tsx`, `activity-item.tsx`, `category-chart.tsx` and
`ticket-trend-chart.tsx`. README files are excluded from both figures.

**The 08-10 batch stopped at 3 components, not for lack of effort.** Every
remaining frontend route screen over 100 lines now sits in an area excluded from
architecture batches: the five `(auth)` screens (authentication implementation),
`kanban` and the three `tickets` screens (lifecycle/SLA engine), `team/page.tsx`
(reads `workdayApi`), `settings/page.tsx` (`authApi` plus workday policy), and
`hrms/page.tsx` (attendance). The remaining large *component* block —
`components/sales-crm/*` — is blocked on the superseded stylesheet rows below.
Pushing relocation past ~18% requires clearing one of those gates, not finding
more safe screens.

**Counting method.** Architecture = `platforms/` + `shared/` + `apps/` +
`database/`. Legacy = `frontend/` + `backend/`, excluding `backend/prisma/`
(schema and migrations are database artifacts, not relocatable runtime files).
`e2e/`, `scripts/`, `docs/` and root config are excluded from both.

**Batch note:** `compartmentalize/architecture-batch-2026-08-07` holds several
independently validated commits and pushes once at end of day. Per-commit
deltas are measured against the previous commit; this table reconciles against
`origin/main`.

### Platform and shared coverage

Batch branch included. **All six platforms now hold a compartment.**

| Module | Files | Status |
| --- | --- | --- |
| `platforms/business` | 40 | Sales CRM Leads + shared |
| `shared/ui` | 16 | Design-system primitives |
| `platforms/intelligence` | 16 | Dashboard overview + **Analytics overview (batch Commit 4)** |
| `platforms/core` | 19 | **`core/users` complete on the frontend** — administration + profiles + change-requests — plus **Organization departments (batch Commit 5)** and the Identity auth boundary |
| `platforms/workforce` | 15 | Leave applications + **Calendar (08-10)** + **Teams team-management (08-10)** |
| `platforms/system` | 9 | Public site + **Audit (08-10)** |
| `platforms/operations` | 4 | Projects frontend |
| `shared/utilities` | 4 | `cn`, `formatDate`, `getInitials` |
| `shared/auth` | 3 | Authenticated HTTP client |
| `database` / `apps` | 0 | not started |

### Largest remaining blocks

| Area | Files | Note |
| --- | --- | --- |
| `backend/src` | 113 | **Blocked** — needs the Render deployment-root move |
| `frontend/components` | 90 | Largest unblocked block |
| `backend/test` | 54 | Moves with its backend modules |
| `frontend/app` | 45 | Route adapters + screens |
| `backend/prisma` | 15 | Stays centralised per **D13** |

Backend is 182 files — **42% of all remaining work — and it is blocked.**
Validating the staging repository-root deployment unblocks more than any
individual frontend slice.

---

## Architecture decisions applied

These were open questions in the first draft. They are now decided and reflected
throughout this map.

| # | Decision |
| --- | --- |
| D1 | **`shared/time/`** is the cross-platform home for TVA, company-date and timezone logic. |
| D2 | **`database/client/`** holds `PrismaModule` and `PrismaService`. |
| D3 | **`apps/e2e/`** is the Playwright runner and configuration root; feature E2E specs stay co-located with their component. |
| D4 | **`platforms/system/public-site/`** holds the landing page, privacy and terms. |
| D5 | **`home-v2`** stays under `platforms/intelligence/dashboard`. |
| D6 | **Scripts do not move** pending the script-safety audit. Future categories are documented, not created. |
| D7 | **Scheduler splits**: generic cron infrastructure stays in `system/scheduler`; Workday-specific jobs move to `workforce/attendance/workday/backend/jobs/` and must call the shared finalizer. |
| D8 | **`workforce/attendance/idle/`** is created; its current files are marked `DORMANT`. |
| D9 | **`MEETING` stays under `attendance/breaks/`.** No separate meetings component. |
| D10 | **No empty modules created** — `regularization`, `daily-attendance`, `finance`, `training-delivery`, `performance` are not scaffolded. |
| D11 | **`workforce/calendar/`** is a cross-workforce calendar module. |
| D12 | **Sales CRM `dashboard` stays separate from `analytics`.** |
| D13 | **Database schema and migrations stay centralized** outside `platforms/`. |

---

## Legend

| Marker | Meaning |
| --- | --- |
| ✅ | Clean 1:1 assignment. Low ambiguity. |
| ⚠️ | Assigned, but the file must be **split** — it currently serves several components. |
| ❓ | Deferred to a later phase. Listed in [Unresolved assignments](#unresolved-assignments). |
| 🔒 | Payroll-adjacent or production-sensitive. Migrate last, with staging validation. |
| 💤 | `DORMANT` — real code, currently imported by nothing. |

---

## platforms/core

### core/identity/authentication ✅

| Current | Target |
| --- | --- |
| `backend/src/modules/core/auth/auth.controller.ts` | `platforms/core/identity/authentication/backend/controllers/` |
| `backend/src/modules/core/auth/auth.service.ts` | `platforms/core/identity/authentication/backend/services/` |
| `backend/src/modules/core/auth/auth.module.ts` | `platforms/core/identity/authentication/backend/authentication.module.ts` |
| `backend/src/modules/core/auth/dto/login.dto.ts` | `platforms/core/identity/authentication/backend/dto/` |
| `backend/src/modules/core/auth/strategies/jwt.strategy.ts` | `platforms/core/identity/authentication/backend/strategies/` |
| `frontend/app/(auth)/login/page.tsx` | `platforms/core/identity/authentication/frontend/screens/` + route adapter |
| `frontend/modules/core/auth/auth.api.ts` | ✅ **RETIRED** — zero-importer `@/lib/api` re-export shim, deleted. |
| `frontend/modules/core/auth/auth.types.ts` | ✅ **RETIRED** — zero-importer dead types, deleted. |
| `frontend/store/auth.store.ts` | `platforms/core/identity/authentication/frontend/state/` ⚠️ **not yet moved — see below** |
| `backend/test/unit/auth.otp.spec.ts`, `auth.throttle.spec.ts` | `platforms/core/identity/authentication/tests/backend/` |

> **Status update (2026-08-06) — Core Identity AUTH STATE BOUNDARY created**
> (branch `compartmentalize/core-identity-frontend`). A **boundary, not a
> relocation**: `frontend/store/auth.store.ts` was NOT moved and NOT modified.
> Its SHA-256 is unchanged, as are `shared/auth/**`, the dashboard layout and
> all five `(auth)` routes.
>
> `platforms/core/identity/authentication/frontend/state/auth-store.adapter.ts`
> is a single `export { useAuthStore } from '@/store/auth.store'` line —
> published as **`@apex/core-identity`**. It is not a wrapper; a self-test
> rejects `create(`, `persist(`, `useState`, `useEffect`, `useMemo` and
> `zustand` appearing in it, because a second store means a second persisted
> state.
>
> **9 platform consumers migrated** (dashboard 3, projects 2, core/users 2,
> sales-crm 1, leave 1). **29 legacy consumers untouched** — a self-test asserts
> that count so nobody migrates legacy authentication without staging.
>
> **Debt 27 → 19** (`27 − 9 + 1`). `DEBT-P2A-SALES-CRM-AUTH-STORE` is removed
> entirely, and `auth.store.ts` was dropped from the Projects, Dashboard, Leave
> and Core Users allowlists. One narrow `DEBT-P7-CORE-IDENTITY-AUTH-STORE`
> replaces them, scoped to the adapter file alone.
>
> **Why the store did not move:** 29 legacy consumers; **zero** frontend tests
> for login, logout, hydration or the 401 path; and
> `frontend/app/(dashboard)/layout.tsx` records that redirecting while
> `hasHydrated` is false is what logged users out on every refresh. The store
> also has an **invisible localStorage contract** with `shared/auth` — no import
> expresses it — around `apex_token`, `apex-auth`, `apexMode` and the `nexus_*`
> migration, plus the 401 hard-navigate to `/login?expired=true`. Self-tests now
> assert every one of those literals on both sides.
>
> **No storage key, persisted shape, hydration timing, login, logout, 401
> behaviour, redirect or authorization changed.** Self-tests 132 → 149.
> Frontend build 38/38 with all auth-touching routes at baseline.

### core/identity/authorization ✅

| Current | Target |
| --- | --- |
| `backend/src/common/services/access-policy.service.ts` | `platforms/core/identity/authorization/backend/policies/` |
| `backend/src/shared/guards/jwt-auth.guard.ts`, `roles.guard.ts`, `app-throttler.guard.ts` | `shared/auth/guards/` |
| `backend/src/shared/decorators/roles.decorator.ts`, `current-user.decorator.ts` | `shared/auth/decorators/` |
| `backend/src/shared/constants/roles.ts` | `shared/auth/constants/` |
| `backend/src/shared/interfaces/user-payload.interface.ts` | `shared/auth/types/` |
| ~~`frontend/lib/roles.ts`~~ | ⛔ **SUPERSEDED 2026-08-11** — retired as zero-consumer dead code, NOT relocated. See the note under `shared/auth/` below. |
| `backend/test/unit/p0.access-policy.spec.ts`, `roles.guard.spec.ts` | `platforms/core/identity/authorization/tests/backend/` |

> Guards, decorators and the role constant are used by every platform. They go
> to `shared/auth/`, not inside a component — see dependency rule 8.

> **Status update (2026-08-06) — shared/utilities EXTRACTED**
> (branch `compartmentalize/shared-utilities-frontend`).
>
> Three exports moved **verbatim** out of `frontend/lib/utils.ts` into
> `shared/utilities/`, published as `@apex/shared-utilities`:
> `cn` (`class-names.ts`, 20 consumers across 3 platforms), `getInitials`
> (`text.ts`, 9 across 2), `formatDate` (`date.ts`, 7 across 2). 20 consumers
> updated.
>
> **The mixed file was not moved wholesale.** What remains in
> `frontend/lib/utils.ts` is feature vocabulary, not utilities — ticket
> priority/status/category, `PROJECT_STATUS_*`, `LEAVE_STATUS_*`, `ROLE_LABELS`,
> `formatRole`, `DEPT_COLORS` — each owned by the feature that uses it.
> `formatRelativeTime` stayed too: **1 platform consumer**, failing the
> multiple-platform bar. It falls back to `formatDate`, so `lib/utils.ts` now
> imports the extracted helper — one implementation, not two.
>
> **This unblocked three Shared UI primitives.** `skeleton`, `multi-select` and
> `status-badge` had `cn` as their **sole** legacy dependency, and `shared/` may
> not import the legacy `frontend/` root (no exemption mechanism). All three
> moved to `shared/ui` in the same phase, each published by an exact subpath.
> `frontend/components/ui/` is down to 5 files, all with feature logic.
>
> **Debt 23 → 22.** Only Dashboard dropped an import — it consumed `cn` alone.
> Projects and Leave still import `@/lib/utils` for their own domain constants,
> so their counts are unchanged; the debt counter counts import statements, not
> symbols. Dashboard's allowlist was tightened to drop `lib/utils.ts`.
> Self-tests 110 → 120.
>
> **No implementation, date-formatting output, class-merging behaviour,
> component API or visible UI changed.** All route bundles within ±1 kB of
> baseline. Frontend build 38/38.

> **Status update (2026-08-06) — shared/ui COMPARTMENTALISED**
> (branch `compartmentalize/shared-ui-frontend`). 11 design-system primitives
> moved from `frontend/components/ui/` to `shared/ui/frontend/components/`:
> breadcrumb, empty-state, user-avatar, staging-banner, AnnouncementBroadcast,
> CommandModal, QuickActionPalette, CommandCard, HoverPreview, KpiCapsuleStrip,
> KpiCapsule. Every one had zero legacy dependencies.
>
> Published as `@apex/shared-ui` plus **11 exact per-component subpaths**.
> Consumers use the subpaths: routing them through the barrel made a route that
> needs one primitive load all eleven, costing **~50 kB First Load JS on six
> routes** (`/projects` 153→203, `/leave` 149→207, `/settings` 154→212,
> `/teams/[id]` 145→196, `/departments/[id]` 147→198, `/projects/[id]` 158→209).
> The subpaths returned every route to baseline exactly.
>
> **First phase to reduce debt: 27 → 20.** Five dashboard imports and two
> Projects imports moved to their real owner, and both allowlists were tightened
> so the retired coupling cannot reappear. **No new exemption was added.**
>
> **`skeleton` (5 consumers), `multi-select` and `status-badge` did NOT move** —
> all three import `cn` from `frontend/lib/utils.ts`, and `shared/` may not
> import the legacy frontend root (`shared-no-legacy-frontend`, no exemption
> mechanism by design). Extracting `cn` to `shared/utilities` is the unlock.
> `QuickActionDock`, `cold-start-banner` and `command-palette` stay for feature
> logic; `HighPriorityTicketsPreview`, `LeavesApprover` and
> `DownloadScreenshotButton` are feature-specific or lib-coupled and unused —
> retained, not deleted.
>
> **No component API, markup, styling, accessibility behaviour or route
> changed.** Frontend build 38/38.

### core/identity/password-recovery ✅

| Current | Target |
| --- | --- |
| `frontend/app/(auth)/forgot-password/page.tsx` | `platforms/core/identity/password-recovery/frontend/screens/` + route adapter |
| `frontend/app/(auth)/change-password/page.tsx` | `platforms/core/identity/password-recovery/frontend/screens/` + route adapter |

> Backend routes live in `auth.controller.ts` — split during Phase 3.

### core/identity/sessions ✅

| Current | Target |
| --- | --- |
| `frontend/app/(auth)/select-mode/page.tsx`, `welcome/page.tsx` | `platforms/core/identity/sessions/frontend/screens/` |

> Sessions are JWT-stateless, so this component is frontend-only. It exists for
> the post-login mode/welcome flow, not for server-side session storage.

### core/users ✅

| Current | Target |
| --- | --- |
| `backend/src/modules/core/users/users.controller.ts`, `users.service.ts`, `users.module.ts` | `platforms/core/users/profiles/backend/` ⚠️ backend only — see the note below |
| **(from `frontend/lib/api.ts`)** `usersApi` group | ✅ **DONE** — `platforms/core/users/administration/frontend/api/`, published as `@apex/core-users/api`; `lib/api.ts` keeps a compatibility re-export |
| `backend/src/modules/core/users/change-requests.controller.ts`, `change-requests.service.ts` | `platforms/core/users/change-requests/backend/` |
| `frontend/app/(dashboard)/(platform)/users/page.tsx`, `[id]/page.tsx` | `platforms/core/users/administration/frontend/screens/` |
| `frontend/app/(dashboard)/(platform)/users/[id]/profile/page.tsx`, `(dashboard)/profile/page.tsx` | `platforms/core/users/profiles/frontend/screens/` |
| `frontend/app/(dashboard)/admin/approvals/page.tsx` | `platforms/core/users/change-requests/frontend/screens/` |
| `frontend/modules/core/users/users.api.ts` | ✅ **RETIRED** — zero-importer `@/lib/api` re-export shim, deleted. |
| `backend/test/unit/users.profile.spec.ts` | `platforms/core/users/profiles/tests/backend/` |
| `backend/test/unit/users.change-requests.spec.ts` | `platforms/core/users/change-requests/tests/backend/` |
| `backend/test/unit/users.admin-correction.spec.ts` | `platforms/core/users/administration/tests/backend/` |

> **Status update (2026-08-12) — the frontend `usersApi` is administration-owned.**
>
> All **24 methods** moved verbatim from `frontend/lib/api.ts` to
> `platforms/core/users/administration/frontend/api/users-api.ts`, byte-identical
> and in the same order, published as the exact subpath `@apex/core-users/api` —
> never through the component root barrel, which exports screens.
>
> **The ruling is triple-attested.** Each of the three `core/users` components
> states in its own docs that `administration` owns `/users`, `/users/[id]` and
> "the user directory"; `profiles` explicitly disclaims the directory;
> `change-requests` is scoped to `/admin/approvals`. Semantics agree: 13 of 24
> methods are administration operations, including every destructive one.
>
> ⚠️ **Frontend ownership and backend ownership are separate questions.** The row
> above sends `users.controller.ts` / `users.service.ts` / `users.module.ts` to
> `profiles/backend/`. **That backend row is unchanged and was not re-decided
> here** — the backend has not migrated at all and is blocked by the Render
> `rootDir` constraint. Frontend `usersApi` ownership is `administration`;
> backend users-module ownership remains a separate pending decision that needs
> its own audit.
>
> **`frontend/lib/api.ts` keeps a compatibility re-export** so all **16**
> consumers stay untouched — including the protected `team/page.tsx`. Canonical
> ownership is not legacy retirement: the façade survives, primary stays
> **168 / 423**, and debt stays **23** because every one of those 16 consumers
> also imports other groups from the same `@/lib/api` statement.
>
> The `API_BASE_URL as API_URL` alias left `lib/api.ts` with the group:
> `usersApi.downloadBackup` was its only user in that file.
>
> **`getDirectory` was deliberately NOT added.** It currently lives in `teamApi`
> and calls `GET /users/directory`, which this API should own — but moving it
> touches `teamApi` and is a separate batch, kept out so this relocation could be
> proved on its own.
>
> 🔒 `users.service.ts` calls the OneDrive backup vault during
> deactivation/anonymisation and refuses to anonymise on failure. That
> cross-component dependency must become a published contract from
> `system/backup`, not a direct import.

> **Status update (2026-08-06) — Users ADMINISTRATION frontend COMPARTMENTALISED**
> (branch `compartmentalize/core-users-frontend`), giving `core` its first
> compartment and taking platform coverage to five of six.
>
> 2 legacy files → `platforms/core/users/administration/frontend/screens/`:
> `users/page.tsx` (661 ln) → `UsersScreen.tsx`, `users/[id]/page.tsx` (683 ln)
> → `UserDetailScreen.tsx`. `UsersScreen.tsx` preserves the original screen
> source exactly; `UserDetailScreen.tsx` matched it before trailing-whitespace
> normalisation, with fifteen pre-existing whitespace sequences removed — logic,
> strings, class names, component behaviour and rendered output unchanged.
> Neither needed an import rewrite.
>
> Public entry `@apex/core-users` plus two exact screen subpaths. The routes use
> the subpaths, not the barrel, matching the Projects rule. `/users` and
> `/users/[id]` measured 154 kB and 156 kB against identical baselines.
>
> **Only the `administration` component moved.** The rows above assign
> `/users/[id]/profile` and `(dashboard)/profile` to **`profiles`**, and
> `/admin/approvals` to **`change-requests`** — different components, both
> unmigrated, so those three screens stayed. `frontend/modules/core/users/users.api.ts`
> is a re-export shim with zero importers; retained, not deleted.
>
> **This component administers users; it does not own identity.** The auth
> store, login, sessions and role policy remain with `core/identity` — moving
> them here would invert that ownership.
>
> New tracked debt `DEBT-P6-CORE-USERS-LEGACY-FRONTEND` — **5 imports**
> (`lib/api`, `lib/utils` for the tickets-owned STATUS/PRIORITY colours,
> `store/auth.store`). Repository debt 22 → 27. Both screens already consumed
> `cn`/`formatDate`/`getInitials` from `@apex/shared-utilities`, so the debt is
> 5 rather than 7 — the Shared Utilities phase paying off again.
> Self-tests 120 → 132.
>
> **No authentication, authorization, role check, visibility rule, scoping,
> endpoint, payload, query key, pagination, filter, sort, validation, copy,
> style or defect changed.** Frontend build 38/38.

> **Status update (2026-08-07) — Users PROFILES frontend COMPARTMENTALISED**
> (batch branch `compartmentalize/architecture-batch-2026-08-07`, Commit 2),
> giving `core/users` its second component.
>
> 3 legacy files → `platforms/core/users/profiles/frontend/`:
> `(dashboard)/profile/page.tsx` (558 ln) → `screens/ProfileScreen.tsx`,
> `users/[id]/profile/page.tsx` (833 ln) → `screens/UserProfileScreen.tsx`, and
> `components/dashboard/activity-item.tsx` (29 ln) → `components/activity-item.tsx`.
> `UserProfileScreen.tsx` and `activity-item.tsx` preserve their original
> sources exactly apart from the import and identifier edits below;
> `ProfileScreen.tsx` matched its original before trailing-whitespace
> normalisation, with eleven pre-existing whitespace sequences (50 characters)
> removed — logic, strings, class names, component behaviour and rendered
> output unchanged.
>
> **`activity-item` was resolved as Profiles-owned**, settling the open question
> left by the Dashboard phase note above. Its only importer repo-wide is
> `ProfileScreen`, so leaving it in `frontend/components/dashboard/` would have
> created a debt entry no future phase could ever retire. `ticket-row` was NOT
> moved — it has four importers and belongs to `operations/tickets`.
>
> Public entry `@apex/core-users-profiles` plus two exact screen subpaths. Not
> `core-user-profiles`: every alias is built from real directory names, and
> `@apex/core-users` was already administration's. Both routes are unchanged and
> use the subpaths, not the barrel — `/profile` measured 9.81 kB / 160 kB
> against a 9.8 kB / 160 kB baseline and `/users/[id]/profile` 10.3 kB / 148 kB
> against an identical baseline. `ActivityItem` stays internal.
>
> **First component to consume `@apex/core-identity`.** Both screens migrated
> `useAuthStore` from `@/store/auth.store` to the public boundary — an
> import-path change only, with the hook call and destructuring untouched. The
> adapter had zero importers until now. Legacy auth-store consumers 29 → 27:
> these two left `frontend/` entirely rather than being rewritten in place, and
> a self-test enforces that distinction.
>
> New tracked debt `DEBT-P8-CORE-USERS-PROFILES-LEGACY-FRONTEND` — **4 imports**
> (`lib/api` ×2, `components/tickets/ticket-row`, `lib/utils` for
> `formatRelativeTime`). `store/auth.store` is deliberately absent from the
> allowlist so the boundary cannot be re-crossed. Repository debt 19 → 23.
> Self-tests 159 → 180.
>
> `frontend/modules/core/users/users.api.ts` is assigned to `profiles/frontend/api/`
> by the row above but remains a re-export shim with zero importers; retained,
> not deleted — same call as administration.
>
> **No form, validation, upload, document, password, role, visibility, endpoint,
> payload, query key, error handling, toast, copy or style changed.** Frontend
> build 38/38, 42 routes.

> **Status update (2026-08-07) — Users CHANGE-REQUESTS frontend COMPARTMENTALISED**
> (batch branch, Commit 3). **`core/users` is now complete on the frontend:**
> administration, profiles and change-requests all hold their own component and
> public entry, and a self-test proves none can reach into another's internals.
>
> 1 legacy file → `platforms/core/users/change-requests/frontend/screens/`:
> `(dashboard)/admin/approvals/page.tsx` (195 ln) → `ApprovalsScreen.tsx`. It
> matched the original before trailing-whitespace normalisation, with eleven
> pre-existing whitespace sequences (18 characters) removed; the only other
> change is the identifier rename `ApprovalsPage` → `ApprovalsScreen`. **Not one
> import path was rewritten** — the import list is byte-for-byte the original.
>
> Public entry `@apex/core-users-change-requests`. **No exact subpath**: one
> screen behind the barrel consumed by one route cannot force a consumer to load
> code it does not use, matching the Workforce Leave rule. `/admin/approvals`
> measured 4.94 kB / 133 kB against a 4.96 kB / 133 kB baseline — the 20-byte
> drop is the stripped whitespace, and **every other route in the build was
> byte-identical**.
>
> **No Core Identity migration was needed.** This is the only migrated screen
> with no frontend auth-state dependency at all: it never imported
> `@/store/auth.store`. A self-test still rejects one, so it cannot acquire the
> coupling silently.
>
> **The approvals surface has no client-side role check**, by design — queue
> scoping is backend-driven through `listPendingApprovals()`. A self-test asserts
> no authorization expression appears in the screen, so a future edit that adds
> one is caught rather than merged quietly. Endpoints, payloads, query keys,
> cache invalidation, the status eligibility guard, disabled states and all five
> toast strings are locked by a contract test.
>
> `changeRequestsApi` stayed in `frontend/lib/api.ts`: it has **4 consumers** —
> this screen, `core/users/profiles`, `intelligence/dashboard` and the legacy
> `hrms` page — so moving it here would make three unrelated features import a
> change-requests component.
>
> New tracked debt `DEBT-P9-CORE-USERS-CHANGE-REQUESTS-LEGACY-FRONTEND` —
> **1 import**, the narrowest entry of any component that carries debt. It names
> only `lib/api.ts`; `lib/utils.ts` is deliberately excluded even though both
> siblings allow it. Repository debt 23 → 24. Self-tests 180 → 200.
>
> **No approval rule, rejection rule, status eligibility, button visibility,
> disabled state, payload, endpoint, mutation callback, cache invalidation,
> error handling, toast, label, icon or style changed.** Frontend build 38/38,
> 42 routes.

### core/organization ✅

| Current | Target |
| --- | --- |
| `backend/src/modules/core/departments/*` (3) | `platforms/core/organization/departments/backend/` |
| `frontend/app/(dashboard)/(platform)/departments/page.tsx`, `[id]/page.tsx` | `platforms/core/organization/departments/frontend/screens/` |
| `backend/test/unit/departments.manager-access.spec.ts` | `platforms/core/organization/departments/tests/backend/` |
| **(from `frontend/lib/api.ts`)** `departmentsApi` group | ✅ `platforms/core/organization/departments/frontend/api/` — published as the exact subpath `@apex/core-organization-departments/api`; `lib/api.ts` keeps a compatibility re-export |
| `backend/src/modules/core/roles/*` (3) | `platforms/core/organization/roles/backend/` |
| `backend/src/common/services/hierarchy-approval.service.ts` | `platforms/core/organization/hierarchy/backend/services/` |

> **Status update (2026-08-11) — the department HTTP API is departments-owned.**
>
> This supersedes the earlier note (below, under `core/users`) that
> `departmentsApi` "stayed in `lib/api.ts` — 14 consumers". That recorded a
> deferral, not an ownership ruling; ownership is now decided on evidence.
>
> **The evidence.** `departmentsApi` has **9 methods**. This component's own two
> screens use **8 of them** — `getOne`, `getManagers`, `patch`, `addManager`,
> `removeManager` in `DepartmentDetailScreen`, and `getAll`, `create`, `remove`
> in `DepartmentsScreen` — which is **every mutation the group has**. All eleven
> other consumers call **only `getAll()`**, to fill a department dropdown or
> filter. Department administration is the authority; everything else is
> cross-component read, which is exactly what a public boundary is for. The
> backend departments module is already mapped to this same component.
>
> Moved verbatim (**11 lines, 9 methods**) from `frontend/lib/api.ts` to
> `platforms/core/organization/departments/frontend/api/departments-api.ts`,
> published as `@apex/core-organization-departments/api` — never through the
> component root barrel, which exports the two screens and must not drag the
> authenticated client into consumers that only want a screen. Same mechanism as
> `@apex/sales-crm-shared/api` and `@apex/operations-tickets-lifecycle/api`.
>
> `frontend/lib/api.ts` **survives and still owns 17 other API groups**, so this
> retires **no original runtime file**: primary stays **150 / 423**. It keeps a
> compatibility re-export for the four legacy consumers (kanban, ticket list,
> ticket creation, settings) plus the zero-consumer `modules/core/users/users.api.ts`
> shim. The façade is compatibility, not authority.
>
> Eight migrated consumers repointed. The two screens in this component use a
> **relative** `../api` import because they are inside it; the six cross-component
> consumers — `UsersScreen`, `ApprovalsScreen`, `ProfileScreen`, `ProjectsScreen`,
> `ProjectDetailScreen`, `TeamsScreen` — use the public alias.
>
> **Reported, not fixed:** `update()` (`PUT /departments/:id`) has **zero
> consumers** — the detail screen calls `patch()`. It was preserved verbatim under
> R100 rather than dropped; retiring it is a separate decision.
>
> **Status update (2026-08-07) — DEPARTMENTS frontend COMPARTMENTALISED**
> (batch branch, Commit 5), giving `core/organization` its first compartment.
>
> 2 legacy files → `platforms/core/organization/departments/frontend/screens/`:
> `departments/page.tsx` (273 ln) → `DepartmentsScreen.tsx` and
> `departments/[id]/page.tsx` (711 ln) → `DepartmentDetailScreen.tsx`. Each
> differs from its route file by exactly **two edits** — the `useAuthStore`
> import path and the component identifier. Neither had trailing whitespace, so
> nothing else changed.
>
> **The most write-heavy component relocated so far — eight mutations** across
> the two screens: create, delete, rename, add/remove member, set team lead, and
> add/remove Department Head. A contract test pins every call, every invalidated
> query key and every success toast, and fails if the mutation count drifts from
> 2 on the list screen and 6 on the detail screen.
>
> **Authorization is pinned, not touched.** Both screens gate on
> `ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN']`, render the same admin-only denial
> card, and carry `enabled: hasHydrated && isAdmin` on every query — all five
> expressions are required verbatim by a self-test. The detail screen's manager
> candidate filter is pinned separately because its own comment requires it to
> match the backend's `MANAGER_ASSIGNABLE_ROLES`.
>
> ⚠️ **Observed, not fixed:** the frontend restricts these screens to
> ADMIN/SUPER_ADMIN while the backend carries `departments.manager-access.spec.ts`
> — manager access exists server-side. The frontend is therefore *more*
> restrictive than the backend, which is fail-safe rather than fail-open, so this
> is a product/UX question rather than a security defect. It predates this phase
> and was deliberately left alone.
>
> Public entry `@apex/core-organization-departments` plus two exact screen
> subpaths; the routes use the subpaths, not the barrel. `/departments` measured
> 6.54 kB / 144 kB against a 6.55 kB baseline and `/departments/[id]` was
> **identical** at 9.2 kB / 147 kB.
>
> `useAuthStore` migrated to `@apex/core-identity`, taking legacy auth-store
> consumers 26 → 24. `hasHydrated` is load-bearing here — every query is gated on
> it — so a self-test requires the destructure verbatim on both screens.
>
> New tracked debt `DEBT-P11-CORE-ORGANIZATION-DEPARTMENTS-LEGACY-FRONTEND` —
> **2 imports**, one per screen, both naming `lib/api.ts`. There is **no
> `lib/utils.ts` coupling at all**: `STATUS_COLORS` and `PRIORITY_COLORS` are
> declared locally in the detail screen, so unlike the `core/users` siblings this
> component never needed it, and a self-test proves it is rejected. Repository
> debt 25 → 27. Self-tests 221 → 243.
>
> `departmentsApi` stayed in `lib/api.ts` — **14 consumers** across tickets,
> kanban, teams, settings, projects and three `core/users` components. `teamsApi`
> belongs to `workforce/teams`. The roles registry and hierarchy approval service
> remain assigned to their own sibling components, both unmigrated.
>
> **No view, create, edit, delete, manager assignment, role check, status
> handling, query key, payload, invalidation, modal state, disabled state,
> endpoint, toast, validation or navigation changed.** Frontend build 38/38,
> 42 routes.

### core/settings ✅

| Current | Target |
| --- | --- |
| `backend/src/modules/platform/settings/*` (3) | `platforms/core/settings/backend/` |
| `frontend/app/(dashboard)/settings/page.tsx` | `platforms/core/settings/frontend/screens/` |
| `backend/test/unit/settings.service.spec.ts` | `platforms/core/settings/tests/backend/` |

---

## platforms/workforce 🔒

> **Entire platform migrates last (Phase 5).** Payroll-adjacent, and holds the
> highest-risk lifecycle logic in the system.

### workforce/attendance/workday 🔒

| Current | Target |
| --- | --- |
| `backend/src/modules/platform/workday/workday.controller.ts` | `platforms/workforce/attendance/workday/backend/controllers/` |
| `backend/src/modules/platform/workday/workday.service.ts` | `platforms/workforce/attendance/workday/backend/services/` ⚠️ |
| `backend/src/modules/platform/workday/workday.module.ts` | `platforms/workforce/attendance/workday/backend/workday.module.ts` |
| `backend/src/modules/platform/workday/workday.calculation.ts` | `platforms/workforce/attendance/workday/backend/services/` |
| `backend/src/modules/platform/workday/workday.calculation.spec.ts` | `platforms/workforce/attendance/workday/tests/backend/` |
| `backend/src/common/services/attendance-authority.service.ts` | `platforms/workforce/attendance/workday/backend/repositories/` |
| **(from `scheduler.service.ts`)** `autoCloseMidnightSessions` | `platforms/workforce/attendance/workday/backend/jobs/` **D7** 🔒 |
| **(from `scheduler.service.ts`)** `autoLogoutInactive` | `platforms/workforce/attendance/workday/backend/jobs/` **D7** 🔒 |
| **(from `scheduler.service.ts`)** `workdayEndReminder` | `platforms/workforce/attendance/workday/backend/jobs/` **D7** |
| `frontend/components/workday/WorkdayBar.tsx` | `platforms/workforce/attendance/workday/frontend/components/` |
| `frontend/components/workday/EndDayModal.tsx` | `platforms/workforce/attendance/workday/frontend/components/` |
| `frontend/components/workday/AutoCloseConsentModal.tsx` | `platforms/workforce/attendance/workday/frontend/components/` |
| `frontend/hooks/useWorkdayReminders.ts` | `platforms/workforce/attendance/workday/frontend/hooks/` |
| `backend/test/unit/workday.finalize-session.spec.ts`, `workday.release-a.spec.ts`, `tva-attendance-authority.spec.ts`, `workday.repair-rules.spec.ts` | `platforms/workforce/attendance/workday/tests/backend/` |
| `backend/test/unit/scheduler.service.spec.ts`, `scheduler.policy.spec.ts` | `platforms/workforce/attendance/workday/tests/backend/` **D7** |
| `e2e/tests/wf10-workday-attendance.spec.ts` | `platforms/workforce/attendance/workday/tests/e2e/` |

> **D7 — the scheduler dependency is resolved by splitting, not by contracts.**
> `scheduler.service.ts` currently imports `WorkdayService` directly and drives
> three of the four Workday close paths. Rather than publish a contract across
> a platform boundary, the Workday-specific cron jobs move *into* this
> component, where calling `finalizeWorkSession` is a legal same-component call.
> Generic cron infrastructure stays in `system/scheduler` (see that section).
> **All three jobs must route through the shared finalizer** — that invariant
> is what PR #11 established and it must survive the migration intact.
>
> ⚠️ **`workday.service.ts` must be split.** It currently contains workday
> lifecycle *and* break/meeting handling *and* history aggregation. The
> finalizer stays here; `startBreak`/`endBreak` move to `breaks`; `getHistory`
> moves to `history`. `AttendanceAuthorityService` is the sole `WorkSession`
> writer and stays a single repository adapter, published as a contract that
> `breaks`/`history` consume — never duplicated.

### workforce/attendance/breaks 🔒 (**includes MEETING** — D9)

| Current | Target |
| --- | --- |
| `frontend/components/workday/BreakModal.tsx` | `platforms/workforce/attendance/breaks/frontend/components/` |
| `backend/test/unit/workday.meeting-break.spec.ts` | `platforms/workforce/attendance/breaks/tests/backend/` |
| (from `workday.service.ts`) `startBreak`, `endBreak` | `platforms/workforce/attendance/breaks/backend/services/` |

> **D9 — no separate `meetings/` component.** `MEETING` is a `breakType` value
> on `BreakLog`, not a distinct entity. Splitting it out would require a
> data-model change, which is out of scope for a code move. `breaks/` owns
> meeting handling, including the settled rule that meeting time counts as
> productive work and is excluded from deducted break minutes.

### workforce/attendance/history 🔒

| Current | Target |
| --- | --- |
| `frontend/components/workday/WorkdayHistoryStrip.tsx` | `platforms/workforce/attendance/history/frontend/components/` |
| `backend/test/unit/workday.history.spec.ts` | `platforms/workforce/attendance/history/tests/backend/` |
| (from `workday.service.ts`) `getHistory` | `platforms/workforce/attendance/history/backend/services/` |

### workforce/attendance/idle 💤 (**new component** — D8)

| Current | Target | State |
| --- | --- | --- |
| `frontend/components/workday/IdlePopup.tsx` | `platforms/workforce/attendance/idle/frontend/components/` | `DORMANT` |
| `frontend/components/workday/IdleWarningToast.tsx` | `platforms/workforce/attendance/idle/frontend/components/` | `DORMANT` |
| `frontend/components/workday/SessionRecoveryModal.tsx` | `platforms/workforce/attendance/idle/frontend/components/` | `DORMANT` |
| `frontend/hooks/useIdleDetection.ts` | `platforms/workforce/attendance/idle/frontend/hooks/` | `DORMANT` |

> **D8 — these four files are real code that nothing currently imports.** They
> get a home rather than being silently folded into `workday/` or deleted.
> Each must carry a `DORMANT` marker in its component README stating that it is
> not wired to any route or parent component.
>
> Current backend reality this component will eventually own: `reportIdle`
> sets `WorkSession.status = IDLE` and emits an `IDLE_DETECTED` point event.
> There is **no** idle interval record, `totalIdleMinutes` is unreferenced
> anywhere in `backend/src`, and going idle does **not** pause ticket timers.
> Building real idle tracking is future work, not migration work.

### workforce/attendance/policies 🔒

| Current | Target |
| --- | --- |
| `backend/src/modules/platform/workday/workday.policy.helper.ts` | `platforms/workforce/attendance/policies/backend/policies/` |
| `backend/prisma/seed-hrms-policy.ts` | `database/seeds/` |

> ⚠️ Two competing policy sources exist — see
> [Unresolved assignments](#unresolved-assignments) item U2.

### workforce/attendance — not scaffolded (D10)

`regularization/` and `daily-attendance/` have **no code**.
`AttendanceRegularization` and `DailyAttendance` are migrated Prisma models with
no service, controller, or UI referencing them. **Per D10 these folders are not
created.** They are built when the features are built.

### workforce/leave ✅ 🔒

| Current | Target |
| --- | --- |
| `backend/src/modules/operations/leave/leave.controller.ts` | `platforms/workforce/leave/applications/backend/controllers/` |
| `backend/src/modules/operations/leave/leave.service.ts` | `platforms/workforce/leave/applications/backend/services/` ⚠️ split with `approvals` |
| `backend/src/modules/operations/leave/leave.module.ts` | `platforms/workforce/leave/leave.module.ts` |
| `backend/src/modules/operations/leave/leave-balance.service.ts` | `platforms/workforce/leave/balances/backend/services/` |
| `backend/src/common/services/leave-access.service.ts` | `platforms/workforce/leave/approvals/backend/policies/` |
| **(from `scheduler.service.ts`)** `setLeaveStatuses` | `platforms/workforce/leave/applications/backend/jobs/` **D7** |
| `frontend/app/(dashboard)/(operations)/leave/page.tsx` | `platforms/workforce/leave/applications/frontend/screens/` |
| `frontend/modules/operations/leave/leave.api.ts` | ✅ **RETIRED** — zero-importer `@/lib/api` re-export shim, deleted. Supersedes the earlier "Retained, not deleted". |
| `frontend/modules/operations/leave/leave.types.ts` | `platforms/workforce/leave/shared/contracts/` |
| `frontend/components/ui/LeavesApprover.tsx` | `platforms/workforce/leave/approvals/frontend/components/` |
| `backend/test/unit/leave.rules.spec.ts` | `platforms/workforce/leave/applications/tests/backend/` |
| `backend/test/unit/p1.leave-balance.spec.ts` | `platforms/workforce/leave/balances/tests/backend/` |
| `e2e/tests/wf8-leave-application.spec.ts` | `platforms/workforce/leave/applications/tests/e2e/` |
| `e2e/tests/wf13-leave-approval.spec.ts` | `platforms/workforce/leave/approvals/tests/e2e/` |

> ⚠️ Open P1 issue: the approve/reject route guard checks role only and ignores
> `isHR`, while the service layer honours `isHR`. Resolve the policy question
> **before** splitting `leave.service.ts` across two components, or the
> inconsistency gets baked into the boundary.

> **Status update (2026-08-06) — Leave FRONTEND COMPARTMENTALISED**
> (branch `compartmentalize/workforce-leave-frontend`), giving `workforce` its
> first compartment.
>
> 3 legacy files → `platforms/workforce/leave/applications/`:
> `leave/page.tsx` (677 ln) → `frontend/screens/LeaveScreen.tsx`,
> `components/ui/LeavesApprover.tsx` (146 ln) → `frontend/components/`,
> `modules/operations/leave/leave.types.ts` (25 ln) → `shared/contracts/`.
> `LeavesApprover.tsx` and `leave.types.ts` are **R100**. `LeaveScreen.tsx` was
> identical before trailing-whitespace normalisation — four whitespace-only
> lines (18 chars) removed so the commit carries no `git diff --check`
> failures; **logic and rendered output unchanged**. The screen needed no
> import rewrite at all.
>
> Public entry `@apex/workforce-leave` publishes one screen plus the four domain
> types; `LeavesApprover` stays internal. Route `/leave` unchanged, measured
> 7.05 kB / 149 kB against a 7.06 / 149 baseline, so no subpath was needed.
>
> **The applications/approvals/balances split was NOT applied to the frontend.**
> That split is a backend split; on the frontend `LeaveScreen.tsx` performs both
> application *and* approval (`approveMutation`, `rejectMutation`, the
> self-approval guard). Creating a frontend `approvals` component for one unused
> presentational file would bake in precisely the boundary the ⚠️ above warns
> against baking in. `LeavesApprover` becomes a clean candidate to move once the
> `isHR` policy question is settled and the backend splits.
>
> `frontend/modules/operations/leave/leave.api.ts` did **not** move — a
> re-export shim of `@/lib/api` with zero importers. Retained, not deleted.
>
> New tracked debt `DEBT-P5-LEAVE-LEGACY-FRONTEND` — **3 imports**
> (`lib/api`, `lib/utils`, `store/auth.store`). Repository debt 20 → 23. The
> screen's global-UI dependency was already retired by the shared/ui phase: it
> consumes `EmptyState` via `@apex/shared-ui/components/empty-state`.
> Self-tests 99 → 110.
>
> **No leave policy, balance, approval rule, permission, date calculation,
> endpoint, payload, query key, style or defect changed.** Frontend build 38/38.

### workforce/calendar ✅ (**new module** — D11)

| Current | Target |
| --- | --- |
| `frontend/app/(dashboard)/calendar/page.tsx` | `platforms/workforce/calendar/frontend/screens/` |
| `e2e/tests/wf12-calendar.spec.ts` | `platforms/workforce/calendar/tests/e2e/` |

> **D11 — calendar is its own cross-workforce module**, not a sub-component of
> `leave/`. The screen aggregates leave *and* other event types, so making it a
> leave component would misrepresent its scope and force a wrong dependency
> direction. It consumes published contracts from `leave/`, `attendance/` and
> `teams/`.

> **Status update (2026-08-10) — CALENDAR frontend COMPARTMENTALISED.**
> 1 legacy file → `platforms/workforce/calendar/overview/frontend/screens/CalendarScreen.tsx`
> (149 ln), two edits only: the `useAuthStore` path and the identifier. The
> component path is `calendar/overview` because the row above is depth-2 while
> `componentDepth` is 3 — the same resolution used for `dashboard/overview`.
>
> **D11's dependency direction is now enforced, not merely documented:** a
> self-test rejects any reach into the Leave component's internals.
> `CalendarView` stays inline so the five FullCalendar packages keep
> lazy-loading via `import()`. Public entry `@apex/workforce-calendar`, no
> subpath. New debt `DEBT-P12-WORKFORCE-CALENDAR-LEGACY-FRONTEND` — **1 import**
> (`lib/api` for `ticketsApi` and `leaveApi`; moving either here would invert
> D11).

### workforce/teams ✅

| Current | Target |
| --- | --- |
| `backend/src/modules/operations/team/team.controller.ts`, `team.service.ts` | `platforms/workforce/teams/reporting-lines/backend/` |
| `backend/src/modules/operations/team/teams.controller.ts`, `teams.service.ts` | `platforms/workforce/teams/team-management/backend/` |
| `backend/src/modules/operations/team/team.module.ts` | `platforms/workforce/teams/teams.module.ts` |
| `backend/src/modules/operations/team/dto/*` (4) | `platforms/workforce/teams/team-management/backend/dto/` |
| `frontend/app/(dashboard)/(operations)/teams/page.tsx`, `[id]/page.tsx` | `platforms/workforce/teams/team-management/frontend/screens/` |
| `frontend/app/(dashboard)/(operations)/team/page.tsx` | `platforms/workforce/teams/reporting-lines/frontend/screens/` |
| `frontend/modules/operations/team/team.api.ts` | ✅ **RETIRED** — zero-importer `@/lib/api` re-export shim, deleted. |
| `frontend/components/home/TeamPressurePanel.tsx` | `platforms/workforce/teams/reporting-lines/frontend/components/` |
| `backend/test/unit/teams.service.spec.ts` | `platforms/workforce/teams/team-management/tests/backend/` |
| `e2e/tests/wf3-manager-oversight.spec.ts` | `platforms/workforce/teams/reporting-lines/tests/e2e/` |

> Note the confusing pair: `team.*` (singular, reporting lines) and `teams.*`
> (plural, team CRUD) are different features in one folder. The split above is
> a genuine improvement, not just relocation.

> **Status update (2026-08-10) — TEAM-MANAGEMENT frontend COMPARTMENTALISED.**
> 2 legacy files → `platforms/workforce/teams/team-management/frontend/screens/`:
> `teams/page.tsx` (367 ln) → `TeamsScreen.tsx` and `teams/[id]/page.tsx`
> (381 ln) → `TeamDetailScreen.tsx`. Two edits per screen; all seven mutations
> preserved. Public entry `@apex/workforce-teams` plus two exact screen subpaths.
>
> **`reporting-lines` was deliberately NOT migrated.** `team/page.tsx` (850 ln)
> imports `workdayApi` and formats via `formatInTimeZone` — attendance-engine
> adjacent, so it needs its own review rather than an architecture batch. A
> self-test proves it cannot borrow team-management's exemption later.
>
> ⚠️ **The `TeamPressurePanel.tsx` row above is STALE.** That file already moved
> into `platforms/intelligence/dashboard/overview/frontend/components/` during
> the Dashboard phase, which relocated all eight `components/home/*`.
>
> `frontend/modules/operations/team/team.api.ts` is a zero-importer re-export
> shim; retained, not deleted. New debt
> `DEBT-P13-WORKFORCE-TEAMS-LEGACY-FRONTEND` — **2 imports**.

### workforce/employee-management ✅

| Current | Target |
| --- | --- |
| `frontend/app/(workspaces)/hrms/page.tsx` | `platforms/workforce/employee-management/frontend/screens/` |
| `backend/prisma/scripts/add-missing-employees.ts` | `database/repair/` (unmoved pending audit — D6) |

> UI-only on `main`. `backend/src/modules/platform/hrms-attendance/` exists
> **only on the `staging` branch** — see [Unresolved](#unresolved-assignments) U4.

---

## platforms/operations

### operations/tickets ⚠️

> **The largest and riskiest module.** Migrate component-by-component, never as
> one move. `tickets.service.ts` alone serves creation, assignment, lifecycle,
> review-rework, blocking and SLA.

| Current | Target |
| --- | --- |
| `backend/src/modules/operations/tickets/tickets.controller.ts` | split across `creation/`, `assignment/`, `lifecycle/`, `review-rework/`, `blocking/` backend controllers ⚠️ |
| `backend/src/modules/operations/tickets/tickets.service.ts` | split — same five components ⚠️ |
| `backend/src/modules/operations/tickets/tickets.module.ts` | `platforms/operations/tickets/tickets.module.ts` |
| `backend/src/modules/operations/tickets/ticket-ledger.service.ts` | `platforms/operations/tickets/timing-ledger/backend/services/` |
| `backend/src/modules/operations/tickets/ticket-import.service.ts` | `platforms/operations/tickets/imports/backend/services/` |
| `backend/src/common/services/ticket-access.service.ts` | `platforms/operations/tickets/lifecycle/backend/policies/` |
| `backend/src/common/services/ticket-timing.service.ts` | `platforms/operations/tickets/sla/backend/services/` |
| `backend/src/modules/operations/comments/*` (3) | `platforms/operations/tickets/comments/backend/` |
| **(from `scheduler.service.ts`)** `checkScheduledTickets` | `platforms/operations/tickets/lifecycle/backend/jobs/` **D7** |
| `frontend/app/(dashboard)/(operations)/tickets/page.tsx` | `platforms/operations/tickets/lifecycle/frontend/screens/` |
| `frontend/app/(dashboard)/(operations)/tickets/new/page.tsx` | `platforms/operations/tickets/creation/frontend/screens/` |
| `frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx` | `platforms/operations/tickets/lifecycle/frontend/screens/` ⚠️ also renders review/rework |
| `frontend/app/(dashboard)/(operations)/kanban/page.tsx` | ✅ **DONE** — `platforms/operations/tickets/lifecycle/frontend/screens/KanbanScreen.tsx`, published as the exact subpath `@apex/operations-tickets-lifecycle/screens/KanbanScreen`; the route survives as a thin adapter |
| `frontend/components/tickets/OverdueTicker.tsx` | `platforms/operations/tickets/sla/frontend/components/` |
| `frontend/components/tickets/ticket-row.tsx` | ✅ `platforms/operations/tickets/lifecycle/frontend/components/` — **U1 RESOLVED**, published as an exact subpath |
| `frontend/modules/operations/tickets/components/TicketRow.tsx` | ✅ **RETIRED** — U1 resolved the canonical implementation to `lifecycle/frontend/components/`; the zero-importer shim left behind has now been deleted. |
| `frontend/modules/operations/tickets/tickets.api.ts` | ✅ **RETIRED** — the real `ticketsApi` moved to `platforms/operations/tickets/lifecycle/frontend/api/` in PR #33; the zero-importer shim left behind has now been deleted. |
| `frontend/modules/operations/tickets/tickets.types.ts` | ✅ **RETIRED** — zero-importer dead types, deleted. Its `TicketStatus` was also stale (declared `PENDING_APPROVAL`/`REJECTED`, omitted `REVIEW`). |
| `frontend/lib/ticket-timing.ts` | `platforms/operations/tickets/sla/shared/` |
| `frontend/lib/ticket-visibility.ts` | `platforms/operations/tickets/lifecycle/shared/` |
| `backend/test/unit/ticket*.spec.ts`, `tickets.*.spec.ts` (17 files) | distribute across component `tests/backend/` |
| `backend/test/unit/scheduler.recurring.spec.ts` | `platforms/operations/tickets/lifecycle/tests/backend/` **D7** |
| `e2e/tests/wf1-ticket-execution.spec.ts` | `platforms/operations/tickets/lifecycle/tests/e2e/` |
| `e2e/tests/wf2-team-lead-review.spec.ts` | `platforms/operations/tickets/review-rework/tests/e2e/` |
| `e2e/tests/wf4-cross-department-block.spec.ts` | `platforms/operations/tickets/blocking/tests/e2e/` |

> **Status update (2026-08-11) — KANBAN MIGRATED to lifecycle.**
>
> `kanban/page.tsx` (493 ln) → `lifecycle/frontend/screens/KanbanScreen.tsx`,
> published as the exact subpath
> `@apex/operations-tickets-lifecycle/screens/KanbanScreen`. **Not** through the
> component root barrel: the screen pulls the ticket API, `@dnd-kit` and the auth
> boundary, none of which a consumer wanting a visibility helper should load.
>
> **The migrated screen carries ZERO legacy architecture edges** — the first ticket
> screen to reach that state. `ticketsApi` resolves relatively to `../api` (same
> component), `departmentsApi` to `@apex/core-organization-departments/api`, and
> auth to `@apex/core-identity`. The three preceding boundary batches existed to
> make exactly this possible.
>
> **The whole diff against the route file is five import lines and the function
> name.** Every other line is byte-identical, which is what makes the mutation
> claim checkable rather than asserted: the single `useMutation` calling
> `ticketsApi.updateStatus(id, status)`, the drag/drop entry points, the optimistic
> `setLocalKanban`, the `onError` revert-and-toast, the five `invalidateQueries`
> keys and the `refetchInterval: 30000` are all unchanged.
>
> **`canMoveCard` moved verbatim and is worth naming.** It is a client-side
> expression over role, ownership and assignment that gates the drag affordance.
> It now lives under `platforms/operations/tickets/`, and the "no permission or
> scope rules" contract still passes because it matches none of that test's
> markers. It mirrors backend rules rather than replacing them — the backend
> remains the sole transition authority — but it is frontend permission-shaped
> code inside the ticket platform, and the contract test would not catch it
> drifting from the backend.
>
> **Retires no original runtime file:** the route survives as an 8-line adapter, so
> primary stays **150 / 423** and remaining stays **273**. Debt stays 24 — Kanban's
> legacy imports were the ones being removed, and they were never allowlisted.
>
> Bundle: **zero First Load increases**, two decreases — `/kanban` 170 → 167 kB and
> `/tickets/[id]` 180 → 179 kB, both re-attribution out of shared chunks into the
> page chunk. Shared-by-all unchanged at 87.5 kB.
>
> **Merge gate: authenticated drag/drop browser validation on the preview.** This
> is the first migrated screen that performs a real ticket-status mutation.
>
> **Status update (2026-08-11) — the ticket HTTP API is lifecycle-owned.**
>
> `ticketsApi` (**29 methods, 101 lines**) moved verbatim from `frontend/lib/api.ts`
> to `platforms/operations/tickets/lifecycle/frontend/api/tickets-api.ts` and is
> published as the exact subpath `@apex/operations-tickets-lifecycle/api` — never
> through the component root barrel, which stays presentation-only so a consumer
> wanting a status label does not load the authenticated client. Same reasoning,
> and the same exact-subpath mechanism, as `@apex/sales-crm-shared/api`.
>
> **The map row above named the wrong source.** It listed
> `frontend/modules/operations/tickets/tickets.api.ts`, which is a zero-consumer
> re-export shim — the same shape as the `TicketRow.tsx` shim resolved in U1. The
> implementation was always in `frontend/lib/api.ts`. The row is corrected above.
>
> `frontend/lib/api.ts` **survives and still owns 18 other API groups**, so this
> retires **no original runtime file**: primary stays **150 / 423**. It re-exports
> `ticketsApi` as a compatibility façade for the six legacy consumers (ticket
> detail, creation, list, kanban, command palette, `useApprovalReminders`). The
> façade is compatibility, not authority. Unlike the Sales CRM case, the façade is
> safe here because the extracted module's only import is `@apex/shared-auth`,
> which `lib/api.ts` already imports — no new module graph reaches its consumers.
>
> Five migrated consumers now import the component boundary directly:
> `UserDetailScreen`, `ProfileScreen`, `AnalyticsScreen`, `DashboardScreen`,
> `CalendarScreen`. **Debt is unchanged at 24** — every one of those five also
> imports other groups from the same `@/lib/api` statement, and debt counts
> statements, not symbols.
>
> **Carried-over transport exceptions, reported not fixed.** `fetchAttachmentBlob`,
> `exportCsv` and `downloadImportTemplate` return binary bodies, so they bypass the
> JSON axios instance: they use raw `fetch()` and read `apex_token` from
> `localStorage` themselves, and `exportCsv` recomputes its own base URL from
> `process.env.NEXT_PUBLIC_API_URL` instead of using `API_URL`. All of that predates
> the move and was preserved byte-for-byte under R100. It is a latent inconsistency
> — if `API_BASE_URL` and that recomputation ever diverge, `exportCsv` alone would
> call a different host — and retiring it is a behaviour change owed its own phase.
>
> **Status update (2026-08-11) — U1 RESOLVED; ticket-row is lifecycle-owned.**
>
> Evidence: `frontend/components/tickets/ticket-row.tsx` (225 ln) had **4 consumers**
> — the tickets list, the `modules/` shim, `core/users/profiles` and
> `operations/projects`. `frontend/modules/operations/tickets/components/TicketRow.tsx`
> is a **5-line re-export with zero consumers**. They are not two implementations,
> so U1 was never a canonicity question — it was an ownership question.
>
> **Decision: ticket-row is ticket-domain presentation and belongs to `lifecycle`.**
> It renders ticket status, priority, visibility and the SLA ticker; it is not
> generic enterprise UI. Projects and Core Users *consume* ticket presentation,
> and cross-feature consumption does not make a component generic — that is
> exactly what a public boundary is for.
>
> Published as the exact subpath
> `@apex/operations-tickets-lifecycle/components/ticket-row`, **never through the
> lifecycle barrel**: the barrel carries the pure visibility contract, and routing
> a React component through it would pull ticket presentation into every consumer
> that only wants the contract.
>
> The `modules/` shim was **retained, not deleted** — same treatment as the other
> zero-importer shims (`projects.api.ts`, `leave.api.ts`, `team.api.ts`) — and
> repointed at the new public subpath. Deleting it is a separate decision.
>
> Debt 29 → 28: `DEBT-P8` 3→2 and `DEBT-P3` 5→4 both lose their ticket-row
> import, and new `DEBT-T1-TICKETS-LIFECYCLE-LEGACY-FRONTEND` (1) covers the
> `lib/utils.ts` vocabulary ticket-row still renders. That vocabulary was
> deliberately left behind: `PRIORITY_COLORS`, `STATUS_COLORS` and
> `PRIORITY_LABELS` have Projects and Core Users consumers, so their ownership is
> a separate unresolved question and must not be forced to retire a file.
>
> `frontend/components/tickets/` is now empty.

### operations/projects ✅

| Current | Target |
| --- | --- |
| `backend/src/modules/operations/projects/*` (3) | `platforms/operations/projects/project-management/backend/` |
| `frontend/app/(dashboard)/(operations)/projects/page.tsx`, `[id]/page.tsx` | `platforms/operations/projects/project-management/frontend/screens/` |
| `frontend/modules/operations/projects/projects.api.ts` | ✅ **RETIRED** — zero-importer `@/lib/api` re-export shim, deleted. |
| `backend/test/unit/fp14b.project-stages.spec.ts` | `platforms/operations/projects/stages/tests/backend/` |
| `backend/test/unit/p0.project-access.spec.ts` | `platforms/operations/projects/project-management/tests/backend/` |

> `stages/`, `membership/` and `reporting/` have no separate files today —
> `projects.service.ts` covers all three. Split during Phase 4 only if the
> split is real; per D10, do not create empty folders.

> **Status update (2026-08-06) — Operations Projects frontend COMPARTMENTALISED**
> (branch `compartmentalize/operations-projects-frontend`). The first slice
> outside Sales CRM.
>
> | Current | Destination |
> | --- | --- |
> | `frontend/app/(dashboard)/(operations)/projects/page.tsx` (290 ln) | `platforms/operations/projects/project-management/frontend/screens/ProjectsScreen.tsx` |
> | `frontend/app/(dashboard)/(operations)/projects/[id]/page.tsx` (456 ln) | `.../frontend/screens/ProjectDetailScreen.tsx` |
>
> Public import: **`@apex/operations-projects`**, plus two exact screen
> subpaths `@apex/operations-projects/screens/{ProjectsScreen,ProjectDetailScreen}`.
> The routes use the subpaths, not the barrel: with both screens behind one
> barrel each route loaded both, taking `/projects` 153 → 161 kB and
> `/projects/[id]` 158 → 161 kB. The subpaths returned both to baseline exactly.
>
> **Status update (2026-08-12) — `projectsApi` is now Projects-owned.** The
> paragraph below is superseded for that one target; the rest of it still holds.
>
> `projectsApi` (**8 methods, 10 lines**) moved from `frontend/lib/api.ts` to
> `platforms/operations/projects/project-management/frontend/api/projects-api.ts`,
> byte-identical, published as the exact subpath `@apex/operations-projects/api`
> — never through the component root barrel, which exports screens.
>
> **The "4 of 5 consumers are not Projects" objection is resolved the same way it
> was for `ticketsApi` (PR #33) and `departmentsApi` (PR #34):** cross-component
> consumption through a public boundary is what a public boundary is for, and it
> does not make project data generic. The recorded removal condition —
> *"once core/users and operations/tickets stop consuming it"* — was written
> before that rule was settled and is not the condition that applied.
>
> **No compatibility façade was created**, unlike the ticket and department
> extractions. Those each left six legacy consumers behind; this one had only
> two (ticket creation and the command palette), so all six consumers were
> repointed and `frontend/lib/api.ts` sheds the group outright. It survives with
> **16** API groups.
>
> **Real debt reduction: 24 → 23.** `ProjectsScreen` imported *nothing else* from
> `@/lib/api`, so repointing it removed the whole statement and
> `DEBT-P3-PROJECTS-LEGACY-FRONTEND` fell 2 → 1. `ProjectDetailScreen` keeps one
> edge for `eventsApi` and `usersApi`, neither Projects-owned. This is the first
> API extraction in the programme to actually lower debt — the ticket and
> department extractions each moved it by zero.
>
> Bundle: `/projects` **152 → 149 kB**, because the screen no longer drags the
> 16-group façade into its First Load. `/tickets/new` shows 149 → 150 kB, a
> rounding-boundary crossing on a **+0.1 kB** page delta — it now imports from two
> modules where it previously imported from one.
>
> **`teamApi` was examined in the same pass and deliberately NOT moved.** Its two
> methods span two domains: `getDirectory()` calls `GET /users/directory`
> (`core/users/users.controller.ts`) and `sendRequest()` calls `POST /team/request`
> (`operations/team/team.controller.ts`, the reporting-lines controller). It is a
> composite façade group, not a domain API, and `platforms/workforce/teams/reporting-lines/`
> **does not exist**. Splitting it would change the exported object shape; moving
> it whole would put a users-directory call inside a teams component. It stays in
> `frontend/lib/api.ts` until `reporting-lines` exists — and note `teamApi` is
> **not** `teamsApi`, which is genuine `/teams/*` CRUD already owned by
> `workforce/teams/team-management`.
>
> **Nothing else was Projects-owned.** `projectsApi` has 5 consumers of which 4
> are not Projects (tickets/new, users/[id], profile, command-palette);
> `lib/utils.ts`, `auth.store.ts`, `EmptyState`, `Breadcrumb` are shared or
> global; `TicketRow` belongs to operations/tickets;
> `frontend/modules/operations/projects/projects.api.ts` is a re-export shim
> with **zero importers** and was left in place, not deleted.
>
> **New tracked debt `DEBT-P3-PROJECTS-LEGACY-FRONTEND` — 9 imports** across
> those 6 targets, scoped to the screens folder only, each with its own removal
> condition. Total repository debt 3 → 12. Self-tests 63 → 76.
>
> **Routes, component logic, API requests, payloads, permissions, styling and
> known defects are unchanged.** The Projects **backend** stays in
> `backend/src/` pending the Render deployment-root move. Frontend build 38/38.
>
> The rows above are now partially superseded: the two frontend screens have
> moved; the backend rows and the `stages/` test row remain accurate.

### operations/task-types ✅

| Current | Target |
| --- | --- |
| `backend/src/modules/platform/task-types/*` (3) | `platforms/operations/task-types/backend/` |
| `backend/test/integration/task-types.spec.ts` | `platforms/operations/task-types/tests/integration/` |

---

## platforms/intelligence

### intelligence/dashboard ✅ (**includes `home-v2`** — D5)

| Current | Target |
| --- | --- |
| `backend/src/modules/platform/dashboard/dashboard.controller.ts`, `dashboard.service.ts`, `dashboard.module.ts` | `platforms/intelligence/dashboard/backend/` |
| `backend/src/modules/platform/dashboard/home.controller.ts` | `platforms/intelligence/dashboard/backend/controllers/` |
| `frontend/app/(dashboard)/(core)/dashboard/page.tsx` | `platforms/intelligence/dashboard/frontend/screens/` |
| `frontend/app/home-v2/page.tsx` | `platforms/intelligence/dashboard/frontend/screens/` **D5** |
| `frontend/components/home/*` (8) | `platforms/intelligence/dashboard/frontend/components/` |
| `frontend/components/dashboard/*` (4) | `platforms/intelligence/dashboard/frontend/components/` |
| `backend/test/unit/p1d.dashboard-consistency.spec.ts` | `platforms/intelligence/dashboard/tests/backend/` |
| `backend/test/integration/p2.dashboard-recovery.spec.ts` | `platforms/intelligence/dashboard/tests/integration/` |

> **D5** — `home-v2` is an unlinked preview of the dashboard, using the
> established hidden-route pattern. It belongs with the dashboard it previews,
> and its route adapter stays unlinked.
>
> **D5 CORRECTED (2026-08-06).** This is no longer true. `frontend/app/home-v2/page.tsx`
> renders `ApexLandingPage` with `showPreviewBanner` — the same component `/`
> renders — and its own comment says the content "is promoted to /". It is a
> landing-page alias route, not a dashboard preview, and belongs to
> `platforms/system/public-site` per **D4**. It was NOT moved to the dashboard.
>
> **Status update (2026-08-06) — Dashboard overview frontend COMPARTMENTALISED**
> (branch `compartmentalize/intelligence-dashboard-frontend`), giving
> `intelligence` its first compartment.
>
> 9 legacy files → `platforms/intelligence/dashboard/overview/frontend/`:
> `dashboard/page.tsx` (770 ln) → `screens/DashboardScreen.tsx`, and all eight
> `components/home/*` → `components/`, emptying that folder. Five had exactly
> one consumer (this screen); three had none anywhere and were moved rather than
> orphaned — **not deleted**.
>
> Public entry `@apex/intelligence-dashboard` publishes one export. Route
> `/dashboard` unchanged, measured 20.5 kB / 223 kB against a 20.6 / 223
> baseline, so no subpath was needed.
>
> **`components/dashboard/*` (4) did NOT move** — the row above misassigns them.
> `activity-item` is consumed by profile, `category-chart` and
> `ticket-trend-chart` by analytics, `stat-card` by nothing. They follow
> analytics and profile, not the dashboard.
>
> New tracked debt `DEBT-P4-DASHBOARD-LEGACY-FRONTEND` — **15 imports** across
> `lib/{api,utils,company-date}`, `store/auth.store`, `components/ui/` and
> `components/workday/`. Repository debt 12 → 27. Self-tests 76 → 85.
> **No route, logic, API contract, permission, query key or style changed.**

### intelligence/analytics + reports ✅

| Current | Target |
| --- | --- |
| `backend/src/modules/platform/analytics/*` (3) | `platforms/intelligence/analytics/backend/` |
| `frontend/app/(dashboard)/analytics/page.tsx` | `platforms/intelligence/analytics/frontend/screens/` |
| `backend/test/unit/analytics.spec.ts` | `platforms/intelligence/analytics/tests/backend/` |
| `frontend/app/(dashboard)/(platform)/reports/page.tsx` | `platforms/intelligence/reports/frontend/screens/` |
| `frontend/modules/platform/reports/reports.api.ts` | ✅ **RETIRED** — zero-importer `@/lib/api` re-export shim, deleted. |

> Per D10, `performance/` is **not** scaffolded — it has no dedicated code and
> is currently part of analytics.

> **Status update (2026-08-07) — Analytics frontend COMPARTMENTALISED**
> (batch branch, Commit 4), giving `intelligence` its second compartment.
>
> 3 legacy files → `platforms/intelligence/analytics/overview/frontend/`:
> `analytics/page.tsx` (988 ln) → `screens/AnalyticsScreen.tsx`, plus
> `components/dashboard/{category-chart,ticket-trend-chart}.tsx` →
> `components/`. Both charts are `R100`; the screen differs from its route file
> by exactly four edits (three import paths and the identifier rename) and had
> no trailing whitespace to normalise.
>
> **This settles the `components/dashboard/*` question the Dashboard phase
> opened.** That phase predicted the two charts follow analytics; the evidence
> confirmed it — each has exactly one importer repo-wide, this screen.
> **`stat-card.tsx` was deliberately NOT absorbed**: it has zero consumers, and
> ownership follows consumers. It stays put, and a self-test asserts this phase
> left it alone. `frontend/components/dashboard/` is now down to that one file.
>
> > **Status update (2026-08-12) — `stat-card.tsx` is RETIRED, and the
> > "must stay in place" decision above is SUPERSEDED.**
> >
> > That decision was correct for its phase: it stopped an unconsumed file being
> > absorbed into analytics on filename grounds, when ownership follows consumers
> > and an unconsumed file has none to follow. What it could not do was decide the
> > file's fate — it only deferred it. The file never gained a consumer, so the
> > real choice was retire or keep forever. **Retirement was explicitly
> > authorised** and is recorded here rather than inferred.
> >
> > **Zero-consumer proof, re-run at `c4f5771` across four mechanisms:** no static
> > import by path or alias; no `StatCard` symbol import — the three similarly
> > named symbols elsewhere are unrelated declarations (`Card.tsx` in sales-crm,
> > `LegacyStatCard` declared locally inside `AnalyticsScreen`, `SkeletonStatCard`
> > in `shared/ui`); no dynamic `import()`, `React.lazy` or `require()`; no
> > string-based reference outside documentation and the architecture test's own
> > synthetic fixture. The file had **no module-scope side effects** — its only
> > statements were imports, an interface and one exported function — so deleting
> > it cannot change evaluation order.
> >
> > **Retired as dead code, NOT migrated into analytics.** The original reasoning
> > holds: it was never analytics-owned. `frontend/components/dashboard/` is now
> > empty and gone.
> >
> > The old assertion is replaced by the established anti-recreation pattern — the
> > path joins the same `RETIRED` list used for the PR #36 shim and PR #37 dead
> > component retirements, so recreating it fails the suite. Self-test count moves
> > 304 → 303 because one bespoke assertion was replaced by a line in an existing
> > list, not because coverage was lost.
>
> **Target path is `analytics/overview`, not `analytics/`.** The row above is
> depth-2, and `componentDepth` is 3 — `componentRootOf` returns `null` for a
> path that shallow, so the component-privacy rules would not bind. Same gap the
> Dashboard phase resolved with `dashboard/overview`; the alias mirrors it,
> `@apex/intelligence-analytics`.
>
> Public entry publishes one screen and **no subpath** — one screen, one route,
> so the barrel cannot force unused code on a consumer. Both charts stay
> internal so `recharts` is not pulled into every consumer of the entry.
> `/analytics` measured **117 kB / 263 kB, exactly its baseline** — and every
> other route in the build was byte-identical too.
>
> `useAuthStore` migrated to `@apex/core-identity`, taking legacy auth-store
> consumers 27 → 26. A self-test asserts the destructure is still
> `{ user, hasHydrated }` — `hasHydrated` is the field whose mishandling once
> logged users out on refresh.
>
> **The screen is read-only by construction** — no `useMutation`, no
> `mutationFn`, no `invalidateQueries` — so its three role expressions
> (`isManagerPlus`, `isAdminPlus`, `canAccess`) gate views only and cannot
> authorize an action. All three are locked verbatim, and the test fails if a
> mutation ever appears here.
>
> New tracked debt `DEBT-P10-INTELLIGENCE-ANALYTICS-LEGACY-FRONTEND` —
> **1 import**: a single multi-line statement for `analyticsApi`, `dashboardApi`
> and `ticketsApi`. None can follow this component — `analyticsApi` is shared
> with `core/users/profiles`, and the other two belong to sibling components.
> **3 files relocated for 1 debt import, the best ratio so far.** Repository
> debt 24 → 25. Self-tests 200 → 221.
>
> **No tab, role gate, period filter, query key, API call, chart rendering,
> empty state, export behaviour, copy or style changed.** Frontend build 38/38,
> 42 routes.

### intelligence/ai ✅

| Current | Target |
| --- | --- |
| `backend/src/modules/ai/*` (4) | `platforms/intelligence/ai/backend/` |
| `frontend/modules/ai/ai.api.ts` | ✅ **RETIRED** — zero-importer `@/lib/api` re-export shim, deleted. |

---

## platforms/business

### business/sales-crm — **pilot module**

> **Status update (2026-08-04):** the **Leads frontend slice is MIGRATED**
> (Phase 1A, branch `refactor/sales-crm-leads-frontend`). 18 files now live in
> `platforms/business/sales-crm/leads/`. The **Leads backend remains in its
> legacy location** and is deferred to **Phase 1B** — `backend/tsconfig.json`
> sets `rootDir: "./src"`, so compiling external sources would change the emit
> layout and break `render.yaml`'s `node dist/main.js`. **No API endpoint,
> browser route, response shape, feature-flag default or Prisma file changed.**
> All other Sales CRM components below are still unmigrated.
> See `platforms/business/sales-crm/leads/docs/README.md`.

> **Status update (2026-08-05) — Phase 2A: the `shared` component is MIGRATED**
> (branch `refactor/sales-crm-shared-frontend`). 10 files moved into
> `platforms/business/sales-crm/shared/`, published through
> `@apex/sales-crm-shared`: domain types and audit types, role permissions,
> constants, mock data, country codes (with `data/countries.json`), the auth
> adapter, the audit-log store and the data-mode connector.
>
> **Leads legacy debt: 90 → 37 imports.** The single broad
> `DEBT-P1A-LEADS-LEGACY-FRONTEND` exemption is **removed** and replaced by
> three narrow ones — `DEBT-P2A-LEADS-OWNED-LEGACY-ASSETS` (30),
> `DEBT-P2A-SALES-CRM-API-CLIENT` (6), `DEBT-P2A-SALES-CRM-AUTH-STORE` (1).
>
> Legacy Sales CRM feature screens were **not** migrated; they now import
> `@apex/sales-crm-shared` from their existing location, so there is exactly one
> implementation of each shared concern. The **Sales CRM backend remains in its
> legacy location** (see `apex-os-render-root-blocks-backend-slices`).
> **No browser route, API path, payload, response handling, role gate,
> feature-flag default, mock-data behaviour or Prisma file changed.**
> Frontend build stays at 38/38 static pages.
>
> Two rows in the table below are now **superseded**: the Sales CRM
> stylesheets and `frontend/components/sales-crm/ui/*` did **not** move to the
> shared component. `CompanyAutocomplete` and `CountryCodeSelect` have exactly
> one consumer (Leads), and moving `primitives.module.css` through the shared
> barrel would change CSS cascade order against `leads.module.css`. Both are
> deferred to **Phase 2B**.
> See `platforms/business/sales-crm/shared/docs/README.md`.

> **Status update (2026-08-05) — Phase 2B: legacy Sales CRM assets MIGRATED**
> (branch `refactor/sales-crm-leads-legacy-assets`). The four assets split by
> **importer evidence, not by filename**:
>
> | Asset | Importers | Went to |
> | --- | --- | --- |
> | `leads.module.css` | 16, all Leads | `leads/frontend/styles/` — component-internal |
> | `CompanyAutocomplete.tsx` | 1 (`LeadCreate`) | `leads/frontend/components/` — internal |
> | `CountryCodeSelect.tsx` | 1 (`LeadCreate`) | `leads/frontend/components/` — internal |
> | `primitives.module.css` | 51, of which 37 are other Sales CRM features | `shared/frontend/styles/` — public subpath |
>
> `primitives.module.css` is published as an **exact public style subpath**
> (`@apex/sales-crm-shared/styles/primitives.module.css`), never through the
> JavaScript barrel — a barrel export changes a CSS module's bundle position
> and therefore its cascade order against `leads.module.css`, which is applied
> to the same elements. `publicSubpaths` in `architecture-boundaries.json`
> is an exact allowlist, not a directory.
>
> **CSS content and import order preserved.** Both stylesheets are byte-identical
> to `HEAD` after CRLF normalisation (verified by SHA-256), and all 16 consumers
> keep `leads` then `primitives` on consecutive lines in their original
> positions — only the module specifier changed.
>
> **Debt: 37 → 8.** `DEBT-P2A-LEADS-OWNED-LEGACY-ASSETS` (30) **removed**. One
> new narrow debt, `DEBT-P2B-LEADS-COMPANY-REPOSITORY` (1): `CompanyAutocomplete`
> still calls `LocalStorageCompanyRepository`, which could not follow it —
> the repository has a second importer and reads `MOCK_CLIENTS` from the
> unmigrated Sales CRM **database** component. `DEBT-P2A-SALES-CRM-API-CLIENT`
> (6) and `DEBT-P2A-SALES-CRM-AUTH-STORE` (1) are unchanged.
>
> Architecture self-tests 26 → 38. **No browser route, rendered markup, class
> name, CSS declaration, component prop, API path, feature flag, role gate or
> mock-data behaviour changed.** Frontend build stays at 38/38 static pages with
> Sales CRM route sizes unchanged; backend and Prisma untouched.

> **Status update (2026-08-05) — Phase 2C: the authenticated API client is
> EXTRACTED** (branch `refactor/sales-crm-api-client`).
>
> The application's single axios instance — with the `Bearer` request
> interceptor, the `nexus_*`→`apex_*` token-key migration, the 401 →
> `/login?expired=true` redirect and the `response.data` unwrapping — moved
> **verbatim** from `frontend/lib/api.ts` to `shared/auth/frontend/authenticated-api-client.ts`,
> published as `@apex/shared-auth`. `frontend/lib/api.ts` keeps all 20
> application-wide API groups unchanged and re-exports `api`, because callers
> import the raw instance from it.
>
> `salesCrmLeadsApi` (11 methods) moved to the Sales CRM `shared` component and
> is consumed through `@apex/sales-crm-shared`. It is **not** re-exported from
> `frontend/lib/api.ts`: no runtime consumer of the old path remained, and a
> compatibility re-export would drag the Sales CRM barrel — including the
> Zustand-backed auth adapter — into all 57 consumers of that file.
>
> **Debt: 8 → 3.** `DEBT-P2A-SALES-CRM-API-CLIENT` (6) **removed**. Five of its
> six imports vanished outright; the sixth line also imported `usersApi`, an
> application-wide group used by 20 files, which is not a Sales CRM concern and
> stays put — recorded as `DEBT-P2C-LEADS-GLOBAL-USERS-API` (1). That is why the
> total is 3 and not the 2 originally projected.
>
> Two validator gaps closed: `shared/` importing the legacy `frontend/` or
> `backend/` roots was previously **unguarded** and is now
> `shared-no-legacy-frontend` / `-backend` with no exemption mechanism; and
> declared shared modules now publish a public entry point
> (`shared-module-public-entry`), so `shared/auth` internals are private exactly
> as a platform component's are.
>
> Self-tests 42 → 57, including source-contract assertions that there is exactly
> one production `axios.create`, that each interceptor is registered once, and
> that the token keys, migration keys, 401 redirect string and all 11 Leads
> endpoint/verb pairs are unchanged.
>
> `salesCrmLeadsApi` is published under the exact subpath
> **`@apex/sales-crm-shared/api`**, not the component's root barrel. Routing it
> through the barrel was measured first and cost **~23 kB of First Load JS** on
> `/sales-crm`, `/sales-crm/analytics`, `/sales-crm/dashboard`,
> `/sales-crm/database` and `/sales-crm/settings` — five routes that never call
> the Leads API — because every consumer of the barrel then loaded axios and
> evaluated the authenticated-client module. The subpath returned all five to
> their Phase 2B sizes exactly. The standing rule: **the Sales CRM root barrel
> carries no HTTP infrastructure.**
>
> **No route, API path, payload, response handling, token behaviour, redirect,
> feature flag or role gate changed.** Frontend build 38/38 with Sales CRM route
> sizes back at baseline; backend, Prisma and schema untouched.


| Current | Target |
| --- | --- |
| `backend/src/modules/business/sales-crm/leads.controller.ts`, `leads.service.ts` | `platforms/business/sales-crm/leads/backend/` |
| `backend/src/modules/business/sales-crm/sales-crm.module.ts` | `platforms/business/sales-crm/sales-crm.module.ts` |
| `backend/src/common/services/sales-access.service.ts` | `platforms/business/sales-crm/leads/backend/policies/` |
| `frontend/app/(workspaces)/sales-crm/leads/page.tsx` | `platforms/business/sales-crm/leads/frontend/screens/` + route adapter |
| `frontend/app/(workspaces)/sales-crm/dashboard/page.tsx` | `platforms/business/sales-crm/dashboard/frontend/screens/` **D12** |
| `frontend/app/(workspaces)/sales-crm/{page,layout,analytics,database,deals,requirements-sourcing,settings}` | matching `platforms/business/sales-crm/<component>/frontend/screens/` |
| `frontend/components/sales-crm/leads/*` (15) | `platforms/business/sales-crm/leads/frontend/components/` |
| `frontend/components/sales-crm/dashboard/*` (12) | `platforms/business/sales-crm/dashboard/frontend/components/` **D12** |
| `frontend/components/sales-crm/analytics/*` (8) | `platforms/business/sales-crm/analytics/frontend/components/` |
| `frontend/components/sales-crm/database/*` (5) | `platforms/business/sales-crm/database/frontend/components/` |
| `frontend/components/sales-crm/settings/*` (10) | `platforms/business/sales-crm/settings/frontend/components/` |
| `frontend/components/sales-crm/shell/*` (4) | `platforms/business/sales-crm/shared/shell/` |
| `frontend/components/sales-crm/ui/*` (7) | `platforms/business/sales-crm/shared/ui/` |
| `frontend/lib/sales-crm/*` (25) | split: adapters → component `frontend/api/`; types → `shared/contracts/`; stores → component `frontend/state/` ⚠️ |
| `frontend/styles/{leads,analytics,database,settings,shell,primitives,tokens,confirm-modal}.module.css` | `platforms/business/sales-crm/shared/styles/` |
| `frontend/modules/business/sales-crm/index.ts` | `platforms/business/sales-crm/index.ts` |

> **D12 — `dashboard/` and `analytics/` stay separate components.** They are
> distinct surfaces with 12 and 8 components respectively; collapsing them
> would create a component larger than the pilot needs and obscure which
> screens are which.
>
> **Why this is the right pilot:** 86 files, already self-contained under
> `sales-crm/` prefixes in four separate trees, feature-flagged dark
> (`NEXT_PUBLIC_SALES_CRM_LEADS_BACKEND_ENABLED` defaults off), and
> route-gated to ADMIN/SUPER_ADMIN. Lowest blast radius in the repository.
>
> Per D10, `frontend/modules/business/{finance,training-delivery}/index.ts` are
> placeholder stubs with no implementation — **no platform folders are created
> for them.** The stub files stay where they are until they have content.

---

## platforms/system

| Component | Current | Target |
| --- | --- | --- |
| `notifications` | `backend/src/modules/operations/notifications/*` (4) | `platforms/system/notifications/backend/` |
| | `frontend/components/notifications/DesktopNotificationManager.tsx` | `platforms/system/notifications/frontend/components/` |
| | `frontend/hooks/useDesktopNotifications.ts`, `useApprovalReminders.ts` | `platforms/system/notifications/frontend/hooks/` |
| | `frontend/modules/operations/notifications/notifications.api.ts` | ✅ **RETIRED** — zero-importer `@/lib/api` re-export shim, deleted. |
| | `backend/test/unit/p1.notification-event.spec.ts`, `p1d.notification-monitoring.spec.ts` | `platforms/system/notifications/tests/backend/` |
| `email` | `backend/src/modules/platform/email/*` (2) | `platforms/system/email/backend/` |
| `uploads` | `backend/src/modules/platform/uploads/*` (2) | `platforms/system/uploads/backend/` |
| | `backend/test/unit/p1d.attachment-security.spec.ts` | `platforms/system/uploads/tests/backend/` |
| | `e2e/tests/wf11-attachments.spec.ts` | `platforms/system/uploads/tests/e2e/` |
| `events` / `audit` | `backend/src/modules/platform/events/*` (2) | `platforms/system/events/backend/` |
| | `backend/src/common/services/event-logger.service.ts` | `platforms/system/audit/backend/services/` |
| | `backend/src/shared/constants/events.ts` | `platforms/system/events/shared/` |
| | `frontend/app/(dashboard)/admin/activity/page.tsx` | `platforms/system/audit/frontend/screens/` |
| | `e2e/tests/wf6-super-admin-audit.spec.ts` | `platforms/system/audit/tests/e2e/` |

> **Status update (2026-08-10) — SYSTEM AUDIT frontend COMPARTMENTALISED.**
> 1 legacy file → `platforms/system/audit/frontend/screens/ActivityLogScreen.tsx`
> (425 ln); one trailing-whitespace sequence removed, plus the `useAuthStore`
> path and the identifier. Public entry `@apex/system-audit`, no subpath.
> Read-only — the screen declares no mutation — and a self-test rejects any reach
> into another platform's internals, since it renders events it does not own.
>
> New debt `DEBT-P14-SYSTEM-AUDIT-LEGACY-FRONTEND` — **2 imports**. `eventsApi`
> stays because the events backend is unmigrated. **`frontend/lib/company-date.ts`
> stays for a stronger reason:** it is the central company business-date source
> shared with the scheduler and attendance surfaces, so moving it into audit would
> make attendance depend on audit. It must become a published shared contract, and
> a self-test proves no other component can borrow this exemption to reach it.

| `websocket` | `backend/src/modules/platform/gateway/*` (2) | `platforms/system/websocket/backend/` |
| | `frontend/hooks/useSocket.ts` | `platforms/system/websocket/frontend/hooks/` |
| `scheduler` | `backend/src/modules/platform/scheduler/scheduler.module.ts` | `platforms/system/scheduler/backend/` **D7** |
| | `backend/src/modules/platform/scheduler/scheduler.service.ts` | ⚠️ **split** — generic cron registration/logging stays; domain jobs leave **D7** |
| `automation` | `backend/src/modules/platform/automation/*` (2) | `platforms/system/automation/backend/` |
| `health` | `backend/src/modules/platform/health/*` (2) | `platforms/system/health/backend/` |
| `backup` | `backend/src/modules/platform/backup-vault/*` (2) | `platforms/system/backup/backend/` |
| **`public-site`** **D4** | `frontend/components/landing/ApexLandingPage.tsx` | `platforms/system/public-site/frontend/screens/` |
| | `frontend/app/page.tsx` | `platforms/system/public-site/frontend/screens/` + route adapter |
| | `frontend/app/privacy/page.tsx`, `terms/page.tsx` | `platforms/system/public-site/frontend/screens/` + route adapters |

> **D7 — scheduler split.** After the split, `system/scheduler` owns only
> generic cron infrastructure: module registration, the `@Cron` wiring pattern,
> and shared scheduling utilities. It holds **no domain logic** and imports no
> platform. The five current jobs relocate to their owning components:
> `autoCloseMidnightSessions`, `autoLogoutInactive` and `workdayEndReminder` →
> `workforce/attendance/workday/backend/jobs/`; `setLeaveStatuses` →
> `workforce/leave/applications/backend/jobs/`; `checkScheduledTickets` →
> `operations/tickets/lifecycle/backend/jobs/`. This removes the
> `system → workforce` import that would otherwise violate rule 9.
>
> **D4 — `public-site`** collects the unauthenticated marketing and legal
> surfaces. They are real screens with no platform affiliation; putting them in
> `apps/web` would leak page implementation into the composition shell.
>
> **Status update (2026-08-07) — public-site COMPARTMENTALISED**
> (batch branch `compartmentalize/architecture-batch-2026-08-07`, Commit 1),
> giving `system` its first compartment and completing coverage of **all six
> platforms**.
>
> 3 legacy files → `platforms/system/public-site/frontend/screens/`:
> `components/landing/ApexLandingPage.tsx` (474 ln, **byte-identical**),
> plus the `/privacy` and `/terms` bodies as `PrivacyScreen.tsx` and
> `TermsScreen.tsx`. `frontend/components/landing/` is now empty.
>
> **`metadata` stayed in the route files.** Next.js only honours
> `export const metadata` in a route file, so `/privacy` and `/terms` keep
> theirs with byte-identical values; only the JSX bodies moved.
>
> Published as `@apex/system-public-site` plus **three exact screen subpaths**.
> All four routes — `/`, `/home-v2`, `/privacy`, `/terms` — use the subpaths and
> measured **193 B / 94.5 kB**, identical to baseline. A barrel would have
> pulled the 474-line landing page into two 193 B pages.
>
> **This component adds ZERO debt** — the first to do so. Its three screens
> import only `next/link` and lucide icons, so there is no exemption entry at
> all, and a self-test asserts any legacy import from it is rejected.
> Repository debt unchanged at 19. Self-tests 149 → 159.
>
> **No rendered copy, layout, styling, animation, link, navigation, responsive
> behaviour, route URL, route visibility or metadata value changed.**
>
> ⚠️ `notifications` currently sits under `operations/` and moves to `system/`.
> Also carries open **BUG-H**: `events.gateway.ts` broadcasts ticket events to
> every connected socket. Fix that on its own branch **before** migrating the
> websocket component, so the fix is reviewable in isolation.

---

## shared/

| Target | Current |
| --- | --- |
| **`shared/time/`** **D1** | `backend/src/common/services/tva.service.ts`, `company-date.service.ts` |
| | `backend/src/common/controllers/tva.controller.ts` |
| | `backend/src/common/utils/timezone.util.ts` |
| | `frontend/lib/company-date.ts`, `date-utils.ts` |
| | `backend/test/unit/tva-date-authority.spec.ts`, `tva-sla-authority.spec.ts` |
| `shared/ui/` | `frontend/components/ui/*` (20), `frontend/components/layout/{sidebar,topbar}.tsx` |
| `shared/ui/styles/` | `frontend/app/globals.css`, `frontend/styles/dashboard.module.css` |
| `shared/auth/` | guards (3), decorators (2), `roles.ts` constants, `user-payload.interface.ts` |

> **Role vocabulary — corrected 2026-08-11.** `frontend/lib/roles.ts` was removed
> from this row and **retired**, not migrated here.
>
> It had **zero consumers** repo-wide — no static import, no dynamic `import()`,
> no `require()`, no barrel re-export, and none for any of its five exports
> (`ROLES`, `RoleName`, `ROLE_HIERARCHY`, `roleAtLeast`, `getRoleName`).
> Meanwhile `backend/src/shared/constants/roles.ts` exports the same `ROLES` and
> has **19 live backend consumers**.
>
> Moving the dead frontend copy into `shared/auth` would have manufactured a
> **second runtime role authority** beside a live one. `ROLE_HIERARCHY`,
> `roleAtLeast()` and `getRoleName()` were retired with it rather than preserved:
> relocating unused permission helpers would suggest an auth policy authority
> that no runtime path actually exercises.
>
> **`backend/src/shared/constants/roles.ts` remains the current live role
> authority** and is still the intended future source for `shared/auth/roles.ts`.
> It has NOT migrated. Cross-stack convergence is deferred to the backend
> structural phase, which is itself blocked until the Render deployment root
> moves.
| `shared/contracts/` | `frontend/modules/**/*.types.ts` not owned by one component |
| `shared/configuration/` | `frontend/lib/constants.ts` |

> **Status update (2026-08-11) — shared/configuration OPENED for cross-domain
> presentation constants.** `PRIORITY_LABELS` and `PRIORITY_COLORS` moved here
> from `frontend/lib/utils.ts`, published as `@apex/shared-configuration`.
>
> **Why not `operations/tickets`:** the Prisma `Priority` enum
> (LOW/MEDIUM/HIGH/URGENT) backs **both** the `Ticket` and the `Project` model —
> `schema.prisma` lines 170 and 230. Projects do not borrow ticket vocabulary;
> they have their own first-class `priority` field on the same enum, rendered at
> `ProjectDetailScreen.tsx:183` beside the projects-owned `PROJECT_STATUS_*`.
> Publishing these from a ticket component would assert that Projects renders
> ticket data, which the schema contradicts.
>
> **Why not `shared/contracts`:** that module is types only, no runtime code.
> These are runtime `Record<string,string>` maps of Tailwind classes.
>
> This is the `shared/configuration` README's own "constants used across
> platforms" allowance — the opposite of its "feature-specific constants"
> exclusion.
>
> **`frontend/lib/constants.ts` was RETIRED, not migrated (2026-08-11).** Its
> map row above targeted `shared/configuration`, but moving it wholesale would
> have recreated duplicate authorities: by the time this phase reached it, every
> one of its exports already had a live owner elsewhere, and the file itself had
> **zero consumers** — no static import, no dynamic `import()`, no `require()`.
>
> | Export | Live authority |
> | --- | --- |
> | `STATUS_LABELS`, `DEPT_COLORS` | `operations/tickets/lifecycle/shared/ticket-vocabulary.ts` |
> | `PRIORITY_LABELS` | `shared/configuration/priority.ts` |
> | `PROJECT_STATUS_LABELS` | `operations/projects/project-management/frontend/lib/project-status.ts` |
> | `LEAVE_STATUS_LABELS` | `workforce/leave/applications/frontend/lib/leave-status.ts` |
> | `ROLE_NAMES`, `RoleName` | `frontend/lib/roles.ts` (`ROLES`) — identical content, and the map already schedules that file for `shared/auth/roles.ts` |
>
> `ROLE_NAMES` is the one that matched by **content rather than name**: `ROLES` in
> `roles.ts` is the same six keys, same values, same `as const`. `constants.ts`
> held the duplicate; `roles.ts` is the mapped canonical source.
>
> Retiring the obsolete file rather than relocating a set of duplicates is
> recorded here as the resolved decision for this row.
| `shared/observability/` | `backend/src/instrument.ts` |
| `shared/utilities/` | `frontend/lib/utils.ts`, `download-screenshot.ts`, `frontend/hooks/{useDebounce,useTheme}.ts` — ✅ `useDebounce` and `useTheme` both DONE |

> **Status update (2026-08-12) — `useTheme` MOVED to `shared/utilities`.**
>
> `frontend/hooks/useTheme.ts` (87 ln) → `shared/utilities/use-theme.ts` via
> `git mv`; the blob hash is unchanged, so the relocation is byte-identical.
> Published as the exact subpath `@apex/shared-utilities/use-theme`, mirroring
> `use-debounce` from this same row — **not** added to the root barrel, which
> stays at its four dependency-light exports.
>
> This is the second and last file from this row: `useDebounce` moved in PR #32
> under the identical pattern. The whole module imports only `react`, so the move
> introduces no legacy edge and the original **fully retires** — no adapter, no
> façade. Its single consumer, `(dashboard)/settings/page.tsx`, changed by one
> import specifier.
>
> **`applyTheme` is exported but unconsumed**, and `settings/page.tsx` defines its
> own local `applyTheme` for a different concern (light/dark/system, versus the
> module's `applyTheme(theme, accent)`). The names collide but nothing imports the
> exported one. It was preserved verbatim under R100 rather than pruned during a
> relocation; retiring it is a separate decision.
>
> The unresolved-assignments list above previously named `useTheme.ts` as having
> "no proven owner yet", which contradicted this row. That entry is corrected.
>
> Preserved exactly: `useTheme`, `applyTheme`, `ThemeId`, `AccentId`, the
> `apex-theme`/`apex-accent` storage keys, the `data-theme`/`data-accent`
> attributes, the `typeof localStorage === 'undefined'` guards and every default.
> `frontend/app/layout.tsx`'s anti-flash script reads the same keys independently
> and was not touched.

> **Status update (2026-08-11) — `frontend/lib/utils.ts` is RETIRED.** The row
> above is now historical: the file did not move to `shared/utilities` wholesale,
> it was split by ownership across four destinations, which is the rule this
> migration settled on rather than the one the row assumed.
>
> | Symbols | Went to |
> | --- | --- |
> | `cn`, `formatDate`, `getInitials`, `formatRelativeTime` | `shared/utilities` |
> | `PROJECT_STATUS_*` | `operations/projects/project-management` |
> | `LEAVE_STATUS_*` | `workforce/leave/applications` |
> | `PRIORITY_LABELS`, `PRIORITY_COLORS` | `shared/configuration` — cross-domain enum |
> | `STATUS_*`, `CATEGORY_*`, `DEPT_COLORS`, `ROLE_LABELS`, `formatRole` | `operations/tickets/lifecycle` |
>
> Zero runtime importers remained, so the file was deleted. That is +1 original
> runtime file relocated, and it retired `DEBT-T1-TICKETS-LIFECYCLE-LEGACY-FRONTEND`
> outright while narrowing `DEBT-P6` and `DEBT-P3` to `lib/api.ts` only.
| `shared/testing/` | `backend/test/helpers/{app,auth}.helper.ts`, `backend/test/jest.env.ts`, `e2e/tests/utils.ts` |

> **D1 — `shared/time/` is the Time/Value Authority's home.** Attendance,
> tickets, SLA, scheduler jobs and analytics all depend on it for company-date
> and elapsed-time semantics. It is genuinely cross-cutting: it is not a
> platform, and it is not feature-specific. Any other placement creates the
> circular dependency rule 9 forbids.
>
> `shared/time/` must not import from any platform. Platforms import from it.

---

## database/ (D13)

| Target | Current |
| --- | --- |
| `database/prisma/schema.prisma` | `backend/prisma/schema.prisma` |
| `database/prisma/migrations/` | `backend/prisma/migrations/` (33) |
| `database/prisma/migration_lock.toml` | `backend/prisma/migrations/migration_lock.toml` |
| **`database/client/`** **D2** | `backend/src/prisma/prisma.module.ts`, `prisma.service.ts` |
| `database/seeds/` | `seed.ts`, `seed-test-users.ts`, `seed-hrms-policy.ts`, `reset-seed.ts` 🔒, `backend/seed-test-sessions.ts` |
| `database/maintenance/` | `check-db.ts`, `scripts/{verify-manager-access,seed-manager-access,seed-task-types}.ts` |
| `database/repair/` 🔒 | `scripts/{fix-production-data,fix-hierarchy,fix-hierarchy-v2,fix-role-name,migrate-estimated-time,add-missing-employees}.ts`, `backend/{tva_repair,tva_execute_repair,tva_anomaly_scan}.js`, `backend/wipe.ts` |

> **D13 — schema and migrations stay centralized outside `platforms/`.**
> A single schema and a single migration history are non-negotiable: Prisma
> resolves one `schema.prisma`, `migrate deploy` runs one history, and
> per-platform schemas would make migration ordering unresolvable. Components
> may hold repository adapters; they never hold migrations or private schemas.
>
> **D2 — `database/client/` holds `PrismaModule` and `PrismaService`.** They are
> injected by nearly every backend service, so they must be importable from any
> platform without creating a cycle. `database/client/` imports nothing from
> `platforms/`.

---

## apps/

| Target | Current |
| --- | --- |
| `apps/web/app/**` | `frontend/app/**` route files, reduced to one-line re-export adapters |
| `apps/web/app/{layout.tsx,not-found.tsx,providers.tsx}` | same paths — genuine app shell, stay real |
| `apps/web/public/` | `frontend/public/` |
| `apps/web/{next.config.js,tailwind.config.ts,postcss.config.js,tsconfig.json,package.json,.eslintrc.json}` | `frontend/` root |
| `apps/web/.env*.example` | `frontend/.env*.example` (3) |
| `apps/api/src/{main.ts,app.module.ts}` | `backend/src/{main.ts,app.module.ts}` |
| `apps/api/{nest-cli.json,tsconfig.json,package.json,jest.config.js,.eslintrc.js,.npmrc}` | `backend/` root |
| `apps/api/.env*.example` | `backend/.env*.example` (2) |
| **`apps/e2e/`** **D3** | `e2e/{playwright.config.ts,package.json,package-lock.json,.gitignore,simulate-e2e.ts}` |
| | `e2e/tests/example.spec.ts` |

> **D3 — `apps/e2e/` is the Playwright runner and configuration root.**
> Feature specs stay co-located with their component in `tests/e2e/`; the runner
> discovers them via `testDir`/glob configuration pointing into `platforms/`.
> This keeps one Playwright project and one config while preserving
> vertical-slice ownership of the specs themselves. `e2e/tests/utils.ts` moves
> to `shared/testing/` since it is consumed by specs across many components.

---

## Scripts (D6) — documented, not moved

Root and backend ad-hoc scripts **do not move in this migration.** Moving an
executable can break any package script, deployment step, or documentation that
references it by path, and several can destroy production data. They are
deferred to a dedicated script-safety audit.

**Target categories for that audit** — documented now so the audit has a
vocabulary, created only when the audit runs:

| Category | Intent | Current candidates |
| --- | --- | --- |
| `audit` | Read-only inspection, safe to run anywhere | `backend/audit_assignees.ts`, `audit_relations.ts`, `audit_sequence.ts`, `check_logs.ts`, `tva_anomaly_scan.js` |
| `verification` | Post-deploy checks against a running system | `production-smoke-test.js`, `verify-endpoints.js`, `backend/prisma/scripts/verify-manager-access.ts` |
| `maintenance` | Routine, reversible operational tasks | `backend/prisma/check-db.ts`, `scripts/seed-manager-access.ts`, `seed-task-types.ts` |
| `repair` 🔒 | Mutates existing data; requires dry-run + approval | `scripts/fix-production-data.ts`, `fix-hierarchy*.ts`, `fix-role-name.ts`, `migrate-estimated-time.ts`, `add-missing-employees.ts`, `tva_repair.js`, `tva_execute_repair.js` |
| `quarantine` 🔒 | Unknown purpose or destructive; do not run | `backend/wipe.ts`, `fix-specs.js`, `fix-specs-2.js`, `test-bug2.ts`, `test-bug2-prisma.ts`, `generate_policy_decision.js`, `generate_tva_reports.js`, `reset-seed.ts` |

Every script must be classified — with package-script reference checks, import
checks, environment guards, dry-run support and production-database protection
confirmed — before any of them is moved.

---

## Unresolved assignments

Only decisions that genuinely belong to a later phase remain open. Each is
blocked on information that does not exist yet, not on a choice that could be
made now.

| # | Item | Why deferred | Phase |
| --- | --- | --- | --- |
| ~~U1~~ | ~~`ticket-row.tsx` vs `TicketRow.tsx`~~ | **RESOLVED 2026-08-11.** The premise was wrong: these were never two implementations. `components/tickets/ticket-row.tsx` (225 ln) is the only one, with 4 consumers; `modules/.../TicketRow.tsx` is a 5-line re-export with **zero** consumers. The real question was ownership, answered below. | — |
| U2 | Attendance policy source of truth | The live `AppSetting` `workday_policy` record and the fully-migrated but entirely unwired `AttendancePolicy` / `ShiftPolicy` / `EmployeeAttendanceProfile` / `WeeklyOffPolicy` / `HolidayCalendar` models are two competing systems. A grep for those model names across `backend/src` returns zero files. The `policies/` component boundary cannot be settled until the transition is decided — and that is a product decision, not a structural one. | 5 |
| U3 | `tickets/attachments/` boundary | No dedicated backend file exists; attachment handling is split between `tickets.service.ts` and `system/uploads`. Defining the boundary requires tracing the actual call paths. | 4 |
| U4 | `staging` HRMS backend | `backend/src/modules/platform/hrms-attendance/` exists only on `staging`, which is 19 commits behind `main`. It cannot be assigned a target until `staging` is reconstructed and its content reconciled with `main`. | 5 |

---

## Phase sequencing

| Phase | Scope | Branch | Risk |
| --- | --- | --- | --- |
| 0 | Create `apps/`, `platforms/`, `database/`, `shared/`; add path aliases and boundary lint rules. **No runtime move.** | `refactor/modular-architecture-foundation` | LOW |
| 1 | Sales CRM leads pilot | `refactor/sales-crm-leads-module` | LOW — flagged dark |
| 2 | `health`, `email`, `uploads`, `settings`, `analytics`, `reports`, `public-site` | one branch each | LOW–MED |
| 3 | `auth`, `users`, `roles`, `departments`, `teams` | one branch each | MED–HIGH |
| 4 | `projects`, `tickets` (component-by-component), `comments`, `task-types`, `notifications`. Resolve U1, U3. | one branch per component | HIGH |
| 5 | `leave`, `calendar`, `attendance` (incl. scheduler job split), `idle`. Resolve U2, U4. | one branch per component | **HIGHEST** 🔒 |

Every migration PR must preserve: browser URLs, API URLs, API response shapes,
Prisma schema, migration history, feature behaviour, and production environment
configuration.

**Phase 0 is now unblocked** — D1, D2, D3, D4, D5 and D6 resolve everything that
previously prevented the foundation branch from being created.

---

## What this map does not do

- It does not move, rename, or modify any file.
- It does not change any import, route, endpoint, or configuration.
- It does not resolve U1–U4 — those are deliberately deferred to their phase.
- It does not authorise creating the foundation branch. That is a separate,
  explicitly approved step.
