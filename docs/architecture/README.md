# Architecture Documentation

How Apex OS is put together, and why.

## Belongs here

- [`REPOSITORY_MAP.md`](REPOSITORY_MAP.md) — canonical map of the repository as
  it is today: every top-level directory, the backend and frontend module
  structures, where Prisma and tests live, and which executable files still
  need a safety audit.
- [`VERTICAL_SLICE_MIGRATION_MAP.md`](VERTICAL_SLICE_MIGRATION_MAP.md) —
  planning map for the Platform → Module → Component architecture: the target
  location of every tracked runtime file, plus the open questions that must be
  answered before any code moves. Read-only; nothing has been migrated.
- [`system/`](system/) — service-level and cross-cutting system design.
- [`data/`](data/) — data model, schema-level design, time/date authority.
- [`decisions/`](decisions/) — recorded architecture decisions, one per file.

## Does not belong here

- Per-feature documentation → [`../features/`](../features/)
- Historical program implementation reports → [`../programs/`](../programs/)
- Operational runbooks → [`../operations/`](../operations/)

## Standing policy

New feature development should prefer modular feature locations. Existing stable
runtime code moves only when actively modified, tested and reviewed — see
[`REPOSITORY_MAP.md`](REPOSITORY_MAP.md) for the full rationale.
