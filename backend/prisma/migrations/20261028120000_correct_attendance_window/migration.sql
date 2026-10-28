-- The approved arrival window is inclusive from 09:30 through 10:30.
-- Correct only rows still carrying the previous migration's 13:00 default;
-- preserve any explicitly customized policy version.
ALTER TABLE "attendance_policies"
  ALTER COLUMN "lateArrivalBoundaryMinutes" SET DEFAULT 630;

UPDATE "attendance_policies"
SET "lateArrivalBoundaryMinutes" = 630
WHERE "lateArrivalBoundaryMinutes" = 780;

-- Lateness is resolved from shift start + grace. Normalize every governing
-- regular/TL policy to the same inclusive 10:30 cutoff without changing its
-- historical shift start or end time.
UPDATE "shift_policies"
SET "graceMinutes" = CASE
  WHEN "startTime" = '09:30' THEN 60
  WHEN "startTime" = '10:30' THEN 0
  ELSE "graceMinutes"
END
WHERE "category" IN ('REGULAR_EMPLOYEE', 'TEAM_LEADER')
  AND "status" IN ('ACTIVE', 'SCHEDULED')
  AND "startTime" IN ('09:30', '10:30')
  AND "graceMinutes" <> CASE
    WHEN "startTime" = '09:30' THEN 60
    WHEN "startTime" = '10:30' THEN 0
    ELSE "graceMinutes"
  END;

-- Repair official rows produced by the previous refined evaluator. That
-- version compared the break-excluded work total with 540 and encoded its
-- short-hours result as LATE. The approved measure is the elapsed span from
-- first punch-in to final punch-out, so breaks, meetings, and gaps between
-- sessions remain included.
--
-- Restrict this to evaluator-generated refined short-day rows with no approved
-- regularization. Imported history, manual decisions, and corrected days keep
-- their recorded authority. Locked/finalized rows are intentionally included:
-- ordinary re-evaluation cannot rewrite them, so the migration is the only
-- deterministic way to repair the already-visible October results.
UPDATE "daily_attendance"
SET
  "status" = 'PRESENT',
  "calculationReason" = CASE
    WHEN EXTRACT(EPOCH FROM ("punchOutAt" - "punchInAt")) / 60 >= 540
      THEN 'REFINED_FULL_DAY'
    ELSE 'REFINED_SHORT_DAY'
  END,
  "lateMinutes" = CASE
    WHEN ("punchInAt" AT TIME ZONE 'Asia/Kolkata')::time <= TIME '10:30:00'
      THEN 0
    ELSE "lateMinutes"
  END,
  "lwpDeducted" = CASE
    WHEN EXTRACT(EPOCH FROM ("punchOutAt" - "punchInAt")) / 60 >= 540
      THEN 0
    ELSE "lwpDeducted"
  END,
  "evaluatorVersion" = 3,
  "sourceFingerprint" = NULL,
  "updatedAt" = NOW()
WHERE "calculationReason" = 'REFINED_SHORT_DAY'
  AND "punchInAt" IS NOT NULL
  AND "punchOutAt" IS NOT NULL
  AND "lastRegularizationId" IS NULL;
