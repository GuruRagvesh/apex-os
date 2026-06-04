# FP18E Policy Auto Stop Report

## Executive Summary
This phase introduced a policy-driven engine that safely and cleanly terminates running workday sessions for users who have forgotten to end their day, leveraging their role-specific configured timings rather than hardcoded heuristics. The engine respects current-day tracking and caps elapsed time accurately to prevent wage/hour inflation.

## 1. Architectural Changes
1.  **Workday Policy Resolver**:
    *   Created `workday.policy.helper.ts` offering safe pure functions: `resolvePolicyCutoffForUser`, `buildCompanyDateTimeUtc`, and `shouldPolicyAutoStop`.
    *   This isolates complex conditional timezone and role matching from the raw scheduler layer, maintaining high testability.

2.  **Scheduler Integration (`scheduler.service.ts`)**:
    *   Injected `SettingsService` to fetch the live company `workday_policy`.
    *   Split the `autoCloseMidnightSessions()` loop logic into two distinct paths:
        *   **Path A: Stale Previous-Day Sessions**. (Legacy logic) Unchanged, captures any dangling sessions from past dates and closes them.
        *   **Path B: Current-Day Policy Auto-Stop**. Iterates over today's active sessions. If `shouldPolicyAutoStop` returns `true`, it gracefully ends the session.

3.  **Cutoff Capping (Crucial Design Choice)**:
    *   Instead of closing a session at the exact moment the scheduler runs (which could inflate hours by 1-15 minutes if the cron is delayed), the session's `logoutAt` and any open `breakLogs.endAt` are explicitly set to the computed `cutoffUtc` (e.g., exactly 18:30:00).
    *   The `calculateWorkdayRuntime` service already computes `elapsed = Math.floor((logoutAt - start) / 60000)`. Thus, capping `logoutAt` naturally truncates total time safely without requiring database schema changes.

## 2. Policy & Role Resolution Implementation
*   **EMPLOYEE / INTERN**: Resolved using `policy.employeeTiming.end`.
*   **TEAM_LEAD**: Resolved using `policy.tlTiming.exitEnd`.
*   **MANAGER / ADMIN / SUPER_ADMIN**: Checks `policy.managerTiming.flexible`. If `true`, the resolver gracefully skips the session, allowing managers to work late without disruption.
*   **Timezone Enforcement**: Utilizes `date-fns-tz` to construct the cutoff Date based on `policy.timezone` mapping, guaranteeing accurate execution even if the server is in UTC.

## 3. Side Effects & Notifications
*   **Ticket Timers**: Automatically paused explicitly via `ticketLedger.pauseActiveLogsForUser(..., 'POLICY_AUTO_STOP')`.
*   **Break Logs**: If a user is on break during the auto-stop, the break log is securely capped to the cutoff boundary and saved with `source: 'POLICY_AUTO_STOP'`.
*   **Notifications**: Emits a `WARNING` tier in-app notification confirming their session was auto-stopped to prevent confusion the following morning.

## 4. Tests Added
*   `test/unit/scheduler.policy.spec.ts` was implemented.
*   Confirmed `EMPLOYEE`, `INTERN`, `TEAM_LEAD` parse correctly.
*   Confirmed `MANAGER` flexibility evaluates to `null`.
*   Confirmed `shouldPolicyAutoStop` boundaries return true/false based on precise company timezone calculations.

## 5. Verification Results
*   The `scheduler` test suite passed cleanly.
*   The `workday` logic inherently complies without regression.
*   The `test:unit` command fully passes.
*   TypeScript builds correctly. No migrations were introduced, keeping the production database perfectly stable.
