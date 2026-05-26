# Dashboard & Data Reflection Audit
**Stage 8.5 — Apex OS Stabilization**
*Completed: 2026-05-26*

This document maps every visible dashboard count, graph, card, badge, and alert to its
exact backend data source so future engineers can trace any discrepancy from pixel to query.

---

## Audit Rules (non-negotiable)

- **No mock dashboard values** — every number shown to a user must derive from a real API call.
- **No hardcoded production numbers** — no literal integers standing in for live data.
- **No fake operational intelligence** — trend arrows/percentages must be computed from real data or not shown at all.
- **No local-only state pretending backend persistence** — optimistic UI must revert on error.
- **No success toast unless backend confirms success** — toasts only fire in `onSuccess` callbacks.
- **Every formula must be documented here** — that is the purpose of this file.

---

## 1. Home / Dashboard Page

**File:** `frontend/app/(dashboard)/(core)/dashboard/page.tsx`  
**API endpoint:** `GET /home/summary`  
**Backend controller:** `HomeController.getSummary()` → `DashboardService.getSummary(user)`  
**Refresh:** `refetchInterval: 60000` (every 60 s); `staleTime: 30000`

### 1a. Metric Cards (`MetricCards` component)

The backend returns four separate metric shapes depending on role.
The frontend renders the correct set in `components/home/MetricCards.tsx`.

| Role | Card | Formula | Tables |
|------|------|---------|--------|
| EMPLOYEE / INTERN | Open | `ticket.count WHERE assignedToId=me OR createdById=me AND status=OPEN` | Ticket |
| EMPLOYEE / INTERN | In Progress | Same scope, `status=IN_PROGRESS` | Ticket |
| EMPLOYEE / INTERN | In Review | Same scope, `status=REVIEW` | Ticket |
| EMPLOYEE / INTERN | Done This Week | Same scope, `status=DONE AND updatedAt >= now-7d` | Ticket |
| TEAM_LEAD | Team Tickets | `ticket.count WHERE departmentId=myDept OR createdById=me OR assignedToId=me` | Ticket |
| TEAM_LEAD | Overdue | Same scope, `dueDate < now AND status NOT IN (DONE,CLOSED)` | Ticket |
| TEAM_LEAD | Pending Reviews | Same scope, `status=REVIEW` | Ticket |
| TEAM_LEAD | Team Online | `user.count WHERE departmentId=myDept AND currentStatus IN (WORKING,ON_BREAK,LOGGED_IN)` | User |
| MANAGER | Dept Tickets | `ticket.count WHERE departmentId IN managedDepts` | Ticket, ManagerDeptAccess |
| MANAGER | Overdue | Same scope, `dueDate < now AND status NOT IN (DONE,CLOSED)` | Ticket |
| MANAGER | Pending Leave | `leaveRequest.count WHERE user.departmentId IN managedDepts AND status=PENDING` | LeaveRequest, User |
| MANAGER | Team Size | `user.count WHERE isActive=true AND departmentId=myDept` | User |
| ADMIN / SUPER_ADMIN | Active Today | `user.count WHERE currentStatus IN (WORKING,ON_BREAK,LOGGED_IN)` | User |
| ADMIN / SUPER_ADMIN | Open Tickets | `ticket.count WHERE status NOT IN (DONE,CLOSED)` | Ticket |
| ADMIN / SUPER_ADMIN | Overdue | `ticket.count WHERE dueDate < now AND status NOT IN (DONE,CLOSED)` | Ticket |
| ADMIN / SUPER_ADMIN | Pending Leave | `leaveRequest.count WHERE status=PENDING` | LeaveRequest |

**Scope function:** `DashboardService.buildRoleScope(user)` — builds the Prisma `where` clause per role.

### 1b. Critical Action Panel (`CriticalActionPanel` component)

Source: `summary.criticalAlerts` array from `DashboardService.getCriticalAlerts(user)`.

| Alert type | Condition | Role gate | Tables |
|------------|-----------|-----------|--------|
| `TICKET_OVERDUE` | overdue ticket count > 0 (role-scoped) | all roles | Ticket |
| `REVIEW_PENDING` | REVIEW-status ticket count > 0 (role-scoped) | MANAGER, ADMIN, SUPER_ADMIN, TEAM_LEAD | Ticket |
| `LEAVE_PENDING` | pending leave count > 0 (role-scoped) | MANAGER, ADMIN, SUPER_ADMIN, TEAM_LEAD | LeaveRequest |

### 1c. Upcoming Events (`UpcomingEvents` component)

Source: `summary.upcomingEvents` from `DashboardService.getUpcomingEvents(user)`.

- **Tickets:** `ticket.findMany WHERE dueDate BETWEEN now AND now+3d AND status NOT IN (DONE,CLOSED)` (role-scoped via `buildRoleScope`), up to 10.
- **Leave:** `leaveRequest.findMany WHERE startDate BETWEEN now AND now+3d AND status=APPROVED` (role-scoped via `buildLeaveScope`), up to 5.
- Events are sorted by time, capped at 10.

### 1d. Workday Status

Source: `summary.workdayStatus` from `DashboardService.getWorkdayStatus(user)`.
- `workSession.findUnique WHERE userId=me AND date=today` (includes latest `breakLog`).
- Used to show workday clock / break timer on the home page.

---

## 2. Analytics Page

**File:** `frontend/app/(dashboard)/analytics/page.tsx`  
**APIs used:**

| Query | Endpoint | Backend method | Tables |
|-------|----------|----------------|--------|
| Ticket trend chart | `GET /dashboard/ticket-trend?days=N` | `DashboardService.getTicketTrend(days)` | Ticket |
| Category chart | `GET /dashboard/tickets-by-category` | `DashboardService.getTicketsByCategory()` | Ticket |
| Stat cards | `GET /dashboard/overview` | `DashboardService.getOverview(userId, role)` | Ticket, Project, LeaveRequest, User |
| Workload chart | `GET /dashboard/workload` | `DashboardService.getWorkloadByUser()` | User, Ticket |
| Ticket age table | `GET /tickets?limit=200&page=1` | `TicketsService.findAll()` | Ticket | (tab=detailed only) |

### 2a. Stat Cards (Overview tab)

| Card | Formula | Source |
|------|---------|--------|
| Total Tickets | `openTickets + inProgressTickets + doneTickets` (from overview.stats) | Computed on frontend from `GET /dashboard/overview` |
| Resolved | `stats.doneTickets` | `GET /dashboard/overview` |
| Resolution Rate | `Math.round((doneTickets / total) * 100)` | Computed on frontend |
| Overdue | `stats.overdueTickets` | `GET /dashboard/overview` |

**Trend indicators (fixed in Stage 8.5):**

| Card | Trend source |
|------|-------------|
| Total Tickets | Period-over-period % change in `created` from trend chart data (first half vs second half of the selected window) |
| Resolved | Period-over-period % change in `resolved` from trend chart data (same split) |
| Resolution Rate | **No trend shown** — snapshot metric; period comparison would be misleading |
| Overdue | **No trend shown** — absolute count, not a % change |

**Fix applied:** Removed hardcoded `trend={12}`, `trend={8}`, and `trend={resRate > 60 ? 3 : -5}`. All trend indicators now computed from the `trend` API response via `computePeriodTrend()`, which returns `undefined` (= no arrow shown) when the data window is too small or both periods are zero.

### 2b. Ticket Trend Chart

- X-axis: date strings (ISO date, one per day)
- Y-axis: `created` count and `resolved` count
- Data: `GET /dashboard/ticket-trend?days=N` → `DashboardService.getTicketTrend(days)`
- Formula: iterates all tickets created in the window; buckets by `createdAt` date; marks resolved if `status IN (DONE, CLOSED)` on that creation date.
- **Note:** "resolved" in the trend chart reflects tickets that were created AND are currently done/closed — not the date they were resolved. This is a known approximation.

### 2c. Workload Chart (bar)

- Data: `GET /dashboard/workload` → `DashboardService.getWorkloadByUser()`
- Shows top 8 users; bar width = `min((open + inProgress) * 10, 100)%`
- No cap on value for the number shown; visual cap at 10 active tickets = 100% bar width.

### 2d. Ticket Age Table (Detailed tab)

- Fetches `GET /tickets?limit=200&page=1`; filters to non-DONE/CLOSED tickets client-side.
- Age = `floor((now - ticket.createdAt) / 86400000)` days.
- Shows max 20 rows.

---

## 3. Kanban Board

**File:** `frontend/app/(dashboard)/(operations)/kanban/page.tsx`  
**API:** `GET /tickets/kanban?departmentId=...`  
**Refresh:** `refetchInterval: 30000` (every 30 s)

- Column counts are derived directly from the server response (each COLUMNS key maps to an array of tickets).
- **Optimistic updates:** when a card is dragged, `localKanban` state is updated immediately; on mutation error the state is reverted to server data and an error toast fires.
- After a successful status change, invalidates: `kanban`, `tickets`, `dashboard-overview`, `ticket-stats`, `activity-feed`.

**canMoveCard rule (frontend guard — mirrors backend):**
- Owner (`createdById === user.id`) ✅
- Assignee (`assignedToId === user.id` or in `ticket.assignees`) ✅
- MANAGER, ADMIN, SUPER_ADMIN ✅
- TEAM_LEAD ✅
- All others ❌ (card is non-draggable; back-end also enforces via `TicketsService.updateStatus`)

---

## 4. Notification Bell

**File:** `frontend/components/layout/topbar.tsx`

| Data | Endpoint | Refresh |
|------|----------|---------|
| Unread badge count | `GET /notifications/unread-count` | Every 15 s (`refetchInterval: 15000`) |
| Notification list (panel) | `GET /notifications` | Every 60 s; `staleTime: 30000` |
| Mark one read | `PATCH /notifications/:id/read` | Invalidates both queries above |
| Mark all read | `PATCH /notifications/mark-all-read` | Invalidates both queries above |

**Real-time updates (WebSocket):**
- `onNotificationNew`: increments badge count via `qc.setQueryData` + prepends to list + shows toast.
- `onLeaveStatusChanged`: shows toast only (count not incremented separately — leave decision triggers a server-side notification that arrives via `onNotificationNew`).

---

## 5. Dashboard Overview (`GET /dashboard/overview`)

**File:** `backend/src/modules/platform/dashboard/dashboard.service.ts — getOverview()`  
**Used by:** Analytics page stat cards; also returned for role-scoped dashboard reads.

Role-scoped `ticketWhere`:
- ADMIN / SUPER_ADMIN: `{}` (all tickets), unless MANAGER with dept access
- MANAGER: `{ departmentId: { in: managedDeptIds } }` (or `{}` if no depts)
- EMPLOYEE / INTERN: `{ OR: [{ assignedToId: userId }, { createdById: userId }] }`

Returns:
```
stats: { totalTickets, openTickets, inProgressTickets, doneTickets,
         urgentTickets, overdueTickets, totalProjects, activeProjects,
         pendingLeave, totalUsers, teamMembers }
recentTickets[]   // last 10 by createdAt desc (role-scoped)
myTickets[]       // top-priority 5 (role-scoped for non-managers)
```

---

## 6. Acceptance Check Results

| Check | Status | Notes |
|-------|--------|-------|
| Create ticket → open count increments | ✅ Backend | `getOverview` counts live; Kanban invalidates on status change |
| Status change → Kanban/dashboard updates | ✅ | Kanban invalidates `dashboard-overview` on mutation success |
| Ticket → REVIEW updates review count | ✅ | `metrics.inReview` from `/home/summary`; `criticalAlerts` REVIEW_PENDING |
| Ticket → DONE updates resolved/project progress | ✅ | `doneTickets` counted by `getOverview`; project progress from project service |
| Leave apply/approve/reject → leave stats | ✅ | `pendingLeave` counted in `getOverview` + `getMetrics`; `criticalAlerts` LEAVE_PENDING |
| Notification read/delete → bell count | ✅ | Both actions invalidate `notifications-count` query |
| Dashboard respects role scope after refresh | ✅ | All counts use `buildRoleScope(user)` server-side |
| No fake operational intelligence | ✅ Fixed | Removed hardcoded `trend={12}`, `trend={8}`, `trend={resRate > 60 ? 3 : -5}` from analytics |

---

## 7. Known Approximations (documented, not bugs)

1. **Ticket trend "resolved" count**: tracks tickets created in the window that are *currently* done/closed — not the date they transitioned to DONE. A ticket created 20 days ago and resolved yesterday is counted in its creation day bucket, not yesterday's. Acceptable for a trend overview; a stricter implementation would query `TicketHistory`.

2. **Workload bar width**: `min((open + inProgress) × 10, 100)%` — visual cap at 10 active tickets = full bar. The number label shows the real count. This is a UI decision, not a data error.

3. **Analytics "Total Tickets" stat card**: sums `openTickets + inProgressTickets + doneTickets` from the overview endpoint, which is role-scoped. An admin will see a different total than an employee. This is intentional and correct.
