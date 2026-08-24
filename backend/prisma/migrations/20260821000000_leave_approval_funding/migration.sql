-- LH-2: Manager -> HR approval lifecycle and funding settlement for leave.
--
-- Purely additive. LeaveStatus is untouched, so every existing reader that
-- checks PENDING / APPROVED / REJECTED / CANCELLED keeps working unchanged.
-- The new stage runs alongside it.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeaveApprovalStage') THEN
    CREATE TYPE "LeaveApprovalStage" AS ENUM ('MANAGER_REVIEW', 'HR_REVIEW', 'COMPLETE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeaveFundingOutcome') THEN
    CREATE TYPE "LeaveFundingOutcome" AS ENUM ('PAID', 'UNPAID', 'PARTIAL');
  END IF;
END
$$;

-- AlterTable
ALTER TABLE "leave_requests"
  ADD COLUMN IF NOT EXISTS "approvalStage" "LeaveApprovalStage" NOT NULL DEFAULT 'MANAGER_REVIEW',
  ADD COLUMN IF NOT EXISTS "managerApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "managerApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "hrApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "hrApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "fundingOutcome" "LeaveFundingOutcome",
  ADD COLUMN IF NOT EXISTS "paidDays" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "unpaidDays" DOUBLE PRECISION;

-- Backfill the stage from the status that already exists.
--
-- APPROVED rows are finished, so their chain is COMPLETE. REJECTED and
-- CANCELLED are equally terminal: no further review will ever happen on them,
-- and leaving them at MANAGER_REVIEW would put dead rows in an HR queue.
-- PENDING rows keep the column default and start at MANAGER_REVIEW.
UPDATE "leave_requests"
   SET "approvalStage" = 'COMPLETE'
 WHERE "status" IN ('APPROVED', 'REJECTED', 'CANCELLED');

-- Historical rows get NO stage-specific provenance. This is deliberate.
--
-- The legacy system had ONE final approver, who may have been a Team Lead, a
-- Manager, an Admin or a Super Admin. We know they gave the final approval; we
-- do NOT know they were HR. Copying approvedBy into hrApprovedById would turn
-- an unknown into a recorded fact and make the audit trail assert something
-- that was never true.
--
-- So managerApprovedById/At and hrApprovedById/At stay NULL, and approvedBy /
-- approvedAt are preserved exactly as they are. A legacy row therefore reads as
-- "completed under the legacy single-stage workflow", which is all the data
-- actually supports.
--
-- fundingOutcome / paidDays / unpaidDays stay NULL for the same reason: the old
-- system never recorded a settlement, and deriving one now would mean
-- recalculating a past decision against today's calendar and balance. AE-1
-- treats a null funding outcome as "legacy approved leave".

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leave_requests_approvalStage_idx"
  ON "leave_requests"("approvalStage");
