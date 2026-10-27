-- Phase 3 approved safeguards.
--
-- This migration is separate because the first two Phase 3 drafts were
-- already exercised on the disposable Gate database before these safeguards
-- were approved. It remains additive and rewrites no historical row.

ALTER TABLE "attendance_regularizations"
  ADD COLUMN "decisionFingerprint" TEXT;

-- Replace the guard with the final version. Existing legacy REJECTED rows are
-- exempt, but no INSERT or transition to REJECTED after this migration may
-- omit the complete protocol-v1 decision evidence.
CREATE OR REPLACE FUNCTION "attendance_regularization_decision_guard"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" = 'REJECTED' AND NEW."decisionProtocolVersion" IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'A new rejected attendance correction requires protocol-v1 decision evidence'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."decisionProtocolVersion" IS NULL OR "apex_row_delete_authorized"(OLD."userId") THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'A decided attendance correction is audit history and cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."status" = 'REJECTED'
     AND OLD."status" IS DISTINCT FROM 'REJECTED'
     AND NEW."decisionProtocolVersion" IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'A new rejected attendance correction requires protocol-v1 decision evidence'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."decisionProtocolVersion" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."decidedById" = 'system-deleted-account'
     AND OLD."decidedById" IS DISTINCT FROM NEW."decidedById"
     AND "apex_row_delete_authorized"(OLD."decidedById")
     AND (to_jsonb(NEW) - 'decidedById' - 'updatedAt') = (to_jsonb(OLD) - 'decidedById' - 'updatedAt') THEN
    RETURN NEW;
  END IF;

  IF NEW."decisionProtocolVersion" IS DISTINCT FROM OLD."decisionProtocolVersion"
     OR NEW."status" IS DISTINCT FROM OLD."status"
     OR NEW."decision" IS DISTINCT FROM OLD."decision"
     OR NEW."decidedById" IS DISTINCT FROM OLD."decidedById"
     OR NEW."decidedByRole" IS DISTINCT FROM OLD."decidedByRole"
     OR NEW."decidedVia" IS DISTINCT FROM OLD."decidedVia"
     OR NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt"
     OR NEW."decisionReason" IS DISTINCT FROM OLD."decisionReason"
     OR NEW."decisionFingerprint" IS DISTINCT FROM OLD."decisionFingerprint"
     OR NEW."userId" IS DISTINCT FROM OLD."userId"
     OR NEW."date" IS DISTINCT FROM OLD."date"
     OR NEW."requestType" IS DISTINCT FROM OLD."requestType"
     OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."requestedPunchIn" IS DISTINCT FROM OLD."requestedPunchIn"
     OR NEW."requestedPunchOut" IS DISTINCT FROM OLD."requestedPunchOut"
     OR NEW."proposedStatus" IS DISTINCT FROM OLD."proposedStatus" THEN
    RAISE EXCEPTION 'A decided attendance correction cannot be changed; record a new correction instead'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."applicationStatus" IS DISTINCT FROM OLD."applicationStatus"
     AND NOT (OLD."applicationStatus" = 'REVIEW_REQUIRED' AND NEW."applicationStatus" = 'APPLIED') THEN
    RAISE EXCEPTION 'An attendance correction can only move from REVIEW_REQUIRED to APPLIED'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "attendance_regularizations_decision_guard" ON "attendance_regularizations";
CREATE TRIGGER "attendance_regularizations_decision_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "attendance_regularizations"
  FOR EACH ROW EXECUTE FUNCTION "attendance_regularization_decision_guard"();
