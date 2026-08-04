# TVA_ANALYTICS_AUDIT.md

Date: 2026-06-06
Mode: Read-only forensic audit

## Verdict

Analytics recomputes several time metrics independently and does not consistently use the same formulas as dashboard or operational screens.

Risk: Critical for SLA and time trust.

## Analytics Tabs and Origins

| Tab/Metric | Backend File | Source | Formula | Matches Dashboard? | Severity |
| --- | --- | --- | --- | --- | --- |
| Overview total/resolution rate | frontend `analytics/page.tsx`, backend dashboard overview | ticket counts | frontend derives totals/rate from overview stats | Mostly | Low |
| Open ticket age | frontend `analytics/page.tsx` | `Ticket.createdAt` | `Date.now() - createdAt` | Not an SLA metric | Medium |
| Ticket trend | `dashboard.service.ts` | `createdAt`, `resolvedAt` | date buckets | Yes | Low |
| Command center active work | `analytics.service.ts` | `Ticket.updatedAt` | status count since period start | Different from dashboard count | Medium |
| Command center pending approvals | `analytics.service.ts` | `LeaveRequest.createdAt` | pending leaves since period start | Not scoped by leave access | Medium |
| Employee productive hours | `analytics.service.ts` | `TicketTimeLog.durationSeconds` | sum seconds / 3600 | Different from workday hours | Critical if mislabeled |
| Employee average completion | `analytics.service.ts` | ticket count + ticket logs | productive seconds / completed count | Different from actual cycle time | High |
| Reviewer average approval | `analytics.service.ts` | `ReviewCycleLog.reviewerWorkSeconds` | sum/review cycles | Different from review due timer | High |
| Reviewer SLA breach | `analytics.service.ts` | reviewer seconds vs review SLA hours | active reviewer work duration | Different from `reviewDueAt` overdue | Critical |
| Manager overdue | `analytics.service.ts` | `executionDueAt` | `executionDueAt < now` | Does not call `TicketTimingService` | High |
| SLA analytics | `analytics.service.ts` | `TicketTimeLog` | work seconds vs SLA hours | Different from dashboard overdue | Critical |
| Rework analytics | `analytics.service.ts` | `reworkCount` | count/rate | Not a time calculation except cycle fields | Low |

## Backend Analytics Sources

### Employee Metrics

File: `backend/src/modules/platform/analytics/analytics.service.ts`

Source:

- `Ticket.assignedToId` for ticket counts.
- `ReviewCycleLog` for approval/rework decisions.
- `TicketTimeLog.durationSeconds` for productive hours.

Risk:

- Productive hours are ticket-ledger hours, not workday hours.
- Counts rely on primary `assignedToId`, not necessarily all `TicketAssignee` rows.

### Reviewer Metrics

File: `backend/src/modules/platform/analytics/analytics.service.ts`

Source:

- `ReviewCycleLog.reviewerWorkSeconds`.
- review SLA config from `TicketTimingService.getSlaConfig`.
- `new Date()` for today/week buckets.

Risk:

- Reviewer SLA breach uses active reviewer work seconds.
- Operational review overdue uses `reviewDueAt` through `TicketTimingService`.
- These are not the same metric.

### Manager Metrics

File: `backend/src/modules/platform/analytics/analytics.service.ts`

Source:

- department ticket counts.
- overdue count from `executionDueAt < new Date()`.
- blocked ticket count.

Risk:

- Overdue bypasses `TicketTimingService`.
- Ignores blocked timer pause and review timers.
- Placeholder metrics remain for turnaround and rankings.

### SLA Analytics

File: `backend/src/modules/platform/analytics/analytics.service.ts`

Source:

- closed tickets.
- `TicketTimeLog.durationSeconds` for `IN_PROGRESS`.
- SLA config.

Risk:

- Uses active work duration, not due-window elapsed time.
- Can disagree with dashboard and ticket list.

### Command Center

File: `backend/src/modules/platform/analytics/analytics.service.ts`

Source:

- `Ticket.updatedAt` for active work/review/blocked period counts.
- `LeaveRequest.createdAt` for pending approvals.

Risk:

- Period activity is based on `updatedAt`, not actual time spent.
- Leave pending count is not built from `LeaveAccessService` scope.

## Frontend Analytics Sources

File: `frontend/app/(dashboard)/analytics/page.tsx`

Local calculations:

- derives resolution rate from overview stats.
- computes export `dateFrom/dateTo` with browser `new Date()`.
- computes ticket age days with `Date.now() - new Date(t.createdAt).getTime()`.

Risk:

- Age is acceptable only if labeled as age.
- Export range uses browser date, not company date.

## Mismatches

### TVA-AN-001: SLA Analytics Formula Differs From Dashboard

Dashboard overdue uses `TicketTimingService.getTimingState`.

Analytics SLA uses total `TicketTimeLog.durationSeconds` compared to configured SLA hours.

These answer different questions:

- Dashboard: "Is the ticket due/overdue in operational time?"
- Analytics: "How much active logged work time was spent?"

Severity: Critical.

### TVA-AN-002: Reviewer SLA Breach Formula Differs From Review DueAt

Reviewer metrics compare `reviewerWorkSeconds` to review SLA hours. Ticket operational review SLA uses `reviewDueAt` and `TicketTimingService`.

Severity: High.

### TVA-AN-003: Manager Overdue Bypasses TicketTimingService

Manager metrics directly compare `executionDueAt` to `new Date()`. This ignores blocked state and review timers.

Severity: High.

### TVA-AN-004: Analytics Page Calculates Open Ticket Age in Frontend

The analytics page computes age days using `Date.now() - createdAt`. This is acceptable only as "age", not as "SLA" or "time spent".

Severity: Medium.

### TVA-AN-005: Productive Hours Can Be Confused With Workday Hours

Employee productive hours use ticket ledger duration. Workday hours use work sessions and breaks. Both are valid only if separately named.

Severity: High.

## Analytics TVA Classification

| Area | Status |
| --- | --- |
| Ticket counts | Mostly connected |
| SLA analytics | TVA violation |
| Employee productive hours | Valid separate metric, naming risk |
| Reviewer metrics | Valid separate metric, SLA naming risk |
| Workday analytics | Not centralized; no direct workday analytics authority found |
| Frontend official time math | Present for ticket age/export ranges |

## Conclusion

Analytics cannot yet be treated as a trustworthy consumer of one time authority. It has valid raw inputs, but its formulas and labels do not consistently match operational screens.

