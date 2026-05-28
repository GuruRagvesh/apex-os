# Phase Ω — Remaining Gaps

Status: **NO BLOCKING OPERATIONAL UX GAPS**

---

## 1. Redundant Database Models (`activity_logs` vs `operational_events`)
*   **Risk:** The database still maintains the `activity_logs` table, and write actions continue to execute duplicate writes alongside `operational_events`.
*   **Mitigation:** The application uses `operational_events` for feeds, ensuring complete security. Deprecating `activity_logs` can be scheduled for a database hygiene pass.

---

## 2. No Entity Blocker Tracking
*   **Risk:** The `TicketStatus` enum does not contain a `BLOCKED` status, nor is there a dedicated table mapping ticket blockers. Blockers must be manually documented in ticket description text.
*   **Mitigation:** Status is tracked through standard workflow transitions (`OPEN`, `IN_PROGRESS`, `REVIEW`, `DONE`, `CLOSED`). Adding structural blocker schemas requires a future DB migration.

---

## 3. No Standalone Workday History View
*   **Risk:** Workday session events return `null` entity links, so users cannot click them to view a detailed breakdown of a past shift.
*   **Mitigation:** Workday logs are unclickable, avoiding 404 navigation errors. Detailed logs can be audited by managers via the Live Status tab.
