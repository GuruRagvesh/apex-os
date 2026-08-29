-- The durable record of what attendance data was finalized and sent to Finance.
--
-- Purely additive: one new table, one new enum, one nullable foreign key. No
-- existing column is altered, no data is moved, nothing else references it.
-- Safe to apply while the application is running.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "MonthCloseStatus" AS ENUM ('OPEN', 'REVIEWING', 'FINALIZED', 'SENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "attendance_month_closes" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" "MonthCloseStatus" NOT NULL DEFAULT 'OPEN',
    "employeeCount" INTEGER,
    "unresolvedDays" INTEGER,
    "employeesWithUnresolved" INTEGER,
    "finalizedById" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "recipientEmail" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveryStatus" TEXT,
    "reportSha256" TEXT,
    "reportByteSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_month_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- A month is closed once.
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_month_closes_month_key"
  ON "attendance_month_closes"("month");
CREATE INDEX IF NOT EXISTS "attendance_month_closes_status_idx"
  ON "attendance_month_closes"("status");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "attendance_month_closes"
    ADD CONSTRAINT "attendance_month_closes_finalizedById_fkey"
    FOREIGN KEY ("finalizedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
