# Apex OS Operational Convergence Priority Matrix

This document prioritizes the remaining gaps and disconnects identified in the Apex OS audit to ensure absolute operational trust.

---

## P0 — Operational Trust & Workflow Disconnects
*Critical items affecting data integrity, workflow correctness, or breaking basic business processes.*

| Issue ID | Area | Description | Impact |
| --- | --- | --- | --- |
| **P0-01** | Team Directory | **Roster Request Persistence Gap**<br>Adding team members from the directory only updates local React state and is lost on page reload. | Users think requests are pending, but reload resets them, causing confusion. |
| **P0-02** | Notifications | **Notification Template Hardcoding**<br> Roster add notifications hardcode the "AI & R&D team" as the department name regardless of the actual department. | Users see the wrong department name in alerts, breaking trust. |
| **P0-03** | Event Logging | **Parallel Redundant Event Logs**<br>Legacy `activity_logs` and unified `operational_events` write duplicate entries, adding database overhead. | Redundant database queries and model maintenance. |

---

## P1 — Operational Visibility & Manager Intelligence
*Items that limit the capability of managers and leads to oversee workloads and track team performance.*

| Issue ID | Area | Description | Impact |
| --- | --- | --- | --- |
| **P1-01** | Ticket Lifecycle | **No Blocker Status or Blocker Tracking**<br>No `BLOCKED` ticket status exists in the database `TicketStatus` enum. Blockers must be described manually in descriptions. | Managers cannot easily query or view currently blocked tickets. |
| **P1-02** | Workday | **No Standalone Workday History View**<br>Clicking workday events does not redirect to a detailed workday log/timeline calendar view. | Limited visibility for HR and Managers to audit historical workday sessions. |
| **P1-03** | Leave | **Leave Balance Display Missing**<br>Leave request forms do not display remaining yearly leave allocations/balances directly in the UI. | Employees apply for leave blindly without knowing their remaining balance. |

---

## P2 — UX Polish & Advanced Summaries
*Quality-of-life adjustments, cleanups, and non-blocking enhancements.*

| Issue ID | Area | Description | Impact |
| --- | --- | --- | --- |
| **P2-01** | Feeds | **Unmapped Event Labels in Feeds**<br>Some operational actions rely on fallback string replacements rather than being mapped explicitly. | Minor visual formatting inconsistency. |
| **P2-02** | Settings | **No Settings Change History UI**<br>Although `SETTINGS_UPDATED` is logged, there is no history view in settings. | Administrators cannot easily audit settings modifications. |
