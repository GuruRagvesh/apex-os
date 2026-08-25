# Git Workflow

**Status:** Canonical
**Date:** 2026-08-04

Apex OS is a live system used by real employees. Attendance, tickets,
authentication, leave and payroll-adjacent data are production-sensitive. This
workflow exists to keep risky changes reviewable and reversible.

## Permanent branches

| Branch | Role |
| --- | --- |
| `main` | Production. Deploys are driven from here. |
| `staging` | Staging integration and pre-production validation. |

Neither is ever force-pushed. Neither is developed on directly.

## Temporary branches

```
feat/<feature>        new functionality
fix/<bug>             defect repair
security/<issue>      security remediation
chore/<maintenance>   repository or tooling maintenance
docs/<documentation>  documentation-only work
```

## Rules

1. **One concern per branch.** A branch fixes one thing. If work reveals a
   second problem, it gets its own branch — it is reported, not silently
   bundled.
2. **No cleanup mixed with feature work.** Repository organisation, formatting,
   and refactors never ride along with behaviour changes.
3. **Draft PR while incomplete.** Mark ready for review only when the change is
   actually reviewable.
4. **No merge without evidence.** A PR that changes runtime code states its
   backend build result, frontend build result, and test results. "It builds
   locally" is not evidence; the command output is.
5. **Risky areas require staging validation before merge.** Attendance/Workday,
   authentication, Prisma schema, and SLA/timing changes are validated on
   staging first. Merging one of these straight to `main` is an exception that
   should be recorded as such, not treated as normal.
6. **Delete merged temporary branches after verification** — after confirming
   the merge landed, not merely because a PR shows as closed.
7. **Never force-push `main` or `staging`.**
8. **Tag production releases** as `prod-YYYY-MM-DD-NN` (e.g.
   `prod-2026-08-04-01`).
9. **Push, merge, and deploy are explicit actions.** Prior approval for one
   push does not authorise the next one.

## Schema and data changes

- Migrations are additive by default: new nullable columns, new models, new
  indexes. Column drops, renames and type narrowing require an approved plan.
- `render.yaml`'s start command runs `npx prisma migrate deploy` on every
  deploy, so merging a migration to `main` applies it to production on the next
  deploy. There is no separate migration gate.
- Seed, reset, and repair scripts are never run against production. Before
  running any script that takes a `DATABASE_URL`, confirm which database it
  points at.

## Safety tags

Before any bulk or structural repository operation, create a local tag at the
pre-change commit:

```
pre-<operation>-<YYYYMMDD>-<short-sha>
```

This makes the pre-change state trivially recoverable without relying on reflog.
