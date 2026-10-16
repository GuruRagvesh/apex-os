-- Phase 1 lifecycle foundation (2 of 2): nullable columns on existing tables,
-- legal-hold states with per-state CHECKs and the status guard trigger.
-- Source: PHASE1_FINAL_SPEC_2026-10-15 (Gate 1 approved), SQL v2.3.
--
-- Additive only. The single non-null addition is
-- leave_policies.sickLeaveAllocation DEFAULT 4, which no Phase 1 code reads.
-- user_legal_holds.placedAt loses its default and NOT NULL; existing values
-- are untouched. No existing row is rewritten.

ALTER TABLE "users"
  ADD COLUMN "employmentState" "EmploymentState",
  ADD COLUMN "scheduledActivationOn" DATE;

ALTER TABLE "leave_policies"
  ADD COLUMN "sickLeaveAllocation" INTEGER NOT NULL DEFAULT 4;

ALTER TABLE "leave_requests"
  -- Nullable on purpose (review item B): NULL = legacy, derived at read time
  -- (type EMERGENCY -> EMERGENCY, else STANDARD; setupStatus NULL -> LEGACY_UNASSESSED).
  ADD COLUMN "submissionMode" "LeaveSubmissionMode",
  ADD COLUMN "fundingBucket" "LeaveFundingBucket",
  ADD COLUMN "fundingChangedById" TEXT,
  ADD COLUMN "fundingChangeReason" TEXT,
  ADD COLUMN "provisionallyApprovedAt" TIMESTAMP(3),
  ADD COLUMN "evidenceDueOn" DATE,
  ADD COLUMN "evidenceSubmittedAt" TIMESTAMP(3),
  ADD COLUMN "reviewDueOn" DATE,
  ADD COLUMN "isLateSubmission" BOOLEAN,
  ADD COLUMN "setupStatus" "PolicyContextStatus",
  ADD COLUMN "routingSnapshotId" TEXT REFERENCES "routing_snapshots"("id") ON DELETE SET NULL;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_funding_change_reason_chk"
  CHECK ("fundingChangedById" IS NULL OR "fundingChangeReason" IS NOT NULL);
CREATE INDEX "leave_requests_routingSnapshotId_idx" ON "leave_requests"("routingSnapshotId");

-- Append-only table: ADD COLUMN does not fire row triggers; new columns are written at INSERT only.
ALTER TABLE "attendance_punch_evidence"
  ADD COLUMN "altitudeMeters" DOUBLE PRECISION,
  ADD COLUMN "altitudeStatus" "EvidenceAvailability",
  ADD COLUMN "accuracyStatus" "EvidenceAvailability",
  ADD COLUMN "policyContextStatus" "PolicyContextStatus";

-- Legal holds (v2.2 item 5). Single authority: placedById/placedAt = became ACTIVE (placed or
-- confirmed); releasedById/releasedAt = released. No confirmedById/confirmedAt columns exist.
ALTER TABLE "user_legal_holds"
  ADD COLUMN "status" "LegalHoldStatus",
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "reference" TEXT,
  ADD COLUMN "requestedById" TEXT, ADD COLUMN "requestedAt" TIMESTAMP(3),
  ADD COLUMN "rejectedById" TEXT, ADD COLUMN "rejectedAt" TIMESTAMP(3), ADD COLUMN "rejectionReason" TEXT,
  ADD COLUMN "withdrawnById" TEXT, ADD COLUMN "withdrawnAt" TIMESTAMP(3),
  ADD COLUMN "releaseReason" TEXT;

-- A REQUESTED hold has not been placed yet. Existing placedAt values are untouched.
ALTER TABLE "user_legal_holds" ALTER COLUMN "placedAt" DROP DEFAULT;
ALTER TABLE "user_legal_holds" ALTER COLUMN "placedAt" DROP NOT NULL;

-- Per-state integrity (v2.3). Actors AND timestamps AND reasons are mutually consistent per state.
-- status NULL = genuine pre-migration legacy row only; the trigger below stops new or updated
-- rows from ever becoming NULL.
ALTER TABLE "user_legal_holds" ADD CONSTRAINT "user_legal_holds_state_chk" CHECK (
  "status" IS NULL
  OR ("status" = 'REQUESTED'
      AND "requestedById" IS NOT NULL AND "requestedAt" IS NOT NULL
      AND "placedById" IS NULL AND "placedAt" IS NULL
      AND "rejectedById" IS NULL AND "rejectedAt" IS NULL AND "rejectionReason" IS NULL
      AND "withdrawnById" IS NULL AND "withdrawnAt" IS NULL
      AND "releasedById" IS NULL AND "releasedAt" IS NULL AND "releaseReason" IS NULL)
  OR ("status" = 'ACTIVE'
      AND "placedById" IS NOT NULL AND "placedAt" IS NOT NULL
      AND "rejectedById" IS NULL AND "rejectedAt" IS NULL AND "rejectionReason" IS NULL
      AND "withdrawnById" IS NULL AND "withdrawnAt" IS NULL
      AND "releasedById" IS NULL AND "releasedAt" IS NULL AND "releaseReason" IS NULL)
  OR ("status" = 'REJECTED'
      AND "requestedById" IS NOT NULL AND "requestedAt" IS NOT NULL
      AND "rejectedById" IS NOT NULL AND "rejectedAt" IS NOT NULL
      AND "rejectionReason" IS NOT NULL AND length(trim("rejectionReason")) > 0
      AND "placedById" IS NULL AND "placedAt" IS NULL
      AND "withdrawnById" IS NULL AND "withdrawnAt" IS NULL
      AND "releasedById" IS NULL AND "releasedAt" IS NULL AND "releaseReason" IS NULL)
  OR ("status" = 'WITHDRAWN'
      AND "requestedById" IS NOT NULL AND "requestedAt" IS NOT NULL
      AND "withdrawnById" IS NOT NULL AND "withdrawnAt" IS NOT NULL
      AND "placedById" IS NULL AND "placedAt" IS NULL
      AND "rejectedById" IS NULL AND "rejectedAt" IS NULL AND "rejectionReason" IS NULL
      AND "releasedById" IS NULL AND "releasedAt" IS NULL AND "releaseReason" IS NULL)
  OR ("status" = 'RELEASED'
      AND "placedById" IS NOT NULL AND "placedAt" IS NOT NULL
      AND "releasedById" IS NOT NULL AND "releasedAt" IS NOT NULL
      AND "releaseReason" IS NOT NULL AND length(trim("releaseReason")) > 0
      AND "rejectedById" IS NULL AND "rejectedAt" IS NULL AND "rejectionReason" IS NULL
      AND "withdrawnById" IS NULL AND "withdrawnAt" IS NULL)
);
ALTER TABLE "user_legal_holds" ADD CONSTRAINT "user_legal_holds_reason_code_chk"
  CHECK ("status" IS NULL OR length(trim("reasonCode")) > 0);

-- v2.3: INSERT must set a status; UPDATE may never turn a non-null status back to NULL.
-- A genuine pre-migration row (OLD.status NULL and NEW.status NULL) stays supported, and may be
-- moved INTO the new model (NULL -> a valid status), which the CHECK above then constrains.
CREATE OR REPLACE FUNCTION "user_legal_holds_status_guard"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."status" IS NULL THEN
    RAISE EXCEPTION 'user_legal_holds: new rows must set status' USING ERRCODE = 'not_null_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" IS NOT NULL AND NEW."status" IS NULL THEN
    RAISE EXCEPTION 'user_legal_holds: status % cannot be cleared to NULL (legacy treatment is reserved for pre-migration rows)', OLD."status"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "user_legal_holds_status_guard" BEFORE INSERT OR UPDATE ON "user_legal_holds"
  FOR EACH ROW EXECUTE FUNCTION "user_legal_holds_status_guard"();
CREATE INDEX "user_legal_holds_status_idx" ON "user_legal_holds"("status");

ALTER TABLE "user_lifecycle_operations"
  ADD COLUMN "remediation" JSONB;
