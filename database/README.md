# database/

The single source of truth for schema, migrations, the Prisma client, and every
script that touches data.

**Status: Phase 0 — empty scaffold.** `backend/prisma/` remains the live schema
and migration history. It is what `npx prisma migrate deploy` runs against on
every production deploy. **Nothing here is active.**

## Why schema and migrations are centralized

This is not a stylistic choice — it is a constraint:

- Prisma resolves exactly one `schema.prisma`.
- `migrate deploy` applies exactly one, linearly-ordered migration history.
- Per-platform schemas would make migration ordering unresolvable across
  components, and would break the `render.yaml` deploy command.

So: **components may own repository adapters. They never own migrations or a
private schema.**

## Contents

| Folder | Purpose |
| --- | --- |
| [`client/`](client/) | `PrismaModule` and `PrismaService`. |
| [`prisma/`](prisma/) | `schema.prisma`, `migrations/`, `migration_lock.toml`. |
| [`seeds/`](seeds/) | Seed scripts. |
| [`maintenance/`](maintenance/) | Routine, reversible operational scripts. |
| [`repair/`](repair/) | 🔒 Scripts that mutate existing data. |

## Dependency direction

```
platforms/ → database/client
apps/api   → database/client
```

`database/` imports from **nothing**. Not `apps/`, not `platforms/`, not
`shared/`. It is the bottom of the dependency graph — anything else would make
the client unimportable from somewhere that needs it.

## Must not live here

- Business rules. A repair script encoding policy about *what correct data
  looks like* is a symptom that the rule belongs in a platform.
- Feature-specific queries. Those are component repositories.

## Safety

🔒 Scripts under `repair/` and `seeds/reset-seed.ts` can destroy production
data. Relocating them changes nothing about that. Every script must pass the
script-safety audit — package-script references, import checks, environment
guards, dry-run support, production-database protection — before it moves.

Standing rules: never run seed, reset, or repair scripts against production.
Before running anything that takes a `DATABASE_URL`, confirm which database it
points at.
