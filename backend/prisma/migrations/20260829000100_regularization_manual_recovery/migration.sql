-- Manual Attendance Recovery: the last-resort path when neither the laptop nor
-- the employee's phone can produce evidence.
--
-- Purely additive. Five nullable columns, two new enums, one nullable foreign
-- key and one index. No existing column is altered or dropped, and existing
-- rows remain valid: createdById stays null and entrySource defaults to
-- EMPLOYEE_REQUEST, which is what every current row is. No backfill.
--
-- Safe to apply while the application is running.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "RegularizationEntrySource" AS ENUM ('EMPLOYEE_REQUEST', 'MANUAL_RECOVERY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ManualRecoveryReason" AS ENUM (
    'SERVER_UNAVAILABLE',
    'EMPLOYEE_INTERNET_ISSUE',
    'DEVICE_NETWORK_ISSUE',
    'CAMERA_OR_LOCATION_UNAVAILABLE',
    'PUNCH_SUBMISSION_FAILED',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "attendance_regularizations"
  ADD COLUMN IF NOT EXISTS "createdById" TEXT,
  ADD COLUMN IF NOT EXISTS "entrySource" "RegularizationEntrySource" NOT NULL DEFAULT 'EMPLOYEE_REQUEST',
  ADD COLUMN IF NOT EXISTS "recoveryReason" "ManualRecoveryReason",
  ADD COLUMN IF NOT EXISTS "employeeInformedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "actorRoleAtEntry" TEXT,
  -- Captured at creation and never recomputed: once the official record is
  -- rewritten the previous value exists nowhere else.
  ADD COLUMN IF NOT EXISTS "originalPunchIn" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "originalPunchOut" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "attendance_regularizations_entrySource_date_idx"
  ON "attendance_regularizations"("entrySource", "date");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "attendance_regularizations"
    ADD CONSTRAINT "attendance_regularizations_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
