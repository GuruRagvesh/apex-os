-- AlterTable: add isHalfDay and halfDayType to leave_requests
-- These columns were applied via db push in P1-A; this migration formalises them
-- so that `prisma migrate deploy` on a fresh / production database adds them correctly.

ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "isHalfDay" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "halfDayType" TEXT;
