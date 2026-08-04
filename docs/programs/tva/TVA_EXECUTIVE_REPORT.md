# TVA_EXECUTIVE_REPORT.md

Date: 2026-06-06
Mode: Read-only forensic audit
Project: Apex OS
Audit: FP-20A - Time Vigilance Authority

## Core Question

Does Apex OS have one authoritative time system or multiple competing clocks?

## Verdict

Apex OS currently has multiple competing clocks.

There are good domain authorities in the backend, especially `calculateWorkdayRuntime` for workday runtime and `TicketTimingService` for ticket SLA. However, those authorities are not universally enforced. Several backend jobs, analytics methods, and frontend components recompute official-looking time metrics independently.

Risk Rating: Critical Risk.

Reason: users can see or receive different answers for worked minutes, ticket overdue status, productive time, leave duration, and team status depending on which screen/job/report they use.

## Current Authoritative Sources

| Domain | Current Best Authority | Status |
| --- | --- | --- |
| Company date | `TimezoneUtil.getCompanyTodayDate` | Partial |
| Workday live minutes | `calculateWorkdayRuntime` | Partial |
| Stored workday totals | `WorkSession.totalWorkMinutes`, `totalBreakMinutes` | Contaminated by historical anomalies |
| Team status | `User.currentStatus` plus `WorkSession` | Split |
| Ticket operational SLA | `TicketTimingService.getTimingState` | Partial |
| Ticket productive time | `TicketLedgerService` / `TicketTimeLog` | Partial |
| Review/rework time | `ReviewCycleLog` | Partial |
| Leave duration | `LeaveBalanceService.calculateLeaveDuration` | Partial |
| Scheduler time | Nest cron jobs | Multiple writers |
| Historical reports | stored DB values | Not fully trustworthy |

## Does a TVA Already Exist?

No complete TVA exists.

The closest partial TVAs are:

- `backend/src/modules/platform/workday/workday.calculation.ts`
- `backend/src/common/services/ticket-timing.service.ts`
- `backend/src/modules/operations/tickets/ticket-ledger.service.ts`
- `backend/src/modules/operations/leave/leave-balance.service.ts`

They are domain-specific and not enforced as the only route for all consumers.

## How Many Independent Clocks Exist?

Runtime audit identified at least 60 clock entries. Grouped by authority:

| Clock Family | Count/Examples |
| --- | --- |
| Backend workday clocks | workday service, runtime calculator, policy helper |
| Backend ticket clocks | timing service, ticket service stamps, ticket ledger |
| Backend analytics clocks | employee/reviewer/SLA/manager calculations |
| Backend scheduler clocks | scheduled tickets, leave reset, auto-close, auto-logout, digest |
| Backend auth/security clocks | login attendance, OTP TTL, throttling |
| Backend leave clocks | leave duration, approval timestamps |
| Frontend workday clocks | WorkdayBar, EndDayModal, team stale detection |
| Frontend ticket clocks | ticket countdown, spent so far, age, due-today filters |
| Frontend date display clocks | relative time/date formatting |

## Duplicate Calculations

Confirmed duplicate or competing calculations:

| Metric | Competing Calculations |
| --- | --- |
| Worked minutes today | backend runtime vs WorkdayBar live addition vs EndDayModal |
| Team status | `User.currentStatus` vs `WorkSession.status` |
| Ticket overdue | `TicketTimingService` vs automation created-age vs AI digest created-age |
| Ticket SLA analytics | due-window SLA vs active-work-seconds SLA |
| Ticket spent time | `TicketTimeLog.durationSeconds` vs frontend `actualStartAt -> now` |
| Leave duration | `LeaveBalanceService` vs dashboard preview vs leave page |
| Today/date boundary | company timezone utility vs server local midnight vs browser local day |

## Percentage From a Single Source

Estimated percentage of time calculations originating from a single source: 58%.

Basis: core backend screens often use the right service, but scheduler, analytics, frontend live displays, and leave/date boundaries still duplicate formulas.

## Historical Data Trust

Production workday data contains confirmed anomalies:

- 192 work sessions checked.
- 7 sessions where logout is before start.
- 43 sessions with logout but no start.
- 33 open sessions.
- 9 stale open sessions older than 12 hours.
- 51 sessions over 16 hours.
- 55 sessions over 10 hours.
- 7 sessions with total break over 4 hours.
- 7 open break logs.
- 9 break logs over 4 hours.
- 186 overlapping session pairs.
- 39 break logs outside/invalid against parent session.

Conclusion: historical workday records are not production-trustworthy without repair and re-verification.

## Production Safety Rating

```
Production Safe              [ ]
Controlled Rollout Candidate [ ]
High Risk                    [ ]
Critical Risk                [X]
```

## Top Findings

| ID | Finding | Severity |
| --- | --- | --- |
| TVA-001 | WorkdayBar can double count active time by adding frontend delta to backend elapsed. | Critical |
| TVA-004 | WorkSession/User status has multiple writers: workday, auth, scheduler. | Critical |
| TVA-005 | Overdue notifications bypass ticket timing authority. | Critical |
| TVA-006 | AI digest overdue list bypasses ticket timing authority. | Critical |
| TVA-007 | Analytics SLA uses a different formula from operational SLA. | Critical |
| TVA-008 | Ticket detail "spent so far" bypasses ticket ledger. | Critical |
| TVA-010 | Leave duration is duplicated in backend dashboard and frontend leave page. | High |
| TVA-011 | "Today" uses company, server, and browser clocks in different paths. | High |
| TVA-012 | Historical workday data contains critical anomalies. | Critical |

## Final Answer

Apex OS does not yet have one trustworthy authoritative time system. It has partial authorities that should become TVA inputs, but current consumers still perform independent calculations and several jobs directly mutate time-sensitive state.

Users cannot yet trust every reported minute across the platform.

