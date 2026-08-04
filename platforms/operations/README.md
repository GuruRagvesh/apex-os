# platforms/operations/

Tickets, projects and task types — the work-execution core of Apex OS.

**Status: Phase 0 — empty scaffold.** Live code remains in
`backend/src/modules/operations/` and `frontend/app/(dashboard)/(operations)/`.
Migrates in **Phase 4**.

## Planned modules

| Module | Components |
| --- | --- |
| `tickets/` | `creation`, `assignment`, `lifecycle`, `review-rework`, `timing-ledger`, `sla`, `blocking`, `comments`, `attachments`, `imports` |
| `projects/` | `project-management` (+ `stages`, `membership`, `reporting` only if a real split exists) |
| `task-types/` | (single component) |

## Migrate tickets component-by-component

`tickets.service.ts` and `tickets.controller.ts` each serve five or more of the
components above. They must be **split**, not relocated wholesale — and each
split lands on its own branch with its own tests. Moving tickets as one unit
would be the single riskiest change in the migration.

## Must not live here

- SLA date arithmetic primitives — those are `shared/time/`. The SLA
  *policy* (what the deadline means, when it pauses) lives here; the
  *calculation of elapsed company time* does not.
- Notification delivery — that is `system/notifications`. Tickets publish
  events; the system platform delivers them.

## Dependency direction

```
allowed:    operations/ → core/, shared/, database/client
allowed:    operations/ → workforce/ (public contracts only)
forbidden:  operations/ → apps/
```

Ticket timers are paused by attendance state changes. That flows as a published
contract from `workforce/attendance` — `operations/` does not import the
Workday service directly, and `workforce/` does not import the ticket ledger
directly.

## Known issues carried into migration

- HELP tickets have an approver/rejecter asymmetry (approve gates on
  `createdById`, reject on `assignedToId`).
- Self-assigned ticket approval Phase 2 (creation-time `PENDING_APPROVAL`) is
  deferred — the enum value and column do not exist.
- `ticket-row.tsx` and `TicketRow.tsx` are duplicate implementations; the
  canonical one must be chosen before either migrates.
