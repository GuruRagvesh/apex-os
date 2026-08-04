# database/client/

`PrismaModule` and `PrismaService` — the injectable database client.

**Status: Phase 0 — empty scaffold.** Live code is
`backend/src/prisma/{prisma.module.ts,prisma.service.ts}`.

## Why the client lives here and not in `shared/`

`PrismaService` is injected by nearly every backend service in the system. It
needs to be importable from any platform without creating a cycle. Placing it
here — at the bottom of the dependency graph, alongside the schema it wraps —
guarantees that.

Putting it in `shared/` would work mechanically, but it would blur what
`shared/` means: `shared/` is for cross-cutting *code*, and the Prisma client
is infrastructure bound to the schema next door.

## May live here

- `PrismaModule`, `PrismaService`.
- Connection lifecycle (`onModuleInit`, `onModuleDestroy`).
- Transaction helpers that are genuinely generic.

## Must not live here

- Queries. A `findManyTickets` helper belongs in
  `operations/tickets/*/backend/repositories/`.
- Business rules or validation.
- Any import from `apps/`, `platforms/`, or `shared/`.

## Dependency direction

```
platforms/*/backend/repositories → database/client
apps/api                         → database/client
database/client                  → (nothing internal)
```

## Transaction note

Several services accept an optional `Prisma.TransactionClient` so callers can
compose atomic operations across services — the Workday finalizer does this to
close breaks, freeze totals and pause ticket timers in one transaction. That
pattern stays: the client exposes the capability, components decide when to use
it.
