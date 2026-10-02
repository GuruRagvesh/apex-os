-- Phase 4: one active TIMED ticket per user, across employee (ASSIGNEE) and
-- reviewer (REVIEWER) timers. Replaces the Phase 2D1 ASSIGNEE-only index
-- (ticket_time_logs_one_active_assignee_per_user) with a strict superset.
--
-- An active timed row is one with endedAt NULL and ownerType ASSIGNEE or
-- REVIEWER. Ended rows (including zero-length pause markers) and any other
-- owner type are outside the index.
--
-- PRECONDITION (manual, reviewed): `npm run ticket-time:cleanup` must report
-- CLEAN on the target database first. This migration never deletes or edits
-- data. If a user has more than one active timed row it stops with the message
-- below, and nothing is created or dropped. See
-- docs/operations/deployment/TICKET_TIMER_GUARDRAIL_RELEASE.md.
--
-- Not declared in schema.prisma: Prisma cannot express a partial unique index.
--
-- Deliberately no BEGIN/COMMIT and no CONCURRENTLY (same reasons as the Phase
-- 2D1 migration, verified with Prisma 5.22.0): `migrate deploy` runs this file
-- as one implicit transaction, so the check, the new index and the drop of the
-- old index are atomic, and a failure is recorded in _prisma_migrations with
-- this message. The new index is created before the old one is dropped, so
-- there is no moment without the guarantee. The build blocks writes to
-- ticket_time_logs while it runs; release it in a quiet period.

DO $$
DECLARE
  dup_users integer;
BEGIN
  SELECT count(*) INTO dup_users
  FROM (
    SELECT "userId"
    FROM "ticket_time_logs"
    WHERE "endedAt" IS NULL AND "ownerType" IN ('ASSIGNEE', 'REVIEWER')
    GROUP BY "userId"
    HAVING count(*) > 1
  ) d;

  IF dup_users > 0 THEN
    RAISE EXCEPTION 'ticket_time_logs has % user(s) with more than one active timed ticket (employee or reviewer). Run the ticket-time cleanup (dry run, review, --apply) before this migration.', dup_users;
  END IF;
END $$;

CREATE UNIQUE INDEX "ticket_time_logs_one_active_timed_per_user"
  ON "ticket_time_logs" ("userId")
  WHERE "endedAt" IS NULL AND "ownerType" IN ('ASSIGNEE', 'REVIEWER');

DROP INDEX IF EXISTS "ticket_time_logs_one_active_assignee_per_user";
