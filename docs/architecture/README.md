# Architecture Documentation

How Apex OS is put together, and why.

## Canonical documents

Read in this order to understand the architecture:

| Document | What it answers |
| --- | --- |
| [`REPOSITORY_MAP.md`](REPOSITORY_MAP.md) | What the repository looks like **today** — every top-level directory, the backend and frontend structures, where Prisma and tests live, which executables still need a safety audit, and why runtime code was not moved during documentation compartmentalization. |
| [`MODULAR_ARCHITECTURE_FOUNDATION.md`](MODULAR_ARCHITECTURE_FOUNDATION.md) | What we are building **toward** and why — platform responsibilities, dependency direction, the key placement decisions (`shared/time`, `database/client`, `apps/e2e`, `public-site`, scheduler ownership), migration phases, Phase 0 scope and non-goals, rollback. |
| [`VERTICAL_SLICE_MIGRATION_MAP.md`](VERTICAL_SLICE_MIGRATION_MAP.md) | **Where each file goes** — a target location for all 500 tracked runtime files, the thirteen applied architecture decisions, and the four questions deferred to later phases. |
| [`COMPONENT_TEMPLATE.md`](COMPONENT_TEMPLATE.md) | **What a component looks like** — the internal shape every vertical slice takes, the public entry point, and why folders are created only when real files exist. |
| [`PUBLIC_API_CONVENTIONS.md`](PUBLIC_API_CONVENTIONS.md) | **What may import what** — the sixteen import rules, with allowed and forbidden examples, and which of them the validator enforces automatically. |

## Enforcement

Boundary rules are machine-checked:

```bash
npm run architecture:test    # validator self-tests
npm run architecture:check   # scan the repository
```

Configuration lives in `architecture-boundaries.json`; the validator is
`scripts/architecture/validate-boundaries.mjs` (Node built-ins only, no
dependencies). CI runs both on pull requests and on pushes to `main` and
`staging`.

Scope note: enforcement currently covers `apps/`, `platforms/`, `database/`
and `shared/`. The live roots `frontend/`, `backend/` and `e2e/` are excluded
until their modules migrate.

## Also here

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
