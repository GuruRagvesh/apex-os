# platforms/

Where the product actually lives. Every business rule, screen, endpoint and
contract belongs to exactly one component inside one platform.

**Status: Phase 0 — empty scaffold.** `frontend/` and `backend/` at the
repository root remain the live application roots. Nothing here is wired into
any build yet.

## The hierarchy

```
platform  →  module  →  component  →  frontend / backend / shared / tests / docs
```

- **Platform** — a broad business domain (`workforce`, `operations`).
- **Module** — a coherent feature area within it (`attendance`, `tickets`).
- **Component** — one vertical slice with a single responsibility (`workday`,
  `breaks`, `review-rework`). This is the unit that owns code.

A component holds its own UI, API adapter, controller, service, contracts and
tests together. See
[`../docs/architecture/COMPONENT_TEMPLATE.md`](../docs/architecture/COMPONENT_TEMPLATE.md).

## Platforms

| Platform | Domain |
| --- | --- |
| [`core/`](core/) | Identity, users, organization, settings. |
| [`workforce/`](workforce/) | Attendance, leave, calendar, teams, employees. |
| [`operations/`](operations/) | Tickets, projects, task types. |
| [`intelligence/`](intelligence/) | Dashboard, analytics, reports, AI. |
| [`business/`](business/) | Sales CRM. |
| [`system/`](system/) | Notifications, email, uploads, events, websocket, scheduler, health, backup, public site. |

## Dependency direction

```
apps/     →  platforms/
platforms/ →  shared/
platforms/ →  database/client
```

Within `platforms/`, a component may import another component **only** through
its public `index.ts`. Platforms must not form cycles: if `A` imports `B`, then
`B` must not import `A`, directly or transitively.

`platforms/` must never import from `apps/`.

## Public import expectations

```ts
// allowed — public entry point
import { TicketContract } from '@apex/operations/tickets/lifecycle';

// forbidden — internal file across a component boundary
import { TicketService } from '@apex/operations/tickets/lifecycle/backend/services/ticket.service';
```

## Must not live here

- Prisma schema or migrations — those stay in `database/prisma/`.
- Framework bootstrap or route files — those belong to `apps/`.
- Genuinely cross-cutting utilities — those belong to `shared/`.

## Creating folders

Create a module or component folder **only when it holds a real file.** Empty
scaffolding is worse than no scaffolding: it implies structure that does not
exist. `regularization`, `daily-attendance`, `performance`, `finance` and
`training-delivery` are deliberately absent for this reason.

## Migration status

Empty. Populated per the phase order in
[`../docs/architecture/VERTICAL_SLICE_MIGRATION_MAP.md`](../docs/architecture/VERTICAL_SLICE_MIGRATION_MAP.md):
Sales CRM leads pilot first, attendance last.
