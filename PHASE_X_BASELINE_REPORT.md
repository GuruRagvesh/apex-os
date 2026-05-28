# Phase X - Core Operational Trust Baseline Report

This baseline report documents the current state of the Apex OS dashboard metrics, recent activity feeds, workday logging, and ticket workflow consistency. It details why certain UI elements show zero or empty states, where the counts originate, and how the scoping rules affect data visibility.

---

## 1. Dashboard Zero Counts & Discrepancies

### Issue: Why does the Dashboard show 0 while Tickets / Kanban have data?
1. **Scope and User Mismatch**:
   - The seeded tickets belong to specific departments (e.g., `Company / Operations` or `Marketing`). If the logged-in user belongs to a different department, their department-level filters (scopings) filter out these tickets.
   - For `EMPLOYEE` and `INTERN` roles, their dashboard counts come from `getMetrics()`, which scopes tickets strictly to those where the user is the **Assignee**, the **Reporter**, or a **Participant** (via the `TicketAssignee` join table). If the seeded tickets are not assigned to or created by them, the employee dashboard shows `0` across all cards.
2. **Missing Active Projects Data Mapping**:
   - The "Active Projects" card on the dashboard uses `metrics.activeProjects`. While `activeProjects` count exists in the backend `getOverview()` payload, it was missing or incorrectly mapped in the role-specific `getMetrics()` endpoints for various roles in the past.
3. **High Priority Tickets vs Overdue Mismatch**:
   - On the Employee dashboard, the "High Priority Tickets" card uses `metrics.overdue ?? 0`, but the `getMetrics()` response for the `EMPLOYEE`/`INTERN` role does not calculate or return an `overdue` count. It instead returns `open`, `inProgress`, `inReview`, and `doneThisWeek`, resulting in a fallback `0` on the UI.
4. **Active Today / Staff Online**:
   - The "Active Today" card (visible to Admins/Super Admins) reads `metrics.activeToday`, which counts users whose `currentStatus` in the database is `'WORKING'`, `'ON_BREAK'`, or `'LOGGED_IN'`. Under clean seed conditions, all users start with a status of `'OFFLINE'`. Without any user having logged in and started their workday, this count naturally resolves to `0`.

---

## 2. Empty Recent Activity & Activity Log

### Issue: Why is Recent Activity empty, and why is the Activity Log blank?
1. **Aggressive Role Scoping on Event Query**:
   - The frontend Recent Activity Widget and the Activity Log page make API requests to `/api/events`.
   - In `EventsController.getEvents()`, the `actorId` query parameter is restricted:
     ```typescript
     const actorId = isAdmin && query.userId ? query.userId : user.id;
     ```
     For all non-admin roles (including `MANAGER` and `TEAM_LEAD`), the backend ignores the query filters and overwrites `actorId` with the logged-in user's own ID (`user.id`).
   - Consequently, managers and team leads only see their own sign-in/sign-out events. If they have not performed recent actions, their timeline appears completely empty. They cannot see events triggered by members of their teams or departments, violating their expected supervisory view.
2. **Database Table Discrepancy**:
   - The database schema contains two different event/log tables: `activity_logs` (model `ActivityLog`) and `operational_events` (model `OperationalEvent`).
   - All major backend actions (such as ticket creation, status changes, and leave requests) write to the `operational_events` table using `EventLoggerService.log()`.
   - The `activity_logs` table contains `0` rows because the system has transitioned to `operational_events` for real activity auditing, but old parts of the codebase (like `DashboardService.getActivityFeed()`) still query the empty `activity_logs` table.

---

## 3. Empty Workday Logs & Workday Bar Logic

### Issue: Why is the Workday Log empty?
1. **Workday is Not Login**:
   - Simply logging into the application (`USER_LOGIN` event) does not initialize an active workday session. A user must explicitly click "Start Work" in the `WorkdayBar` component.
   - If no workday has been started for the current day, `workdayApi.getToday()` returns a null session, showing the yellow "workday not started" bar.
2. **Lack of Stale Session and Logout Auto-Close Handling**:
   - If a user logs out of the frontend application, the active session in the database is not updated because there is no API call to `/workday/end` during the logout flow.
   - The session remains in the `WORKING` or `ON_BREAK` status until the midnight scheduler reset, which updates the `User.currentStatus` to `OFFLINE` but leaves the `WorkSession.status` open without a `logoutAt` timestamp, corrupting workday reports.

---

## 4. Frontend-Backend Data Source Mappings

| Frontend Metric Card | Source Field (metrics) | Backend Calculation Query |
|---|---|---|
| **Active Today** (Admin) | `activeToday` | `prisma.user.count({ where: { currentStatus: { in: ['WORKING', 'ON_BREAK', 'LOGGED_IN'] } } })` |
| **Open Tickets** (Admin) | `totalTickets` | `prisma.ticket.count({ where: { status: { notIn: [DONE, CLOSED] } } })` (scoped) |
| **Overdue** (Admin/MGR/TL) | `overdue` | Scopes tickets and checks SLA timing via `TicketTimingService.getTimingState(ticket, config).isOverdue` |
| **Pending Leave** (Admin/MGR)| `pendingLeave` | `prisma.leaveRequest.count({ where: { status: PENDING } })` (scoped) |
| **Dept/Team Tickets** (MGR/TL) | `total` | `prisma.ticket.count({ where: ticketScope })` |
| **Team Size** (Manager) | `teamCount` | `prisma.user.count({ where: { isActive: true, departmentId: manager.departmentId } })` |
| **Team Online** (Team Lead) | `teamOnline` | `prisma.user.count({ where: { currentStatus: { in: [WORKING, ON_BREAK, LOGGED_IN] } } })` (scoped) |
| **Open Tickets** (Employee) | `open` | `prisma.ticket.count({ where: { status: OPEN, assignedToId: user.id } })` |
| **Active Projects** (All) | `activeProjects` | `prisma.project.count({ where: { status: 'ACTIVE' } })` (scoped) |

---

## 5. Conclusions & Remediation Path

1. **Dashboard Convergence**:
   - Reconcile `getMetrics()` and the frontend KPI card mappings so they read consistent fields. Ensure `activeProjects` is included in all role metrics.
   - For employees, replace the mislabeled/unsupported "High Priority Tickets" card (which fallbacks to 0) with a card showing their tickets "In Review" or actual "Open" tickets.
2. **Activity Scoping**:
   - Adjust `EventsController.getEvents()` to build actor filter scopes dynamically:
     - Admins: see all organization-wide events.
     - Managers & Team Leads: see events from themselves and members of their managed departments (fetched via `AccessPolicyService.managedDepartmentIds()`).
     - Employees/Interns: see their own events only.
3. **Emit Workday Events**:
   - Ensure `WorkdayService` logs events using `EventLoggerService` during start work, break start/end, and end workday.
4. **Workday Logic**:
   - Trigger a warning or option to auto-close the workday session when logging out of the application.
   - Implement midnight auto-close for orphaned active workday sessions.
