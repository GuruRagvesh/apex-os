-- AE-1: Daily Attendance evaluation layer.
--
-- Purely additive. Every new column is nullable or defaulted, so existing rows
-- (of which there are none today -- nothing has ever written this table) and
-- existing readers are unaffected.
--
-- Provenance ids are deliberately plain text with NO foreign keys: this table
-- explains a decision made on a past date, and must keep explaining it after
-- the policy, calendar or leave row it names has been superseded or removed.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DailyAttendanceEvaluationState') THEN
    CREATE TYPE "DailyAttendanceEvaluationState" AS ENUM ('CALCULATED', 'NEEDS_REVIEW', 'FINALIZED');
  END IF;
END
$$;

-- AlterTable
ALTER TABLE "daily_attendance"
  ADD COLUMN IF NOT EXISTS "evaluationState" "DailyAttendanceEvaluationState" NOT NULL DEFAULT 'CALCULATED',
  ADD COLUMN IF NOT EXISTS "evaluatorVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "resolverVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "evaluatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "exceptionFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "sourceFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "employeeProfileId" TEXT,
  ADD COLUMN IF NOT EXISTS "attendancePolicyId" TEXT,
  ADD COLUMN IF NOT EXISTS "attendancePolicyVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "shiftPolicyId" TEXT,
  ADD COLUMN IF NOT EXISTS "shiftPolicyVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "holidayCalendarId" TEXT,
  ADD COLUMN IF NOT EXISTS "weeklyOffPolicyId" TEXT,
  ADD COLUMN IF NOT EXISTS "holidayId" TEXT,
  ADD COLUMN IF NOT EXISTS "businessDayOverrideId" TEXT,
  ADD COLUMN IF NOT EXISTS "leaveRequestId" TEXT,
  ADD COLUMN IF NOT EXISTS "punchInEvidenceId" TEXT,
  ADD COLUMN IF NOT EXISTS "punchOutEvidenceId" TEXT,
  ADD COLUMN IF NOT EXISTS "workSessionIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX IF NOT EXISTS "daily_attendance_evaluationState_idx"
  ON "daily_attendance"("evaluationState");
