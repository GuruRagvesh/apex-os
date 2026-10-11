-- CreateEnum
CREATE TYPE "AttendanceRecoveryTombstoneType" AS ENUM ('DAY', 'DAILY_ATTENDANCE', 'WORK_SESSION', 'BREAK_LOG', 'PUNCH_EVIDENCE', 'REGULARIZATION');

-- CreateTable
CREATE TABLE "attendance_recovery_tombstones" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "recordType" "AttendanceRecoveryTombstoneType" NOT NULL,
    "recordId" TEXT,
    "reason" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL,
    "deletedById" TEXT NOT NULL,
    "replacementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_recovery_tombstones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_recovery_tombstones_employeeId_businessDate_idx" ON "attendance_recovery_tombstones"("employeeId", "businessDate");

-- CreateIndex
CREATE INDEX "attendance_recovery_tombstones_recordType_recordId_idx" ON "attendance_recovery_tombstones"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "attendance_recovery_tombstones_createdAt_idx" ON "attendance_recovery_tombstones"("createdAt");
