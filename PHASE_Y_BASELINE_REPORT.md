# Phase Y - Post Phase X Operational Context Convergence Baseline Report

This report documents the current visibility of operational context across Apex OS. It outlines what data exists but is hidden, identifies "dead" versus rich screens, highlights role-scoping gaps, and details the safe UX improvements to implement.

---

## 1. What Operational Context is Currently Visible
- **Tickets List**: Displays basic attributes: Title, Ticket ID, Category, Priority, Status, Assignee Initials (but not full name), raw overdue status badge, scheduled date ranges, and a basic SLA percentage bar.
- **Ticket Detail**: Displays description, assignee selection dropdown, creator name, category, priority, SLA timers, attachments list, comments timeline, and AI suggestion panels.
- **Kanban Board**: Displays column boards for `OPEN`, `IN_PROGRESS`, `REVIEW`, and `DONE` statuses. Cards contain title, priority, category, assignee initials, due date, and SLA bar.
- **Leave Management**: Shows a list of leave requests containing applicant, leave type, date range, and current status.
- **Projects**: Basic details showing name, description, and status.
- **Activity Log**: Displays timelines mapped from operational events with actor name, action string, and timestamp.
- **Workday Live Status**: Shows live status (Working, On Break, Idle, Offline) with calculated work/break minutes.

---

## 2. What Backend Operational Context Exists but is Not Shown
- **Ticket Lists & Kanban**: Full assignee names, reporter names, latest updates, latest comment previews, and department relations are omitted or hidden.
- **Leave Decisions**: Under the hood, the backend leave request contains user records, roles, departments, overlapping leaves, and balance calculations. However, the approval UI hides leave balances (before/after), requester departments/roles, and overlap warnings.
- **Projects**: Project lists do not show open, overdue, or in-review ticket counts, nor do they summarize project ticket health or estimated completion ratios.
- **Activity Feed**: Interactive page links, related ticket tags, and rich descriptions of the entity modified are missing.

---

## 3. Which Pages Still Feel "Dead"
- **Leave Approval Screen**: Feels like a basic admin table. Approvers make decisions blindly without knowing context, overlapping dates of other department members, or balance limits.
- **Projects Page**: Shows static descriptions. It does not communicate active workloads, risks, or real-time project progress.
- **Kanban Board**: Cards look uniform; overdue items do not grab attention, and finished items resemble active work too closely.

---

## 4. Which Pages Feel Operationally Rich
- **Ticket Detail Page**: Features rich comment threads, status progression flows, SLA decorators, file attachments, history/timeline tracking, and AI-driven workflow suggestions.

---

## 5. Which Workflows Lack Urgency/Context
- **Overdue Tickets**: Lack distinct visual flags or explanations explaining why the SLA breached (e.g., overdue minutes, SLA progression rates).
- **Reviews**: It is unclear who is reviewing tickets or what feedback is waiting on them.
- **Leave Actions**: Read-only restrictions are not explained (e.g., why a manager cannot approve a request from another department).

---

## 6. Which Role-Specific Views Still Feel Unclear
- Users are presented with scoped data without knowing why they are restricted. A Team Lead, Manager, or Employee should have clear context labels indicating their active department or scoping boundaries.

---

## 7. Which Empty States Feel Fake/Confusing
- Standard "No data found" messages do not guide users on the next step (e.g., creating a ticket, starting a workday, or adjusting filters).

---

## 8. Which UX Issues are Safe Frontend-only Fixes
- Enhancing card badges, borders, and layouts.
- Adding tooltip descriptions and SLA timeline graphs.
- Rendering context headers (e.g., scope labels).
- Customizing empty states and adding next-action buttons.

---

## 9. Which UX Issues Require Backend/API Additions
- None. The backend models (`user`, `ticket`, `department`, `project`, `leaveRequest`, `operational_events`) already provide the necessary data inside current endpoints.

---

## 10. Which Screens Still Feel Like Admin Templates
- **Leave List**: Lacks visual color-coding, contextual metrics, and impact metrics.
- **Project List**: Consists of simple boxes instead of tracking live progress and risk.
