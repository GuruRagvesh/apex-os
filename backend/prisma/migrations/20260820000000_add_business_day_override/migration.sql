-- BL-2A Business Calendar foundation.
--
-- Purely additive: one new enum and one new table. No existing table, column,
-- index or constraint is altered or dropped.
--
-- NOT YET APPLIED ANYWHERE. Staging deployment is BL-2B.

-- CreateEnum
CREATE TYPE "BusinessDayOverrideType" AS ENUM ('SPECIAL_WORKING_DAY', 'COMPANY_CLOSURE');

-- CreateTable
CREATE TABLE "business_day_overrides" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "BusinessDayOverrideType" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_day_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_day_overrides_date_key" ON "business_day_overrides"("date");

-- CreateIndex
CREATE INDEX "business_day_overrides_type_idx" ON "business_day_overrides"("type");

-- CreateIndex
CREATE INDEX "business_day_overrides_revokedAt_idx" ON "business_day_overrides"("revokedAt");
