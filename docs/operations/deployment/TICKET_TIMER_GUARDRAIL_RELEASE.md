# Ticket timer guardrail release (Phase 2D1)

> **Documentation only.** Nothing in this runbook has been run against
> production or staging. Every production step needs explicit owner approval
> at the time it is run. The general rules in
> [`MIGRATION_RELEASE_PROCEDURE.md`](MIGRATION_RELEASE_PROCEDURE.md) still
> apply: migrations are never run automatically, and never from a start
> command.

## What ships

1. **`npm run ticket-time:cleanup`** (`backend/scripts/ticket-time-cleanup.ts`).
   It closes invalid or duplicate *active employee timers*: `ticket_time_logs`
   rows where `ownerType = 'ASSIGNEE'` and `endedAt IS NULL`. It is a dry run
   unless given `--apply --confirm-database=<exact database name>`.
2. **Migration `20261001000000_one_active_assignee_timer`.** It adds this
   partial unique index:

   ```sql
   CREATE UNIQUE INDEX "ticket_time_logs_one_active_assignee_per_user"
     ON "ticket_time_logs" ("userId")
     WHERE "endedAt" IS NULL AND "ownerType" = 'ASSIGNEE';
   ```

   After this, the database itself refuses a second active employee timer for
   one user. Reviewer and manager timers, ended rows and zero-length pause
   markers are not affected. The migration first checks for duplicates. If
   any exist, it stops with
   `… user(s) with more than one active ASSIGNEE timer. Run the ticket-time cleanup …`
   and creates nothing. It never edits or deletes data.
3. **Application handling.** The ledger still serialises every timer start
   with the per-worker advisory lock. If the index ever rejects a start, the
   start is retried once: it then sees the other timer and switches to it, or
   returns it if it is the same ticket. A second failure returns
   `409 Another timer for this worker started at the same moment`. A raw
   database error is never returned.

## Why the cleanup must run before the migration

`CREATE UNIQUE INDEX` fails if any user already has two active employee
timers. The cleanup is a separate, reviewed step. It is deliberately not
embedded in the migration, so that a person sees and approves every row it
changes.

## What the cleanup changes

For each active employee timer row the cleanup closes, it sets only:

| Column | Value |
| --- | --- |
| `endedAt` | the run's single repair timestamp, or `startedAt` if the row claims to start later (clock skew), so no duration is negative |
| `durationSeconds` | `endedAt − startedAt` in whole seconds |
| `countsAsWork` | `false`: repaired time is never productive (see below) |
| `pauseReason` | `INTEGRITY_REPAIR`: a deliberate stop, never auto-resumed |
| `updatedAt` | the same effective end as `endedAt`, so `updatedAt` is never earlier than `endedAt` |

It never deletes rows. It never touches ended rows (including completed WORK
or REWORK history), reviewer or manager timers, tickets, assignments, work
sessions, user status or SLA fields.

**Repaired time is not productive.** `countsAsWork` is the ledger's canonical
productive-time field, and only rows where it is true are counted. That
applies to employee work time, original and rework cycle actual time, the work
budget (Time Left, on the ticket page and in lists/Kanban alike), frozen
`reworkWorkSeconds`, a review cycle's `assigneeWorkSeconds`, and analytics.
Lifecycle/SLA wall-clock time, reviewer approval time and `activeClock` do not
depend on it and are unchanged.

**Which rows it closes.** An active employee timer is closed when it breaks
any Phase 1 rule:
- the ticket is not IN_PROGRESS, is blocked, is unassigned, or has another
  primary assignee;
- the user is not WORKING, or has no open WORKING session;
- the linked work session is missing, belongs to another user, is closed, or
  has been superseded by a later-dated session;
- the timer's stage is REWORK but its ticket has no open rework cycle
  (`REWORK_WITHOUT_OPEN_CYCLE`).

**Age alone is not a reason.** A timer that has merely run for a long time is
not closed. The audit's `ACTIVE_LOG_OLDER_THAN_THRESHOLD` stays report-only,
because age is a warning, not proof of corruption. Review such timers by hand.

If a user still has more than one valid timer after that, one is kept:
**the most recently started, with equal start times resolved to the greatest
id**. The others are closed as `DUPLICATE_NOT_SURVIVOR`.

**What the cleanup does not repair.** The cleanup is not a general repair
tool for the 17 Phase 2C audit findings. It repairs only the active employee
timer conditions listed above, plus the duplicates that would block the unique
index. The following stay audit findings for manual investigation, and are
not repaired automatically:
- `ACTIVE_LOG_OLDER_THAN_THRESHOLD` (long-running but otherwise valid timers);
- historical overlaps between completed timer rows;
- completed WORK rows inside rework cycles;
- malformed completed rows: missing, negative or inverted durations;
- anything about reviewer or manager timers.

A CLEAN cleanup report therefore does **not** mean the full Phase 2C audit
will be CLEAN. The production release must review every remaining audit
finding separately.

**How an apply run protects itself.** Apply runs as one transaction. It:
1. takes every affected worker's timer lock and row locks;
2. re-plans with the same planner the dry run uses;
3. closes exactly the planned rows;
4. re-plans, and rolls everything back unless the result is CLEAN.

## Exit codes

| Code | Dry run | Apply |
| --- | --- | --- |
| 0 | CLEAN | APPLIED, or already CLEAN |
| 2 | CHANGES_REQUIRED | — |
| 1 | refused or failed | refused, failed or rolled back (nothing kept) |

## Current safety gate

Today both commands accept **only** the local integration database:
- loopback host;
- database name `apex_os_attendance_integration`;
- the server's identity is verified after connecting.

Render, AWS, `prod`, `production`, `staging`, Neon and Supabase addresses are
refused. There is no production override. Running the steps below in
production needs a separately reviewed change that adds a production mode.

## Future production release order

Record the output of every step in the release record.

1. **Confirm the release commit.** The exact `main` commit being released
   contains both the cleanup script and the migration.
2. **Take a production backup** immediately before release.
3. **Verify the backup**: restore-test it or check its manifest, following
   `docs/operations/backup-recovery/`.
4. **Dry run the cleanup** against production:
   `ticket-time:cleanup -- --json`. Also run the read-only
   `ticket-time:audit -- --json`.
5. **Review every proposed change.** Check each row, reason and kept timer in
   the dry-run report. Stop if anything is unexpected.
6. **Get explicit production approval** for this apply, on this database, at
   this time.
7. **Apply the cleanup**:
   `ticket-time:cleanup -- --apply --confirm-database=<production db name>`.
8. **Verify the cleanup.** The dry run must now report CLEAN (exit 0). The
   audit must show `DUPLICATE_ACTIVE_ASSIGNEE_LOGS: 0`. Any other remaining
   audit findings (see "What the cleanup does not repair") are reviewed and
   recorded, not assumed away.
9. **Apply the migration by hand**: run `prisma migrate status`, review
   exactly one pending migration, run `prisma migrate deploy`, then run
   `prisma migrate status` again.
10. **Verify the index** exists and is valid:

    ```sql
    SELECT i.indisvalid, pg_get_indexdef(i.indexrelid)
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'ticket_time_logs_one_active_assignee_per_user';
    ```

11. **Run post-deploy health checks**: check `/api/health`, then start a
    ticket, start a break, end the break, and end the day for a test user.
12. **Record counts and evidence**: rows closed per reason, the kept timers,
    the index definition, and the audit result before and after.

## Rollback

**Dropping the index is not a rollback of the migration.** Once
`prisma migrate deploy` has applied `20261001000000_one_active_assignee_timer`,
`_prisma_migrations` records it as finished. If the index is dropped by hand
afterwards:
- the migration is **not** marked as rolled back;
- `prisma migrate status` may still report the migration as applied and the
  schema as up to date;
- a later `prisma migrate deploy` will **not** recreate the missing index.

Operators must **never**:
- run `prisma migrate resolve --rolled-back` for this migration once it has
  applied successfully. That command is only for a *failed* attempt; see the
  next section.
- edit `_prisma_migrations` by hand.

**Safe policy:**
1. **Removing the guardrail permanently:** ship a reviewed *forward*
   migration that drops the index, released like any other migration.
2. **Emergency manual drop:** `DROP INDEX "ticket_time_logs_one_active_assignee_per_user";`
   Record the resulting schema drift in the release record immediately. Before
   the next deployment, do one of:
   - Recreate the exact partial unique index, after confirming that no user has
     more than one active ASSIGNEE timer (cleanup dry run CLEAN, audit
     `DUPLICATE_ACTIVE_ASSIGNEE_LOGS: 0`):

     ```sql
     CREATE UNIQUE INDEX "ticket_time_logs_one_active_assignee_per_user"
       ON "ticket_time_logs" ("userId")
       WHERE "endedAt" IS NULL AND "ownerType" = 'ASSIGNEE';
     ```

   - Or ship a reviewed corrective migration that represents the intended
     database state.
3. **Always verify the index directly**, not only with `prisma migrate status`:

   ```sql
   SELECT i.indisvalid, pg_get_indexdef(i.indexrelid)
   FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'ticket_time_logs_one_active_assignee_per_user';
   ```

   One row with `indisvalid = true` and the definition above means the
   guardrail is in place. No row means it is missing, whatever
   `migrate status` says.

**Dropping the index does not undo the cleanup.** Rows the cleanup closed stay
closed, keep their history, and can be identified by
`pauseReason = 'INTEGRITY_REPAIR'`. Restoring the pre-cleanup data requires the
separately approved backup/restore procedure. That restores the whole database
to the backup point, so it may also revert unrelated changes made since.

## If `prisma migrate deploy` fails in step 9

This procedure was exercised end to end on the local integration database.
The test is `backend/test/integration-pg/t4-guardrail-migration-deploy.int-spec.ts`,
using the installed Prisma CLI **5.22.0** (`package.json` allows `^5.13.0`).

**What a failed deploy looks like** (duplicates still present):
- `prisma migrate deploy` exits 1 with `Error: P3018`,
  `Database error code: P0001` and the migration's own message
  (`… user(s) with more than one active ASSIGNEE timer. Run the ticket-time cleanup …`).
- No index is created, even partially, and no data changes.
- `_prisma_migrations` gets a row for `20261001000000_one_active_assignee_timer`
  with `finished_at = NULL`, `rolled_back_at = NULL`,
  `applied_steps_count = 0`, and the error text in `logs`.
- While that row is unresolved, every later `prisma migrate deploy` exits 1
  with `P3009` (failed migration found), and `prisma migrate status` exits 1.

**Tested recovery:**
1. Run the cleanup dry run, review it, then apply it. The dry run must then
   report CLEAN.
2. Mark the failed attempt rolled back. Nothing was applied, so this is
   accurate:

   ```bash
   npx prisma migrate resolve --rolled-back "20261001000000_one_active_assignee_timer"
   ```

   The expected output is `Migration 20261001000000_one_active_assignee_timer marked as rolled back.`
3. `npx prisma migrate deploy` applies the migration
   (`All migrations have been successfully applied.`).
4. Verify the index as in step 10. `_prisma_migrations` now holds two rows for
   the migration: the rolled-back attempt, and a finished one with
   `applied_steps_count = 1`.
5. `npx prisma migrate status` reports `Database schema is up to date!`.

Never use `migrate resolve --applied` for this migration. The index would not
exist.

## Transaction and index design (verified for Prisma 5.22.0)

- **The script is atomic.** Prisma 5.22 sends a PostgreSQL `migration.sql` to
  the server as one multi-statement batch, which PostgreSQL runs as a single
  implicit transaction. This was verified with a throwaway two-statement probe
  migration: when the second statement failed, the first statement's table
  was not left behind.
- **No explicit `BEGIN; … COMMIT;`.** That variant was probed too. On failure,
  Prisma then reported only `current transaction is aborted …` and left
  `_prisma_migrations.logs` empty, which hides the real reason. The migration
  therefore contains only the duplicate check and the `CREATE UNIQUE INDEX`.
- **A normal blocking `CREATE UNIQUE INDEX`.** `CREATE INDEX CONCURRENTLY`
  cannot run inside a transaction, so it cannot share this atomic script. A
  concurrent build would need a separately designed and tested
  migration-and-recovery procedure. The blocking build locks writes to
  `ticket_time_logs` while it runs, so run step 9 in a quiet period.

**Operational note:** nobody should start or stop timers between steps 7 and
9. If someone does, repeat step 8 before step 9.
