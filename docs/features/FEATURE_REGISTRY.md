# Feature Registry

**Status:** Canonical
**Date created:** 2026-08-04
**Branch:** `chore/repo-compartmentalization-audit`
**Base commit:** `d3f0490`
**Last verified:** 2026-08-04

This is the authoritative map from feature → code, data, contracts, and current
state. Where a historical report disagrees with this file, this file is treated
as current and the report as point-in-time evidence.

## How to read this

- **Paths** are real paths verified in the repository at the base commit above.
- **API endpoints** are controller route prefixes verified from `@Controller()`
  decorators. Individual sub-routes are only listed where verified in this
  session; otherwise the prefix is given.
- **"Needs verification"** means exactly that — it was not confirmed against
  code, and must not be treated as fact.
- **Status** is one of: `COMPLETE`, `PARTIAL`, `UI_ONLY`, `BACKEND_ONLY`,
  `HIDDEN`, `BROKEN`, `DEPRECATED`, `NEEDS_AUDIT`.
- **Environment** is one of: `LOCAL`, `STAGING`, `PRODUCTION`, `MIXED`, `UNKNOWN`.
- A feature being listed here is **not** a claim it is production-ready.

---

## Workforce — Attendance

### ATT-001 — Workday lifecycle

| Field | Value |
| --- | --- |
| Domain | Workforce |
| Frontend paths | `frontend/components/workday/WorkdayBar.tsx`, `frontend/components/workday/EndDayModal.tsx`, `frontend/app/(dashboard)/(core)/dashboard/page.tsx` |
| Backend paths | `backend/src/modules/platform/workday/workday.service.ts`, `workday.controller.ts`, `workday.policy.helper.ts`, `workday.calculation.ts`; `backend/src/common/services/attendance-authority.service.ts` |
| Database models | `WorkSession`, `AttendanceEvent`, `OperationalEvent` |
| API endpoints | `POST /workday/start`, `POST /workday/end`, `GET /workday/today`, `GET /workday/team`, `POST /workday/resume`, `POST /workday/resume-auto-closed`, `POST /workday/continue-working` |
| Status | `COMPLETE` |
| Environment | `PRODUCTION` |
| Feature flag | None |
| Risk | HIGH — payroll-adjacent attendance data |
| Tests | `backend/test/unit/workday.finalize-session.spec.ts`, `backend/test/unit/scheduler.service.spec.ts`, `backend/test/unit/scheduler.policy.spec.ts`, `backend/test/unit/tva-attendance-authority.spec.ts` |
| Known issues | All four close paths now route through `finalizeWorkSession` (merged via PR #11). Staging validation of that change was skipped — the merge went straight to `main`. `ATTENDANCE_PHASE1_QA.md` staging script has not been executed in any environment. |
| Last verified | 2026-08-04 |

### ATT-002 — Break and meeting tracking

| Field | Value |
| --- | --- |
| Domain | Workforce |
| Frontend paths | `frontend/components/workday/BreakModal.tsx`, `frontend/components/workday/WorkdayBar.tsx` |
| Backend paths | `backend/src/modules/platform/workday/workday.service.ts` (`startBreak`, `endBreak`) |
| Database models | `BreakLog` |
| API endpoints | `POST /workday/break/start`, `POST /workday/break/end` |
| Status | `COMPLETE` |
| Environment | `PRODUCTION` |
| Feature flag | None |
| Risk | HIGH — affects computed work totals |
| Tests | `backend/test/unit/workday.meeting-break.spec.ts` (currently failing on `main` for a pre-existing TVA mock gap), `backend/test/unit/workday.finalize-session.spec.ts` |
| Known issues | Break types are defined client-side in `BreakModal.tsx` (`TEA`, `LUNCH`, `RESTROOM`, `PERSONAL`, `POWER_CUT`, `MEETING`, `OTHER`); there is no distinct "Field work" type. `MEETING` is excluded from deducted break minutes by design. `startBreak` is only valid from `WORKING` status. |
| Last verified | 2026-08-04 |

### ATT-003 — Attendance history

| Field | Value |
| --- | --- |
| Domain | Workforce |
| Frontend paths | `frontend/components/workday/WorkdayHistoryStrip.tsx` |
| Backend paths | `backend/src/modules/platform/workday/workday.service.ts` (`getHistory`) |
| Database models | `WorkSession`, `BreakLog` |
| API endpoints | `GET /workday/history/:userId` |
| Status | `COMPLETE` |
| Environment | `PRODUCTION` |
| Feature flag | None |
| Risk | MEDIUM |
| Tests | `backend/test/unit/workday.history.spec.ts` |
| Known issues | Returns a 7-day grouped summary capped at 90 sessions. |
| Last verified | 2026-08-04 |

### ATT-004 — HRMS attendance workspace

| Field | Value |
| --- | --- |
| Domain | Workforce |
| Frontend paths | `frontend/app/(workspaces)/hrms/page.tsx` (gated to `isHR` or ADMIN/SUPER_ADMIN) |
| Backend paths | **None on `main`.** `backend/src/modules/platform/hrms-attendance/` exists only on the `staging` branch. |
| Database models | `AttendancePolicy`, `ShiftPolicy`, `EmployeeAttendanceProfile`, `WeeklyOffPolicy`, `HolidayCalendar`, `Holiday`, `DailyAttendance`, `AttendanceRegularization` — all migrated into `schema.prisma`, **none referenced by any service on `main`** |
| API endpoints | None on `main`. |
| Status | `UI_ONLY` |
| Environment | `MIXED` — UI on `main`, backend only on `staging` |
| Feature flag | None (route-gated by role instead) |
| Risk | MEDIUM |
| Tests | None identified |
| Known issues | The HRMS attendance policy schema is fully migrated but entirely unwired — a grep for `AttendancePolicy`, `ShiftPolicy`, or `EmployeeAttendanceProfile` across `backend/src` returns zero files. Two competing policy sources exist: this schema and the live `AppSetting` `workday_policy` record. No transition decision has been made. |
| Last verified | 2026-08-04 |

### ATT-005 — Unified attendance card (preview)

| Field | Value |
| --- | --- |
| Domain | Workforce |
| Frontend paths | `frontend/components/workday/UnifiedAttendanceCard.tsx`, `frontend/app/attendance-v2/page.tsx` — **on branch `feat/attendance-v2-unified-card` only, not on `main`** |
| Backend paths | None — reuses existing `workday` endpoints unchanged |
| Database models | None new |
| API endpoints | Reuses ATT-001/ATT-002 endpoints |
| Status | `HIDDEN` |
| Environment | `LOCAL` |
| Feature flag | None — hidden by being an unlinked route |
| Risk | LOW |
| Tests | None — UI only |
| Known issues | Not merged. Authenticated flows have not been exercised end-to-end. Idle state deliberately omits Break/Meeting because `startBreak` is not valid from `IDLE`. |
| Last verified | 2026-08-04 |

---

## Identity and access

### AUTH-001 — Login and JWT authentication

| Field | Value |
| --- | --- |
| Domain | Identity and access |
| Frontend paths | `frontend/app/(auth)/login/page.tsx`, `frontend/store/auth.store.ts`, `frontend/lib/api.ts` |
| Backend paths | `backend/src/modules/core/auth/` |
| Database models | `User`, `Role` |
| API endpoints | `/auth` prefix — specific sub-routes: Needs verification |
| Status | `COMPLETE` |
| Environment | `PRODUCTION` |
| Feature flag | None |
| Risk | HIGH |
| Tests | Needs verification |
| Known issues | Login must never create or start a `WorkSession` — a standing attendance invariant. |
| Last verified | 2026-08-04 |

### AUTH-002 — Password recovery and OTP

| Field | Value |
| --- | --- |
| Domain | Identity and access |
| Frontend paths | `frontend/app/(auth)/forgot-password/page.tsx`, `frontend/app/(auth)/change-password/page.tsx` |
| Backend paths | `backend/src/modules/core/auth/`, `backend/src/modules/platform/email/` |
| Database models | `User` |
| API endpoints | `/auth` prefix — specific sub-routes: Needs verification |
| Status | `COMPLETE` |
| Environment | `PRODUCTION` |
| Feature flag | None |
| Risk | HIGH |
| Tests | Needs verification |
| Known issues | Email delivery uses Resend, configured from the `AppSetting` table rather than SMTP environment variables. |
| Last verified | 2026-08-04 |

### USR-001 — User management

| Field | Value |
| --- | --- |
| Domain | Identity and access |
| Frontend paths | `frontend/app/(dashboard)/(platform)/users/page.tsx`, `users/[id]/page.tsx`, `users/[id]/profile/page.tsx` |
| Backend paths | `backend/src/modules/core/users/`, `backend/src/common/services/access-policy.service.ts` |
| Database models | `User`, `Role`, `Department`, `EmployeeDocument`, `EmployeeProfileChangeRequest`, `UserRoleAssignment` |
| API endpoints | `/users` |
| Status | `COMPLETE` |
| Environment | `PRODUCTION` |
| Feature flag | None |
| Risk | HIGH — payroll and document access |
| Tests | `backend/test/unit/users.profile.spec.ts` (currently failing on `main`, pre-existing) |
| Known issues | User deactivation/anonymisation calls the OneDrive backup vault and refuses to anonymise if it fails; that vault was previously reported returning 404. Not revalidated. |
| Last verified | 2026-08-04 |

### TEAM-001 — Teams and hierarchy

| Field | Value |
| --- | --- |
| Domain | Workforce |
| Frontend paths | `frontend/app/(dashboard)/(operations)/teams/page.tsx`, `teams/[id]/page.tsx`, `team/page.tsx` |
| Backend paths | `backend/src/modules/operations/team/`, `backend/src/common/services/hierarchy-approval.service.ts` |
| Database models | `Team`, `TeamMember`, `UserDepartmentMembership`, `ManagerDeptAccess` |
| API endpoints | `/team`, `/teams` |
| Status | `COMPLETE` |
| Environment | `PRODUCTION` |
| Feature flag | None |
| Risk | MEDIUM |
| Tests | Needs verification |
| Known issues | Only `ManagerDeptAccess` affects access scoping; `UserDepartmentMembership` is used for team membership only. There is no `DEPARTMENT_HEAD` role — only the six roles in `backend/src/shared/constants/roles.ts`. |
| Last verified | 2026-08-04 |

---

## Workforce — Leave

### LEAVE-001 — Leave application and approvals

| Field | Value |
| --- | --- |
| Domain | Workforce |
| Frontend paths | `frontend/app/(dashboard)/(operations)/leave/page.tsx` |
| Backend paths | `backend/src/modules/operations/leave/`, `backend/src/common/services/leave-access.service.ts` |
| Database models | `LeaveRequest`, `LeavePolicy` |
| API endpoints | `/leave` — includes `POST /leave/:id/approve`, `POST /leave/:id/reject` |
| Status | `PARTIAL` |
| Environment | `PRODUCTION` |
| Feature flag | None |
| Risk | HIGH |
| Tests | `backend/test/unit/p1.leave-balance.spec.ts` (currently failing on `main`, pre-existing) |
| Known issues | **Open P1 permission inconsistency:** the approve/reject route guard checks role only and does not check `isHR`, while the service layer grants approval authority to any `isHR=true` user. An Employee/Intern with `isHR=true` would be blocked at the route before the service check runs. Requires a policy decision on which layer is authoritative. Separately, who may approve a Manager's own leave is not fully traced — approval requires a strictly lower numeric role `level`. |
| Last verified | 2026-08-04 |

---

## Operations — Tickets

### TKT-001 — Ticket lifecycle

| Field | Value |
| --- | --- |
| Domain | Operations |
| Frontend paths | `frontend/app/(dashboard)/(operations)/tickets/`, `frontend/components/tickets/`, `frontend/modules/operations/tickets/` |
| Backend paths | `backend/src/modules/operations/tickets/`, `backend/src/common/services/ticket-access.service.ts` |
| Database models | `Ticket`, `TicketAssignee`, `TicketWatcher`, `TicketHistory`, `Comment`, `Attachment`, `TaskType`, `TaskSubtype` |
| API endpoints | `/tickets`, `/tickets/:ticketId/comments`, `/task-types` |
| Status | `COMPLETE` |
| Environment | `PRODUCTION` |
| Feature flag | None |
| Risk | HIGH |
| Tests | `backend/test/unit/tickets.hierarchy-approval.spec.ts`, `backend/test/unit/ticket.guardrails.spec.ts` (currently failing on `main`, pre-existing) |
| Known issues | QUERY/HELP/TASK types have different approval rules; HELP has an approver/rejecter asymmetry (approve gates on `createdById`, reject on `assignedToId`). Ticket deletion is ADMIN/SUPER_ADMIN only. Interns cannot block/unblock. |
| Last verified | 2026-08-04 |

### TKT-002 — Ticket timing and ledger

| Field | Value |
| --- | --- |
| Domain | Operations |
| Frontend paths | `frontend/lib/ticket-timing.ts`, `frontend/components/tickets/OverdueTicker.tsx` |
| Backend paths | `backend/src/modules/operations/tickets/ticket-ledger.service.ts` |
| Database models | `TicketTimeLog` |
| API endpoints | Needs verification |
| Status | `COMPLETE` |
| Environment | `PRODUCTION` |
| Feature flag | None |
| Risk | HIGH — SLA and time accounting |
| Tests | `backend/test/unit/ticket-ledger.service.spec.ts` (currently failing on `main`, pre-existing), `backend/test/unit/tickets.work-log-ledger.spec.ts` |
| Known issues | `pauseActiveLogsForUser` now accepts an optional Prisma transaction client so Workday finalization can pause timers atomically. Going `IDLE` does **not** pause ticket timers — only breaks and the eventual auto-logout do. Whether idle should pause timers is an open product decision. |
| Last verified | 2026-08-04 |

### TKT-003 — Ticket review and rework

| Field | Value |
| --- | --- |
| Domain | Operations |
| Frontend paths | `frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx` |
| Backend paths | `backend/src/modules/operations/tickets/`, `backend/src/common/services/hierarchy-approval.service.ts` |
| Database models | `ReviewCycleLog`, `Ticket` |
| API endpoints | `/tickets` — review/approve sub-routes: Needs verification |
| Status | `PARTIAL` |
| Environment | `PRODUCTION` |
| Feature flag | None |
| Risk | HIGH |
| Tests | `backend/test/unit/tickets.hierarchy-approval.spec.ts` |
| Known issues | Self-assigned ticket approval Phase 1 (review/completion/rating control) is done with no schema change. Phase 2 (creation-time "Pending Approval") is deferred — `TicketStatus` has no `PENDING_APPROVAL` value and `Ticket` has no `approvalStatus` field. |
| Last verified | 2026-08-04 |

---

## Operations — Projects and Notifications

### PRJ-001 — Projects

| Field | Value |
| --- | --- |
| Domain | Operations |
| Frontend paths | `frontend/app/(dashboard)/(operations)/projects/page.tsx`, `projects/[id]/page.tsx`, `kanban/page.tsx` |
| Backend paths | `backend/src/modules/operations/projects/` |
| Database models | `Project`, `ProjectStage`, `ProjectMember` |
| API endpoints | `/projects` |
| Status | `COMPLETE` |
| Environment | `PRODUCTION` |
| Feature flag | None |
| Risk | MEDIUM |
| Tests | Needs verification |
| Known issues | None recorded. |
| Last verified | 2026-08-04 |

### NTF-001 — Notifications

| Field | Value |
| --- | --- |
| Domain | Platform |
| Frontend paths | `frontend/components/notifications/DesktopNotificationManager.tsx`, `frontend/hooks/useWorkdayReminders.ts` |
| Backend paths | `backend/src/modules/operations/notifications/`, `backend/src/modules/platform/gateway/events.gateway.ts` |
| Database models | `Notification` |
| API endpoints | `/notifications` |
| Status | `PARTIAL` |
| Environment | `PRODUCTION` |
| Feature flag | None |
| Risk | MEDIUM |
| Tests | `backend/test/unit/p1d.notification-monitoring.spec.ts` |
| Known issues | **Open security issue (BUG-H):** `events.gateway.ts` broadcasts `ticket:created` and `ticket:status_changed` to every connected socket via bare `server?.emit(...)`, unlike `notification:new` and `leave:status_changed`, which are correctly scoped to `user:{id}` rooms. Not yet fixed. A notification access/visibility audit is also still outstanding. |
| Last verified | 2026-08-04 |

---

## Intelligence

### DASH-001 — Dashboard

| Field | Value |
| --- | --- |
| Domain | Intelligence |
| Frontend paths | `frontend/app/(dashboard)/(core)/dashboard/page.tsx`, `frontend/components/home/` |
| Backend paths | `backend/src/modules/platform/dashboard/dashboard.service.ts` |
| Database models | Aggregates over `Ticket`, `LeaveRequest`, `WorkSession`, `Project` |
| API endpoints | `/dashboard`, `/home` |
| Status | `COMPLETE` |
| Environment | `PRODUCTION` |
| Feature flag | None |
| Risk | MEDIUM |
| Tests | `backend/test/unit/p1d.dashboard-consistency.spec.ts` (currently failing on `main`, pre-existing) |
| Known issues | Metrics are role-scoped: Employee/Intern see own data, Team Lead and Manager see department scope, Admin/Super Admin see company-wide. Displayed totals depend on frozen Workday totals being correct — see ATT-001. |
| Last verified | 2026-08-04 |

### ANL-001 — Analytics and reporting

| Field | Value |
| --- | --- |
| Domain | Intelligence |
| Frontend paths | `frontend/app/(dashboard)/analytics/page.tsx`, `frontend/app/(dashboard)/(platform)/reports/page.tsx` |
| Backend paths | `backend/src/modules/platform/analytics/analytics.service.ts` |
| Database models | Aggregates; no dedicated model |
| API endpoints | `/analytics` |
| Status | `PARTIAL` |
| Environment | `PRODUCTION` |
| Feature flag | None |
| Risk | MEDIUM |
| Tests | `backend/test/unit/analytics.spec.ts` (intermittently failing on `main`, pre-existing) |
| Known issues | `getManagerMetrics` hard-blocks non-MANAGER/ADMIN/SUPER_ADMIN callers. Per the company rollout decision, workday and analytics data are **not authoritative** for salary, penalty, or performance decisions until verification completes. |
| Last verified | 2026-08-04 |

---

## Business

### CRM-001 — Sales CRM leads

| Field | Value |
| --- | --- |
| Domain | Business |
| Frontend paths | `frontend/app/(workspaces)/sales-crm/` (route-gated to ADMIN/SUPER_ADMIN), `frontend/components/sales-crm/`, `frontend/lib/sales-crm/` |
| Backend paths | `backend/src/modules/business/sales-crm/leads.service.ts`, `leads.controller.ts`; `backend/src/common/services/sales-access.service.ts` |
| Database models | `Lead`, `LeadActivity`, `FollowUp`, `Requirement`, `Deal` |
| API endpoints | `/sales-crm/leads` |
| Status | `PARTIAL` |
| Environment | `MIXED` |
| Feature flag | `NEXT_PUBLIC_SALES_CRM_LEADS_BACKEND_ENABLED` — defaults OFF; anything other than exactly `"true"` is treated as off |
| Risk | LOW — dark by default |
| Tests | Needs verification |
| Known issues | Leads has a real backend behind the flag; Database, Analytics, Settings and Dashboard sub-modules still read local/mock data regardless of the flag. No `DealTab` UI exists despite the `Deal` model being present. |
| Last verified | 2026-08-04 |

---

## Cross-cutting notes

- **Roles:** exactly six exist — `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `TEAM_LEAD`,
  `EMPLOYEE`, `INTERN` (`backend/src/shared/constants/roles.ts`). `isHR` is a
  separate boolean on `User`, independent of role.
- **Audit trail:** `OperationalEvent` (company-wide) and `AttendanceEvent`
  (per-session) are written by `EventLoggerService` and the Workday services.
- **No feature-flag framework exists.** `NEXT_PUBLIC_SALES_CRM_LEADS_BACKEND_ENABLED`
  is a bare environment variable read in `frontend/lib/sales-crm/api-connector.ts`.
  There is no `attendance_v2_enabled` or equivalent server-side flag mechanism.
