# Phase Ω - Operational UX Audit

**Date:** May 28, 2026  
**Project:** Apex OS  
**Auditor:** Antigravity AI  

---

## SECTION 1 — ROLE UX CONVERGENCE

### 1. SUPER_ADMIN / ADMIN
*   **What SHOULD they see?** Global command dashboard, all tickets in the system, all leave requests, all projects, all users, all department stats, global activity log, and configurations (SMTP, SLA).
*   **What CAN they currently see?** Almost all of these. They see all tickets, leaves, projects, user management, and department metrics.
*   **What is MISSING?** A detailed audit trail page or summary of changed settings, and visibility on blocked tickets beyond description text.
*   **What is incorrectly hidden?** Nothing.
*   **What should NOT be visible?** Unmasked payroll details by default (unmasked only when explicitly authorized or clicked).
*   **Which workflows feel broken?** Roster requests in the directory reset on page reload (local React state resets).
*   **Which pages feel dead?** The Project list page (shows static list, doesn't feel like a live portfolio with real-time risk indicators).
*   **Which operational actions are unclear?** Re-assigning tickets via update vs re-assign has overlapping paths.
*   **Which intelligence is missing?** Stale sessions overview on the dashboard (can only see active users).

### 2. MANAGER
*   **What SHOULD they see?** Scoped department metrics, department tickets, department member workloads, department leaves pending, department member workday states, department activities.
*   **What CAN they currently see?** Department scope metrics on dashboard, department tickets, pending leave requests, department members list, Live Status workday tracking.
*   **What is MISSING?** The ability to persist requested members in the team directory (lost on refresh), and a visual warning on the dashboard for workers who haven't ended their workday.
*   **What is incorrectly hidden?** None.
*   **What should NOT be visible?** Global admin configuration settings (SMTP, default themes), global users list outside department boundary.
*   **Which workflows feel broken?** Roster requests (state resets on refresh).
*   **Which pages feel dead?** Leave approval list feels like an admin grid with no visibility into overlapping leaves or department attendance context.
*   **Which operational actions are unclear?** Denying leave request without standard reasoning input in the UI.
*   **Which intelligence is missing?** Live ticket workload metrics for department members directly inside the team page.

### 3. TEAM_LEAD
*   **What SHOULD they see?** Team tickets, overdue tasks, pending reviews, active workday statuses, department member workloads.
*   **What CAN they currently see?** Team dashboard metrics, department tickets, Live Status workday tab.
*   **What is MISSING?** Persistent roster request status in directory.
*   **What is incorrectly hidden?** None.
*   **What should NOT be visible?** Analytics, department administration, user configuration.
*   **Which workflows feel broken?** Adding team members from directory.
*   **Which pages feel dead?** Dashboard upcoming events (interns/employees have no context on peer leaves).
*   **Which operational actions are unclear?** Pushing back a ticket for rework (shows comments as standard commentary instead of rework feedback).
*   **Which intelligence is missing?** Historical team workday logs (can see live status, but not history).

### 4. EMPLOYEE / INTERN
*   **What SHOULD they see?** Assigned tickets, in-progress work, own leave requests, own workday timer, theme settings, personal activity.
*   **What CAN they currently see?** Scoped dashboard metrics (Open, In Progress, In Review, Done), own ticket details, own leave requests, personal activity log.
*   **What is MISSING?** Direct leave balance indicator on the leave request list page.
*   **What is incorrectly hidden?** None.
*   **What should NOT be visible?** Other team members' leaves/workday details in detail, department workload details.
*   **Which workflows feel broken?** Logging out without ending workday (warns but does not automate).
*   **Which pages feel dead?** Dashboard if there are no tickets (shows empty tiles with no "Get Started" guidance).
*   **Which operational actions are unclear?** Intern ticket transitions (forbidden from moving to REVIEW/DONE unless self-assigned creator).
*   **Which intelligence is missing?** Remaining leave balances at the moment of submitting requests.

---

## SECTION 2 — TEAM LEAD / MANAGER VISIBILITY

### Team Leads:
*   **See all assigned team tickets?** Yes, via scoped `buildTicketWhereForUser`.
*   **See member workload?** Yes, through the workload widget in Analytics, but Team Leads are excluded from the `/analytics` navigation, meaning they cannot access this view.
*   **See member activity?** Yes, via scoped `/events` in the Activity Log page.
*   **See pending reviews?** Yes, on the dashboard.
*   **See overdue member tickets?** Yes, via `/tickets?overdue=true`.
*   **See team workday state?** Yes, via the Live Status tab.
*   **See inactive/stale workers?** Stale workers are auto-closed, but no dashboard warning exists for unclosed sessions before midnight.

### Managers:
*   **See department operations?** Yes, via scoped dashboard metrics.
*   **See delivery risks?** Yes, via `getSlaRiskCategories` in the backend, but there is no detailed risk panel in the UI.
*   **See blocked tickets?** No. There is no `BLOCKED` status in the ticket schema.
*   **See review bottlenecks?** Yes, via the dashboard bottlenecks feed.
*   **See stale workdays?** Only in the Live Status tab.
*   **See overloaded members?** Only in the Analytics workload widget.
*   **See pending leave approvals?** Yes, in the Leave page under "Needs Action".

---

## SECTION 3 — ACTIVITY SYSTEM DIAGNOSIS

We audited the event logging flow:
1.  **Event Generation:** Wired for major ticket, leave, workday, settings, and user mutations.
2.  **Event Storage:** Double writes exist (logs are saved in both `activity_logs` and `operational_events`).
3.  **Event Scoping:** Restructured in `EventsController.getEvents()` so non-admins only see scoped department members' activity.
4.  **Event Rendering:** The dashboard and Activity Log render events correctly.
5.  **Event Clickability:** Mapped properly to `/tickets/{id}` and `/leave`. Workday session events return `null` entity links, avoiding 404 navigation failures.

---

## SECTION 4 — DASHBOARD OPERATIONAL COHERENCE

- **Widgets Connected:** All major metric capsules, alerts, upcoming events, and recent activities are populated.
- **Truthful Counts:** Correctly scoped by user department/manager access boundaries. No metrics drift.
- **Drilldowns Working:** Overdue card routes to `/tickets?overdue=true` (hydrates timing-backed filter); pending leave card routes to `/leave`.
- **Gaps Identified:** 
  - "Active Projects" count is now populated, but project status taxonomy is limited.
  - No visual alerts show unclosed worker sessions at the end of the day.

---

## SECTION 5 — WORKDAY UX CONVERGENCE

- **Workday Timer & States:** UI correctly handles WORKING, ON_BREAK, IDLE, OFFLINE, ON_LEAVE states.
- **Logout Prevention:** Topbar and Sidebar handle active workday warnings when users attempt to logout.
- **Midnight Reset:** Stale workdays close cleanly at midnight, saving `logoutAt = 23:59:59` and logging an `AUTO_CLOSE` attendance event.

---

## SECTION 6 — TICKET UX CONVERGENCE

- **Counts Synchronization:** Statistics and board lists share the same scoped query.
- **Kanban Board:** Columns align with the tickets page. Transition matrices are enforced server-side.
- **Blocker Visibility:** Lacks blocker tracking due to missing `BLOCKED` database status.

---

## SECTION 7 — OPERATIONAL PAGE CONNECTIVITY

- **Propagation Paths:** Transitioning a ticket updates the Kanban column immediately, logs an `operational_event`, updates the home metric totals, and notifies assignees.
- **Leave Requests:** Applying leave immediately locks the requested duration from the employee's balance and alerts managers.

---

## SECTION 8 — UX FAILURE DETECTION

- **Team request persistence:** State is reset on page refresh (Frontend local state limitation).
- **Settings history log:** Missing from the UI.
- **Leave balance banner:** Hidden from the employee's view on the Leave request page.

---

## SECTION 9 — PRODUCT COHERENCE
*   **Current Verdict:** **A. One operational company OS.**
*   Following P0/P1/P1-D stabilization, the application functions cohesively under department and role boundaries. The primary areas of fragmentation are localized UI states (directory requests) and redundant database logs.
