-- AR-1: activate the dormant AttendanceRegularization model and record which
-- approved correction produced the current official attendance fact.
--
-- Deliberately small. AttendanceRegularization already carries the employee,
-- the date, the request type, the reason, the proposed punch times, and BOTH
-- approval slots (managerApproverId/managerDecisionAt, hrApproverId/hrDecisionAt).
-- RegularizationStatus already encodes the maker-checker chain
-- (PENDING -> MANAGER_APPROVED -> HR_APPROVED / REJECTED), so no new stage
-- enum is introduced. Only two genuinely missing concepts are added.

-- AlterTable: the official record remembers how it came to be corrected.
ALTER TABLE "daily_attendance"
  ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastRegularizationId" TEXT;

-- AlterTable: staleness guard + an explicit granted status.
--
-- basedOnFingerprint captures the official result's sourceFingerprint at the
-- moment the request was raised. At final approval it is compared against the
-- current record, so a correction argued against a stale view of the day cannot
-- silently overwrite a newer official result.
ALTER TABLE "attendance_regularizations"
  ADD COLUMN IF NOT EXISTS "basedOnFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "proposedStatus" "DailyAttendanceStatus";

-- CreateIndex: the manager/HR review queue reads by stage.
CREATE INDEX IF NOT EXISTS "attendance_regularizations_status_date_idx"
  ON "attendance_regularizations"("status", "date");
