-- One-time handoff letting an employee finish a punch on their phone when the
-- laptop cannot produce camera or location evidence.
--
-- Purely additive: one new table and one new enum. No existing column is
-- altered, no data is moved, and nothing outside this table references it.
-- Safe to apply while the application is running.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PunchHandoffStatus" AS ENUM ('WAITING', 'COMPLETED', 'EXPIRED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "attendance_punch_handoffs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "intent" "PunchType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "PunchHandoffStatus" NOT NULL DEFAULT 'WAITING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "evidenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_punch_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_punch_handoffs_tokenHash_key"
  ON "attendance_punch_handoffs"("tokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_punch_handoffs_idempotencyKey_key"
  ON "attendance_punch_handoffs"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_punch_handoffs_evidenceId_key"
  ON "attendance_punch_handoffs"("evidenceId");
CREATE INDEX IF NOT EXISTS "attendance_punch_handoffs_userId_status_idx"
  ON "attendance_punch_handoffs"("userId", "status");
CREATE INDEX IF NOT EXISTS "attendance_punch_handoffs_expiresAt_idx"
  ON "attendance_punch_handoffs"("expiresAt");

-- AddForeignKey
ALTER TABLE "attendance_punch_handoffs"
  ADD CONSTRAINT "attendance_punch_handoffs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
