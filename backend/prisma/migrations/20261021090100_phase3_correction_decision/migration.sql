-- Phase 3: single-decision attendance correction workflow.
--
-- Separate from 20261021090000 because PostgreSQL refuses to use an enum value
-- (APPROVED, STALE_REVIEW_REQUIRED) in the same transaction that added it, and
-- the checks and the unresolved-request index below use them.
--
-- Additive only. No existing correction row is changed: legacy rows keep a
-- NULL decisionProtocolVersion and every check below exempts them.

-- ── Preflight: duplicate unresolved requests ──────────────────────────────
-- The unique index below treats PENDING, STALE_REVIEW_REQUIRED and the legacy
-- MANAGER_APPROVED state as unresolved. If any employee-date already holds two
-- of them, stop here with a clear message rather than half-way through.
-- scripts/attendance/phase3-correction-preflight.ts lists them read-only.
DO $$
DECLARE dupes INTEGER;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT "userId", "date"
      FROM "attendance_regularizations"
     WHERE "status" IN ('PENDING', 'MANAGER_APPROVED')
     GROUP BY "userId", "date"
    HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION 'Phase 3 preflight: % employee-date(s) have more than one unresolved attendance correction. Run scripts/attendance/phase3-correction-preflight.ts and resolve them before migrating.', dupes;
  END IF;
END $$;

CREATE TYPE "CorrectionDecision" AS ENUM ('APPROVE', 'REJECT');
CREATE TYPE "CorrectionApplicationStatus" AS ENUM ('APPLIED', 'REVIEW_REQUIRED', 'NOT_REQUIRED');

ALTER TABLE "attendance_regularizations"
  ADD COLUMN "decisionProtocolVersion" INTEGER,
  ADD COLUMN "decidedById" TEXT,
  ADD COLUMN "decidedByRole" TEXT,
  ADD COLUMN "decidedVia" TEXT,
  ADD COLUMN "decision" "CorrectionDecision",
  ADD COLUMN "decidedAt" TIMESTAMP(3),
  ADD COLUMN "decisionReason" TEXT,
  ADD COLUMN "applicationStatus" "CorrectionApplicationStatus",
  ADD COLUMN "applicationFailureReason" TEXT,
  ADD COLUMN "appliedAt" TIMESTAMP(3),
  ADD COLUMN "staleDetectedAt" TIMESTAMP(3),
  ADD COLUMN "staleFingerprint" TEXT;

CREATE INDEX "attendance_regularizations_status_userId_createdAt_idx" ON "attendance_regularizations"("status", "userId", "createdAt");
CREATE INDEX "attendance_regularizations_decidedById_idx" ON "attendance_regularizations"("decidedById");

-- One unresolved request per employee-date, enforced by the database rather
-- than by a check-then-insert in the service.
CREATE UNIQUE INDEX "attendance_regularizations_one_unresolved_per_day"
  ON "attendance_regularizations"("userId", "date")
  WHERE "status" IN ('PENDING', 'STALE_REVIEW_REQUIRED', 'MANAGER_APPROVED');

-- Protocol version 1: every decision field together, and a final status.
ALTER TABLE "attendance_regularizations"
  ADD CONSTRAINT "attendance_regularizations_decision_v1_chk" CHECK (
    "decisionProtocolVersion" IS NULL
    OR (
      "decisionProtocolVersion" = 1
      AND "decision" IS NOT NULL
      AND "decidedById" IS NOT NULL
      AND "decidedByRole" IS NOT NULL
      AND "decidedVia" IS NOT NULL
      AND "decidedAt" IS NOT NULL
      AND length(btrim(coalesce("decisionReason", ''))) > 0
      AND "applicationStatus" IS NOT NULL
      AND (("decision" = 'APPROVE' AND "status" = 'APPROVED') OR ("decision" = 'REJECT' AND "status" = 'REJECTED'))
    )
  );

-- APPROVED exists only under the new protocol; legacy statuses never carry it.
ALTER TABLE "attendance_regularizations"
  ADD CONSTRAINT "attendance_regularizations_approved_v1_chk" CHECK (
    "status" <> 'APPROVED' OR "decisionProtocolVersion" = 1
  );

-- No decision fields on a row that has not been decided under protocol 1.
ALTER TABLE "attendance_regularizations"
  ADD CONSTRAINT "attendance_regularizations_decision_fields_chk" CHECK (
    "decisionProtocolVersion" IS NOT NULL
    OR ("decision" IS NULL AND "decidedById" IS NULL AND "decidedAt" IS NULL AND "applicationStatus" IS NULL)
  );

-- A committed decision is audit history. Once protocol 1 is set the decision
-- and the request's content are immutable; only the application outcome may
-- progress (REVIEW_REQUIRED -> APPLIED, after an authorized reopen). DELETE is
-- possible only through the row-scoped Permanent Delete exception.
CREATE OR REPLACE FUNCTION "attendance_regularization_decision_guard"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."decisionProtocolVersion" IS NULL OR "apex_row_delete_authorized"(OLD."userId") THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'A decided attendance correction is audit history and cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."decisionProtocolVersion" IS NULL THEN
    RETURN NEW;
  END IF;
  -- Permanent Delete of the person who decided it: the decider moves to the
  -- deleted-account principal (the protocol CHECK requires one), nothing else.
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

CREATE TRIGGER "attendance_regularizations_decision_guard"
  BEFORE UPDATE OR DELETE ON "attendance_regularizations"
  FOR EACH ROW EXECUTE FUNCTION "attendance_regularization_decision_guard"();
