# Apex OS Dashboard Command Center Audit

This document audits the reality of the dashboard and home summary interfaces in Apex OS to assess their visual completeness, routing accuracy, and telemetry integration.

## 1. Which dashboard cards are real?
The dashboard uses two primary sources of data:
1. `GET /api/home/summary` (hydrates `summary` state: `metrics`, `criticalAlerts`, `workdayStatus`, `upcomingEvents`).
2. `GET /api/dashboard/overview` (hydrates `overview` state: `myTickets` list used in the Bottlenecks section).

### Active Dashboard Cards:
* **KPI Capsules**:
  * *Employee/Intern*: Open Tickets, In Progress, In Review, Done This Week.
  * *Team Lead*: Team Tickets, Overdue, Pending Reviews, Team Online.
  * *Manager*: Dept Tickets, Overdue, Pending Leave, Team Size.
  * *Admin/Super Admin*: Active Today, Open Tickets, Overdue, Pending Leave.
* **Command Dock Cards**:
  * *Card 1 (high-priority)*: "In Review" for employees, "Overdue Tickets" for TL/Manager/Admin.
  * *Card 2 (active-projects)*: Active Projects for all roles.
  * *Card 3 (pending-leave)*: Pending leave count (TL/Manager/Admin only).
  * *Card 4 (in-review)*: In Review count (Employee/Intern only).

---

## 2. Which cards show 0 because API says 0?
* **Pending Leave**: If there are no pending leaves in the database (or user scope), it shows `0` pending leave requests.
* **Overdue Tickets**: If there are no overdue tickets, it shows `0`.
* **Active Projects**: If there are no active projects associated with the user/department, it shows `0`.

---

## 3. Which cards show 0 because frontend reads wrong field?
* **Overdue Tickets / In Review redundancy**: For Employees/Interns, Card 1 shows "In Review" but Card 4 is also "In Review" (both show `metrics.inReview`). This creates duplicate widgets.
* Additionally, employees do not have their `overdue` tickets calculated or returned in the `/api/home/summary` metrics payload, so if an employee has overdue tickets, it cannot be displayed on their dashboard.
* **Active Projects**: The KPI capsules do not display Active Projects for some roles (only Command Card does).

---

## 4. Which widgets use stale or wrong endpoint?
* **Recent Activity Feed**: It fetches from `${process.env.NEXT_PUBLIC_API_URL}/events?limit=15` directly via raw `fetch` and custom token retrieval, bypasses the standard `dashboardApi` client, and manually computes the `timeAgo` string instead of leveraging the backend format if available.
* **Home Summary**: Fetches `/home/summary` via raw `fetch` rather than through the `dashboardApi` Axios wrapper.

---

## 5. Which cards have broken drilldowns?
* **Active Staff/Team Online**: Drills down to `/team` instead of `/team?tab=live-status`. The `team/page.tsx` component is completely unaware of query parameters, so passing `tab=live-status` has no effect.
* **Leave Requests**: Drills down to `/leave` instead of `/leave?tab=needs-action`. The `leave/page.tsx` component is also unaware of query parameters and defaults to showing personal requests for employees, meaning leads/managers wouldn't land on their required action tab dynamically.
* **Active Projects**: Drills down to `/projects` instead of `/projects?status=ACTIVE`. The projects list displays all projects regardless of status query parameters.

---

## 6. Which widgets are empty because backend has no events?
* **Telemetry Hover Previews**: Every `CommandCard` is passed `previewItems={[]}` because the backend summary API does not return telemetry previews (overdue list, active projects list, leave request list, review tickets list). As a result, the hover preview panels are completely empty.

---

## 7. Which empty states are misleading?
* **Bottlenecks & SLA Risk**: The widget relies on client-side filtering of `overview.myTickets`. However, `overview.myTickets` is capped at `take: 5` in the backend. If the 5 most recently updated tickets are completed (`DONE`/`CLOSED`), the Bottlenecks list will show "No critical bottlenecks" even if there are older open overdue tickets in the system.

---

## 8. Which role sees which dashboard fields?

| Dashboard Element | Employee / Intern | Team Lead | Manager | Admin / Super Admin |
| :--- | :--- | :--- | :--- | :--- |
| **KPI Capsules** | Open, In Progress, In Review, Done This Week | Team Tickets, Overdue, In Review, Team Online | Dept Tickets, Overdue, Pending Leave, Team Size | Active Staff, Open Tickets, Overdue, Pending Leave |
| **Card 1 (High Priority)** | In Review | Overdue Tickets | Overdue Tickets | Overdue Tickets |
| **Card 2 (Active Projects)** | Active Projects | Active Projects | Active Projects | Active Projects |
| **Card 3 (Pending Leave)** | Hidden | Pending Leave | Pending Leave | Pending Leave |
| **Card 4 (In Review)** | In Review | Hidden | Hidden | Hidden |
| **SLA Risk Banner** | Hidden | Visible | Visible | Visible |
