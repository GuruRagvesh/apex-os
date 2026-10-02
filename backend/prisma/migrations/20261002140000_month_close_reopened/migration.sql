-- Explicit reopening of a finalized attendance month.
--
-- PURELY ADDITIVE. One new enum value and four nullable/defaulted columns.
-- Nothing is dropped, nothing is narrowed, and no existing row changes meaning:
-- every month close keeps the status it has, and reopenCount defaults to 0,
-- which is the truth for every month that has never been reopened.
--
-- WHY A NEW STATUS RATHER THAN REUSING OPEN. A month that was finalized and
-- then deliberately unsealed is not the same fact as a month nobody has closed
-- yet. Sending OPEN back would erase that it had ever been sealed, which is the
-- fact an audit of a corrected month depends on.
--
-- ALTER TYPE ... ADD VALUE CANNOT RUN INSIDE A TRANSACTION in PostgreSQL
-- before 12, and Prisma wraps each migration in one. The IF NOT EXISTS form is
-- used so a re-run is harmless; on PostgreSQL 12+ (this deployment is on 18)
-- adding an enum value inside a transaction is supported.
ALTER TYPE "MonthCloseStatus" ADD VALUE IF NOT EXISTS 'REOPENED';

-- Who reopened the month, when, and why. The reason is enforced by the
-- service, not by a NOT NULL constraint: existing rows have no reason and must
-- not be invented one.
ALTER TABLE "attendance_month_closes"
  ADD COLUMN IF NOT EXISTS "reopenedById" TEXT,
  ADD COLUMN IF NOT EXISTS "reopenedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reopenReason" TEXT,
  ADD COLUMN IF NOT EXISTS "reopenCount"  INTEGER NOT NULL DEFAULT 0;

-- ON DELETE SET NULL, deliberately, and NOT Cascade.
--
-- Deleting the HR user who reopened a month must never delete the month close
-- itself -- that would take a payroll record out with an employee record. The
-- reopen is kept with its reason and timestamp; only the link to the person is
-- released, which is the same shape the finalizer relation already uses.
-- Wrapped in a DO block to swallow duplicate_object, matching the migration
-- that added the finalizer constraint.
DO $$ BEGIN
  ALTER TABLE "attendance_month_closes"
    ADD CONSTRAINT "attendance_month_closes_reopenedById_fkey"
    FOREIGN KEY ("reopenedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
