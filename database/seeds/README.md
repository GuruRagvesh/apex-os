# database/seeds/

Scripts that populate a database with baseline or test data.

**Status: Phase 0 — empty scaffold.** Live scripts remain in
`backend/prisma/` and `backend/`. They do **not** move until the
script-safety audit completes.

## Planned contents

| Script | Purpose |
| --- | --- |
| `seed.ts` | 🔒 Baseline seed. **Contains destructive deletes.** |
| `reset-seed.ts` | 🔒 Reset and reseed. Destructive by design. |
| `seed-test-users.ts` | Test user fixtures. |
| `seed-test-sessions.ts` | Test session fixtures. |
| `seed-hrms-policy.ts` | HRMS policy fixtures. |

## 🔒 Never run against production

`seed.ts` deletes users and projects despite comments suggesting otherwise.
`reset-seed.ts` is destructive by name and behaviour.

Before running any of these:

1. Print the target `DATABASE_URL` host and confirm it is **not** production.
2. Confirm the environment guard in the script itself is intact.
3. If you cannot confirm both, do not run it.

## May live here

- Idempotent baseline data (roles, task types, default settings).
- Test fixtures for local and staging environments.

## Must not live here

- Data repair. That is [`../repair/`](../repair/) — repair mutates existing
  rows; seeding creates baseline rows.
- Migrations. Those are [`../prisma/migrations/`](../prisma/).

## Dependency direction

```
seeds/ → database/client, database/prisma
```

Seeds must not import from `platforms/` or `apps/`. A seed that needs business
logic is a signal the logic belongs in a service the seed calls, not inlined.
