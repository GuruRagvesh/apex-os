# Attendance — What Still Requires Live Infrastructure

**Branch** `refactor/attendance-canonical-archive-delete` · **Base** `origin/main` `1453d6a`
**Date** 2026-10-01

Only items that cannot be done without external credentials or infrastructure appear here.
Everything else was completed and verified locally — see §2.

---

## 1. Genuinely blocked

| # | Item | Blocked on | Why it cannot be substituted |
|---|---|---|---|
| B1 | `npx prisma migrate status` clean | A reachable non-production PostgreSQL | Needs a real connection. Schema validation passes (`The schema at prisma\schema.prisma is valid`), but migrate status compares the `_prisma_migrations` table against the folder, which requires a database. |
| B2 | Applying `20261001120000_remove_daily_attendance_policy_version` | A non-production database | The migration is generated and reviewed; applying it is an operator action. |
| B3 | Row-by-row old-vs-new parity over real data | A restored copy of production | Code-level parity is complete (`ATTENDANCE_PARITY_REPORT.md`, 0 regressions). Confirming the *volume* of each expected correction needs real rows. The queries are in §6 of that report. |
| B4 | Console rendering against live data | A running staging deployment | The frontend builds and typechecks; the data contract is covered by tests. Visual confirmation needs a deployment. |
| B5 | Live staging environment | `render.yaml` defines one service | There is no staging backend service and no staging Vercel config in the repository, so "verify on staging" has nowhere to run. Recorded earlier in `APEX_OS_COMPLETE_ARCHITECTURE.md` §20. |

**What B1–B3 need, concretely:** a `DATABASE_URL` pointing at a disposable PostgreSQL
database. Nothing else. No code change is required for any of them.

---

## 2. Done locally instead — not blocked, not skipped

"Staging unavailable" was not treated as a reason to stop verifying.

| Verification | How | Result |
|---|---|---|
| Schema validity | `prisma validate` with a URL present | **valid** |
| The migration's blast radius | Read the generated SQL | **1 statement**, `ALTER TABLE "daily_attendance" DROP COLUMN "policyVersion"` |
| Only the intended column goes | `rg policyVersion` across backend, frontend, platforms, shared | 0 app references; the one survivor is `AttendanceEvent.policyVersion`, a different model, deliberately untouched |
| Exactly 2 worksheets | Built a real workbook from a representative month | **PASS** |
| Exact sheet names | `September 2026 Daily Attendance`, `Employee Monthly Summary` | **PASS** |
| 26 daily headers, in order | Compared against `DAILY_COLUMNS` | **PASS** |
| 19 summary headers, in order | Compared against `SUMMARY_COLUMNS` | **PASS** |
| No hidden or diagnostic sheets | Inspected `state` and names on every sheet | **PASS** |
| No internal ID leaked | Scanned every header and every string cell for the fixture's `userId`s | **PASS** |
| Summary = aggregation of daily | Recomputed each figure from the rows in the test | **PASS** |
| Console values = workbook cells | Compared all 26 daily and all 19 summary columns, every row | **PASS** |
| Deterministic bytes | Rendered the same month twice | **identical** |
| Round trip through real xlsx | Wrote and reloaded the buffer with ExcelJS | **PASS** |

### The representative month

One fixture month exercises every case the brief names, so the contract, the parity and the
semantics are proven on the same data: current employee, former employee, future joiner,
joined mid-month, exited mid-month, complete punch pair, punch-in only, punch-out only,
WorkSession only, multiple **unsorted** sessions, a 20:00 policy auto-close, a late
employee, weekly off, unconfirmed calendar, leave, half day, pending regularization,
invalid regularization, a working day with no evidence, an unprovable requirement, and an
extract cutoff.

All seven visible statuses occur in it, and exactly **one** day in the month meets the full
Absent conjunction — asserted, so a future change that starts calling uncertainty "absent"
fails here.

---

## 3. What is NOT blocked and NOT outstanding

Stated explicitly so this file is not mistaken for a list of unfinished work:

- the canonical reporting service, and the console and download both consuming it
- the 26 and 19 column contracts
- one workbook builder; the second report+workbook stack deleted
- the second attendance engine (`payroll-aggregation.ts`, `payroll-workbook.ts`) deleted
- month-close, finalization and the Finance handoff reading canonical rows
- fingerprint v2 over canonical facts, with explicit legacy-v1 handling
- historical employee eligibility by date
- the evaluator's positional session-start bug
- the hardcoded `LATE_AFTER = '10:30:00'`

---

## 4. Unblocking sequence

1. Provision a disposable PostgreSQL database.
2. `DATABASE_URL=<that> npx prisma migrate status` — expect pending:
   `20261001120000_remove_daily_attendance_policy_version`.
3. `DATABASE_URL=<that> npx prisma migrate deploy` — expect 1 migration applied.
4. Re-run `migrate status` — expect clean.
5. Optionally restore a production copy and run the §6 queries from
   `ATTENDANCE_PARITY_REPORT.md` to quantify each expected correction.

**None of this is production.** The production migration remains an explicit, authorized,
human-run step.
