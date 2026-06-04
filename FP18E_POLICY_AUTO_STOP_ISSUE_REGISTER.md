# FP18E Policy Auto Stop Issue Register

## Closed Issues (Fixed in FP-18E)

1. **[WRK-P-001] Missing Auto-Stop for Forgotten Same-Day Workdays**
   - **Issue:** The midnight cron successfully cleared out stale sessions from the previous day, but if an employee whose shift ended at 18:30 forgot to log out, the session would continue running falsely racking up hours until midnight.
   - **Fix:** Introduced the `POLICY_AUTO_STOP` engine inside `scheduler.service.ts`, iterating active current-day sessions and closing them specifically at their policy-defined cutoff.
   - **Status:** CLOSED

2. **[WRK-P-002] Role-Agnostic Cutoffs Would Disrupt Managers**
   - **Issue:** Using a naive 18:30 fixed cutoff would improperly log out managers and admins who have flexible or late-night schedules.
   - **Fix:** Built a role-aware `resolvePolicyCutoffForUser` helper. Checks `managerTiming.flexible === true` and securely bypasses policy auto-stop for flexible roles.
   - **Status:** CLOSED

3. **[WRK-P-003] Inflation of Elapsed Work Time After Scheduler Delays**
   - **Issue:** If the cron was set to run at 18:30, but an overload caused it to run at 18:45, using the `Date.now()` execution time would inflate the employee's logged hours by 15 minutes.
   - **Fix:** Forced `logoutAt` and any open `breakLogs.endAt` to equal the exact `cutoffUtc` computed boundary, rather than the cron's execution timestamp. 
   - **Status:** CLOSED

4. **[WRK-P-004] Active Ticket Timer Inflation During Auto-Stop**
   - **Issue:** If a user was forced to logout but had active ticket work timers, the ticket logs would persist indefinitely.
   - **Fix:** Explicitly hooked into `TicketLedgerService` to invoke `pauseActiveLogsForUser` with a `POLICY_AUTO_STOP` reason, capping `endedAt` to the exact cutoff UTC.
   - **Status:** CLOSED

## Pending Issues (None)
- No further work required for FP-18E. The policy-driven engine covers the stated requirements accurately.
