# TVA_SCHEDULER_AUDIT.md

Date: 2026-06-06
Mode: Read-only forensic audit

## Verdict

Scheduler is a major time writer. It can create, close, and mutate workday state and can send time-based ticket notifications. It is not merely a notification layer.

Risk: Critical.

## Scheduler Jobs

| Job | Schedule | Timezone | Inputs | Outputs | Failure Risks |
| --- | --- | --- | --- | --- | --- |
| Scheduled ticket reminders | `0 * * * *` hourly | server timezone | `scheduledFor`, `scheduleRecurring`, `createdAt`, `scheduleEndDate` | notifications | missed reminders, duplicate recurring checks, server timezone drift |
| Leave status setter | `1 0 * * *` | server timezone | approved leave date ranges | work sessions `ON_LEAVE`, user status `ON_LEAVE`, non-leave users `OFFLINE` | wrong company day if server timezone differs; status reset conflicts |
| Workday auto-close | `*/15 * * * *` | policy timezone + server cron | open work sessions, policy cutoff | closes sessions, breaks, ticket logs, user status | incorrect closure, missed closures if Render sleeps, historical corruption |
| Workday end reminder | `30 18 * * 1-6` | server timezone | users working/break/idle | notifications | wrong local time if server timezone differs |
| Auto logout inactive | `0 * * * *` hourly | server timezone | `User.currentStatus`, `lastActiveAt` | user offline, session `LOGGED_OUT`, `logoutAt` | can close active sessions incorrectly |
| Overdue ticket check | `0 9 * * *` | server timezone | open tickets, SLA settings | overdue notifications | uses createdAt formula, diverges from `TicketTimingService` |
| AI daily digest | `0 18 * * *` | server timezone | tickets/leaves/SLA settings | email digest | uses createdAt formula, diverges from dashboard |

## Exact Files

- `backend/src/modules/platform/scheduler/scheduler.service.ts`
- `backend/src/modules/platform/automation/automation.service.ts`
- `backend/src/modules/ai/ai.cron.service.ts`
- `backend/src/app.module.ts` with `ScheduleModule.forRoot()`

## Can Scheduler Create Incorrect Workday States?

Yes.

Reasons:

- `setLeaveStatuses` creates or updates work sessions at server midnight and resets non-leave users to `OFFLINE`.
- `autoCloseMidnightSessions` closes every open session using policy/company date logic.
- `autoLogoutInactive` closes idle sessions based on `User.currentStatus` and `lastActiveAt`.
- Production historical forensics show workday anomalies still exist.

## Can Scheduler Close Active Sessions Incorrectly?

Yes.

Risk paths:

- Server timezone cron schedule may not align with company timezone.
- `autoLogoutInactive` uses server hour and last active status, not a verified current work session heartbeat.
- Render sleep can skip expected auto-close runs.
- Policy cutoff logic relies on session anchor and configured policy.

## Can Scheduler Create Duplicate Calculations?

Yes.

Examples:

- `autoCloseMidnightSessions` calculates `totalWorkMinutes`.
- `WorkdayService.endWork` calculates `totalWorkMinutes`.
- `calculateWorkdayRuntime` calculates live elapsed minutes.
- Automation and AI digest calculate overdue independently of dashboard/ticket timing.

## Scheduler Violations

| ID | Violation | Severity |
| --- | --- | --- |
| TVA-SCH-001 | Auto-close writes authoritative workday end/totals separately from manual end code. | Critical |
| TVA-SCH-002 | Auto-logout can stamp `logoutAt` based on idle status. | Critical |
| TVA-SCH-003 | Leave status setter resets non-leave users to `OFFLINE`. | High |
| TVA-SCH-004 | Overdue notification uses createdAt-age formula. | Critical |
| TVA-SCH-005 | AI digest uses createdAt-age formula. | Critical |
| TVA-SCH-006 | Cron reliability is unverified if Render service sleeps. | High |

## Production Note

Production backend API routing was previously observed returning 404 for checked routes. Scheduler deploy/runtime status therefore remains unverified from HTTP health checks. Historical DB data confirms anomalies exist, but does not prove whether the latest scheduler code is running correctly.

