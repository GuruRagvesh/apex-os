-- Migration A: make the database able to outlive an employee.
--
-- PREREQUISITE FOR ARCHIVE & DELETE, not an afterthought. Prisma's default for
-- a required relation is Restrict, so today `user.delete()` on anyone who has
-- ever created a ticket, written a comment or appeared in an audit event FAILS
-- at the database. That is accidentally a safety property -- shared history is
-- protected because nothing can be removed -- but it means retention is
-- impossible until these columns can hold NULL.
--
-- THE ALTERNATIVE WAS REJECTED. Declaring `onDelete: Cascade` on these would
-- let the database do the work, and would delete the company's tickets,
-- comments, time logs and audit trail because one person left.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- DESTRUCTIVE-SQL REVIEW (required reading before this is applied)
--
--   DROP TABLE    none.
--   TRUNCATE      none.
--   DELETE FROM   none.
--   CASCADE       appears ONLY as `ON UPDATE CASCADE` on new foreign keys,
--                 which propagates a primary-key CHANGE, not a deletion.
--                 No `ON DELETE CASCADE` is created anywhere in this file.
--
-- Every statement is additive or widening. ALTER COLUMN ... DROP NOT NULL
-- accepts strictly more values than before, so no existing row can fail it and
-- no existing row changes. Nothing here can lose data.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The tombstone and the receipt ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS "former_employees" (
    "id"                 TEXT NOT NULL,
    "formerUserId"       TEXT NOT NULL,
    "employeeId"         TEXT,
    "displayName"        TEXT NOT NULL,
    "roleName"           TEXT,
    "departmentName"     TEXT,
    "deletedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedById"        TEXT,
    "archiveDriveFileId" TEXT,

    CONSTRAINT "former_employees_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "former_employees_formerUserId_key"
    ON "former_employees"("formerUserId");
CREATE INDEX IF NOT EXISTS "former_employees_formerUserId_idx"
    ON "former_employees"("formerUserId");

DO $$ BEGIN
    CREATE TYPE "EmployeeDeletionStatus" AS ENUM (
        'REQUESTED', 'ARCHIVING', 'ARCHIVED', 'DELETE_STARTED', 'COMPLETED', 'FAILED'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "employee_deletion_ledger" (
    "id"                TEXT NOT NULL,
    "formerUserId"      TEXT NOT NULL,
    "formerEmployeeId"  TEXT,
    "formerDisplayName" TEXT NOT NULL,
    "driveFileId"       TEXT,
    "driveFileName"     TEXT,
    "archiveBytes"      INTEGER,
    "archiveChecksum"   TEXT,
    "archivedAt"        TIMESTAMP(3),
    "deletedAt"         TIMESTAMP(3),
    "initiatedById"     TEXT,
    "status"            "EmployeeDeletionStatus" NOT NULL DEFAULT 'REQUESTED',
    "failureReason"     TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_deletion_ledger_pkey" PRIMARY KEY ("id")
);

-- UNIQUE on formerUserId is load-bearing, not tidiness: it is what makes a
-- double-clicked Archive & Delete collapse into one operation rather than
-- starting a second destructive run against the same person.
CREATE UNIQUE INDEX IF NOT EXISTS "employee_deletion_ledger_formerUserId_key"
    ON "employee_deletion_ledger"("formerUserId");
CREATE INDEX IF NOT EXISTS "employee_deletion_ledger_status_idx"
    ON "employee_deletion_ledger"("status");

-- ── 2. Ten actor columns widen to accept NULL ──────────────────────────────
--
-- Each is classified RETAIN (the record survives the person) but declared NOT
-- NULL, which makes that classification unachievable. Widening only.

ALTER TABLE "tickets"                          ALTER COLUMN "createdById"   DROP NOT NULL;
ALTER TABLE "ticket_history"                   ALTER COLUMN "changedById"   DROP NOT NULL;
ALTER TABLE "ticket_time_logs"                 ALTER COLUMN "userId"        DROP NOT NULL;
ALTER TABLE "comments"                         ALTER COLUMN "authorId"      DROP NOT NULL;
ALTER TABLE "operational_events"               ALTER COLUMN "actorId"       DROP NOT NULL;
ALTER TABLE "activity_logs"                    ALTER COLUMN "userId"        DROP NOT NULL;
ALTER TABLE "employee_profile_change_requests" ALTER COLUMN "requestedById" DROP NOT NULL;
ALTER TABLE "sales_lead_activities"                  ALTER COLUMN "createdById"   DROP NOT NULL;
ALTER TABLE "sales_followups"                       ALTER COLUMN "createdById"   DROP NOT NULL;
ALTER TABLE "attendance_import_batches"        ALTER COLUMN "uploadedById"  DROP NOT NULL;

-- ── 3. Fifteen attribution pointers ────────────────────────────────────────
--
-- One nullable column per relation classified RETAIN_WITH_SNAPSHOT, so a
-- surviving record can still say WHO, readably, after the User row is gone.

ALTER TABLE "tickets"                          ADD COLUMN IF NOT EXISTS "formerCreatorId"   TEXT;
ALTER TABLE "ticket_history"                   ADD COLUMN IF NOT EXISTS "formerActorId"     TEXT;
ALTER TABLE "ticket_time_logs"                 ADD COLUMN IF NOT EXISTS "formerActorId"     TEXT;
ALTER TABLE "review_cycle_logs"                ADD COLUMN IF NOT EXISTS "formerReviewerId"  TEXT;
ALTER TABLE "comments"                         ADD COLUMN IF NOT EXISTS "formerAuthorId"    TEXT;
ALTER TABLE "operational_events"               ADD COLUMN IF NOT EXISTS "formerActorId"     TEXT;
ALTER TABLE "activity_logs"                    ADD COLUMN IF NOT EXISTS "formerActorId"     TEXT;
ALTER TABLE "attendance_month_closes"          ADD COLUMN IF NOT EXISTS "formerFinalizerId" TEXT;
ALTER TABLE "attendance_month_closes"          ADD COLUMN IF NOT EXISTS "formerReopenerId"  TEXT;
ALTER TABLE "attendance_import_batches"        ADD COLUMN IF NOT EXISTS "formerUploaderId"  TEXT;
ALTER TABLE "attendance_import_batches"        ADD COLUMN IF NOT EXISTS "formerApproverId"  TEXT;
ALTER TABLE "attendance_import_batches"        ADD COLUMN IF NOT EXISTS "formerApplierId"   TEXT;
ALTER TABLE "employee_profile_change_requests" ADD COLUMN IF NOT EXISTS "formerRequesterId" TEXT;
ALTER TABLE "sales_lead_activities"                  ADD COLUMN IF NOT EXISTS "formerActorId"     TEXT;
ALTER TABLE "sales_followups"                       ADD COLUMN IF NOT EXISTS "formerActorId"     TEXT;

-- ── 4. Their foreign keys ──────────────────────────────────────────────────
--
-- ON DELETE RESTRICT, deliberately, on every one. A FormerEmployee is the only
-- remaining record of who somebody was; deleting one while a ticket still
-- points at it would re-create the exact problem this migration exists to
-- solve, so the database refuses rather than nulling it away.
--
-- ON UPDATE CASCADE propagates a primary-key change. It is not a delete rule,
-- and no ON DELETE CASCADE is created by this migration.

DO $$
DECLARE
    fk RECORD;
BEGIN
    FOR fk IN
        SELECT * FROM (VALUES
            ('tickets',                          'formerCreatorId',   'tickets_formerCreatorId_fkey'),
            ('ticket_history',                   'formerActorId',     'ticket_history_formerActorId_fkey'),
            ('ticket_time_logs',                 'formerActorId',     'ticket_time_logs_formerActorId_fkey'),
            ('review_cycle_logs',                'formerReviewerId',  'review_cycle_logs_formerReviewerId_fkey'),
            ('comments',                         'formerAuthorId',    'comments_formerAuthorId_fkey'),
            ('operational_events',               'formerActorId',     'operational_events_formerActorId_fkey'),
            ('activity_logs',                    'formerActorId',     'activity_logs_formerActorId_fkey'),
            ('attendance_month_closes',          'formerFinalizerId', 'attendance_month_closes_formerFinalizerId_fkey'),
            ('attendance_month_closes',          'formerReopenerId',  'attendance_month_closes_formerReopenerId_fkey'),
            ('attendance_import_batches',        'formerUploaderId',  'attendance_import_batches_formerUploaderId_fkey'),
            ('attendance_import_batches',        'formerApproverId',  'attendance_import_batches_formerApproverId_fkey'),
            ('attendance_import_batches',        'formerApplierId',   'attendance_import_batches_formerApplierId_fkey'),
            ('employee_profile_change_requests', 'formerRequesterId', 'employee_profile_change_requests_formerRequesterId_fkey'),
            ('sales_lead_activities',                  'formerActorId',     'sales_lead_activities_formerActorId_fkey'),
            ('sales_followups',                       'formerActorId',     'sales_followups_formerActorId_fkey')
        ) AS t(tbl, col, conname)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = fk.conname
        ) THEN
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) '
                || 'REFERENCES "former_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
                fk.tbl, fk.conname, fk.col
            );
        END IF;
    END LOOP;
END $$;
