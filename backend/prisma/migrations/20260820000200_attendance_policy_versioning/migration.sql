-- BL-4 Attendance Policy Versioning.
--
-- Gives AttendancePolicy, ShiftPolicy, LeavePolicy and HolidayCalendar a common
-- DRAFT -> APPROVED -> ACTIVE -> SUPERSEDED lifecycle with effective dating, so
-- a policy that has ever been active is never edited in place and historical
-- attendance keeps its original meaning.
--
-- Also introduces policyKey: the immutable identity of a logical policy SERIES.
-- Before this, versions of the same policy could only be matched by the MUTABLE
-- display name (financialYear + name, or attendancePolicyId + name for shifts),
-- with no unique constraint anywhere -- so nothing tied V1 to V2 and duplicates
-- were already possible.
--
-- Additive except for two deliberate, narrowly scoped backfills, both called
-- out below. No column is dropped and no type is changed.
--
-- NOT YET APPLIED ANYWHERE. See the staging preflight note at the end.

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('DRAFT', 'APPROVED', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PolicyDecisionAction" AS ENUM ('REQUIRE_REVIEW', 'NO_ACTION', 'MARK_HALF_DAY', 'MARK_ABSENT', 'DEDUCT_HALF_PAID_LEAVE', 'DEDUCT_FULL_PAID_LEAVE', 'MARK_LWP');

-- AlterTable
ALTER TABLE "attendance_policies"
ADD COLUMN IF NOT EXISTS "policyKey" TEXT,
ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "status" "PolicyStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN IF NOT EXISTS "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "effectiveTo" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "approvedById" TEXT,
ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "createdById" TEXT,
ADD COLUMN IF NOT EXISTS "supersededById" TEXT;

-- BACKFILL 1/2: every pre-existing row becomes the root of its own series.
-- Using the row's own id is deliberately conservative: it can never merge two
-- unrelated rows into one series, which guessing from name/financialYear could.
UPDATE "attendance_policies" SET "policyKey" = "id" WHERE "policyKey" IS NULL;

ALTER TABLE "attendance_policies" ALTER COLUMN "policyKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_policies_policyKey_version_key" ON "attendance_policies"("policyKey", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "attendance_policies_policyKey_idx" ON "attendance_policies"("policyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "attendance_policies_status_idx" ON "attendance_policies"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "attendance_policies_effectiveFrom_idx" ON "attendance_policies"("effectiveFrom");

-- AlterTable
ALTER TABLE "shift_policies"
ADD COLUMN IF NOT EXISTS "policyKey" TEXT,
ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "status" "PolicyStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN IF NOT EXISTS "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "effectiveTo" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "approvedById" TEXT,
ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "createdById" TEXT,
ADD COLUMN IF NOT EXISTS "supersededById" TEXT;

-- BACKFILL 1/2: every pre-existing row becomes the root of its own series.
-- Using the row's own id is deliberately conservative: it can never merge two
-- unrelated rows into one series, which guessing from name/financialYear could.
UPDATE "shift_policies" SET "policyKey" = "id" WHERE "policyKey" IS NULL;

ALTER TABLE "shift_policies" ALTER COLUMN "policyKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "shift_policies_policyKey_version_key" ON "shift_policies"("policyKey", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "shift_policies_policyKey_idx" ON "shift_policies"("policyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "shift_policies_status_idx" ON "shift_policies"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "shift_policies_effectiveFrom_idx" ON "shift_policies"("effectiveFrom");

-- AlterTable
ALTER TABLE "leave_policies"
ADD COLUMN IF NOT EXISTS "policyKey" TEXT,
ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "status" "PolicyStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN IF NOT EXISTS "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "effectiveTo" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "approvedById" TEXT,
ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "createdById" TEXT,
ADD COLUMN IF NOT EXISTS "supersededById" TEXT;

-- BACKFILL 1/2: every pre-existing row becomes the root of its own series.
-- Using the row's own id is deliberately conservative: it can never merge two
-- unrelated rows into one series, which guessing from name/financialYear could.
UPDATE "leave_policies" SET "policyKey" = "id" WHERE "policyKey" IS NULL;

ALTER TABLE "leave_policies" ALTER COLUMN "policyKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "leave_policies_policyKey_version_key" ON "leave_policies"("policyKey", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leave_policies_policyKey_idx" ON "leave_policies"("policyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leave_policies_status_idx" ON "leave_policies"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leave_policies_effectiveFrom_idx" ON "leave_policies"("effectiveFrom");

-- AlterTable
ALTER TABLE "holiday_calendars"
ADD COLUMN IF NOT EXISTS "policyKey" TEXT,
ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "status" "PolicyStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN IF NOT EXISTS "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "effectiveTo" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "approvedById" TEXT,
ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "createdById" TEXT,
ADD COLUMN IF NOT EXISTS "supersededById" TEXT;

-- BACKFILL 1/2: every pre-existing row becomes the root of its own series.
-- Using the row's own id is deliberately conservative: it can never merge two
-- unrelated rows into one series, which guessing from name/financialYear could.
UPDATE "holiday_calendars" SET "policyKey" = "id" WHERE "policyKey" IS NULL;

ALTER TABLE "holiday_calendars" ALTER COLUMN "policyKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "holiday_calendars_policyKey_version_key" ON "holiday_calendars"("policyKey", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "holiday_calendars_policyKey_idx" ON "holiday_calendars"("policyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "holiday_calendars_status_idx" ON "holiday_calendars"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "holiday_calendars_effectiveFrom_idx" ON "holiday_calendars"("effectiveFrom");

-- AlterTable: configurable management rules, all defaulting to REQUIRE_REVIEW
-- so no undecided rule can silently affect payroll.
ALTER TABLE "attendance_policies"
ADD COLUMN IF NOT EXISTS "afterPunchWindowAction" "PolicyDecisionAction" NOT NULL DEFAULT 'REQUIRE_REVIEW',
ADD COLUMN IF NOT EXISTS "insufficientHoursAction" "PolicyDecisionAction" NOT NULL DEFAULT 'REQUIRE_REVIEW',
ADD COLUMN IF NOT EXISTS "automaticHalfDayEnabled" BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL 2/2 -- STAGING PREFLIGHT REQUIRED BEFORE THIS IS APPLIED ANYWHERE.
--
-- Rows already flagged isActive predate this lifecycle and are in live use.
-- Leaving them at the DRAFT default would make live configuration look
-- unapproved. They become ACTIVE with version 1.
--
-- This is only coherent if each policy family has AT MOST ONE isActive row.
-- Legacy data has never been constrained that way, and the historical notion of
-- "the same logical policy" DIFFERS PER TABLE -- do not run one generic
-- financialYear+name query against all four. Run each of these on staging and
-- confirm every one returns zero rows:
--
--   -- attendance_policies: financialYear + name
--   SELECT "financialYear", "name", COUNT(*)
--   FROM "attendance_policies" WHERE "isActive" = true
--   GROUP BY 1, 2 HAVING COUNT(*) > 1;
--
--   -- shift_policies: scoped to the parent policy, NOT financialYear
--   SELECT "attendancePolicyId", "name", COUNT(*)
--   FROM "shift_policies" WHERE "isActive" = true
--   GROUP BY 1, 2 HAVING COUNT(*) > 1;
--
--   -- leave_policies: financialYear + name
--   SELECT "financialYear", "name", COUNT(*)
--   FROM "leave_policies" WHERE "isActive" = true
--   GROUP BY 1, 2 HAVING COUNT(*) > 1;
--
--   -- holiday_calendars: financialYear + name
--   SELECT "financialYear", "name", COUNT(*)
--   FROM "holiday_calendars" WHERE "isActive" = true
--   GROUP BY 1, 2 HAVING COUNT(*) > 1;
--
-- If any query returns a row, resolve the ambiguity first -- do not let this
-- backfill decide it.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "attendance_policies" SET "status" = 'ACTIVE' WHERE "isActive" = true AND "status" = 'DRAFT';
UPDATE "shift_policies"      SET "status" = 'ACTIVE' WHERE "isActive" = true AND "status" = 'DRAFT';
UPDATE "leave_policies"      SET "status" = 'ACTIVE' WHERE "isActive" = true AND "status" = 'DRAFT';
UPDATE "holiday_calendars"   SET "status" = 'ACTIVE' WHERE "isActive" = true AND "status" = 'DRAFT';
