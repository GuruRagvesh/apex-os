# database/repair/ 🔒

Scripts that mutate existing production data.

**Status: Phase 0 — empty scaffold.** Live scripts remain in
`backend/prisma/scripts/` and `backend/`. They do **not** move until the
script-safety audit completes. **Moving them would not make them safer.**

## Planned contents

| Script | Risk |
| --- | --- |
| `fix-production-data.ts` | 🔒 Direct production mutation. |
| `fix-hierarchy.ts`, `fix-hierarchy-v2.ts` | 🔒 Reporting-line mutation. |
| `fix-role-name.ts` | 🔒 Role mutation. |
| `migrate-estimated-time.ts` | 🔒 Ticket data mutation. |
| `add-missing-employees.ts` | 🔒 User creation. |
| `tva_repair.js`, `tva_execute_repair.js` | 🔒 Time-authority repair. |
| `wipe.ts` | 🔒 **Quarantine.** Name implies total destruction. |

## Required before any repair runs

Every one of these, every time — not once for the category:

1. **Fresh read-only classification** of the affected rows.
2. **Deterministic dry run** with output reviewed by a human.
3. **Staging rehearsal** against a realistic dataset.
4. **Before/after evidence** captured and retained.
5. **Explicit production-apply approval** for that specific run.

A previous dry-run's output does not authorise a later apply. Data moves.

## Rollback

Every repair must produce rollback data *before* it mutates anything. The
FP20C program's rollback JSON is the reference example — it is retained in
`docs/archive/generated-artifacts/restricted/` precisely because it is the
record of what could be undone.

## Must not live here

- Anything that only reports. Read-only inspection is `audit`, not repair.
- Anything a migration should do. Schema change is
  [`../prisma/migrations/`](../prisma/).

## Dependency direction

```
repair/ → database/client, database/prisma
```

## Standing constraint

No script here runs without explicit, per-run approval. Not during incident
response, not as part of a deploy, not "while we're in there".
