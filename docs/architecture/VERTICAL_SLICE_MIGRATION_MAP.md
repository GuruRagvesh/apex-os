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

Every one is assigned below, or listed in [Unresolved assignments](#unresolved-assignments)
with the reason it is deferred to a later phase.

---

## Whole-Apex scoreboard

Exact tracked counts from `git ls-files`, not estimates. Runtime extensions
only (`.ts .tsx .js .jsx .mjs .cjs .css .json .prisma`).

**Last measured: 2026-08-06.**

Two figures, because they answer different questions. Every component we create
adds 2-4 `index.ts` barrels regardless of how much legacy code moved, so the
footprint number flatters progress. **Legacy relocation is the honest metric**,
and its denominator is fixed at **423** so the percentage cannot drift by
adding scaffolding.

### Primary — legacy files relocated (denominator fixed at 423)

| | Merged (`origin/main`) | Candidate (core/users branch) |
| --- | --- | --- |
| Legacy relocated | 59 | **61** |
| **Relocation** | **13.9%** | **14.4%** |

### Secondary — target-architecture footprint

| | Merged (`origin/main`) | Candidate (core/users branch) |
| --- | --- | --- |
| Runtime files in new architecture | 84 | **88** |
| of which barrels | 20 | 22 |
| of which extracted modules | 5 | 5 |
| Legacy remaining | 366 | 366 |
| Total tracked runtime | 450 | 454 |
| **Footprint** | **18.7%** | **19.4%** |

`compartmentalize/core-users-frontend` relocates **2 legacy files** and adds
**2 barrels**. Until it merges the baseline remains 59/423 = 13.9%. README
files are documentation and excluded from both figures.

### Platform and shared coverage

Candidate branch included; `core` is new. **Five of six platforms now hold a
compartment** — only `system` is untouched.

| Module | Files | Status |
| --- | --- | --- |
| `platforms/business` | 40 | Sales CRM Leads + shared |
| `shared/ui` | 16 | Design-system primitives |
| `platforms/intelligence` | 11 | Dashboard overview |
| `platforms/workforce` | 6 | Leave applications |
| `platforms/operations` | 4 | Projects frontend |
| `shared/utilities` | 4 | `cn`, `formatDate`, `getInitials` |
| `platforms/core` | 4 | Users administration (candidate branch) |
| `shared/auth` | 3 | Authenticated HTTP client |
| `platforms/system` | 0 | not started |
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
| `frontend/modules/core/auth/auth.api.ts` | `platforms/core/identity/authentication/frontend/api/` |
| `frontend/modules/core/auth/auth.types.ts` | `platforms/core/identity/authentication/shared/contracts/` |
| `frontend/store/auth.store.ts` | `platforms/core/identity/authentication/frontend/state/` |
| `backend/test/unit/auth.otp.spec.ts`, `auth.throttle.spec.ts` | `platforms/core/identity/authentication/tests/backend/` |

### core/identity/authorization ✅

| Current | Target |
| --- | --- |
| `backend/src/common/services/access-policy.service.ts` | `platforms/core/identity/authorization/backend/policies/` |
| `backend/src/shared/guards/jwt-auth.guard.ts`, `roles.guard.ts`, `app-throttler.guard.ts` | `shared/auth/guards/` |
| `backend/src/shared/decorators/roles.decorator.ts`, `current-user.decorator.ts` | `shared/auth/decorators/` |
| `backend/src/shared/constants/roles.ts` | `shared/auth/constants/` |
| `backend/src/shared/interfaces/user-payload.interface.ts` | `shared/auth/types/` |
| `frontend/lib/roles.ts` | `shared/auth/roles.ts` |
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
| `backend/src/modules/core/users/users.controller.ts`, `users.service.ts`, `users.module.ts` | `platforms/core/users/profiles/backend/` |
| `backend/src/modules/core/users/change-requests.controller.ts`, `change-requests.service.ts` | `platforms/core/users/change-requests/backend/` |
| `frontend/app/(dashboard)/(platform)/users/page.tsx`, `[id]/page.tsx` | `platforms/core/users/administration/frontend/screens/` |
| `frontend/app/(dashboard)/(platform)/users/[id]/profile/page.tsx`, `(dashboard)/profile/page.tsx` | `platforms/core/users/profiles/frontend/screens/` |
| `frontend/app/(dashboard)/admin/approvals/page.tsx` | `platforms/core/users/change-requests/frontend/screens/` |
| `frontend/modules/core/users/users.api.ts` | `platforms/core/users/profiles/frontend/api/` |
| `backend/test/unit/users.profile.spec.ts` | `platforms/core/users/profiles/tests/backend/` |
| `backend/test/unit/users.change-requests.spec.ts` | `platforms/core/users/change-requests/tests/backend/` |
| `backend/test/unit/users.admin-correction.spec.ts` | `platforms/core/users/administration/tests/backend/` |

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

### core/organization ✅

| Current | Target |
| --- | --- |
| `backend/src/modules/core/departments/*` (3) | `platforms/core/organization/departments/backend/` |
| `frontend/app/(dashboard)/(platform)/departments/page.tsx`, `[id]/page.tsx` | `platforms/core/organization/departments/frontend/screens/` |
| `backend/test/unit/departments.manager-access.spec.ts` | `platforms/core/organization/departments/tests/backend/` |
| `backend/src/modules/core/roles/*` (3) | `platforms/core/organization/roles/backend/` |
| `backend/src/common/services/hierarchy-approval.service.ts` | `platforms/core/organization/hierarchy/backend/services/` |

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
| `frontend/modules/operations/leave/leave.api.ts` | `platforms/workforce/leave/applications/frontend/api/` |
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

### workforce/teams ✅

| Current | Target |
| --- | --- |
| `backend/src/modules/operations/team/team.controller.ts`, `team.service.ts` | `platforms/workforce/teams/reporting-lines/backend/` |
| `backend/src/modules/operations/team/teams.controller.ts`, `teams.service.ts` | `platforms/workforce/teams/team-management/backend/` |
| `backend/src/modules/operations/team/team.module.ts` | `platforms/workforce/teams/teams.module.ts` |
| `backend/src/modules/operations/team/dto/*` (4) | `platforms/workforce/teams/team-management/backend/dto/` |
| `frontend/app/(dashboard)/(operations)/teams/page.tsx`, `[id]/page.tsx` | `platforms/workforce/teams/team-management/frontend/screens/` |
| `frontend/app/(dashboard)/(operations)/team/page.tsx` | `platforms/workforce/teams/reporting-lines/frontend/screens/` |
| `frontend/modules/operations/team/team.api.ts` | `platforms/workforce/teams/team-management/frontend/api/` |
| `frontend/components/home/TeamPressurePanel.tsx` | `platforms/workforce/teams/reporting-lines/frontend/components/` |
| `backend/test/unit/teams.service.spec.ts` | `platforms/workforce/teams/team-management/tests/backend/` |
| `e2e/tests/wf3-manager-oversight.spec.ts` | `platforms/workforce/teams/reporting-lines/tests/e2e/` |

> Note the confusing pair: `team.*` (singular, reporting lines) and `teams.*`
> (plural, team CRUD) are different features in one folder. The split above is
> a genuine improvement, not just relocation.

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
| `frontend/app/(dashboard)/(operations)/kanban/page.tsx` | `platforms/operations/tickets/lifecycle/frontend/screens/` |
| `frontend/components/tickets/OverdueTicker.tsx` | `platforms/operations/tickets/sla/frontend/components/` |
| `frontend/components/tickets/ticket-row.tsx` | ❓ U1 — duplicate |
| `frontend/modules/operations/tickets/components/TicketRow.tsx` | ❓ U1 — duplicate |
| `frontend/modules/operations/tickets/tickets.api.ts` | `platforms/operations/tickets/lifecycle/frontend/api/` |
| `frontend/modules/operations/tickets/tickets.types.ts` | `platforms/operations/tickets/shared/contracts/` |
| `frontend/lib/ticket-timing.ts` | `platforms/operations/tickets/sla/shared/` |
| `frontend/lib/ticket-visibility.ts` | `platforms/operations/tickets/lifecycle/shared/` |
| `backend/test/unit/ticket*.spec.ts`, `tickets.*.spec.ts` (17 files) | distribute across component `tests/backend/` |
| `backend/test/unit/scheduler.recurring.spec.ts` | `platforms/operations/tickets/lifecycle/tests/backend/` **D7** |
| `e2e/tests/wf1-ticket-execution.spec.ts` | `platforms/operations/tickets/lifecycle/tests/e2e/` |
| `e2e/tests/wf2-team-lead-review.spec.ts` | `platforms/operations/tickets/review-rework/tests/e2e/` |
| `e2e/tests/wf4-cross-department-block.spec.ts` | `platforms/operations/tickets/blocking/tests/e2e/` |

### operations/projects ✅

| Current | Target |
| --- | --- |
| `backend/src/modules/operations/projects/*` (3) | `platforms/operations/projects/project-management/backend/` |
| `frontend/app/(dashboard)/(operations)/projects/page.tsx`, `[id]/page.tsx` | `platforms/operations/projects/project-management/frontend/screens/` |
| `frontend/modules/operations/projects/projects.api.ts` | `platforms/operations/projects/project-management/frontend/api/` |
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
| `frontend/modules/platform/reports/reports.api.ts` | `platforms/intelligence/reports/frontend/api/` |

> Per D10, `performance/` is **not** scaffolded — it has no dedicated code and
> is currently part of analytics.

### intelligence/ai ✅

| Current | Target |
| --- | --- |
| `backend/src/modules/ai/*` (4) | `platforms/intelligence/ai/backend/` |
| `frontend/modules/ai/ai.api.ts` | `platforms/intelligence/ai/frontend/api/` |

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
| | `frontend/modules/operations/notifications/notifications.api.ts` | `platforms/system/notifications/frontend/api/` |
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
| `shared/auth/` | guards (3), decorators (2), `roles.ts` constants, `user-payload.interface.ts`, `frontend/lib/roles.ts` |
| `shared/contracts/` | `frontend/modules/**/*.types.ts` not owned by one component |
| `shared/configuration/` | `frontend/lib/constants.ts` |
| `shared/observability/` | `backend/src/instrument.ts` |
| `shared/utilities/` | `frontend/lib/utils.ts`, `download-screenshot.ts`, `frontend/hooks/{useDebounce,useTheme}.ts` |
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
| U1 | `frontend/components/tickets/ticket-row.tsx` vs `frontend/modules/operations/tickets/components/TicketRow.tsx` | Two implementations of the same concept in the two competing frontend styles. Which is canonical, and whether they are behaviourally identical, requires reading both against their call sites. Migrating both would preserve duplication inside a structure that claims to have none. | 4 |
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
