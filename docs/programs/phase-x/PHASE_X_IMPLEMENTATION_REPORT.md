# Phase X - Core Operational Trust Implementation Report

This report documents the implementation details for the Core Operational Trust fixes applied to Apex OS in Phase X.

---

## 1. Dashboard Truth Synchronization

### Backend Changes
- **File**: [dashboard.service.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/modules/platform/dashboard/dashboard.service.ts)
  - Updated `getMetrics()` to ensure `activeProjects` count is calculated and returned in all four role-specific branches (Employee/Intern, Team Lead, Manager, Admin).
  - Standardized employee metrics fields returning `open`, `inProgress`, `inReview`, and `doneThisWeek` counts.

### Frontend Changes
- **File**: [page.tsx (Dashboard)](file:///c:/Users/Administrator/Desktop/nexus-app/frontend/app/(dashboard)/(core)/dashboard/page.tsx)
  - Mapped the "Open Tickets" capsule to use `metrics.openTickets` (or fallback) instead of `totalTickets` for admin/super_admin.
  - Mapped "Active Projects" card count to `metrics.activeProjects` for all roles.
  - Fixed the Announcement Broadcast banner check to lookup alerts with `a.severity === 'red'` to ensure overdue ticket notifications are prominently broadcasted.

---

## 2. Activity System Activation

### Backend Changes
- **File**: [events.controller.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/modules/platform/events/events.controller.ts)
  - Restructured `getEvents()` route to scope activities based on user roles:
    - **ADMIN / SUPER_ADMIN**: Retrieve all global events (or target `userId` if filtered).
    - **MANAGER / TEAM_LEAD**: Retrieve own events or events of members belonging to departments they manage (using `AccessPolicyService.managedDepartmentIds()`).
    - **EMPLOYEE / INTERN**: Retrieve own events only, throwing a `ForbiddenException` for cross-user attempts.
  - Enriched `ACTION_DESCRIPTIONS` dictionary mapping all missing operational actions (`PROJECT_CREATED`, `COMMENT_ADDED`, `SETTINGS_UPDATED`, etc.) to human-readable strings.

- **File**: [workday.service.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/modules/platform/workday/workday.service.ts)
  - Added `EventLoggerService` calls in `startWork()`, `endWork()`, `startBreak()`, and `endBreak()` to emit `OperationalAction` audit logs for all workday state changes.

---

## 3. Workday Operational Logic

### Backend Changes
- **File**: [workday.service.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/modules/platform/workday/workday.service.ts)
  - Updated `getTeam()` to calculate live active workday elapsed minutes and live break minutes for active sessions rather than returning hardcoded `0` or `null` values.

- **File**: [auth.service.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/modules/core/auth/auth.service.ts)
  - Updated `login()` to check for an active workday session today. If the session's status is `WORKING`, `ON_BREAK`, or `IDLE`, that status is preserved in the `WorkSession` and `User.currentStatus` tables to resume it on relogin instead of overwriting with `LOGGED_IN`.

- **File**: [scheduler.service.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/modules/platform/scheduler/scheduler.service.ts)
  - Updated midnight leave scheduler `setLeaveStatuses()` to find any unclosed `WorkSession` records from the previous day.
  - These stale sessions are closed by setting `logoutAt = 23:59:59` (yesterday), calculating final `totalWorkMinutes` (accounting for any open breaks closed at the same time), setting the status to `'LOGGED_OUT'`, and logging a system `AUTO_CLOSE` attendance event.

### Frontend Changes
- **File**: [team/page.tsx](file:///c:/Users/Administrator/Desktop/nexus-app/frontend/app/(dashboard)/(operations)/team/page.tsx)
  - Added `TEAM_LEAD` to `canSeeStatus` permissions check so Team Leads have access to the "Live Status" tab.

- **Files**: [topbar.tsx](file:///c:/Users/Administrator/Desktop/nexus-app/frontend/components/layout/topbar.tsx), [sidebar.tsx](file:///c:/Users/Administrator/Desktop/nexus-app/frontend/components/layout/sidebar.tsx)
  - Added client-side logout checks. If a user tries to logout with an active workday status (`WORKING`, `ON_BREAK`, `IDLE`), a confirmation warning dialog reminds them to "End Day" and prompts if they wish to proceed.

---

## 4. Ticket Workflow Consistency

### Backend Changes
- **File**: [ticket-access.service.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/common/services/ticket-access.service.ts)
  - Modified `assertCanTransitionTicket()` to allow self-assigned creators (where `ticket.createdById === user.id && ticket.assignedToId === user.id`) to transition their own tickets to `DONE` / `CLOSED` directly (bypassing the Intern restriction and reviewer requirements).

- **File**: [tickets.controller.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/modules/operations/tickets/tickets.controller.ts)
  - Removed strict `@UseGuards(RolesGuard)` and `@Roles(...)` decorators from `@Patch(':id/approve')` and `@Patch(':id/reject')` endpoints. This delegates the validation entirely to `assertCanTransitionTicket()` in the service layer, allowing employees/interns to self-approve self-reported tickets while keeping other tickets protected.

---

## 5. Activity Log Filters & UI

### Frontend Changes
- **File**: [admin/activity/page.tsx](file:///c:/Users/Administrator/Desktop/nexus-app/frontend/app/(dashboard)/admin/activity/page.tsx)
  - Reconciled date filter ranges to support: `Today`, `This Week` (from Monday), `Last 7 Days`, and `All`.
  - Added a dynamic subtitle explaining the log's visibility scope matching the user's role (Global for Admins, Managed Department for Managers/Leads, Personal for Employees/Interns).
