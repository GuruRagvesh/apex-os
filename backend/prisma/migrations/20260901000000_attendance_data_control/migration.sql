-- Attendance Data Control: durable import batches and rows.
--
-- ADDITIVE ONLY. Every statement below is a CREATE or an ADD COLUMN. Nothing is
-- dropped, renamed, retyped or narrowed, and no existing table is rewritten:
-- the one ALTER TABLE adds a NOT NULL BOOLEAN with a DEFAULT, which PostgreSQL
-- 11+ records as metadata rather than rewriting the heap.
--
-- These tables never hold attendance. They hold what somebody uploaded and what
-- Apex OS made of it. The authoritative write stays AttendanceRegularization ->
-- reviseForApprovedCorrection().

-- CreateEnum
CREATE TYPE "AttendanceImportMode" AS ENUM ('CURRENT_CORRECTION', 'HISTORICAL_MIGRATION');
-- CreateEnum
CREATE TYPE "AttendanceImportStatus" AS ENUM ('UPLOADING', 'VALIDATING', 'READY_FOR_REVIEW', 'HAS_ERRORS', 'APPROVED', 'APPLYING', 'APPLIED', 'PARTIALLY_APPLIED', 'FAILED', 'CANCELLED');
-- CreateEnum
CREATE TYPE "AttendanceImportRowClass" AS ENUM ('NEW', 'MATCH', 'CHANGE', 'CONFLICT', 'INVALID');
-- CreateEnum
CREATE TYPE "AttendanceImportRowState" AS ENUM ('PENDING', 'APPLIED', 'SKIPPED_STALE', 'FAILED');
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
ALTER TYPE "RegularizationEntrySource" ADD VALUE 'BULK_IMPORT';
ALTER TYPE "RegularizationEntrySource" ADD VALUE 'HISTORICAL_IMPORT';
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isAttendanceDataOperator" BOOLEAN NOT NULL DEFAULT false;
-- CreateTable
CREATE TABLE "attendance_import_batches" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "mode" "AttendanceImportMode" NOT NULL,
    "status" "AttendanceImportStatus" NOT NULL DEFAULT 'UPLOADING',
    "fileName" TEXT NOT NULL,
    "fileByteSize" INTEGER NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "vaultObjectKey" TEXT,
    "periodFrom" DATE,
    "periodTo" DATE,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "newRows" INTEGER NOT NULL DEFAULT 0,
    "matchRows" INTEGER NOT NULL DEFAULT 0,
    "changeRows" INTEGER NOT NULL DEFAULT 0,
    "conflictRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "warningRows" INTEGER NOT NULL DEFAULT 0,
    "appliedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "attendance_import_batches_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "attendance_import_rows" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawEmployeeId" TEXT NOT NULL,
    "rawName" TEXT,
    "rawDate" TEXT,
    "rawStatus" TEXT,
    "rawPunchIn" TEXT,
    "rawPunchOut" TEXT,
    "rawHalfDay" TEXT,
    "rawLeaveType" TEXT,
    "rawReason" TEXT,
    "userId" TEXT,
    "businessDate" DATE,
    "proposedStatus" "DailyAttendanceStatus",
    "proposedPunchIn" TIMESTAMP(3),
    "proposedPunchOut" TIMESTAMP(3),
    "proposedHalfDay" "HalfDaySession",
    "proposedLeaveType" "LeaveType",
    "normalizedReason" TEXT,
    "currentStatus" "DailyAttendanceStatus",
    "currentPunchIn" TIMESTAMP(3),
    "currentPunchOut" TIMESTAMP(3),
    "currentPunchInEvidenceId" TEXT,
    "currentPunchOutEvidenceId" TEXT,
    "currentFingerprint" TEXT,
    "classification" "AttendanceImportRowClass",
    "messages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "applyState" "AttendanceImportRowState" NOT NULL DEFAULT 'PENDING',
    "appliedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "regularizationId" TEXT,
    CONSTRAINT "attendance_import_rows_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "attendance_import_batches_reference_key" ON "attendance_import_batches"("reference");
-- CreateIndex
CREATE INDEX "attendance_import_batches_status_idx" ON "attendance_import_batches"("status");
-- CreateIndex
CREATE INDEX "attendance_import_batches_uploadedById_idx" ON "attendance_import_batches"("uploadedById");
-- CreateIndex
CREATE INDEX "attendance_import_batches_fileSha256_idx" ON "attendance_import_batches"("fileSha256");
-- CreateIndex
CREATE INDEX "attendance_import_batches_uploadedAt_idx" ON "attendance_import_batches"("uploadedAt");
-- CreateIndex
CREATE UNIQUE INDEX "attendance_import_rows_regularizationId_key" ON "attendance_import_rows"("regularizationId");
-- CreateIndex
CREATE INDEX "attendance_import_rows_batchId_classification_idx" ON "attendance_import_rows"("batchId", "classification");
-- CreateIndex
CREATE INDEX "attendance_import_rows_userId_businessDate_idx" ON "attendance_import_rows"("userId", "businessDate");
-- CreateIndex
CREATE INDEX "attendance_import_rows_batchId_applyState_idx" ON "attendance_import_rows"("batchId", "applyState");
-- CreateIndex
CREATE UNIQUE INDEX "attendance_import_rows_batchId_rowNumber_key" ON "attendance_import_rows"("batchId", "rowNumber");
-- AddForeignKey
ALTER TABLE "attendance_import_batches" ADD CONSTRAINT "attendance_import_batches_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "attendance_import_batches" ADD CONSTRAINT "attendance_import_batches_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "attendance_import_rows" ADD CONSTRAINT "attendance_import_rows_regularizationId_fkey" FOREIGN KEY ("regularizationId") REFERENCES "attendance_regularizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "attendance_import_rows" ADD CONSTRAINT "attendance_import_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "attendance_import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- MAKER / CHECKER, AT THE DATABASE.
--
-- The service refuses a self-approved batch, but the rule is worth more than
-- one service method: an import can rewrite months of official attendance, and
-- "the uploader was not the approver" should hold even against a future code
-- path that forgets to ask. NULL passes, because an unapproved batch has no
-- approver yet.
ALTER TABLE "attendance_import_batches"
  ADD CONSTRAINT "attendance_import_batches_approver_differs_from_uploader"
  CHECK ("approvedById" IS NULL OR "approvedById" <> "uploadedById");
