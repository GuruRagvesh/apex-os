# TVA_CLOCK_INVENTORY.md

Date: 2026-06-06
Mode: Read-only forensic audit
Scope: runtime source under `backend/src`, `frontend/app`, `frontend/components`, `frontend/lib`, `frontend/hooks`, plus Prisma schema. Generated folders and old audit documents were excluded from authoritative-clock classification.

## Summary

Apex OS does not currently have one monolithic Time Vigilance Authority. It has several domain clocks:

- Company day boundary: `TimezoneUtil`.
- Workday runtime: `calculateWorkdayRuntime`.
- Ticket SLA state: `TicketTimingService`.
- Ticket work ledger: `TicketLedgerService`.
- Leave duration: `LeaveBalanceService`.
- Frontend display clocks: WorkdayBar, ticket countdowns, ticket age, relative time labels.
- Scheduler clocks: cron jobs that write or report time-sensitive state.

The highest-risk clocks are the ones that calculate the same business metric differently: workday live minutes, ticket overdue/SLA, ticket productive time, and leave duration.

## Clock Inventory

### CLK-001

File: `backend/src/common/utils/timezone.util.ts`

Function: `TimezoneUtil.getCompanyTodayDate`

Purpose: Converts current server time into the company date boundary.

Time Source: `new Date()`, `formatInTimeZone`.

Inputs: optional timezone, default `Asia/Kolkata`.

Outputs: `Date` representing company day.

Consumers: workday service, dashboard service, scheduler.

Risk: High. This is a partial day-boundary authority, but not every date calculation uses it.

### CLK-002

File: `backend/src/common/utils/timezone.util.ts`

Function: `TimezoneUtil.isLate`

Purpose: Compares actual start time to expected role start time.

Time Source: DB `startWorkAt`, configured start time, `toZonedTime`.

Inputs: actual start, expected HH:mm, timezone.

Outputs: boolean late flag.

Consumers: `WorkdayService.getTeam`.

Risk: Medium.

### CLK-003

File: `backend/src/modules/platform/workday/workday.calculation.ts`

Function: `calculateWorkdayRuntime`

Purpose: Calculates elapsed work minutes, break minutes, first start, current end, auto-close count, resumed state, and session count across one user's sessions for a day.

Time Source: DB `WorkSession` and `BreakLog` timestamps plus caller-provided `now`.

Inputs: sessions, `now`.

Outputs: runtime workday summary.

Consumers: `WorkdayService.getToday`, `WorkdayService.getTeam`, `DashboardService.getWorkdayStatus`.

Risk: Low as a function, Critical as an authority. This is the closest current workday TVA.

### CLK-004

File: `backend/src/modules/platform/workday/workday.service.ts`

Function: `startWork`

Purpose: Creates or updates today's `WorkSession`, stamps `loginAt` and `startWorkAt`, sets status `WORKING`, emits attendance event, updates `User.currentStatus`.

Time Source: `new Date()`, company date from `TimezoneUtil`.

Inputs: user ID.

Outputs: `WorkSession`, `AttendanceEvent`, `User.currentStatus`.

Consumers: WorkdayBar, QuickActionDock, API `/workday/start`.

Risk: High. It writes authoritative workday state.

### CLK-005

File: `backend/src/modules/platform/workday/workday.service.ts`

Function: `endWork`

Purpose: Closes open break if present, calculates total break minutes and total work minutes, stamps `logoutAt`, status `LOGGED_OUT`, pauses active ticket logs.

Time Source: `new Date()`, `startWorkAt`, `BreakLog.startAt/endAt`.

Inputs: user ID.

Outputs: stored `totalBreakMinutes`, `totalWorkMinutes`, `logoutAt`.

Consumers: WorkdayBar, EndDayModal, team/history/dashboard.

Risk: Critical. Stored totals can diverge from derived runtime if sessions are mutated later.

### CLK-006

File: `backend/src/modules/platform/workday/workday.service.ts`

Function: `startBreak`

Purpose: Creates open `BreakLog`, sets session and user status to `ON_BREAK`, pauses ticket logs.

Time Source: `new Date()`.

Inputs: break type, estimated minutes.

Outputs: `BreakLog.startAt`, status updates.

Consumers: WorkdayBar, BreakModal, team status.

Risk: High.

### CLK-007

File: `backend/src/modules/platform/workday/workday.service.ts`

Function: `endBreak`

Purpose: Closes open break and increments `WorkSession.totalBreakMinutes`.

Time Source: `new Date()`, `BreakLog.startAt`.

Inputs: current open break.

Outputs: `BreakLog.endAt`, `durationMinutes`, incremented total break minutes.

Consumers: WorkdayBar, team status, ticket ledger resume.

Risk: High.

### CLK-008

File: `backend/src/modules/platform/workday/workday.service.ts`

Function: `reportIdle`

Purpose: Marks today's working session and user as `IDLE` when idle duration is at least 20 minutes.

Time Source: frontend-provided idle duration, `new Date()` for event timestamp by DB.

Inputs: idle duration minutes.

Outputs: `WorkSession.status`, `User.currentStatus`, `AttendanceEvent`.

Consumers: currently API exists, but no runtime frontend consumer found for `useIdleDetection`.

Risk: Medium. Authority depends on client idle signal.

### CLK-009

File: `backend/src/modules/platform/workday/workday.service.ts`

Function: `resumeWork`

Purpose: Sets today's `IDLE`, `ON_BREAK`, or `LOGGED_IN` session back to `WORKING`.

Time Source: `new Date()` for user `lastActiveAt`.

Inputs: user ID.

Outputs: status changes.

Consumers: WorkdayBar, IdlePopup, SessionRecoveryModal, QuickActionDock.

Risk: High.

### CLK-010

File: `backend/src/modules/platform/workday/workday.service.ts`

Function: `resumeAutoClosedWork`

Purpose: Creates a new continuation `WorkSession` after auto-close.

Time Source: `new Date()`.

Inputs: auto-closed old session.

Outputs: new `WorkSession`, `continuationOfSessionId`.

Consumers: WorkdayBar.

Risk: High.

### CLK-011

File: `backend/src/modules/platform/workday/workday.service.ts`

Function: `getToday`

Purpose: Returns latest session plus aggregated runtime result from `calculateWorkdayRuntime`.

Time Source: DB sessions/breaks plus `new Date()`.

Inputs: user ID.

Outputs: `session`, `allSessions`, `elapsedWorkMinutes`, `totalBreakMinutes`.

Consumers: WorkdayBar, topbar/sidebar, dashboard layout.

Risk: Low for backend, High if frontend recalculates over it.

### CLK-012

File: `backend/src/modules/platform/workday/workday.service.ts`

Function: `getTeam`

Purpose: Computes team live status and work minutes for each member.

Time Source: `User.currentStatus`, today's `WorkSession`, `calculateWorkdayRuntime`, late policy.

Inputs: requesting user and role scope.

Outputs: team rows with `workStatus`, `workMinutesToday`, `breakMinutesToday`.

Consumers: `/team` page, TeamPressurePanel.

Risk: High. Status comes from `User.currentStatus`; minutes come from work sessions.

### CLK-013

File: `backend/src/modules/platform/workday/workday.service.ts`

Function: `getHistory`

Purpose: Groups last 60 work sessions by date and summarizes work/break minutes.

Time Source: stored `WorkSession.totalWorkMinutes` and `totalBreakMinutes`.

Inputs: target user.

Outputs: daily history summaries.

Consumers: user detail/profile.

Risk: High. History uses stored totals rather than `calculateWorkdayRuntime` for all cases.

### CLK-014

File: `backend/src/modules/platform/workday/workday.policy.helper.ts`

Function: `buildCompanyDateTimeUtc`, `shouldPolicyAutoStop`

Purpose: Converts policy HH:mm to a cutoff Date and decides auto-stop.

Time Source: `new Date()` for timezone offset, policy timezone, company date string.

Inputs: session, user role, workday policy, current date.

Outputs: auto-stop decision and cutoff.

Consumers: scheduler auto-close.

Risk: High. It can close sessions.

### CLK-015

File: `backend/src/modules/core/auth/auth.service.ts`

Function: `login`

Purpose: On successful login, creates or updates today's `WorkSession` with `loginAt`, creates `LOGIN` event, updates `User.currentStatus`.

Time Source: `new Date()`.

Inputs: login credentials.

Outputs: `WorkSession.loginAt`, `AttendanceEvent`, `User.currentStatus`.

Consumers: auth login.

Risk: Critical. Auth is coupled to attendance/session state.

### CLK-016

File: `backend/src/modules/core/auth/auth.service.ts`

Function: OTP store logic.

Purpose: Stores reset OTP with TTL.

Time Source: `Date.now()`.

Inputs: email, OTP.

Outputs: in-memory expiration.

Consumers: forgot/reset password.

Risk: Low for TVA; auth-only time.

### CLK-017

File: `backend/src/shared/guards/app-throttler.guard.ts`

Function: throttler block tracking.

Purpose: Tracks retry/blocked windows.

Time Source: `Date.now()`.

Inputs: request key, retry after.

Outputs: in-memory blocked-until timestamp.

Consumers: auth/API throttling.

Risk: Low for TVA.

### CLK-018

File: `backend/src/common/services/ticket-timing.service.ts`

Function: `getTimingState`, `decorateTicketWithConfig`

Purpose: Authoritative ticket SLA/timer state.

Time Source: `new Date()`, ticket timestamps, SLA settings.

Inputs: ticket and SLA config.

Outputs: `timerType`, `dueAt`, `remainingMs`, `overdueMs`, `progressPercent`, `isOverdue`.

Consumers: tickets API, dashboard overdue, kanban/list/detail.

Risk: Critical. This should be the ticket TVA.

### CLK-019

File: `backend/src/modules/operations/tickets/ticket-ledger.service.ts`

Function: `getTicketTimers`

Purpose: Calculates ticket total age and productive/reviewer seconds.

Time Source: `Ticket.createdAt`, terminal timestamps, `TicketTimeLog.startedAt/endedAt`, `new Date()` for active logs.

Inputs: ticket, logs.

Outputs: `totalTicketSeconds`, `employeeWorkSeconds`, `reviewerApprovalSeconds`.

Consumers: ticket detail and analytics.

Risk: High. This is a different ticket time domain than SLA.

### CLK-020

File: `backend/src/modules/operations/tickets/ticket-ledger.service.ts`

Function: `startWorkLog`

Purpose: Opens `TicketTimeLog` when ticket work/review starts.

Time Source: `new Date()`.

Inputs: ticket, user, stage, owner type.

Outputs: `TicketTimeLog.startedAt`.

Consumers: `TicketsService` lifecycle, break/logout pause/resume.

Risk: High.

### CLK-021

File: `backend/src/modules/operations/tickets/ticket-ledger.service.ts`

Function: `endActiveLog`, `pauseActiveLogsForUser`

Purpose: Closes ticket logs and calculates `durationSeconds`.

Time Source: input `endedAt` or `new Date()`, log `startedAt`.

Inputs: log/user/ticket.

Outputs: `endedAt`, `durationSeconds`, pause reason.

Consumers: workday end, break start, scheduler auto-close, ticket status transitions.

Risk: Critical. Directly feeds analytics productive time.

### CLK-022

File: `backend/src/modules/operations/tickets/ticket-ledger.service.ts`

Function: `startReviewCycle`, `endReviewCycle`

Purpose: Records review/rework cycle timestamps and aggregates assignee/reviewer seconds.

Time Source: input dates, `new Date()`, `TicketTimeLog.durationSeconds`.

Inputs: ticket and cycle.

Outputs: `ReviewCycleLog` review/rework timestamps and seconds.

Consumers: analytics.

Risk: High.

### CLK-023

File: `backend/src/modules/operations/tickets/tickets.service.ts`

Function: `normalizeDateInput`, `calcExecutionDueAt`

Purpose: Normalizes date inputs and computes execution due dates.

Time Source: input dates and fixed fallback `T13:00:00.000Z`.

Inputs: ticket date fields, estimated minutes.

Outputs: normalized Date/ISO and `executionDueAt`.

Consumers: ticket create/update.

Risk: High.

### CLK-024

File: `backend/src/modules/operations/tickets/tickets.service.ts`

Function: ticket create time precompute.

Purpose: Creates `executionDueAt` only when scheduled start is in future.

Time Source: `Date.now()`, `scheduledStartAt`, `estimatedMinutes`.

Inputs: create DTO.

Outputs: ticket due fields.

Consumers: ticket SLA.

Risk: High.

### CLK-025

File: `backend/src/modules/operations/tickets/tickets.service.ts`

Function: ticket status update stamping.

Purpose: Stamps `actualStartAt`, `submittedAt`, `reviewStartedAt`, `reviewDueAt`, `actualCompletedAt`, `closedAt`, `resolvedAt`, `cancelledAt`.

Time Source: `new Date()`, `Date.now()`.

Inputs: status transition.

Outputs: ticket lifecycle timestamps and review cycle.

Consumers: tickets UI, dashboard, analytics.

Risk: Critical.

### CLK-026

File: `backend/src/modules/operations/tickets/tickets.service.ts`

Function: `blockTicket`, `unblockTicket`

Purpose: Stamps `blockedAt`, pauses ticket logs, clears block fields.

Time Source: `new Date()`.

Inputs: ticket and user.

Outputs: blocked state and history.

Consumers: ticket timing and kanban.

Risk: High.

### CLK-027

File: `backend/src/modules/platform/dashboard/dashboard.service.ts`

Function: `countOverdueTickets`

Purpose: Counts overdue tickets using `TicketTimingService`.

Time Source: ticket timing authority.

Inputs: ticket scope.

Outputs: overdue count.

Consumers: dashboard overview/home.

Risk: Low.

### CLK-028

File: `backend/src/modules/platform/dashboard/dashboard.service.ts`

Function: `getWorkdayStatus`

Purpose: Dashboard workday summary using `calculateWorkdayRuntime`.

Time Source: workday authority plus `new Date()`.

Inputs: user.

Outputs: workday status fields.

Consumers: home/dashboard.

Risk: Low.

### CLK-029

File: `backend/src/modules/platform/dashboard/dashboard.service.ts`

Function: `getUpcomingEvents`, `getTicketTrend`, `getPreviews`

Purpose: Computes upcoming ticket/leave dates, trend buckets, leave preview duration.

Time Source: `new Date()`, ticket/leave timestamps.

Inputs: user scope, days.

Outputs: event and trend arrays.

Consumers: home/dashboard.

Risk: Medium. Leave duration duplicate exists here.

### CLK-030

File: `backend/src/modules/platform/analytics/analytics.service.ts`

Function: `getEmployeeMetrics`

Purpose: Computes productive hours from ticket time logs.

Time Source: `TicketTimeLog.durationSeconds`.

Inputs: target user.

Outputs: productive hours and average completion seconds.

Consumers: analytics page.

Risk: High. Different metric from workday minutes.

### CLK-031

File: `backend/src/modules/platform/analytics/analytics.service.ts`

Function: `getReviewerMetrics`

Purpose: Computes approval time and SLA breach rate from review cycles.

Time Source: `ReviewCycleLog.reviewerWorkSeconds`, review SLA config, `new Date()` for today/week.

Inputs: target reviewer.

Outputs: approval seconds and breach counts.

Consumers: analytics page.

Risk: High.

### CLK-032

File: `backend/src/modules/platform/analytics/analytics.service.ts`

Function: `getManagerMetrics`

Purpose: Counts overdue tickets by comparing `executionDueAt` to `new Date()`.

Time Source: `new Date()`, `executionDueAt`.

Inputs: department scope.

Outputs: overdue count.

Consumers: analytics page.

Risk: High. Does not call `TicketTimingService`, so blocked/review/open semantics can drift.

### CLK-033

File: `backend/src/modules/platform/analytics/analytics.service.ts`

Function: `getSlaAnalytics`

Purpose: Computes SLA breach from actual `TicketTimeLog` work seconds vs SLA hours.

Time Source: ticket ledger durations and SLA config.

Inputs: closed tickets.

Outputs: SLA percentages.

Consumers: analytics page.

Risk: Critical. This is not the same formula as operational overdue.

### CLK-034

File: `backend/src/modules/platform/analytics/analytics.service.ts`

Function: `getCommandCenter`

Purpose: Period buckets for active work, active review, blocked, approvals.

Time Source: `new Date()`, `updatedAt`, `createdAt`.

Inputs: period.

Outputs: counts.

Consumers: analytics page.

Risk: Medium.

### CLK-035

File: `backend/src/modules/platform/automation/automation.service.ts`

Function: `checkOverdueTickets`

Purpose: Daily overdue notification.

Time Source: `Date.now()`, `Ticket.createdAt`, SLA config.

Inputs: open tickets.

Outputs: notifications.

Consumers: assigned users.

Risk: Critical. Competes with `TicketTimingService`.

### CLK-036

File: `backend/src/modules/ai/ai.cron.service.ts`

Function: `sendDailyDigest`

Purpose: Daily digest and overdue list.

Time Source: `new Date()`, `Date.now()`, `Ticket.createdAt`, SLA config.

Inputs: tickets and leave.

Outputs: manager digest email.

Consumers: managers/admins.

Risk: Critical. Competes with `TicketTimingService`.

### CLK-037

File: `backend/src/modules/platform/scheduler/scheduler.service.ts`

Function: `checkScheduledTickets`

Purpose: Hourly scheduled and recurring ticket reminders.

Time Source: cron schedule, `new Date()`, `scheduledFor`, `scheduleEndDate`, `createdAt`.

Inputs: tickets.

Outputs: notifications.

Consumers: assigned users.

Risk: Medium.

### CLK-038

File: `backend/src/modules/platform/scheduler/scheduler.service.ts`

Function: `setLeaveStatuses`

Purpose: Midnight leave session/status setter and non-leave reset to `OFFLINE`.

Time Source: cron schedule, `new Date()` set to midnight.

Inputs: approved leaves.

Outputs: work sessions and user statuses.

Consumers: team status/workday.

Risk: Critical. Writes attendance state.

### CLK-039

File: `backend/src/modules/platform/scheduler/scheduler.service.ts`

Function: `autoCloseMidnightSessions`

Purpose: Every 15 minutes, closes stale/policy-stopped sessions and ticket logs.

Time Source: cron schedule, `new Date()`, policy cutoff, session dates.

Inputs: open sessions and policy.

Outputs: `logoutAt`, `autoClosed`, `totalWorkMinutes`, `totalBreakMinutes`, user status.

Consumers: workday/history/team/dashboard/analytics.

Risk: Critical.

### CLK-040

File: `backend/src/modules/platform/scheduler/scheduler.service.ts`

Function: `workdayEndReminder`

Purpose: 6:30 PM reminder.

Time Source: cron schedule.

Inputs: users with current status working/break/idle.

Outputs: notifications.

Consumers: users.

Risk: Low.

### CLK-041

File: `backend/src/modules/platform/scheduler/scheduler.service.ts`

Function: `autoLogoutInactive`

Purpose: Hourly idle auto-logout between 9 and 20 server hour.

Time Source: `new Date().getHours()`, `Date.now()`, `lastActiveAt`.

Inputs: idle users.

Outputs: `User.currentStatus OFFLINE`, `WorkSession.status LOGGED_OUT`, `logoutAt`.

Consumers: team/workday.

Risk: Critical. Logout can affect attendance.

### CLK-042

File: `backend/src/modules/operations/leave/leave-balance.service.ts`

Function: `calculateLeaveDuration`

Purpose: Counts leave days excluding Sunday and configured holidays.

Time Source: `new Date(start/end)`, working-days setting.

Inputs: start/end, half-day.

Outputs: duration days.

Consumers: leave balance and validation.

Risk: High.

### CLK-043

File: `frontend/components/workday/WorkdayBar.tsx`

Function: live elapsed effect.

Purpose: Displays active work/break elapsed timer.

Time Source: `Date.now()`, backend `elapsedWorkMinutes`, `firstStartTime`, breaks.

Inputs: `workdayApi.getToday`.

Outputs: UI elapsed label.

Consumers: user.

Risk: Critical. It adds a frontend delta to backend elapsed and can double count.

### CLK-044

File: `frontend/components/workday/EndDayModal.tsx`

Function: local elapsed display.

Purpose: Shows worked time before ending day.

Time Source: `Date.now()`, `session.startWorkAt`, `session.totalBreakMinutes`.

Inputs: session prop.

Outputs: modal elapsed estimate.

Consumers: user.

Risk: High. Frontend official-seeming work time calculation.

### CLK-045

File: `frontend/hooks/useIdleDetection.ts`

Function: idle timers.

Purpose: Detects idle/warning/suggest thresholds.

Time Source: `new Date()`, `Date.now()`, `setTimeout`, `setInterval`.

Inputs: browser activity.

Outputs: callbacks.

Consumers: no runtime consumer found.

Risk: Medium latent.

### CLK-046

File: `frontend/components/workday/WorkdayHistoryStrip.tsx`

Function: history display.

Purpose: Displays stored work and break minutes from backend summaries.

Time Source: backend history; local `new Date()` for today detection.

Inputs: workday history.

Outputs: UI.

Consumers: user/profile.

Risk: Medium.

### CLK-047

File: `frontend/app/(dashboard)/(operations)/team/page.tsx`

Function: `checkStale`, `fmtTime`.

Purpose: Team live status stale detection and time formatting.

Time Source: `new Date()`, `formatInTimeZone`.

Inputs: team API rows.

Outputs: team status labels.

Consumers: managers/team leads/admins.

Risk: Medium.

### CLK-048

File: `frontend/components/ui/QuickActionDock.tsx`

Function: action status decisions.

Purpose: Enables/disables workday actions.

Time Source: persisted `user.currentStatus`; no live time query.

Inputs: auth store user.

Outputs: UI state/actions.

Consumers: user.

Risk: High. Uses stale status source.

### CLK-049

File: `frontend/lib/ticket-timing.ts`

Function: `computeClientTimingState`

Purpose: Client-side ticket timer, using backend `timing` when present and fallback formula otherwise.

Time Source: `Date.now()`, ticket due fields.

Inputs: ticket object.

Outputs: client timing state.

Consumers: `OverdueTicker`.

Risk: Critical as fallback. It is a competing ticket timer if backend `timing` is absent.

### CLK-050

File: `frontend/components/tickets/OverdueTicker.tsx`

Function: ticking countdown.

Purpose: Recomputes client timing every interval.

Time Source: `setInterval`, `computeClientTimingState`.

Inputs: ticket.

Outputs: UI countdown.

Consumers: ticket list/detail.

Risk: High.

### CLK-051

File: `frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx`

Function: `SlaTimer`.

Purpose: Displays SLA label and open age fallback.

Time Source: `Date.now()`, `createdAt`, backend `timing`.

Inputs: ticket.

Outputs: UI SLA display.

Consumers: ticket detail.

Risk: High.

### CLK-052

File: `frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx`

Function: execution duration display.

Purpose: Shows "Took" and "Spent so far" from `actualStartAt` and completion/current time.

Time Source: `Date.now()`, `actualStartAt`, `actualCompletedAt`.

Inputs: ticket.

Outputs: UI work duration.

Consumers: ticket detail.

Risk: Critical. Competes with `TicketTimeLog` productive seconds.

### CLK-053

File: `frontend/lib/ticket-visibility.ts`

Function: `computeOverdueDisplay`

Purpose: Computes overdue display from due date.

Time Source: `Date.now()`, due fields.

Inputs: due/status.

Outputs: overdue text and severity.

Consumers: visibility helpers.

Risk: High latent.

### CLK-054

File: `frontend/app/(dashboard)/analytics/page.tsx`

Function: ticket age table and export range.

Purpose: Computes open ticket age by `createdAt` and CSV date range.

Time Source: `Date.now()`, `new Date()`.

Inputs: all tickets.

Outputs: analytics UI/export.

Consumers: analytics users.

Risk: Medium. Ticket age is distinct from SLA, but must be labeled clearly.

### CLK-055

File: `frontend/app/(dashboard)/(operations)/tickets/page.tsx`

Function: due-today filter.

Purpose: Builds local start/end of today.

Time Source: browser `new Date()`.

Inputs: query string.

Outputs: dueAfter/dueBefore filters.

Consumers: tickets list.

Risk: Medium. Browser timezone can differ from company timezone.

### CLK-056

File: `frontend/app/(dashboard)/(operations)/tickets/new/page.tsx`

Function: schedule date defaults/min fields.

Purpose: Sets scheduled recurrence end, min due/scheduled dates, converts custom schedule.

Time Source: browser `new Date()`.

Inputs: form state.

Outputs: API payload dates.

Consumers: ticket create.

Risk: Medium.

### CLK-057

File: `frontend/app/(dashboard)/(operations)/leave/page.tsx`

Function: `getLeaveDuration`, `getConflicts`.

Purpose: Client-side leave duration and overlap display.

Time Source: browser `new Date()`.

Inputs: leave rows.

Outputs: UI duration/conflicts.

Consumers: leave page.

Risk: High. Duplicates backend leave duration rules but lacks holidays/policy.

### CLK-058

File: `frontend/app/(dashboard)/calendar/page.tsx`

Function: calendar event date mapping.

Purpose: Maps tickets/leaves/events to calendar dates.

Time Source: browser `new Date()`, UTC date construction.

Inputs: event/ticket/leave API data.

Outputs: calendar entries.

Consumers: calendar page.

Risk: Medium.

### CLK-059

File: `frontend/lib/utils.ts`, `frontend/lib/date-utils.ts`

Function: `formatDate`, `formatRelativeTime`, IST formatting.

Purpose: Date presentation and relative labels.

Time Source: `new Date()`, `Date.now()`, fixed IST offset.

Inputs: dates.

Outputs: UI labels.

Consumers: many frontend pages/components.

Risk: Medium. Display-only but can differ by timezone/offset method.

### CLK-060

File: `frontend/components/home/RecentActivityFeed.tsx`, `frontend/components/dashboard/activity-item.tsx`, `frontend/components/home/UpcomingEvents.tsx`

Function: relative/upcoming labels.

Purpose: Human-readable event time labels.

Time Source: `Date.now()`, `new Date()`.

Inputs: backend timestamps.

Outputs: UI labels.

Consumers: home/dashboard.

Risk: Low if display-only.

