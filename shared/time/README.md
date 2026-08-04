# shared/time/ ⏱

The Time/Value Authority: company-date resolution, timezone handling, and
elapsed-time calculation.

**Status: Phase 0 — empty scaffold.** Live code is
`backend/src/common/services/{tva.service.ts,company-date.service.ts}`,
`backend/src/common/utils/timezone.util.ts`, and
`frontend/lib/{company-date.ts,date-utils.ts}`.

## Why this is `shared/` and not a platform

Attendance, tickets, SLA, scheduled jobs and analytics **all** depend on the
same answers:

- What is "today" in company time?
- What is the company-date boundary for this timestamp?
- How many minutes elapsed between these two instants?

If this lived in `workforce/`, then `operations/tickets/sla` would import
`workforce/` for SLA arithmetic — a dependency that has nothing to do with
attendance and would create a cycle the first time attendance needed anything
from tickets.

It is not a business domain. It is a primitive. It belongs here.

## May live here

- Company timezone resolution (IST, fixed +05:30).
- `companyDateOnly()`, `companyDayStart()`, `companyDayEnd()`, `now()`.
- Elapsed-time calculation between instants.
- Date formatting helpers that avoid UTC drift.

## Must not live here

- **Policy.** "The workday auto-closes at 23:59" is attendance policy, not a
  time primitive. This module answers *what time is it*; platforms decide
  *what that means*.
- SLA rules, shift rules, or grace-period logic.
- Anything that reads business tables.

## Dependency direction

```
platforms/* → shared/time
shared/time → (nothing internal)
```

`shared/time` is a leaf. It imports no platform, no app, and no database
client.

## Why this matters more than it looks

This codebase has an established rule that business-date decisions must use the
central company-date source and never raw `new Date()`. Mixing server-local
time into business-date logic in a scheduled job is exactly how sessions get
attributed to the wrong day. Centralizing the authority here is what makes that
rule enforceable rather than aspirational.
