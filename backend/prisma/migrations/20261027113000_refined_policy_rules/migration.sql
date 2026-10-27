-- Policies_Refined.docx. Text provenance columns avoid owner-only changes to
-- historical PostgreSQL enums and keep old rows readable.
ALTER TABLE "attendance_regularizations"
  ADD COLUMN IF NOT EXISTS "policyCorrectionType" TEXT;

ALTER TABLE "exit_cases"
  ADD COLUMN IF NOT EXISTS "noticePolicyCode" TEXT;

ALTER TABLE "attendance_policies"
  ADD COLUMN IF NOT EXISTS "halfDayMaximumMinutes" INTEGER NOT NULL DEFAULT 270,
  ADD COLUMN IF NOT EXISTS "lateArrivalBoundaryMinutes" INTEGER NOT NULL DEFAULT 780,
  ADD COLUMN IF NOT EXISTS "fullHalfDayCompletionMinutes" INTEGER NOT NULL DEFAULT 1110,
  ADD COLUMN IF NOT EXISTS "earlyCheckoutBoundaryMinutes" INTEGER NOT NULL DEFAULT 960,
  ADD COLUMN IF NOT EXISTS "shortDayPayDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0.3333333333333333;

ALTER TABLE "comp_off_credits"
  ADD COLUMN IF NOT EXISTS "creditMinutes" INTEGER NOT NULL DEFAULT 540,
  ADD COLUMN IF NOT EXISTS "remainingMinutes" INTEGER NOT NULL DEFAULT 540;

ALTER TABLE "comp_off_credits"
  ADD CONSTRAINT "comp_off_credit_minutes_valid"
  CHECK ("creditMinutes" > 0 AND "remainingMinutes" >= 0 AND "remainingMinutes" <= "creditMinutes");
