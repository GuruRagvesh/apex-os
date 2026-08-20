-- BL-3 Employee Attendance Timeline.
--
-- Makes EmployeeAttendanceProfile capable of holding HISTORY. The table shipped
-- with effectiveFrom/effectiveTo columns but also a UNIQUE index on userId
-- alone, which physically forbids a second row -- so "Regular Employee until
-- 30 Jun, Team Leader from 1 Jul" could not be stored and the effective-dating
-- columns were decorative.
--
-- Dropping that index follows the precedent set by
-- 20260603165000_fix_workday_autoclose_resume_sessions, which removed
-- work_sessions_userId_date_key for the same reason and with the same guarded
-- IF EXISTS form.
--
-- Everything else is additive. No column or table is dropped, and no existing
-- row is modified: a single current profile per user remains valid data under
-- the new shape.
--
-- NOT YET APPLIED ANYWHERE. Staging deployment is a later step.

-- Allow more than one attendance profile per user, so the timeline can hold
-- superseded versions alongside the current one.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'employee_attendance_profiles'
      AND indexname = 'employee_attendance_profiles_userId_key'
  ) THEN
    DROP INDEX "employee_attendance_profiles_userId_key";
  END IF;
END $$;

-- AlterTable
-- Inclusive last working day. Kept as TIMESTAMP(3) to match the existing
-- users.joiningDate column type; all comparisons are normalised through the
-- company business-date contract rather than by changing a live column type.
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "lastWorkingDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "employee_attendance_profiles"
ADD COLUMN IF NOT EXISTS "assignedHolidayCalendarId" TEXT,
ADD COLUMN IF NOT EXISTS "assignedWeeklyOffPolicyId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "employee_attendance_profiles_userId_effectiveFrom_idx"
  ON "employee_attendance_profiles"("userId", "effectiveFrom");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "employee_attendance_profiles_userId_effectiveTo_idx"
  ON "employee_attendance_profiles"("userId", "effectiveTo");

-- AddForeignKey
ALTER TABLE "employee_attendance_profiles"
ADD CONSTRAINT "employee_attendance_profiles_assignedHolidayCalendarId_fkey"
FOREIGN KEY ("assignedHolidayCalendarId") REFERENCES "holiday_calendars"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_attendance_profiles"
ADD CONSTRAINT "employee_attendance_profiles_assignedWeeklyOffPolicyId_fkey"
FOREIGN KEY ("assignedWeeklyOffPolicyId") REFERENCES "weekly_off_policies"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
