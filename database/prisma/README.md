# database/prisma/

Schema and migration history. One schema, one linear history, for the whole
system.

**Status: Phase 0 — empty scaffold.** `backend/prisma/schema.prisma` and
`backend/prisma/migrations/` remain live and authoritative. Production deploys
run `npx prisma migrate deploy` against them today.

## Contents (when migrated)

```
schema.prisma          46 models
migrations/            33 migrations, linearly ordered
migration_lock.toml
```

## Must not be split

Per-platform schemas are not possible: Prisma resolves one schema file, and
migration ordering across independent histories is unresolvable. A component
that needs new tables adds them to this schema.

## Migration rules

- **Additive by default** — new nullable columns, new models, new indexes.
- Column drops, renames and type narrowing require an approved plan.
- A migration merged to `main` applies to production on the next deploy.
  There is no separate migration gate.
- Never edit an applied migration. Write a new one.

## Model ownership

Models are owned by the component that writes them, even though they live in
one file. Current examples:

| Models | Owner |
| --- | --- |
| `WorkSession`, `BreakLog`, `AttendanceEvent` | `workforce/attendance/*` |
| `Ticket`, `TicketTimeLog`, `ReviewCycleLog` | `operations/tickets/*` |
| `LeaveRequest`, `LeavePolicy` | `workforce/leave/*` |
| `User`, `Role`, `Department` | `core/*` |
| `Lead`, `Deal`, `FollowUp` | `business/sales-crm/*` |
| `OperationalEvent` | `system/audit` |

Two writers for one model is a design smell. `WorkSession` has exactly one —
`AttendanceAuthorityService` — and that must stay true through migration.

## Unwired models

`AttendancePolicy`, `ShiftPolicy`, `EmployeeAttendanceProfile`,
`WeeklyOffPolicy`, `HolidayCalendar`, `Holiday`, `DailyAttendance` and
`AttendanceRegularization` are migrated but referenced by **no service**. They
represent an HRMS policy system that was schema'd ahead of implementation, and
they compete with the live `AppSetting.workday_policy` record. Resolving that
is a Phase 5 product decision.
