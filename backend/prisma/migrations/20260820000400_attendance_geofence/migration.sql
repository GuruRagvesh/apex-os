-- PE-2 Server-side geofence validation.
--
-- Adds the attendance-location configuration a punch is validated against, the
-- assignment on the effective-dated employee profile, and the decision
-- provenance stored on the immutable evidence row.
--
-- Purely additive: one new table, one nullable column on
-- employee_attendance_profiles, four nullable columns on
-- attendance_punch_evidence, plus indexes and foreign keys. No column is
-- dropped, no type is changed, and no existing row is modified.
--
-- The new evidence columns are nullable for schema reasons only. They are NOT a
-- "fill in later" mechanism: attendance_punch_evidence remains append-only
-- (the PE-1 triggers still reject UPDATE and DELETE), and PE-2 computes the
-- location verdict and its provenance BEFORE the single INSERT.
--
-- NOT YET APPLIED ANYWHERE.

-- CreateTable
CREATE TABLE "attendance_locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 150,
    "minimumAccuracyMeters" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_locations_isActive_idx" ON "attendance_locations"("isActive");

-- AlterTable
ALTER TABLE "employee_attendance_profiles"
ADD COLUMN IF NOT EXISTS "assignedAttendanceLocationId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "employee_attendance_profiles_assignedAttendanceLocationId_idx"
  ON "employee_attendance_profiles"("assignedAttendanceLocationId");

-- AlterTable
ALTER TABLE "attendance_punch_evidence"
ADD COLUMN IF NOT EXISTS "attendanceLocationId" TEXT,
ADD COLUMN IF NOT EXISTS "distanceFromLocationMeters" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "geofenceRadiusMeters" INTEGER,
ADD COLUMN IF NOT EXISTS "accuracyThresholdMeters" INTEGER;

-- AddForeignKey
ALTER TABLE "employee_attendance_profiles"
ADD CONSTRAINT "employee_attendance_profiles_assignedAttendanceLocationId_fkey"
FOREIGN KEY ("assignedAttendanceLocationId") REFERENCES "attendance_locations"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_punch_evidence"
ADD CONSTRAINT "attendance_punch_evidence_attendanceLocationId_fkey"
FOREIGN KEY ("attendanceLocationId") REFERENCES "attendance_locations"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- AlterEnum: NOT_ENFORCED
--
-- Recorded when the governing AttendancePolicy has geoFenceEnabled = false.
-- GPS is still captured and stored; it is simply not enforced against a
-- location. It is deliberately a distinct value rather than VERIFIED, which
-- would falsely assert the employee was inside an approved location.
--
-- Added here rather than in the committed PE-1 migration. IF NOT EXISTS makes
-- it safe to re-run, and the type was created by a migration that commits
-- before this one, so the value is usable immediately afterwards.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TYPE "PunchLocationVerification" ADD VALUE IF NOT EXISTS 'NOT_ENFORCED';
