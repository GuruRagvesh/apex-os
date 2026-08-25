-- AR-1 hardening: separate attendance SPAN from EFFECTIVE WORK.
--
-- AttendancePolicy.minimumWorkingMinutes (540) is the required presence span:
-- the shift window it accompanies, 10:00 to 19:00, is exactly 540 minutes, which
-- can only be met if breaks sit inside the span. Comparing effective work
-- against it made an ordinary lunch break look like a short day.
--
-- The field is NOT renamed, because renaming a live column to fix a reading is
-- a destructive change to make for a comment's sake. The two genuinely missing
-- measures are added instead, and the evaluator maps all three explicitly.

ALTER TABLE "attendance_policies"
  ADD COLUMN IF NOT EXISTS "permittedBreakMinutes" INTEGER NOT NULL DEFAULT 60,
  -- Nullable on purpose: an effective-work floor is only checked when somebody
  -- deliberately sets one, so this migration cannot newly fail any employee.
  ADD COLUMN IF NOT EXISTS "minimumEffectiveWorkMinutes" INTEGER;
