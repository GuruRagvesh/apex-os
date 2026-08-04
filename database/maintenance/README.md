# database/maintenance/

Routine, reversible operational scripts — inspection and safe upkeep.

**Status: Phase 0 — empty scaffold.** Live scripts remain in
`backend/prisma/` and `backend/prisma/scripts/`. They do **not** move until the
script-safety audit completes.

## Planned contents

| Script | Purpose |
| --- | --- |
| `check-db.ts` | Connectivity and basic integrity check. |
| `verify-manager-access.ts` | Verify manager department-access grants. |
| `seed-manager-access.ts` | Grant manager department access. |
| `seed-task-types.ts` | Ensure task types exist. |

## What qualifies as maintenance

- **Reversible.** Running it twice is safe; undoing it is understood.
- **Bounded.** It affects a known, small set of rows.
- **Non-destructive.** It does not delete or overwrite user-generated data.

If a script fails any of those, it belongs in [`../repair/`](../repair/) and
carries repair's approval requirements.

## Must not live here

- Anything that mutates attendance totals, ticket timing, or leave balances —
  that is repair, regardless of how routine it seems.
- Read-only audit scripts that only report — those are classified `audit` in
  the script-safety taxonomy.

## Dependency direction

```
maintenance/ → database/client, database/prisma
```

## Safety

Even maintenance scripts run against a real database. Confirm the target
`DATABASE_URL` before running anything, and prefer staging first.
