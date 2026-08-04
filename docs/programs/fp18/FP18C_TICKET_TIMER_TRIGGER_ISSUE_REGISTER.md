# FP-18C Ticket Timer Trigger Issue Register

| ID | Scenario | Expected | Actual (Pre-Fix) | Severity | Root Cause | Fix Required | Status |
|---|---|---|---|---|---|---|---|
| 1 | Ticket start tracking (`OPEN` → `IN_PROGRESS`) | ASSIGNEE timer starts | Timer did not start | P0 | `startWorkLog` hook missing in `tickets.service.ts` | Inject `ticketLedger` and hook `startWorkLog` on transition. | **FIXED** |
| 2 | Ticket review (`IN_PROGRESS` → `REVIEW`) | ASSIGNEE timer ends, REVIEWER starts | Timers did not toggle | P0 | Lifecycle hooks missing | Wire `endActiveLog` and `startWorkLog` to `REVIEW` transition. | **FIXED** |
| 3 | Ticket approval/rejection (`REVIEW` → `DONE` / `OPEN`) | REVIEWER timer ends | Timer remained active | P0 | Lifecycle hooks missing | Wire `endActiveLog` to `DONE`, `CLOSED`, and `OPEN` transitions. | **FIXED** |
| 4 | Employee starts break | Active ASSIGNEE logs pause | Logs kept running | P0 | Missing `pauseActiveLogsForUser` | Hook `startBreak` in `workday.service.ts`. | **FIXED** |
| 5 | Employee ends break | Active `IN_PROGRESS` logs resume | Logs never paused/resumed | P0 | Missing `resumeLogsForBreak` | Hook `endBreak` in `workday.service.ts`. | **FIXED** |
| 6 | Employee logs out | Active ASSIGNEE logs pause | Logs kept running until auto-close | P0 | Missing `pauseActiveLogsForUser` | Hook `endWork` in `workday.service.ts`. | **FIXED** |
| 7 | Employee logs in next day | Ticket timers optionally resume | Timers do not auto-resume | P3 | Requires user to manually open/start tickets | Leave as-is (complies with rule: do not blindly resume timers). | LOGGED |
| 8 | Auto-close execution | Active ASSIGNEE logs pause for stale sessions | N/A (this was already implemented correctly) | - | N/A | None (verified logic in `scheduler.service.ts`). | VERIFIED |
