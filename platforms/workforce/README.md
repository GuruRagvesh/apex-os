# platforms/workforce/

Attendance, leave, calendar, teams and employee management — everything about
people, their time, and their availability.

**Status: Phase 0 — empty scaffold.** Live code remains in
`backend/src/modules/platform/workday/`, `backend/src/modules/operations/leave/`,
`backend/src/modules/operations/team/` and `frontend/components/workday/`.
Migrates **last, in Phase 5.**

## Why this platform migrates last

🔒 This is the highest-risk code in the repository. It is payroll-adjacent:
attendance totals, break minutes and leave balances feed decisions about real
people's pay and performance. It has already produced corrupted production
sessions once. Every change here requires staging validation.

## Planned modules

| Module | Components |
| --- | --- |
| `attendance/` | `workday`, `breaks`, `history`, `idle`, `policies` |
| `leave/` | `applications`, `approvals`, `balances` |
| `calendar/` | (single component, cross-workforce) |
| `teams/` | `team-management`, `reporting-lines` |
| `employee-management/` | (single component) |

Deliberately absent: `regularization/` and `daily-attendance/` have Prisma
models but no code. They are not scaffolded until they have content.

## Invariants that must survive migration

These are settled behaviour, not implementation details:

- Every session-closing path routes through the shared finalizer.
- `MEETING` time counts as productive work, not deducted break time.
- Login never starts a workday; logout never ends one.
- Same-day re-login never overwrites the original `startWorkAt`.
- `AttendanceAuthorityService` is the sole writer of `WorkSession` and
  `User.currentStatus`.

## Scheduled jobs belong here

Workday auto-close, idle auto-logout and the workday end reminder are
*Workday behaviour that happens on a timer*, not generic infrastructure. They
live in `attendance/workday/backend/jobs/` and call the shared finalizer
directly. `system/scheduler` provides only the cron mechanism.

This is what keeps `system → workforce` out of the dependency graph.

## Dependency direction

```
allowed:    workforce/ → core/ (public entry points), shared/, database/client
forbidden:  workforce/ → apps/
```

`operations/tickets` and `workforce/attendance` interact through published
contracts — attendance pauses ticket timers via a contract, not a direct
service import.

## Must not live here

- Ticket or project logic — that is `operations/`.
- Generic cron infrastructure — that is `system/scheduler`.
- Company-date or timezone helpers — that is `shared/time/`.
