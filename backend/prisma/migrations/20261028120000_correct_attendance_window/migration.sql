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
