-- Phase 2D1: the database refuses a second active employee timer for one user.
--
-- An active employee timer is exactly what the ledger treats as one: an
-- ASSIGNEE row whose endedAt is NULL. Reviewer/manager rows and ended rows
-- (including zero-length pause markers) are outside the index.
--
-- PRECONDITION (manual, reviewed): `npm run ticket-time:cleanup` must report
-- CLEAN on the target database first. This migration never deletes or edits
-- data. If duplicates remain it stops with the message below and nothing is
-- created. See docs/operations/deployment/TICKET_TIMER_GUARDRAIL_RELEASE.md.
--
-- Not declared in schema.prisma: Prisma cannot express a partial unique index.
--
-- Deliberately no BEGIN/COMMIT and no CONCURRENTLY. Verified with the
-- installed Prisma 5.22.0: `migrate deploy` sends this file as one batch that
-- PostgreSQL runs as a single implicit transaction, so the check and the index
-- are atomic, and a failure is recorded in _prisma_migrations with this
-- message. An explicit BEGIN/COMMIT hid the error ("current transaction is
-- aborted") and left the migration log empty. CONCURRENTLY cannot run inside a
-- transaction. The normal build blocks writes to ticket_time_logs while it
-- runs; release it in a quiet period.

DO $$
DECLARE
  dup_users integer;
BEGIN
  SELECT count(*) INTO dup_users
  FROM (
    SELECT "userId"
    FROM "ticket_time_logs"
    WHERE "endedAt" IS NULL AND "ownerType" = 'ASSIGNEE'
    GROUP BY "userId"
    HAVING count(*) > 1
  ) d;

  IF dup_users > 0 THEN
    RAISE EXCEPTION 'ticket_time_logs has % user(s) with more than one active ASSIGNEE timer. Run the ticket-time cleanup (dry run, review, --apply) before this migration.', dup_users;
  END IF;
END $$;

CREATE UNIQUE INDEX "ticket_time_logs_one_active_assignee_per_user"
  ON "ticket_time_logs" ("userId")
  WHERE "endedAt" IS NULL AND "ownerType" = 'ASSIGNEE';
