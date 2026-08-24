-- Management Attendance Policy Extension — additive only.

ALTER TYPE "LeaveType" ADD VALUE IF NOT EXISTS 'CASUAL';
ALTER TYPE "LeaveType" ADD VALUE IF NOT EXISTS 'COMP_OFF';

CREATE TYPE "HalfDaySession" AS ENUM ('FIRST_HALF', 'SECOND_HALF');
CREATE TYPE "CompOffCreditStatus" AS ENUM ('AVAILABLE', 'USED', 'EXPIRED', 'CANCELLED');

ALTER TABLE "leave_requests"
ADD COLUMN "halfDaySession" "HalfDaySession";

-- Preserve the old free-text column and promote only values whose meaning is
-- already exact. Unknown historical strings remain untouched and unguessed.
UPDATE "leave_requests"
SET "halfDaySession" = CASE
  WHEN UPPER(TRIM("halfDayType")) = 'FIRST_HALF' THEN 'FIRST_HALF'::"HalfDaySession"
  WHEN UPPER(TRIM("halfDayType")) = 'SECOND_HALF' THEN 'SECOND_HALF'::"HalfDaySession"
  ELSE NULL
END
WHERE "isHalfDay" = true AND "halfDayType" IS NOT NULL;

ALTER TABLE "leave_policies"
ADD COLUMN "casualLeaveAllocation" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "emergencyLeaveAllocation" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN "firstHalfInEarliest" TEXT NOT NULL DEFAULT '09:30',
ADD COLUMN "firstHalfInLatest" TEXT NOT NULL DEFAULT '10:30',
ADD COLUMN "firstHalfRequiredPresenceMinutes" INTEGER NOT NULL DEFAULT 240,
ADD COLUMN "secondHalfInEarliest" TEXT NOT NULL DEFAULT '14:00',
ADD COLUMN "secondHalfInLatest" TEXT NOT NULL DEFAULT '14:30',
ADD COLUMN "secondHalfOutTime" TEXT NOT NULL DEFAULT '18:30',
ADD COLUMN "compOffExpiryDays" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE "comp_off_credits" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "earnedFromBusinessDate" DATE NOT NULL,
  "earnedFromWorkSessionId" TEXT,
  "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATE NOT NULL,
  "usedAt" TIMESTAMP(3),
  "leaveRequestId" TEXT,
  "status" "CompOffCreditStatus" NOT NULL DEFAULT 'AVAILABLE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "comp_off_credits_pkey" PRIMARY KEY ("id")
);

-- A leave request may consume MANY credits: a two-day COMP_OFF costs two. A
-- unique index here would have made multi-day comp off impossible to settle.
CREATE INDEX "comp_off_credits_leaveRequestId_idx"
  ON "comp_off_credits"("leaveRequestId");

-- One credit per employee per source business date, enforced by the database
-- rather than by a service-level check, so two concurrent grants for the same
-- day lose on the constraint instead of both succeeding.
CREATE UNIQUE INDEX "comp_off_credits_employeeId_earnedFromBusinessDate_key"
  ON "comp_off_credits"("employeeId", "earnedFromBusinessDate");
CREATE INDEX "comp_off_credits_employeeId_status_expiresAt_idx"
ON "comp_off_credits"("employeeId", "status", "expiresAt");
CREATE INDEX "comp_off_credits_earnedFromBusinessDate_idx"
ON "comp_off_credits"("earnedFromBusinessDate");
CREATE INDEX "comp_off_credits_earnedFromWorkSessionId_idx"
ON "comp_off_credits"("earnedFromWorkSessionId");

ALTER TABLE "comp_off_credits"
ADD CONSTRAINT "comp_off_credits_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comp_off_credits"
ADD CONSTRAINT "comp_off_credits_earnedFromWorkSessionId_fkey"
FOREIGN KEY ("earnedFromWorkSessionId") REFERENCES "work_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "comp_off_credits"
ADD CONSTRAINT "comp_off_credits_leaveRequestId_fkey"
FOREIGN KEY ("leaveRequestId") REFERENCES "leave_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
