# TVA_TICKET_TIME_AUDIT.md

Date: 2026-06-06
Mode: Read-only forensic audit

## Verdict

Ticket time has multiple legitimate domains but lacks a single naming and routing authority:

- SLA/due-state authority: `TicketTimingService`.
- Actual productive/review work authority: `TicketLedgerService` and `TicketTimeLog`.
- Review/rework cycle authority: `ReviewCycleLog`.
- Ticket lifecycle stamps: `Ticket` fields.

The critical issue is that some consumers bypass `TicketTimingService` and calculate overdue or spent time independently.

Risk: Critical for trust in SLA, overdue notifications, digest, and analytics.

## Status Lifecycle Time Fields

| Status/Transition | Timestamp Writes | File |
| --- | --- | --- |
| Create ticket | `createdAt`, optional `dueDate`, `scheduledFor`, `scheduledStartAt`, `scheduledEndAt`, `executionDueAt` | `tickets.service.ts` |
| OPEN -> IN_PROGRESS | `actualStartAt`, possibly `executionDueAt`, starts `TicketTimeLog` | `tickets.service.ts`, `ticket-ledger.service.ts` |
| IN_PROGRESS -> REVIEW | `submittedAt`, `reviewStartedAt`, `reviewDueAt`, starts review cycle/log | `tickets.service.ts`, `ticket-ledger.service.ts` |
| REVIEW -> IN_PROGRESS | clears review stamps, recalculates `executionDueAt`, starts rework flow | `tickets.service.ts` |
| REVIEW -> DONE | `actualCompletedAt`, `closedAt`, `resolvedAt`, ends review cycle | `tickets.service.ts` |
| DONE -> CLOSED | terminal timestamps | `tickets.service.ts` |
| Block | `blockedAt`, `isBlocked`, pauses active logs | `tickets.service.ts`, `ticket-ledger.service.ts` |
| Unblock | clears block fields | `tickets.service.ts` |

## Questions

How is assignee time tracked?

`TicketTimeLog` rows with owner type `ASSIGNEE`, stage `IN_PROGRESS`, `startedAt`, `endedAt`, and `durationSeconds`. Open logs include live seconds in `TicketLedgerService.getTicketTimers`.

How is reviewer time tracked?

`TicketTimeLog` rows with owner type `REVIEWER`, plus `ReviewCycleLog.reviewerWorkSeconds`.

How is rework time tracked?

Review cycles use `reworkStartedAt`, `reworkEndedAt`, cycle number, and assignee/reviewer seconds. Rework also reuses assignee ticket logs after REVIEW -> IN_PROGRESS.

How is SLA time tracked?

Operational SLA state is calculated by `TicketTimingService.getTimingState` from ticket timestamps and SLA settings. It sets `timerType`, `dueAt`, `isOverdue`, and progress.

How is blocked time handled?

`TicketTimingService` treats blocked tickets as `timerType: blocked`, freezes progress at `blockedAt`, and returns `isOverdue: false`. `TicketLedgerService.pauseActiveLogsForUser` can close productive logs when blocked.

How is ticket aging calculated?

There are multiple age calculations:

- `TicketLedgerService.getTicketTimers`: `createdAt` to terminal date or now.
- Analytics page: `Date.now() - createdAt` for open ticket age.
- Ticket detail `SlaTimer`: fallback open age from `createdAt`.
- AI/automation overdue: `Date.now() - createdAt`.

Where is ticket timing stored?

- Lifecycle timestamps are stored on `Ticket`.
- Productive/review durations are stored in `TicketTimeLog.durationSeconds`.
- Review/rework cycle totals are stored in `ReviewCycleLog`.

Where is ticket timing displayed?

- ticket list/card: `TicketRow`, `OverdueTicker`.
- ticket detail: `SlaTimer`, timeline fields, spent-so-far card.
- kanban: scheduled/due visual.
- dashboard/home: overdue, bottleneck, trend, previews.
- analytics: age, SLA, productive hours, reviewer hours.

Where is ticket timing calculated?

- Backend authoritative SLA: `backend/src/common/services/ticket-timing.service.ts`.
- Backend ticket lifecycle: `backend/src/modules/operations/tickets/tickets.service.ts`.
- Backend actual work ledger: `backend/src/modules/operations/tickets/ticket-ledger.service.ts`.
- Backend analytics: `backend/src/modules/platform/analytics/analytics.service.ts`.
- Backend automation/digest: `automation.service.ts`, `ai.cron.service.ts`.
- Frontend fallbacks/display: `frontend/lib/ticket-timing.ts`, ticket detail page, analytics page, ticket visibility helper.

## Critical Findings

### TVA-TK-001: Overdue Notification Uses Created-Age Formula

File: `backend/src/modules/platform/automation/automation.service.ts`

Evidence: daily overdue check calculates `hoursOpen = (Date.now() - createdAt) / 3_600_000`.

Problem: This bypasses `TicketTimingService`, ignores review vs execution due rules, and can notify differently than dashboard/ticket list.

Severity: Critical.

### TVA-TK-002: AI Digest Uses Created-Age Formula

File: `backend/src/modules/ai/ai.cron.service.ts`

Evidence: digest overdue list calculates elapsed from `createdAt` against SLA.

Problem: Digest can report a different overdue set than dashboard.

Severity: Critical.

### TVA-TK-003: Analytics SLA Uses Productive Seconds, Not Operational DueAt

File: `backend/src/modules/platform/analytics/analytics.service.ts`

Evidence: `getSlaAnalytics` compares sum of `TicketTimeLog.durationSeconds` to SLA hours.

Problem: Operational SLA is due-date/window based; analytics SLA is active-work-duration based. Both are useful but must not use the same label without distinction.

Severity: Critical.

### TVA-TK-004: Manager Analytics Overdue Bypasses TicketTimingService

File: `backend/src/modules/platform/analytics/analytics.service.ts`

Evidence: `getManagerMetrics` compares `executionDueAt < new Date()`.

Problem: Ignores blocked timer state and review timer semantics.

Severity: High.

### TVA-TK-005: Frontend Ticket Detail Calculates Spent Time From actualStartAt

File: `frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx`

Evidence: "Spent so far" uses `Date.now() - actualStartAt`.

Problem: It does not subtract breaks, pauses, blocked time, logout time, or ledger pauses. It competes with `TicketTimeLog`.

Severity: Critical.

### TVA-TK-006: Frontend Ticket Timing Fallback Is a Parallel SLA Calculator

File: `frontend/lib/ticket-timing.ts`

Evidence: `computeClientTimingState` uses backend `timing` when present but otherwise recomputes execution/review timer state.

Problem: Latent competing SLA formula.

Severity: High.

## Ticket Time Authority Map

| Metric | Current Best Authority | Competing Sources |
| --- | --- | --- |
| Operational overdue/SLA | `TicketTimingService.getTimingState` | automation, AI digest, analytics manager metrics, frontend fallback |
| Productive assignee seconds | `TicketTimeLog.durationSeconds` via `TicketLedgerService` | ticket detail `actualStartAt -> now` |
| Reviewer seconds | `ReviewCycleLog.reviewerWorkSeconds`, reviewer `TicketTimeLog` | none major |
| Ticket age | `createdAt -> now/terminal` | several UI/service calculations; acceptable if labeled "age" |
| Blocked SLA pause | `TicketTimingService` and ticket block fields | automation/AI digest ignore blocked state |

