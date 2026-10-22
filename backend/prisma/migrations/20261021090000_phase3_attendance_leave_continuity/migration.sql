-- Phase 3: attendance and leave continuity.
--
-- Additive only. Every new column is nullable or has a default; no existing row
-- is rewritten, backfilled or reclassified here. Historical punch evidence
-- keeps NULL device fields ("not recorded at the time").

-- ── Policy lifecycle: SCHEDULED ──────────────────────────────────────────
-- A version activated with a future effectiveFrom is SCHEDULED, not ACTIVE.
-- Only one version of a series is ever ACTIVE. Resolution is by date, so a
-- SCHEDULED version governs from its own company date even if no job runs.
ALTER TYPE "PolicyStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';

-- ── Attendance corrections: single-decision states ─────────────────────────
-- Added here, used by 20261021090100 (an enum value cannot be used in the
-- transaction that adds it). Legacy MANAGER_APPROVED / HR_APPROVED stay.
ALTER TYPE "RegularizationStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "RegularizationStatus" ADD VALUE IF NOT EXISTS 'STALE_REVIEW_REQUIRED';

-- ── Device evidence ───────────────────────────────────────────────────────
CREATE TYPE "DeviceType" AS ENUM ('MOBILE', 'TABLET', 'LAPTOP_DESKTOP', 'UNKNOWN');
CREATE TYPE "CaptureChannel" AS ENUM ('CURRENT_DEVICE', 'PHONE_HANDOFF');

ALTER TABLE "attendance_punch_evidence"
  ADD COLUMN "deviceId" TEXT,
  ADD COLUMN "deviceType" "DeviceType",
  ADD COLUMN "captureChannel" "CaptureChannel";

-- The Apex Device ID is an opaque browser-generated UUID. Anything else (a
-- hostname, a serial, a fingerprint) is refused by the database itself.
ALTER TABLE "attendance_punch_evidence"
  ADD CONSTRAINT "attendance_punch_evidence_device_id_format_chk"
  CHECK ("deviceId" IS NULL OR "deviceId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- A recorded id always comes with a classification.
ALTER TABLE "attendance_punch_evidence"
  ADD CONSTRAINT "attendance_punch_evidence_device_type_with_id_chk"
  CHECK ("deviceId" IS NULL OR "deviceType" IS NOT NULL);

CREATE INDEX "attendance_punch_evidence_deviceId_idx" ON "attendance_punch_evidence"("deviceId");
CREATE INDEX "attendance_punch_evidence_deviceType_businessDate_idx" ON "attendance_punch_evidence"("deviceType", "businessDate");
CREATE INDEX "attendance_punch_evidence_captureChannel_businessDate_idx" ON "attendance_punch_evidence"("captureChannel", "businessDate");

-- Restated with the same body: UPDATE is refused for every column, the new
-- device columns included, and the only DELETE is the row-scoped Permanent
-- Delete exception introduced by 20261014000000.
CREATE OR REPLACE FUNCTION "attendance_punch_evidence_append_only"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND "apex_row_delete_authorized"(OLD."userId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'attendance_punch_evidence is append-only: % is not permitted. Punch evidence is raw fact and is corrected by recording a new record, never by rewriting one.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- ── Leave policy: versioned notice rule for late submissions ──────────────
ALTER TABLE "leave_policies"
  ADD COLUMN "standardLeaveMinimumNoticeDays" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "leave_policies"
  ADD CONSTRAINT "leave_policies_notice_days_chk"
  CHECK ("standardLeaveMinimumNoticeDays" >= 0 AND "standardLeaveMinimumNoticeDays" <= 60);

-- ── Reported absences (stop the three-day unreported-absence rule) ────────
CREATE TABLE "absence_reports" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "channel" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "recordedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "absence_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "absence_reports_channel_chk" CHECK ("channel" IN ('EMAIL', 'PHONE', 'MESSAGE', 'OTHER')),
  CONSTRAINT "absence_reports_note_chk" CHECK (length(btrim("note")) > 0)
);
CREATE UNIQUE INDEX "absence_reports_userId_businessDate_key" ON "absence_reports"("userId", "businessDate");
CREATE INDEX "absence_reports_businessDate_idx" ON "absence_reports"("businessDate");

-- ── Three-day unreported-absence decisions ────────────────────────────────
CREATE TABLE "unreported_absence_decisions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "runStartDate" DATE NOT NULL,
  "runLength" INTEGER NOT NULL,
  "outcome" TEXT NOT NULL,
  "previousStatus" TEXT,
  "previousLwpDeducted" DOUBLE PRECISION,
  "previousRevision" INTEGER,
  "correctedById" TEXT,
  "correctedAt" TIMESTAMP(3),
  "correctionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "unreported_absence_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "unreported_absence_decisions_outcome_chk" CHECK ("outcome" IN ('APPLIED', 'SKIPPED_SETTLED', 'CORRECTED')),
  CONSTRAINT "unreported_absence_decisions_run_chk" CHECK ("runLength" >= 3 AND "runStartDate" <= "businessDate"),
  -- A correction always carries who, when and why, together.
  CONSTRAINT "unreported_absence_decisions_correction_chk" CHECK (
    ("outcome" = 'CORRECTED' AND "correctedById" IS NOT NULL AND "correctedAt" IS NOT NULL AND length(btrim(coalesce("correctionReason", ''))) > 0)
    OR ("outcome" <> 'CORRECTED' AND "correctedById" IS NULL AND "correctedAt" IS NULL AND "correctionReason" IS NULL)
  )
);
CREATE UNIQUE INDEX "unreported_absence_decisions_userId_businessDate_key" ON "unreported_absence_decisions"("userId", "businessDate");
CREATE INDEX "unreported_absence_decisions_outcome_idx" ON "unreported_absence_decisions"("outcome");
CREATE INDEX "unreported_absence_decisions_businessDate_idx" ON "unreported_absence_decisions"("businessDate");

-- A decision is audit history. The only permitted change is a single HR
-- correction (APPLIED or SKIPPED_SETTLED -> CORRECTED) that leaves every
-- original column as it was. DELETE only through Permanent Delete.
CREATE OR REPLACE FUNCTION "unreported_absence_decision_guard"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF "apex_row_delete_authorized"(OLD."userId") THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'unreported_absence_decisions are audit history and cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- Permanent Delete of the HR user who corrected it: the actor moves to the
  -- deleted-account principal (the CHECK requires an actor), nothing else.
  IF NEW."correctedById" = 'system-deleted-account'
     AND OLD."correctedById" IS DISTINCT FROM NEW."correctedById"
     AND "apex_row_delete_authorized"(OLD."correctedById")
     AND (to_jsonb(NEW) - 'correctedById') = (to_jsonb(OLD) - 'correctedById') THEN
    RETURN NEW;
  END IF;
  IF OLD."outcome" = 'CORRECTED'
     OR NEW."outcome" <> 'CORRECTED'
     OR NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."userId" IS DISTINCT FROM OLD."userId"
     OR NEW."businessDate" IS DISTINCT FROM OLD."businessDate"
     OR NEW."runStartDate" IS DISTINCT FROM OLD."runStartDate"
     OR NEW."runLength" IS DISTINCT FROM OLD."runLength"
     OR NEW."previousStatus" IS DISTINCT FROM OLD."previousStatus"
     OR NEW."previousLwpDeducted" IS DISTINCT FROM OLD."previousLwpDeducted"
     OR NEW."previousRevision" IS DISTINCT FROM OLD."previousRevision"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'unreported_absence_decisions may only be corrected once, without changing the original decision'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "unreported_absence_decisions_guard"
  BEFORE UPDATE OR DELETE ON "unreported_absence_decisions"
  FOR EACH ROW EXECUTE FUNCTION "unreported_absence_decision_guard"();

-- ── Leave evidence (Emergency Leave) ──────────────────────────────────────
-- Exactly what was submitted, by whom and when. Append-only: a file is never
-- replaced or edited (a correction is another row), and DELETE is possible
-- only through the row-scoped Permanent Delete exception.
CREATE TABLE "leave_evidence" (
  "id" TEXT NOT NULL,
  "leaveRequestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_evidence_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "leave_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "leave_evidence_size_chk" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 10485760),
  CONSTRAINT "leave_evidence_sha_chk" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "leave_evidence_mime_chk" CHECK ("mimeType" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp'))
);
CREATE UNIQUE INDEX "leave_evidence_leaveRequestId_sha256_key" ON "leave_evidence"("leaveRequestId", "sha256");
CREATE INDEX "leave_evidence_userId_idx" ON "leave_evidence"("userId");

CREATE OR REPLACE FUNCTION "leave_evidence_append_only"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND "apex_row_delete_authorized"(OLD."userId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'leave_evidence is append-only: % is not permitted. Submitted evidence is never replaced; add another file instead.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "leave_evidence_no_update"
  BEFORE UPDATE ON "leave_evidence"
  FOR EACH ROW EXECUTE FUNCTION "leave_evidence_append_only"();
CREATE TRIGGER "leave_evidence_no_delete"
  BEFORE DELETE ON "leave_evidence"
  FOR EACH ROW EXECUTE FUNCTION "leave_evidence_append_only"();
