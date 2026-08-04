# Apex OS — Complete Project, Feature, Architecture & Roadmap Audit

**Date:** 2026-08-02
**Scope:** Full repository — frontend, backend, schema, tests
**Method:** Direct code reads (primary author, this session) + 4 parallel read-only research passes, cross-verified against this session's own extensive hands-on work on tickets/workday/departments/notifications
**Nature:** Read-only audit. No code changed. No commit/push.

---

## SECTION 1 — Executive Summary

**How far Apex OS has come.** This is not a prototype. Apex OS has a real, tested, production-deployed core: authentication, users, departments, teams, a genuinely sophisticated ticket engine (TASK/QUERY/HELP, cross-department routing, hierarchy-based approval, rework cycles, SLA timing, and — as of this session — a real worked-time ledger), workday/attendance tracking with break and auto-close handling, leave management, project management with stages and members, and an analytics/dashboard layer that is mostly real, DB-backed computation rather than decoration. 46 backend unit test suites exist, with deep coverage specifically on the ticket/hierarchy/approval logic (35 tests in hierarchy-approval alone).

**Maturity estimate:**
| Dimension | Rating | Why |
|---|---|---|
| MVP readiness | **Exceeded** | Core execution loop (create → assign/route → work → review → close) works end-to-end with real permission logic, not a demo. |
| Production trust readiness | **Mostly there, with named gaps** | Two confirmed data-scoping bugs (dashboard approval-workload count, WebSocket ticket broadcasts) leak cross-department information to authenticated users. Both are narrow, both are fixable in under a day each, neither is currently fixed. |
| Enterprise readiness | **Foundational, not yet structural** | The single biggest structural gap versus your own stated business model is that a Project can only belong to **one department**, not many — assumption #1 in this audit's brief is not true of the current schema. Multi-department user membership (assumption #5) has a schema model (`UserDepartmentMembership`) that exists but is not wired into ticket/leave/project access logic anywhere I can find. |

**Biggest strengths:**
1. The ticket engine's permission model is unusually rigorous for a system this size — self-assignment rules, hierarchy-based approval chains, and the "assigner closes, not the assignee" rule are all real, tested, and (as of this session) correctly extended to cross-department QUERY/HELP routing.
2. Backend is genuinely the source of truth almost everywhere audited — dashboard and analytics numbers are DB-aggregated, not frontend-invented, with one specific exception noted below.
3. The worked-time ledger gap (ticket timers not pausing on break) was found, root-caused, and correctly wired this session — a real example of the system getting *more* correct over time, not just accumulating features.
4. **AI is a genuine, working GPT-4o-mini integration, not a demo stub** — real prompts built from real ticket/comment context for priority suggestion, ticket summaries, and per-ticket next-action suggestions, plus a daily 6pm digest cron job. It degrades gracefully (clear "coming soon" fallback, never a crash) when no API key is configured. This is a stronger starting point for Phase G (AI layer) than the roadmap brief assumed.
5. User profile access control is genuinely tiered, not binary — self (masked payroll), direct manager (no payroll), same-department Team Lead (safe fields only), everyone else (safe fields only), Admin/HR (full, audit-logged) are four distinct, correctly-ordered visibility levels, confirmed by direct code read.

**Biggest risks:**
1. **Most severe finding of this audit — the main seed script (`backend/prisma/seed.ts`) has no production environment guard and unconditionally deletes real data.** It deletes *all* projects and *every user not on a hardcoded allow-list of emails* — with a comment directly above the code claiming "Safe to run multiple times — all upserts, nothing is deleted," which is false for the current code. There is no `NODE_ENV`/`APP_ENV` check anywhere in the script. This is a one-line fix (add a production guard) protecting against a catastrophic, silent, one-command data-loss scenario. Rank this above both bugs below.
2. **Confirmed, unfixed:** `DashboardService.getApprovalWorkload()` counts pending reviews company-wide with no department scope — any Team Lead or Manager sees the *global* pending-review count, not their own. Found independently twice (once in an early audit this session, once by a fresh research pass just now) — this is real, not speculative.
3. **Confirmed, unfixed:** `EventsGateway.emitTicketCreated()` and `emitTicketStatusChanged()` broadcast the full ticket payload to *every connected socket*, regardless of department/role visibility. The code's own comments say `/** Broadcast to every connected client */` — this is a deliberate design choice, not an oversight, but it is inconsistent with how carefully the REST layer scopes the same data.
4. **Project → single department only.** If "one project may involve multiple departments" is a real business requirement, the schema needs a join table (`ProjectDepartment`) before Enterprise Execution OS positioning is honest.
5. **No KRA/KPI data model anywhere.** Department Head and Team Lead "accountability" (assumptions #7/#8) exist as *access* concepts (who can approve/view what) but there is no model that stores a KRA, a KPI target, or a performance score. HRMS/performance is 0% built, not partially built. (Note: this is *not* a gap in the People/Attendance/AI side of HRMS — that side is unexpectedly strong, see Section 6.)
6. Project hard-delete has no application-level check for linked tickets (unlike ProjectStage delete, which correctly blocks if tickets are attached) — the same protective pattern exists one level up in the same file and simply wasn't applied to `remove()`.

**Is the Enterprise Execution OS direction valid?** Yes, directionally — the ticket/project/department/workday primitives are the right foundation, and this session's own work (wiring the worked-time ledger, fixing QUERY/HELP routing to be genuinely anyone-to-anyone, making ticket type visible) shows the codebase responds well to targeted, evidence-driven fixes rather than rewrites. But CRM and HRMS are not "partially built and need polish" — they are **0% built** (CRM: zero code found anywhere; HRMS: only the HR-adjacent pieces of workday/leave/users exist, no performance/KRA/KPI layer at all). The realistic sequencing is: fix the two confirmed scoping bugs, close the multi-department gap, *then* build outward — not build CRM/HRMS on top of a foundation that still leaks data across departments.

---

## SECTION 2 — Complete Feature Inventory

Classification legend: `COMPLETE_REAL` · `COMPLETE_LOCAL_OR_LIMITED` · `PARTIAL_CONNECTED` · `FRONTEND_ONLY` · `BACKEND_ONLY` · `UI_PLACEHOLDER_OR_MISLEADING` · `BROKEN` · `SECURITY_OR_DATA_RISK` · `ROADMAP_NOT_BUILT` · `UNKNOWN_NEEDS_MANUAL_VERIFICATION`

| # | Feature | Frontend | Backend | DB Models | Status | Evidence | Missing | Risk | Next Action |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Auth/login | `app/login`, `store/auth.store.ts` | `auth.service.ts`, `auth.controller.ts`, JWT guard | `User`, `Role` | **COMPLETE_REAL** | `auth.otp.spec.ts`, `auth.throttle.spec.ts` exist; JWT verified in `EventsGateway.handleConnection` too | MFA beyond OTP unclear | Low | None urgent |
| 2 | Users | `users/page.tsx`, `users/[id]/*` | `users.service.ts` (~1200 lines), `users.controller.ts` | `User` | **COMPLETE_REAL** | `safeUser()` strips payroll fields (`access-policy.service.ts`); `users.profile.spec.ts`, `users.admin-correction.spec.ts`, `users.change-requests.spec.ts` exist | Granular audit of every list-endpoint scope not done this pass | Medium (verify) | Spot-check `GET /users` scoping for EMPLOYEE role |
| 3 | Roles/permissions | Role badges, `RolesGuard` usage | `roles.guard.ts`, `ROLES` const, `AccessPolicyService` | `Role`, `UserRoleAssignment` | **COMPLETE_LOCAL_OR_LIMITED** | Fixed 6-tier hierarchy (EMPLOYEE→INTERN→TEAM_LEAD→MANAGER→ADMIN→SUPER_ADMIN) + separate `isHR` boolean flag (confirmed this session, sidebar work) | No granular per-permission RBAC — role name is the unit of authorization everywhere | Low | Fine as-is for current scale |
| 4 | Departments | `departments/page.tsx`, `[id]` | `departments.service.ts`, `.controller.ts` | `Department` | **COMPLETE_REAL** | Full CRUD confirmed multiple sessions; `departments.manager-access.spec.ts` exists | Department has no owner-department-to-project link (see #21) | Low | None urgent |
| 5 | Department Head | `selectDepartmentHead()` used in dept detail | `departments.service.ts` | `ManagerDeptAccess` | **PARTIAL_CONNECTED** | Head is *derived* — the earliest `ManagerDeptAccess` row for a dept, singularity enforced by deleting prior rows in a transaction on `addManager()`, not a DB constraint | No dedicated "head" field; no KRA/KPI attached to the role at all | Medium | Decide: formalize as a field, or accept derived model |
| 6 | Teams | `teams/page.tsx`, `[id]` | `teams.service.ts`, `.controller.ts` | `Team` | **COMPLETE_REAL** | Full CRUD, gated to `ADMIN/SUPER_ADMIN/MANAGER`; sidebar visibility correctly restricted this session | — | Low | None urgent |
| 7 | Team members | Team detail add/remove UI | `teams.service.ts` | `TeamMember` | **COMPLETE_REAL** | Confirmed via `teams.service.spec.ts` | — | Low | None urgent |
| 8 | Team Lead | `Team.teamLeadId` | Hierarchy approval chain uses it directly | `Team.teamLeadId → User` | **COMPLETE_REAL** | First-class field, unlike Department Head; used in `HierarchyApprovalService.resolveTaskCreationApprover()` | Same KRA/KPI gap as Dept Head | Low | None urgent |
| 9 | Tickets (core) | `tickets/`, `tickets/new`, `tickets/[id]` | `tickets.service.ts` (~2000 lines), `.controller.ts` | `Ticket` | **COMPLETE_REAL** | Extensively verified this session across 6+ turns | — | Low | None urgent |
| 10 | Task/Query/Help | Request-type selector, target-department/routing UI | `getRoutingOptions`, `getRoutingDepartments` | `Ticket.type`, cross-dept fields | **COMPLETE_REAL** | Built and hardened this session; QUERY/HELP confirmed anyone-to-anyone (senior-only restriction found and removed) | — | Low | None urgent |
| 11 | Ticket routing | Target Department + Ask/Route To dropdowns | Two dedicated endpoints, `Cache-Control: no-store`, retry-safe | `requestingDepartmentId`/`targetDepartmentId`/team ids | **COMPLETE_REAL** | 18 dedicated tests across 3 spec files this session | — | Low | None urgent |
| 12 | Ticket lifecycle | Status buttons on detail page | `update()`/`updateStatus()`, full transition matrix | `TicketStatus` enum | **COMPLETE_REAL** | OPEN→IN_PROGRESS→REVIEW→DONE/CLOSED, rework (REVIEW→IN_PROGRESS), reopen (DONE/CLOSED→OPEN/IN_PROGRESS) all implemented and tested | No explicit "REOPEN" status — reopen is OPEN/IN_PROGRESS with stamp-clearing logic | Low | None urgent |
| 13 | Approval/review/rework | Approve/Reject buttons, rating modal | `HierarchyApprovalService`, `ticket-access.service.ts`, `ReviewCycleLog` | `ReviewCycleLog` | **COMPLETE_REAL** | 35 tests in `tickets.hierarchy-approval.spec.ts`; self-assignee can never approve own work; senior-assigns-to-junior correctly blocks self-close | — | Low | None urgent |
| 14 | Ticket comments | Comment thread on detail page | `comments.service.ts` (full CRUD, notifies participants) | `Comment` | **COMPLETE_REAL** | Read in full this session — real notifications on new comment, author-or-admin edit/delete guard | — | Low | None urgent |
| 15 | Ticket attachments | Upload/preview/download UI | `uploads.service.ts` | `Attachment` | **COMPLETE_LOCAL_OR_LIMITED** | Cloudinary-backed when configured; falls back to storing the file as a **base64 data URL directly in Postgres** when Cloudinary isn't configured | Base64-in-DB fallback doesn't scale and bloats the database for any real file volume | Medium | Confirm Cloudinary is configured in production; if not, this is a real risk |
| 16 | Ticket notifications | Toast + bell + (this session) desktop notifications | `NotificationEventService`, `useDesktopNotifications` | `Notification` | **COMPLETE_REAL** | In-app real-time via authenticated, per-user WebSocket room (correctly scoped, unlike the two ticket-broadcast events); desktop layer added and tested this session | — | Low | None urgent |
| 17 | Ticket activity/history | History tab, activity log page | `TicketHistory` + `ActivityLog` + `OperationalEvent` — **three separate audit trail models** | all three | **COMPLETE_REAL but architecturally redundant** | All three are written to for ticket events; no single canonical trail | Confusing for future maintainers; not a completeness gap | Low | Consider consolidating in a future pass, not urgent |
| 18 | Ticket SLA/timing | "Time Left" badge (`TimingTicker`) | `TicketTimingService` | `Ticket.dueDate`/`executionDueAt`/`reviewDueAt` | **COMPLETE_REAL** | Confirmed this session to be a pure wall-clock deadline countdown — correctly does **not** pause for break/absence, by design | — | Low | None — working as intended |
| 19 | Ticket worked-time ledger | Not yet surfaced in UI | `TicketLedgerService` | `TicketTimeLog` | **COMPLETE_REAL (backend) / FRONTEND_ONLY GAP** | Fixed this session: `startWorkLog`/`endActiveLog` now wired into `update()`'s IN_PROGRESS transitions; break/end-day/auto-close pause correctly; 10 new tests | **No frontend UI displays actual worked time** — `ticket.timers` field exists in code but nothing renders it prominently | Low-Medium | Add a real "time worked" display to the ticket detail page |
| 20 | Bulk ticket creation/import | Excel import UI on create page | `createBulk()`, `previewImport()` | `Ticket` | **COMPLETE_REAL** | `tickets.bulk-import.spec.ts` exists; all-or-nothing transactional creation | — | Low | None urgent |
| 21 | Projects | `projects/page.tsx`, `[id]` | `projects.service.ts`, `.controller.ts` | `Project` | **PARTIAL_CONNECTED** | Full CRUD confirmed real; but **`departmentId` is a single optional field, not many-to-many** — contradicts business assumption #1 | Multi-department project support | Medium | Schema change needed if multi-dept projects are a real requirement |
| 22 | Project members | Members panel on project detail | `addMember`/`updateMemberRole`/`removeMember` | `ProjectMember` | **COMPLETE_REAL** | Roles: OWNER/LEAD/DEVELOPER/REVIEWER/OBSERVER/MEMBER; creator auto-added as OWNER | — | Low | None urgent |
| 23 | Project stages/modules/milestones | Backend-only currently | `listStages`/`createStage`/`updateStage`/`deleteStage`/`reorderStages` | `ProjectStage` | **BACKEND_ONLY** | Full backend implementation including delete-protection (blocks if tickets linked); confirmed by `fp14b.project-stages.spec.ts` (283 lines) | **No visible frontend UI for stages** on the project detail page | Medium | Build the stages UI — backend is ready and waiting |
| 24 | Kanban board | `kanban/page.tsx` | `getKanban()` | `Ticket.status` | **COMPLETE_REAL** | Confirmed earlier this project's history; drag/drop status changes are real API calls | Not grouped by project/stage | Low | None urgent |
| 25 | Workday | `WorkdayBar`, workday endpoints | `workday.service.ts` | `WorkSession` | **COMPLETE_REAL** | Extensively verified this session (start/end/break/idle/auto-close) | — | Low | None urgent |
| 26 | Breaks | Break modal | `startBreak`/`endBreak` | `BreakLog` | **COMPLETE_REAL** | Now correctly pauses/resumes the ticket worked-time ledger too (this session) | — | Low | None urgent |
| 27 | Auto-close / idle | Idle warning toast | `scheduler.service.ts` cron jobs | `WorkSession` | **COMPLETE_REAL** | Midnight auto-close + policy auto-stop + idle auto-logout all confirmed; now correctly pauses ticket ledger too | — | Low | None urgent |
| 28 | Leave | `leave/page.tsx` | `leave.service.ts`, `.controller.ts`, `LeaveAccessService` | `LeaveRequest` | **COMPLETE_REAL** | Confirmed: self/manager/admin scoping, cannot approve own leave, role-hierarchy check on approver, HR bypass, `setLeaveStatuses` scheduler job correctly sets `ON_LEAVE` workday status daily; `leave.rules.spec.ts`, `p1.leave-balance.spec.ts` exist (latter currently failing — pre-existing, see Section 11) | — | Low | Fix the failing balance test |
| 29 | Calendar | `app/(dashboard)/calendar/page.tsx` (149 lines) | Unclear — not deeply audited this pass | — | **UNKNOWN_NEEDS_MANUAL_VERIFICATION** | Route exists, moderate size, not read in depth | Whether it's a real calendar or a static view | Low | Read the page directly before relying on this line item |
| 30 | Analytics | `analytics/page.tsx`, multiple tabs | `analytics.service.ts`, `.controller.ts` | Aggregates across `Ticket`/`ReviewCycleLog`/`TicketTimeLog` | **COMPLETE_REAL, one confirmed bug** | Real DB aggregation confirmed across Employee/Reviewer/Manager/SLA/Rework/Command-Center endpoints; employee/type "rankings" in Rework and Team tabs currently return **empty array placeholders** | Rankings not implemented; `getCommandCenter`'s leave count not scoped (see Section 9) | Medium | Fill in ranking queries; audit command-center leave scoping |
| 31 | Dashboard | `(core)/dashboard/page.tsx` | `dashboard.service.ts` | Multiple | **COMPLETE_REAL, one confirmed bug** | Every KPI/panel is API-backed, no hardcoded values found | **`getApprovalWorkload()` pending-review count has no department scope — confirmed bug, see Section 9** | **High** | Fix the scoping bug |
| 32 | Activity log (admin) | `admin/activity/page.tsx` (425 lines) | `EventLoggerService`/`OperationalAction` | `OperationalEvent` | **COMPLETE_LOCAL_OR_LIMITED** | Substantial page exists, backend event logging is extensive and used everywhere; not deeply read this pass | Exact frontend scoping/filtering not verified | Low-Medium | Spot check |
| 33 | Settings | `settings/page.tsx` (1671 lines) | `settings.service.ts`, `.controller.ts` | `AppSetting` | **UNKNOWN_NEEDS_MANUAL_VERIFICATION** | Substantial page and backend exist, `settings.service.spec.ts` exists; not deeply read this pass | Full scope of what's configurable | Low | Read directly if settings become a workstream |
| 34 | AI ticket suggestions | `AiSuggestionsPanel`, priority suggestion on create, `aiApi.*` fully wired | `ai.service.ts`, `.controller.ts`, `ai.cron.service.ts` | — | **COMPLETE_REAL** | **Real OpenAI GPT-4o-mini integration** (`new OpenAI({apiKey})`), not a stub — suggest-priority, summarize-tickets (MANAGER+), per-ticket next-action suggestions, plus a daily 6pm digest cron job notifying managers. Graceful "coming soon" fallback (no crash) when `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` unset. Throttled (10/min) on priority suggestion | Digest is in-app/WebSocket only, no email backend | Low | None urgent |
| 35 | WebSocket/live updates | `useSocket.ts` | `events.gateway.ts` | — | **SECURITY_OR_DATA_RISK** | Auth on connect is solid (JWT verified, disconnects on failure); **but `emitTicketCreated`/`emitTicketStatusChanged` broadcast to every connected client with no department/role scoping** — verified directly, code comments confirm intent | Needs room-based scoping matching REST-layer visibility rules | **Medium-High** | Scope these two broadcasts to relevant department/role rooms |
| 36 | Reports/export | "Export CSV" on analytics page | `exportCsv()` | `Ticket` (all fields) | **COMPLETE_REAL** | Real CSV generation from scoped ticket data; `/reports` route is a clean redirect to `/analytics`, not dead code | — | Low | None urgent |
| 37 | Backup/restore | Admin user archive flow | `BackupVaultService` (Microsoft Graph/OneDrive), `archiveAfterBackup()` | — | **COMPLETE_REAL (code) / config risk** | Confirmed: real OAuth2 client-credentials flow against Microsoft Graph, correct upload endpoint construction, clear error surfaced on non-200/201. The known "OneDrive backup vault 404" issue is **not a code gap** — most likely a missing target folder, wrong `ONEDRIVE_USER_ID`, or missing `Files.ReadWrite.All` permission in the deployed environment | Verify the 3 OneDrive env vars + folder existence in production | Medium (config, not code) | Verify OneDrive app registration/folder in production |
| 38 | Seed scripts | N/A | `backend/prisma/seed.ts`, `seed-test-users.ts` | Deletes `Project`, `User` (non-allow-listed) | **SECURITY_OR_DATA_RISK** | **`seed.ts` has no `NODE_ENV`/`APP_ENV` guard and unconditionally deletes all projects and all users not on a hardcoded email allow-list. Its own comment ("Safe to run multiple times — all upserts, nothing is deleted") is false for the current code.** `seed-test-users.ts` has a warning comment but also no runtime guard | A single environment check | **High** | Add a production guard to both scripts before this is run again anywhere near a real database |
| 39 | CRM/sales | **None found** | **None found** | **None found** | **ROADMAP_NOT_BUILT** | Exhaustive grep across backend/frontend/schema for lead/deal/opportunity/client/quote/proposal/pipeline/crm returned zero genuine hits (only false positives on "Team Lead") | Entire module | N/A | See Section 5 |
| 40 | HRMS/performance/KRA/KPI | **None found beyond workday/leave/users/AI** | **None found** | **No KRA/KPI model in any of 32 Prisma models** | **ROADMAP_NOT_BUILT** | Confirmed by direct schema read. Note: the *people* side of HRMS (attendance, leave, documents, offboarding, AI-assisted ticket triage) is strong — only the performance-management layer is missing | Entire performance-management layer | N/A | See Section 6 |

---

## SECTION 3 — Ticket System Deep Audit

1. **Is ticket creation fully connected?** Yes. Single and bulk creation both go through the same `normalizeTicketCreateData()` path, both frontend-tested this session (create page rewired for QUERY/HELP), both backend-tested (`tickets.create-assignee.spec.ts`, `tickets.create-cross-department.spec.ts`, `tickets.bulk-import.spec.ts`).

2. **Are Task/Query/Help implemented frontend and backend?** Yes, fully, as of this session's work. `TicketType` enum has all three; frontend has a request-type selector with type-aware field labels and a dedicated Target Department + routing-recipient flow for QUERY/HELP.

3. **Are Query/Help truly anyone-to-anyone?** Yes, now — this session found and removed a bug where Employee/Intern-authored QUERY was wrongly restricted to TEAM_LEAD/MANAGER recipients only. Confirmed via 10 tests in `tickets.routing-options.spec.ts` including explicit Employee→Employee/Intern-recipient cases.

4. **Are role-based assignment rules correct for Task?** Yes — TASK assignment stays department/team-scoped via `assertCanAssignTicket()`, completely untouched by the QUERY/HELP work (verified: zero changes to that method across this whole session).

5. **Does ticket detail clearly display type?** Yes, as of this session's dedicated fix — a bold, bordered, type-colored header badge (`TASK`/`QUERY`/`HELP REQUEST`) plus a "Request Type" row in the Details card plus a type-aware assignee label ("Assigned To"/"Routed To"/"Help From").

6. **Does lifecycle work?** OPEN, IN_PROGRESS, REVIEW, DONE, CLOSED all real and tested. REWORK is REVIEW→IN_PROGRESS (not a separate status) and correctly resets review stamps and restarts the worked-time ledger (this session). No distinct REOPEN status exists — reopening is DONE/CLOSED→OPEN/IN_PROGRESS with completion-stamp clearing.

7. **Does review approval work for every role, including self-assigned?** Yes, and this is the most rigorously tested part of the whole codebase. Self-assigned Employee/Intern tickets require the resolved reporting hierarchy to approve (never the worker). Self-assigned TASK by TL/Manager/Admin/SuperAdmin can self-close (product decision, tested). The critical rule added this session — **if a senior assigns work to a junior, the junior cannot self-close, only the assigner/hierarchy can** — is implemented and has dedicated tests (`tickets.hierarchy-approval.spec.ts`, 35 tests total).

8. **Are comments real?** Yes — full CRUD, real-time notification to creator/assignee/all secondary assignees, author-or-admin edit/delete permission.

9. **Are attachments real?** Yes, with a caveat: real when Cloudinary is configured; silently falls back to storing the raw file as base64 in Postgres when it isn't. Worth confirming Cloudinary env vars are actually set in production.

10. **Are notifications scoped?** Yes for in-app/desktop (per-user WebSocket room, verified). **No** for the two raw ticket-broadcast WebSocket events (see Section 9) — those aren't notifications per se, but they do leak the same underlying data.

11. **Are activity/history logs real?** Yes, redundantly — `TicketHistory` (field-diff on status/assignee/priority/title), `ActivityLog` (freeform action log), and `OperationalEvent` (structured, indexed audit trail) are all written on ticket events. Three overlapping systems; not wrong, just architecturally noisy.

12. **Is SLA/deadline timing separate from worked-time?** Yes, cleanly, and this was the central finding of this session's ledger-wiring work: `TicketTimingService` (SLA countdown, wall-clock, never pauses) and `TicketLedgerService`/`TicketTimeLog` (worked time, now correctly pauses on break/end-day/auto-close) are architecturally distinct services touching different models.

13. **Is TicketTimeLog now started/ended correctly?** Yes, as of this session. Before: `startWorkLog()` was fully built (dedup logic, pause/resume, all called correctly from workday break/end-day/scheduler) but **never invoked** by the actual ticket status-transition flow, so no active log ever existed for those correct pause calls to act on. Fixed by wiring `startWorkLog`/`endActiveLog` into `tickets.service.ts update()` on IN_PROGRESS entry/exit, wrapped in the same try/catch-and-log pattern as every other side effect in that method (a ledger failure can never corrupt the actual status transition). 10 new tests prove start, end (REVIEW/DONE/CLOSED/OPEN), no-duplicate-on-repeat, rework re-entry, and end-to-end compatibility with the pre-existing (untouched) break-pause/resume methods.

14. **Is actual worked time visible in UI?** **No — this is the one gap left from this session's own fix.** The backend now correctly tracks it; nothing in the frontend prominently displays it. (`ticket.timers` exists as a shape in older header code but the method that populates it, `getTicketTimers()`, has zero real callers anywhere in the backend — so even that display path is currently dead.)

15. **What ticket analytics exist?** Real: SLA on-time/overdue %, rework rate and count, per-employee/reviewer metrics, department/manager rollups. Placeholder: "most reworked employees/types" rankings return empty arrays.

16. **What's still missing before calling ticketing "complete"?** (a) Surface real worked time in the UI — the backend data now exists and is correct. (b) Fix the two confirmed scoping bugs (dashboard approval count, WebSocket broadcasts) since they touch ticket data specifically. (c) Decide whether the three-way audit-trail redundancy is intentional or should be consolidated.

---

## SECTION 4 — Project System Deep Audit

1. **What project model currently exists?** `Project` (id, projectId, name, description, status, priority, startDate, endDate, single optional `departmentId`), `ProjectMember` (role-tagged membership), `ProjectStage` (name, order, status, dates — the milestone/module implementation).

2. **Can projects have departments?** Yes, one, optionally.

3. **Can projects have multiple departments?** **No.** `departmentId String?` is a single scalar field, not a join table. This directly contradicts business assumption #1. If cross-department projects are a real near-term need, this requires a schema addition (`ProjectDepartment` many-to-many).

4. **Can projects have members?** Yes — `ProjectMember` with roles OWNER/LEAD/DEVELOPER/REVIEWER/OBSERVER/MEMBER; creator is auto-added as OWNER on project creation.

5. **Can projects have modules/milestones/stages?** Yes — `ProjectStage` is a genuine, first-class model with its own status lifecycle (PLANNED/ACTIVE/COMPLETED/SKIPPED), ordering, and date range. Full backend CRUD including reordering. **The frontend has no visible UI for this yet** — it's backend-only currently.

6. **Are tickets linked to projects?** Yes — `Ticket.projectId` (optional).

7. **Are tickets linked to modules/stages?** Yes — `Ticket.projectStageId` (optional), separate from `projectId`.

8. **Can one project be split across departments/teams?** Not structurally — since a project has at most one department, "splitting across departments" isn't a first-class concept today. It's *approximated* by tickets under a project having their own (potentially different) `departmentId`, but there's no project-level rollup of "which departments are actually contributing to this project."

9. **Does project access respect roles and departments?** Yes for the confirmed-audited endpoints (`p0.project-access.spec.ts` exists and tests manager/admin edit access, scope rejection).

10. **Does project delete/archive protect linked data?** **Archive: yes, safely** (soft status change, `ProjectStatus.ARCHIVED`, nothing else touched). **Delete: no application-level check.** `remove()` calls `prisma.project.delete()` directly with no count-of-linked-tickets guard — even though the *exact same file* implements this correctly for `deleteStage()` (blocks if tickets are attached, with a clear error message). The Ticket→Project relation in schema has no explicit `onDelete` directive, so the precise failure mode (hard DB constraint error vs. silent orphaning) depends on Prisma's implicit default for this relation shape and wasn't verified further this pass — either outcome is a real production risk, and the fix is cheap: copy the stage-delete pattern up one level.

11. **What's missing for proper project management?** (a) Multi-department support if that's a real requirement. (b) A frontend for stages/milestones — backend is ready and tested. (c) The project hard-delete safety check. (d) Project-level analytics rollup (mentioned as a target in the business model, not found as implemented).

---

## SECTION 5 — CRM Readiness Audit

**Built:** Nothing. Confirmed by exhaustive grep across backend/src, frontend/app, frontend/components, and schema.prisma for lead, deal, opportunity, client, quote, proposal, pipeline, crm — every hit was a false positive on `TEAM_LEAD`/`teamLeadName`/project member `LEAD` role. This is a clean, honest negative result, not a partial finding.

**Proposed integration model** (per the brief), scored against what exists today:

| CRM entity | Needed schema | Needed APIs | Needed UI | Notes |
|---|---|---|---|---|
| Lead | New model | New CRUD | New pages | No overlap with existing `Ticket`/`User` models |
| Company/Client | New model | New CRUD | New pages | Could reuse `Department`-style structure conceptually, but should be its own model — clients are external, departments are internal |
| Contact | New model | New CRUD | New pages | Belongs to Client |
| Deal/Opportunity | New model, pipeline stages | New CRUD + stage transitions | New pages, kanban-style board | Could reuse the `ProjectStage` *pattern* (ordered, status-tagged stages) as a design template |
| Proposal/Quote | New model | New CRUD | New pages | — |
| Won deal → Project | New relation `Project.dealId` | New "convert" endpoint | New action button | Straightforward once Deal exists — `Project` already has the right shape to receive this |
| CRM activity → follow-up tickets | Reuse `Ticket` with a new `sourceType`/`dealId` | Extend `tickets.service.ts` create path | Minimal — could reuse the QUERY/HELP-style routing UI patterns built this session | The QUERY/HELP cross-department routing work this session is a good template for "raise a ticket from a non-ticket source" |
| CRM analytics | New aggregation service | New endpoints | New dashboard tab | Would follow the `analytics.service.ts` pattern already established |
| Client/project profitability | Needs cost/revenue fields | New endpoints | New reports | Depends on Deal + Project + a cost model that doesn't exist yet |

**Risks if added too early:**
1. The two confirmed data-scoping bugs (dashboard, WebSocket) mean the *existing* department-boundary trust model has holes. Adding a CRM module — which by definition needs even *more* careful external/internal data boundaries (a salesperson should not see another department's client list) — on top of that is asking for the same class of bug to recur, at higher stakes (client data, not just ticket counts).
2. Projects can't yet cleanly represent "this project came from a client deal in department X but department Y is doing the work" because of the single-department limitation.
3. No revenue/cost model exists anywhere — "profitability" as a CRM output is a much bigger lift than the CRUD layer suggests.

**Classification: ROADMAP_NOT_BUILT, correctly sequenced as Phase E (see Section 12), not before.**

---

## SECTION 6 — HRMS Readiness Audit

**What's already there (confirmed, stronger than a typical "adjacent module" audit would expect):**
- Employee profile: `User` model is extensive; access is **genuinely tiered**, not binary — self sees masked payroll (last 4 digits of account/PAN/Aadhaar), direct manager sees everything except payroll, same-department Team Lead and everyone else get `safeUser()` (21 sensitive fields stripped: password, CTC, salary, bank details, PAN, Aadhaar, UAN, tax fields, HR notes, etc.), Admin/HR see full data with the access itself audit-logged (`logSensitiveAccess`).
- Documents: `EmployeeDocument` model + upload/verify endpoints (upload, verification status, profile-photo special-case) — confirmed real.
- Attendance/workday: fully real, extensively verified this session, including the worked-time ledger fix.
- Leave: fully real and correctly scoped — `LeaveAccessService` gives self-only (Employee/Intern), department-scoped (Manager/TeamLead), and all (Admin/HR) visibility; approval flow blocks self-approval and enforces role-hierarchy and department-management checks; daily scheduler job (`setLeaveStatuses`) correctly sets a user's live status to `ON_LEAVE`.
- Department/team assignment: real, single-membership today.
- Offboarding: real and unusually careful — `archiveAfterBackup()` in `users.service.ts` requires a confirmed backup download, resolves mandatory recipients by role/department, generates a full 14-sheet XLSX export of the departing user's entire history, and only *then* anonymizes the record (never hard-deletes unless explicitly requested via a separate, blocker-checked `permanentDelete()` path). This is genuinely careful design.
- **AI-assisted HR-adjacent workflows**: a real GPT-4o-mini integration drives ticket priority suggestion, ticket summarization, and a daily digest — see Section 2 row 34. Not HRMS proper, but relevant groundwork for Phase G.

**What's partial:**
- Multi-department membership: `UserDepartmentMembership` model exists in schema but is essentially unused — the only confirmed runtime reference this session found is in `departments.service.ts` (not confirmed as a genuine read/write access path). Ticket access, leave access, and project access all key off the single `User.departmentId` field, not this table. This is the schema half of assumption #5 without the logic half.
- Multi-team membership: similarly, `Team`/`TeamMember` supports one user in many teams structurally, but no evidence was found this session that ticket/leave/project *access logic* accounts for a user being in more than one team.
- Org chart: no dedicated org-chart model or endpoint found; department/team/role data exists to *derive* one, but nothing renders it as a chart today (calendar and settings pages weren't deep-read this pass and could theoretically contain this — worth a direct check if org chart is a near-term ask).

**What's risky:**
- **The main seed script (`backend/prisma/seed.ts`) has no environment guard and deletes real `Project` and `User` rows unconditionally — see Section 9. This is an HRMS-adjacent risk specifically because it deletes User data.**
- Backup/restore: the code itself is complete and correct (verified this pass — real Microsoft Graph OAuth2 client-credentials flow, correct upload path construction, clear error surfaced on failure). The known, tracked "OneDrive backup vault 404" issue is very likely a **configuration/deployment gap** (missing target folder, wrong `ONEDRIVE_USER_ID`, or missing `Files.ReadWrite.All` permission), not a code defect.

**What should wait:**
- Payroll inputs: fields exist (`ctcAnnual`, `basicSalary`, bank details, PAN/Aadhaar) but this audit did not find a payroll *processing* system — just storage. Treat payroll as data-at-rest today, not a payroll engine.
- Performance reviews / KRA / KPI: **zero data model exists.** `ReviewCycleLog` is ticket-specific (assignee/reviewer ratings on a single ticket's approval), not a general employee performance-review system. This needs to be built from scratch, not extended.
- Asset assignment: no evidence found.

**Classification: Attendance/leave/documents/offboarding/AI = COMPLETE_REAL. Multi-membership = PARTIAL_CONNECTED (schema without logic). Performance/KRA/KPI = ROADMAP_NOT_BUILT. Seed-script safety = SECURITY_OR_DATA_RISK, High.**

---

## SECTION 7 — Analytics Readiness Audit

1. **Backend-sourced metrics:** The large majority. `AnalyticsService` (employee/reviewer/manager/SLA/rework/command-center) and `DashboardService` (summary/metrics/alerts/workload/upcoming events/previews) both query real Prisma aggregations, confirmed by direct code read.

2. **Frontend-calculated metrics:** Some display-layer math (percentages, formatting) happens client-side from real fetched data — normal and fine, not a red flag.

3. **Fake/stale/placeholder metrics:** Two confirmed: (a) "most reworked employees/types" and "employee/reviewer rankings" in the Rework and Team analytics tabs return **hardcoded empty arrays** in the backend service itself — not a frontend mock, a genuine unimplemented backend query. (b) Home V2 (explicitly a hidden, non-production preview route) has clearly labeled mock sections — not a production concern, noted for completeness only.

4. **Are ticket metrics reliable?** Yes, with the one confirmed scoping bug (`getApprovalWorkload`).

5. **Are workday metrics reliable?** Yes — real session/break aggregation, confirmed extensively this session including the new worked-time ledger wiring.

6. **Are department/team/user metrics reliable?** Mostly — `getManagerMetrics()` correctly scopes to `managedDepartmentIds`. The dashboard bug is the one confirmed exception.

7. **Are project metrics reliable?** `getStats()` exists on the projects service; not deep-audited for scoping this pass — flag as unverified rather than claim clean.

8. **Does analytics support multi-department membership?** No — since ticket/leave/project access itself doesn't use `UserDepartmentMembership`, analytics inherits the same single-department assumption throughout.

9. **Are KRA/KPI metrics separate from ticket timing?** N/A — no KRA/KPI metrics exist to be separate from anything.

10. **What should the analytics data model be?** The `AnalyticsService` pattern already established (scoped Prisma aggregation per role, real SLA config lookup via `TicketTimingService`) is the right foundation — extend it, don't replace it. The missing piece is a genuine event-sourced or materialized rollup layer for the "process bottleneck" and "company overview" categories the brief asks for; today's analytics answers "how is X doing" well but not yet "where is the process actually slow, company-wide."

---

## SECTION 8 — Data Model and Relationship Audit

32 Prisma models total. Key relationships, purpose, and read/write status:

| Model | Purpose | Frontend reads? | Backend writes? | Analytics uses? | Risks / gaps |
|---|---|---|---|---|---|
| `User` | Core identity, profile, payroll | Yes, extensively | Yes | Yes | `safeUser()` sanitization confirmed; large surface area |
| `Role` | Fixed 6-tier hierarchy | Yes (badges) | Rarely (seeded) | Indirectly | Not a granular permission system |
| `Department` | Org unit | Yes | Yes | Yes | No owner/head field — head is derived via `ManagerDeptAccess` |
| `UserDepartmentMembership` | Multi-department membership | **No evidence found** | **Minimal — one reference in `departments.service.ts`, not confirmed as write path** | No | **Schema exists, logic doesn't** — the core gap behind business assumption #5 |
| `ManagerDeptAccess` | Manager→Department grant, also used to derive "Department Head" | Indirect | Yes (`addManager`/`removeManager`) | Yes (`managedDepartmentIds`) | Singularity enforced at app level (transactional delete-then-create), not a DB constraint |
| `Team` | Team entity, has `teamLeadId` | Yes | Yes | Indirect | — |
| `TeamMember` | User↔Team membership | Yes | Yes | Indirect | Supports multi-team structurally; access-logic usage of that not confirmed |
| `Project` | Project entity | Yes | Yes | Yes (`getStats`) | Single `departmentId` only — no many-to-many |
| `ProjectMember` | Role-tagged project membership | Yes | Yes | Indirect | — |
| `ProjectStage` | Milestone/module | **No (backend-only)** | Yes | Indirect | Frontend gap, not a backend gap |
| `Ticket` | Core work item | Yes, extensively | Yes | Yes | Central model, extensively audited this session |
| `TicketAssignee` | Secondary assignees | Yes | Yes | Indirect | `onDelete: Cascade` from Ticket — correct |
| `TicketWatcher` | **Newly noted this pass** — ticket watchers/followers | Not confirmed this pass | Not confirmed this pass | No | Exists in schema; usage not verified — worth a direct check, may be dormant like the ledger was before this session |
| `TicketTimeLog` | Worked-time ledger | **No (see Section 3 #14)** | **Yes, as of this session** | Not yet | The exact gap this session closed on the backend; frontend display still missing |
| `ReviewCycleLog` | Per-ticket approve/reject/rating history | Yes (ratings UI) | Yes | Yes | Ticket-specific, not a general performance-review model |
| `WorkSession` | Daily workday session | Yes | Yes | Yes | Extensively verified |
| `BreakLog` | Break records | Yes | Yes | Yes | Correctly now pauses/resumes `TicketTimeLog` too |
| `LeaveRequest` | Leave | Yes | Yes | Indirect | Drives daily `ON_LEAVE` status via scheduler |
| `Notification` | In-app notification | Yes | Yes | No | Correctly per-user scoped via `findByUser(user.id)` |
| `ActivityLog` | Freeform action log | Partial | Yes | No | One of three overlapping audit-trail systems |
| `OperationalEvent` | Structured, indexed audit trail | Partial (admin/activity page) | Yes, extensively | No | Most structured of the three trail systems — indexed by actor/entity/action/timestamp |
| `Comment` | Ticket comments | Yes | Yes | No | `onDelete: Cascade` from Ticket — correct |
| `Attachment` | Ticket files | Yes | Yes | No | Base64-in-DB fallback risk noted above |
| CRM/KPI models | — | — | — | — | **None exist** |

**Missing indexes/constraints noticed in passing:** none flagged as obviously broken this pass beyond what's already noted (Ticket→Project missing an explicit `onDelete` directive). A full index audit was not performed — would require `EXPLAIN ANALYZE` against real query patterns, out of scope for a static read-only pass.

---

## SECTION 9 — Access Control and Security Audit

| Area | Finding | Severity |
|---|---|---|
| **Seed script safety** | **`backend/prisma/seed.ts` has no `NODE_ENV`/`APP_ENV` guard and unconditionally deletes all `Project` rows and all `User` rows not on a hardcoded email allow-list. The script's own comment claims this is safe/non-destructive — it is not, for the code as written. `seed-test-users.ts` has a warning comment but the same missing runtime guard.** | **Critical** |
| REST endpoint guards | `JwtAuthGuard` applied class-wide on every controller checked this session (tickets, departments, users, leave, AI); `RolesGuard` layered for admin-only mutations | Low (working as intended) |
| Department scoping (REST) | Extremely consistent — `buildTicketWhereForUser`, `managedDepartmentIds`, `assertCanAssignTicket`, `LeaveAccessService` all correctly narrow by department across everything audited this session | Low |
| Ticket visibility | Correct — self/created/assigned/department-scope OR clauses, verified across many turns this session | Low |
| **Dashboard approval-workload scoping** | **`getApprovalWorkload()` counts pending reviews with no department filter — confirmed twice independently (this session's early audit + a fresh pass just now)** | **High** |
| Project visibility | `p0.project-access.spec.ts` covers manager/admin scoping; not exhaustively re-verified this pass | Low-Medium (unverified, not known-broken) |
| Leave visibility | **Confirmed correct** — `LeaveAccessService` scopes self/department/all by role; cannot approve own leave; role-hierarchy and department-management checks on the approver | Low |
| User list/profile visibility | **Confirmed correct** — `findAll()` scoping (self/department/all by role) and a four-tier `getProfile()` visibility model (self-masked, manager-no-payroll, TL/others-safe-fields, admin/HR-full+audit-logged), both verified by direct code read | Low |
| Team visibility | Confirmed correct via this session's own sidebar-gating work (`isManager \|\| isHR`) | Low |
| AI data access | **Confirmed real** — role-gated (`summarize-tickets` is MANAGER+), throttled (10/min on priority suggestion), builds prompts from already-access-controlled ticket/comment data (no separate leak surface found) | Low |
| **WebSocket broadcasts** | **`emitTicketCreated`/`emitTicketStatusChanged` are unscoped, broadcast to every connected authenticated client regardless of role/department — confirmed directly, code comments admit the design** | **Medium-High** |
| Attachment access | Downloads go through `getAttachmentForDownload()` which reuses `findAccessibleTicket` scoping — appears correctly gated, confirmed structurally this session, not penetration-tested | Low-Medium |
| Admin-only mutations | Consistently role-gated where checked (department/team/project delete, user role changes) | Low |
| Destructive application-level scripts | `permanentDelete()` in `users.service.ts` has an extensive blocker-count check across 19 related tables before allowing a hard delete — genuinely careful. Contrast with the seed-script finding above, which has no equivalent care. | Low |
| Backup/restore reliability | Code confirmed complete and correct this pass (Graph OAuth2 flow, upload path construction, error surfacing). Known open "404" issue is very likely environment configuration, not the code. | Medium (config, tracked) |

**Overall: one Critical finding (the seed script), one High finding (dashboard scoping), one Medium-High finding (WebSocket broadcasts). All three are narrow, well-evidenced, and fixable without architectural change — none require a schema change or a redesign.**

---

## SECTION 10 — Frontend/Backend Connection Matrix

(Condensed here; full detail in `FEATURE_CONNECTION_MATRIX_2026.md`.)

| UI area | Primary API calls | Auth required | Role restrictions | Connected | Failure mode | Loading/error handling | Production risk |
|---|---|---|---|---|---|---|---|
| Dashboard | `dashboardApi.getHomeSummary`, `ticketsApi.getSlaRisk`, `dashboardApi.getOverview` | Yes | Role-varied KPIs | Yes | React Query error states | Present | Medium (scoping bug) |
| Ticket list/detail | `ticketsApi.*` (extensive) | Yes | Scoped per role | Yes | Standard | Present | Low |
| Ticket create | `ticketsApi.create/createBulk`, `getRoutingOptions/Departments` | Yes | TASK vs QUERY/HELP diverge | Yes | Retry-safe as of this session | Present | Low |
| Kanban | `ticketsApi.getKanban` | Yes | Scoped | Yes | Standard | Present | Low |
| Projects list/detail | `projectsApi.*` | Yes | Manager+/Admin for mutation | Yes | Standard | Present | Medium (delete safety) |
| Teams (Manage) | `teamsApi.*` | Yes | HR/Manager/Admin/SuperAdmin only (this session) | Yes | Standard | Present | Low |
| My Team | `teamApi.*` | Yes | TeamLead+ | Yes | Standard | Present | Low |
| Departments | `departmentsApi.*` | Yes | Admin for mutation | Yes | Standard | Present | Low |
| Users | `usersApi.*` | Yes | Role-scoped views | Yes | Standard | Present | Medium (unverified scoping depth) |
| Leave | `leaveApi.*` | Yes | Self vs approver views | Yes | Standard | Present | Medium (unverified) |
| Workday bar | `workdayApi.*` | Yes | Self | Yes | Standard | Present | Low |
| Analytics | `analyticsApi.*` | Yes | Role-varied tabs | Yes | Standard | Present | Medium (2 placeholder rankings) |
| Notifications (bell) | `notificationsApi.*` | Yes | Self only | Yes | Standard | Present | Low |
| Desktop notifications | Client-only (this session) | N/A | N/A | Yes | Graceful fallback to toast | Present | Low |
| Home V2 | Mixed real/mock | Yes | N/A | Partial (Phase 1 preview) | N/A | N/A | None (hidden route) |
| Calendar | Unknown | Yes | Unknown | **Unverified** | Unknown | Unknown | Unknown |
| Settings | Unknown depth | Yes | Unknown | **Unverified** | Unknown | Unknown | Unknown |

---

## SECTION 11 — Test Coverage Audit

**Backend unit tests (46 files),** grouped:
- Tickets (16): including this session's `tickets.work-log-ledger.spec.ts`, `tickets.routing-options.spec.ts`, `tickets.routing-departments.spec.ts`, `tickets.create-cross-department.spec.ts`, `tickets.review-notification.spec.ts`, `tickets.hierarchy-approval.spec.ts` (35 tests alone), plus `ticket-ledger.service.ts`, `ticket.guardrails`, `ticket.permissions`, `ticket.transitions`, `tickets.approval-review-cycle`, `tickets.bulk-import`, `tickets.create-assignee`, `tickets.creation-approval`, `tickets.unassign`, `blocked-ticket`
- Workday (4): `workday.history`, `workday.meeting-break`, `workday.release-a`, `workday.repair-rules`
- Leave (2): `leave.rules`, `p1.leave-balance`
- Users (3): `users.admin-correction`, `users.change-requests`, `users.profile`
- Notifications (2): `p1.notification-event`, `p1d.notification-monitoring`
- Departments (1): `departments.manager-access`
- Teams (1): `teams.service`
- Projects (2): `fp14b.project-stages`, `p0.project-access`
- Scheduler (3): `scheduler.policy`, `scheduler.recurring`, `scheduler.service`
- Auth (2): `auth.otp`, `auth.throttle`
- Settings (1): `settings.service`
- Analytics (1): `analytics`
- Access/security (2 more): `p0.access-policy`, `p0.ticket-access-timing`, `roles.guard`
- TVA/time authority (3): `tva-attendance-authority`, `tva-date-authority`, `tva-sla-authority`
- Dashboard (1): `p1d.dashboard-consistency`
- Security (1): `p1d.attachment-security`

**Backend integration tests (3):** `smoke.spec.ts`, `p2.dashboard-recovery.spec.ts`, `task-types.spec.ts`

**Frontend tests: zero.** No `*.test.ts(x)`, no `*.spec.ts(x)`, no `__tests__` directory anywhere in `frontend/`. An `e2e/tests/` directory exists separately (browser-driven, not component-level).

**Critical flows tested:** ticket lifecycle, hierarchy approval, self-assignment rules, cross-department routing, worked-time ledger (new this session), bulk import, workday/break/auto-close, leave rules, scheduler jobs, JWT auth (OTP + throttle), role guards, attachment security.

**Critical flows untested (as far as this pass found):** project deletion safety, WebSocket broadcast scoping, dashboard approval-workload scoping (the bug itself has no regression test — meaning if fixed, nothing currently guards against it regressing again), any frontend component logic at all.

**Known failing suites** (confirmed pre-existing in a prior session turn, re-stated here for completeness, **not re-verified in this read-only pass**):
- `tva-date-authority.spec.ts`, `tva-sla-authority.spec.ts` — hardcoded-date assertions that don't account for the real system clock moving forward.
- `analytics.spec.ts` — same category, a "today" boundary test.
- `ticket-ledger.service.spec.ts` — one test (`endActiveLog` duration calc) has a self-contradictory mock (`elapsedSeconds: () => 0` while asserting `durationSeconds: 600`) — mathematically can never pass as written.
- `ticket.guardrails.spec.ts` — fails to compile (TS error), calls `service.approve()` with arguments in the wrong order; stale test, pre-dates a signature change.
- `p1.leave-balance.spec.ts`, `users.profile.spec.ts` — flagged as failing in the same prior-session pass, root cause not diagnosed there.

All were independently verified as **pre-existing and unrelated** to that session's own changes at the time (via `git status`/`git log` showing zero recent modification to any of those five files). A follow-up task to fix them was proposed but not yet actioned as of this audit.

**Recommended test additions:** (1) a regression test locking in the dashboard scoping fix once made, (2) a WebSocket broadcast-scoping test once that's fixed, (3) a project hard-delete safety test, (4) any frontend test at all — currently 100% reliant on manual/E2E verification for every UI change.

---

## SECTION 12 — Roadmap

### Phase A — Stabilize Trust
**Objective:** Close every confirmed data-scoping and data-safety gap before building anything new on top.
**Why now:** One Critical, one High, and one Medium-High finding exist today with direct code evidence; every phase after this one increases the blast radius of leaving them open.
**Dependencies:** None — every fix below is narrow and self-contained.
**Exact features:**
- **Add a `NODE_ENV`/`APP_ENV` production guard to `backend/prisma/seed.ts` and `seed-test-users.ts` before either script is run again — this is the single highest-priority item in this entire audit.**
- Fix `DashboardService.getApprovalWorkload()` to scope pending-review count by `buildTicketWhereForUser`.
- Scope `emitTicketCreated`/`emitTicketStatusChanged` to department/role-relevant Socket.IO rooms, matching REST-layer visibility.
- Add a project hard-delete safety check mirroring the existing `deleteStage()` pattern.
- Fix the 5 pre-existing failing test suites so the baseline is green.
- Confirm Cloudinary is actually configured in production (attachment fallback risk).
- Verify the 3 OneDrive env vars and target folder exist in production (backup vault "404").
**Risk:** Low — every fix is additive/corrective, not structural.
**Acceptance criteria:** All findings above have a passing regression test (the seed guard should have a test asserting it throws outside a safe environment); full backend suite is green; `npm run build` clean on both sides.

### Phase B — Complete Execution Core
**Objective:** Finish what's already 80% built.
**Why now:** Backend work (project stages, worked-time ledger) is sitting unused behind a missing frontend.
**Dependencies:** Phase A (don't build new UI on top of unfixed scoping).
**Exact features:**
- Build the ProjectStage/milestone frontend UI — backend is fully ready and tested.
- Build a real "time worked" display on the ticket detail page using the now-correct `TicketTimeLog` data.
- Department/team management UI polish (mostly done — verify calendar/settings depth).
**Risk:** Low.
**Acceptance criteria:** A user can create/reorder/complete project stages and see real worked time on a ticket, both end-to-end tested.

### Phase C — Multi-Membership Foundation
**Objective:** Make `UserDepartmentMembership` (and multi-team membership) real, not just schema.
**Why now:** This is the actual blocker for "one user can belong to multiple departments/teams" (assumptions #5/#6) — and every access-control method audited this session (`buildTicketWhereForUser`, `managedDepartmentIds`, leave scoping) currently assumes single-department.
**Dependencies:** Phase A (fix scoping bugs on the *current* single-department model first, so the multi-membership migration isn't inheriting known-broken logic).
**Exact features:**
- Wire `UserDepartmentMembership` into ticket access, leave access, and project access scope-building functions.
- Safe backfill: every existing `User.departmentId` becomes one row in the membership table, non-destructively.
- Membership management UI.
**Risk:** Medium — touches the most security-sensitive scoping code in the app; needs careful, incremental rollout with tests at every step, same rigor as this session's QUERY/HELP routing work.
**Acceptance criteria:** A user assigned to two departments correctly sees tickets/leave/projects from both; a user assigned to one department sees no regression.

### Phase D — Analytics Foundation
**Objective:** Move from "good per-entity metrics" to genuine company-wide process intelligence.
**Why now:** Phases A-C fix the trust and access-model gaps analytics currently inherits.
**Dependencies:** Phase C ideally (multi-department analytics needs multi-department access first).
**Exact features:**
- Fill in the two placeholder ranking queries (rework, team tabs).
- Company/department/team/project rollup dashboards.
- Process-bottleneck detection (where does work actually stall, across departments).
**Risk:** Low-Medium.
**Acceptance criteria:** No `[]` placeholder arrays remain in any analytics response; multi-department users see correctly-aggregated cross-department views.

### Phase E — CRM Foundation
**Objective:** Bring in the "work in" side of Enterprise Execution OS.
**Why now:** Not yet — sequenced after A-D specifically because CRM introduces external-party data (clients) on top of a system that only just closed its internal department-boundary gaps.
**Dependencies:** Phase A (non-negotiable — don't add client data to a system with known internal leaks), Phase C (projects likely need multi-department support before "won deal → project" is honest).
**Exact features:** Lead/Company/Contact/Deal models, won-deal-to-project conversion, CRM-sourced tickets (reusing this session's QUERY/HELP cross-boundary routing pattern), sales analytics.
**Risk:** Medium-High (new external-data surface).
**Acceptance criteria:** A deal can be created, won, converted to a project, and the resulting tickets are correctly department-scoped.

### Phase F — HRMS/Performance Foundation
**Objective:** Build the KRA/KPI layer that doesn't exist at all today.
**Why now:** Genuinely a from-scratch build; sequence after CRM only because CRM revenue/deal data may feed performance metrics later — not a hard technical dependency, a product-sequencing choice.
**Dependencies:** Phase C (Department Head/Team Lead accountability needs multi-membership resolved first, or KRA ownership will be as ambiguous as today's single-department model).
**Exact features:** Employee profile completion, KRA/KPI models, review cycles distinct from ticket `ReviewCycleLog`, performance analytics.
**Risk:** Medium — sensitive data, needs careful access control from day one (learn from this session's ticket-permission rigor, don't repeat the dashboard/WebSocket scoping mistakes).
**Acceptance criteria:** A Department Head can set and track a KRA independent of any single ticket's approval history.

### Phase G — AI Layer
**Objective:** Scoped intelligence on top of a now-trustworthy data model.
**Why now:** Last, deliberately — an AI summary or recommendation is only as trustworthy as the scoping of the data it reads; every phase above exists to make that data trustworthy first.
**Dependencies:** All of A-F ideally have their access-control fixed, since AI features are exactly the kind of feature that can accidentally aggregate/leak cross-boundary data if the underlying queries aren't already correctly scoped.
**Exact features:** Scoped AI ticket summaries (some exist already — verify scoping), scoped recommendations, process intelligence, leadership insights.
**Risk:** Medium (depends entirely on the rigor of what it's built on).
**Acceptance criteria:** Every AI-surfaced insight can be traced to a correctly-scoped underlying query.

---

## SECTION 13 — Final Recommendation

1. **Are we going in the right direction?** Yes. The primitives (tickets, projects, departments, workday, approval hierarchy) are well-designed and, where tested, well-tested. This session's own trajectory — find a real gap (ticket type not visible, timer not pausing, QUERY wrongly restricted), root-cause it precisely, fix it narrowly, test it — is exactly the right operating model for a live system and should continue to be the model for everything above.

2. **Should Apex OS become Enterprise Execution OS?** Yes, but the honest current state is "strong execution core, zero CRM, zero HRMS-performance layer" — not "80% there." Say that plainly to stakeholders; it sets the right expectations for Phases E and F.

3. **What should NOT be built yet?** CRM and HRMS/KRA/KPI. Not because they're unimportant — because building them on a foundation with two confirmed data-scoping leaks and a single-department project/access model means re-doing the access-control work twice.

4. **What must be fixed before CRM?** The dashboard scoping bug, the WebSocket broadcast scoping, and ideally the multi-department foundation (Phase C) — CRM's "won deal → project" flow is much more honest if a project can actually span the departments doing the work.

5. **What must be fixed before HRMS?** Nothing structurally blocks starting the KRA/KPI schema work in parallel, but Department Head/Team Lead "ownership" of a KRA is only as meaningful as the underlying multi-membership and department-scoping model — sequence Phase C before Phase F for that reason.

6. **What must be fixed before analytics (Phase D)?** The two Phase A bugs specifically, since both are analytics/dashboard-adjacent, plus filling the two placeholder ranking queries that already exist.

7. **Next best 30-day plan:** Phase A in full — **starting with the seed-script guard (a same-day fix)**, then both scoping bugs, project-delete safety, the 5 failing tests, and Cloudinary/OneDrive config confirmation — plus the ProjectStage frontend UI and the ticket worked-time UI from Phase B. All of this is scoped, low-risk, and mostly closing gaps this audit found rather than building anything new.

8. **Next best 90-day plan:** Finish Phase B, complete Phase C (multi-department/team membership wired into real access logic with a safe backfill), and start Phase D's placeholder-ranking fixes. Do not start CRM or HRMS schema work inside this window — the honest sequencing puts both after Phase C.
