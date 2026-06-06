# FP-13 Employee Bug Priority Board

| Priority | Component | Bug / Gap | Impact | Recommended Safe Fix | Type |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P0** | **Timers** | Ticket SLA continues while Employee is on Break or Logged Out. | Severe trust issue. Penalizes employees for valid breaks. | Hook into Workday events to pause/resume `executionDueAt`. Add `TicketTimeLog`. | Code + Migration |
| **P0** | **Timers** | Closed tickets can be reopened or edited. | Violates audit trails and data integrity. | Add strict guard in `tickets.service.ts` rejecting any updates to CLOSED tickets. | Code |
| **P1** | **Workflow** | Employees can submit/complete tickets while actively on break. | Operational mismatch. | Add validation in `updateStatus` rejecting DONE/REVIEW if user `currentStatus === 'ON_BREAK'`. | Code |
| **P1** | **Workflow** | Review cycles are overwritten instead of stored. | Cannot calculate delay blame accurately. | Create `ReviewCycleLog` model. Log start, end, decision, and time taken. | Code + Migration |
| **P1** | **Workflow** | Missing `reworkCount` tracking. | Prevents TLs from identifying quality issues. | Add `reworkCount` to `Ticket` schema, increment on REVIEW -> IN_PROGRESS. | Code + Migration |
| **P2** | **Permissions**| Employees can theoretically edit protected fields via API. | Security/Audit risk. | Ensure DTO whitelist strips system/timer fields for non-admin users in `update`. | Code |
| **P2** | **Workday** | Forgotten close-day sessions never auto-close. | Analytics anomalies. | Add a daily cron job to force-close abandoned sessions at 11:59 PM. | Code |
| **P2** | **Analytics** | No centralized analytics aggregation. | Dashboards lack deep insights. | Create `AnalyticsSnapshot` schema and module. | Code + Migration |
| **P3** | **Workday** | Break reasons are not captured. | Hard to audit excess breaks. | Add `reason` to `startBreak` DTO and enforce it. | Code |
