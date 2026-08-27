-- PE-1 Immutable Punch Evidence.
--
-- Creates the append-only raw-evidence table for future Punch In / Punch Out,
-- plus a database-level guard that rejects UPDATE and DELETE on it.
--
-- Purely additive: four new enums, one new table, and one trigger on that new
-- table. No existing table, column, index, constraint or row is touched. The
-- trigger is deliberately scoped to a table created in this same migration --
-- it has no rows and no readers, so the guarantee cannot affect the live
-- Workday engine or its attendance_events audit stream.
--
-- NOT YET APPLIED ANYWHERE.

-- CreateEnum
CREATE TYPE "PunchType" AS ENUM ('PUNCH_IN', 'PUNCH_OUT');

-- CreateEnum
CREATE TYPE "PunchLocationVerification" AS ENUM ('PENDING', 'VERIFIED', 'OUTSIDE_GEOFENCE', 'LOW_ACCURACY', 'UNAVAILABLE', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "PunchPhotoVerification" AS ENUM ('PENDING', 'CAPTURED', 'MISSING', 'REJECTED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "PunchSource" AS ENUM ('WEB', 'PWA', 'MOBILE', 'MANUAL_APPROVED');

-- CreateTable
CREATE TABLE "attendance_punch_evidence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PunchType" NOT NULL,
    "businessDate" DATE NOT NULL,
    "serverOccurredAt" TIMESTAMP(3) NOT NULL,
    "clientCapturedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyMeters" DOUBLE PRECISION,
    "locationVerification" "PunchLocationVerification" NOT NULL DEFAULT 'PENDING',
    "photoObjectKey" TEXT,
    "photoHash" TEXT,
    "photoVerification" "PunchPhotoVerification" NOT NULL DEFAULT 'PENDING',
    "source" "PunchSource" NOT NULL DEFAULT 'WEB',
    "deviceMetadata" JSONB,
    "ipAddress" TEXT,
    "workSessionId" TEXT,
    "employeeProfileId" TEXT,
    "shiftPolicyId" TEXT,
    "shiftPolicyVersion" INTEGER,
    "attendancePolicyId" TEXT,
    "attendancePolicyVersion" INTEGER,
    "contextResolverVersion" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_punch_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_punch_evidence_userId_idempotencyKey_key" ON "attendance_punch_evidence"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "attendance_punch_evidence_userId_businessDate_idx" ON "attendance_punch_evidence"("userId", "businessDate");

-- CreateIndex
CREATE INDEX "attendance_punch_evidence_businessDate_idx" ON "attendance_punch_evidence"("businessDate");

-- CreateIndex
CREATE INDEX "attendance_punch_evidence_type_idx" ON "attendance_punch_evidence"("type");

-- AddForeignKey
ALTER TABLE "attendance_punch_evidence" ADD CONSTRAINT "attendance_punch_evidence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_punch_evidence" ADD CONSTRAINT "attendance_punch_evidence_workSessionId_fkey" FOREIGN KEY ("workSessionId") REFERENCES "work_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- APPEND-ONLY GUARANTEE
--
-- Service-level immutability is not enough on its own: it protects only the
-- paths that go through the service. This makes the guarantee a property of the
-- table, so a stray script, a console session or a future refactor cannot
-- quietly rewrite evidence.
--
-- INSERT is unaffected. UPDATE and DELETE raise.
--
-- Scoped strictly to this new table. It is created empty in this migration and
-- nothing reads or writes it yet, so no existing behaviour can be affected.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "attendance_punch_evidence_append_only"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'attendance_punch_evidence is append-only: % is not permitted. Punch evidence is raw fact and is corrected by recording a new record, never by rewriting one.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "attendance_punch_evidence_no_update"
  BEFORE UPDATE ON "attendance_punch_evidence"
  FOR EACH ROW EXECUTE FUNCTION "attendance_punch_evidence_append_only"();

CREATE TRIGGER "attendance_punch_evidence_no_delete"
  BEFORE DELETE ON "attendance_punch_evidence"
  FOR EACH ROW EXECUTE FUNCTION "attendance_punch_evidence_append_only"();
