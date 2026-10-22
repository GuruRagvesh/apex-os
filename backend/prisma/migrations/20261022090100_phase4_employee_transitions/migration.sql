-- Phase 4: employee transitions, exit, clearance, F&F, retention, legal holds
-- and payroll readiness.
--
-- Additive only. No table or column is renamed or dropped, no historical row is
-- rewritten and nothing is backfilled. Every new column is nullable or has a
-- default. New CHECKs on tables that existed before Phase 4 are added NOT VALID,
-- so a pre-existing row is never re-validated; they constrain only rows the
-- Phase 4 code writes.
--
-- Restartable: columns, tables and indexes use IF NOT EXISTS, constraints are
-- added inside a block that ignores an existing name, and triggers are dropped
-- before they are created. A second `migrate deploy` is a no-op.

-- Adds a constraint unless one of that name already exists.
CREATE OR REPLACE FUNCTION "phase4_add_constraint"(p_table TEXT, p_name TEXT, p_def TEXT)
RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = p_table AND c.conname = p_name
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', p_table, p_name, p_def);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- Users: the instant access ends for a resigning employee. Authentication
-- refuses once it has passed, even if the separation job is late.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "accessEndsAt" TIMESTAMP(3);

-- ═══════════════════════════════════════════════════════════════════════════
-- Employment periods: verified probation status (an exit needs it).
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "employment_periods"
  ADD COLUMN IF NOT EXISTS "probationVerifiedById" TEXT,
  ADD COLUMN IF NOT EXISTS "probationVerifiedAt" TIMESTAMP(3);

SELECT "phase4_add_constraint"('employment_periods', 'employment_periods_probation_verified_chk',
  'CHECK ((("probationVerifiedById" IS NULL) = ("probationVerifiedAt" IS NULL))
     AND ("probationVerifiedAt" IS NULL OR "probationStatus" IS NOT NULL)) NOT VALID');

-- ═══════════════════════════════════════════════════════════════════════════
-- Idempotency ledger for every exit and transfer mutation. Written in the same
-- transaction as the mutation, so a replay finds the key only if the mutation
-- committed.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "transition_request_keys" (
  "key" UUID PRIMARY KEY,
  "scope" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "transition_request_keys_entity_idx" ON "transition_request_keys"("scope", "entityId");
CREATE INDEX IF NOT EXISTS "transition_request_keys_actor_idx" ON "transition_request_keys"("actorId");

-- ═══════════════════════════════════════════════════════════════════════════
-- Department transfers
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "department_transfers"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" UUID,
  ADD COLUMN IF NOT EXISTS "effectiveOn" DATE,
  ADD COLUMN IF NOT EXISTS "plan" JSONB,
  ADD COLUMN IF NOT EXISTS "previewFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "reason" TEXT,
  ADD COLUMN IF NOT EXISTS "appliedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewReasonCode" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledById" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelReason" TEXT,
  ADD COLUMN IF NOT EXISTS "warnings" JSONB,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "department_transfers_idempotencyKey_key" ON "department_transfers"("idempotencyKey");
-- At most one pending (scheduled or review-required) transfer per person.
CREATE UNIQUE INDEX IF NOT EXISTS "department_transfers_one_pending_per_user"
  ON "department_transfers"("userId") WHERE "status" IN ('SCHEDULED', 'REVIEW_REQUIRED');
CREATE INDEX IF NOT EXISTS "department_transfers_status_effective_idx" ON "department_transfers"("status", "effectiveAt");

-- COMPLETED is never recorded before the effective instant.
SELECT "phase4_add_constraint"('department_transfers', 'department_transfers_completed_chk',
  'CHECK ("status" <> ''COMPLETED'' OR "appliedAt" IS NULL OR "appliedAt" >= "effectiveAt") NOT VALID');
SELECT "phase4_add_constraint"('department_transfers', 'department_transfers_phase4_completed_chk',
  'CHECK ("status" <> ''COMPLETED'' OR "idempotencyKey" IS NULL OR "appliedAt" IS NOT NULL) NOT VALID');
SELECT "phase4_add_constraint"('department_transfers', 'department_transfers_cancelled_chk',
  'CHECK ("status" <> ''CANCELLED'' OR ("cancelledById" IS NOT NULL AND "cancelledAt" IS NOT NULL
     AND "cancelReason" IS NOT NULL AND length(trim("cancelReason")) > 0)) NOT VALID');
SELECT "phase4_add_constraint"('department_transfers', 'department_transfers_review_reason_chk',
  'CHECK ("status" <> ''REVIEW_REQUIRED'' OR "reviewReasonCode" IS NOT NULL) NOT VALID');

ALTER TABLE "department_transfer_impacts"
  ADD COLUMN IF NOT EXISTS "entityType" TEXT,
  ADD COLUMN IF NOT EXISTS "detail" JSONB,
  ADD COLUMN IF NOT EXISTS "reviewedById" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

SELECT "phase4_add_constraint"('department_transfer_impacts', 'department_transfer_impacts_review_status_chk',
  'CHECK ("reviewStatus" IN (''PENDING_REVIEW'', ''REVIEWED'', ''NO_ACTION'')) NOT VALID');
SELECT "phase4_add_constraint"('department_transfer_impacts', 'department_transfer_impacts_reviewed_chk',
  'CHECK ("reviewStatus" <> ''REVIEWED'' OR ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL)) NOT VALID');

-- An impact records what happened. Only its review columns may change later;
-- the permanent-delete path keeps its row-scoped exception.
CREATE OR REPLACE FUNCTION "department_transfer_impacts_review_only"()
RETURNS TRIGGER AS $$
DECLARE subject TEXT;
BEGIN
  SELECT "userId" INTO subject FROM "department_transfers" WHERE "id" = OLD."transferId";
  IF TG_OP = 'DELETE' THEN
    IF subject IS NULL OR "apex_row_delete_authorized"(subject) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'department_transfer_impacts rows cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'reviewStatus' - 'reviewedById' - 'reviewedAt')
     = (to_jsonb(OLD) - 'reviewStatus' - 'reviewedById' - 'reviewedAt') THEN
    RETURN NEW;
  END IF;
  IF subject IS NOT NULL AND "apex_row_delete_authorized"(subject) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'department_transfer_impacts: only the review columns may change' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "department_transfer_impacts_review_only" ON "department_transfer_impacts";
CREATE TRIGGER "department_transfer_impacts_review_only" BEFORE UPDATE OR DELETE ON "department_transfer_impacts"
  FOR EACH ROW EXECUTE FUNCTION "department_transfer_impacts_review_only"();

-- ═══════════════════════════════════════════════════════════════════════════
-- Exit cases
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "exit_cases"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" UUID,
  ADD COLUMN IF NOT EXISTS "submittedById" TEXT,
  ADD COLUMN IF NOT EXISTS "defaultNoticeDays" INTEGER,
  ADD COLUMN IF NOT EXISTS "noticeReference" TEXT,
  ADD COLUMN IF NOT EXISTS "noticeAdjustedById" TEXT,
  ADD COLUMN IF NOT EXISTS "noticeAdjustedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "backdateReason" TEXT,
  ADD COLUMN IF NOT EXISTS "backdateReference" TEXT,
  ADD COLUMN IF NOT EXISTS "withdrawalReason" TEXT,
  ADD COLUMN IF NOT EXISTS "separationDueAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "separatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "separatedById" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "exit_cases_idempotencyKey_key" ON "exit_cases"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "exit_cases_state_due_idx" ON "exit_cases"("state", "separationDueAt");

SELECT "phase4_add_constraint"('exit_cases', 'exit_cases_contract_chk',
  'CHECK ("noticeSource" <> ''CONTRACT'' OR ("noticeReference" IS NOT NULL AND length(trim("noticeReference")) > 0
     AND "noticeAdjustedById" IS NOT NULL AND "noticeAdjustedAt" IS NOT NULL)) NOT VALID');
SELECT "phase4_add_constraint"('exit_cases', 'exit_cases_management_adjustment_actor_chk',
  'CHECK ("noticeSource" <> ''MANAGEMENT_ADJUSTMENT'' OR "idempotencyKey" IS NULL
     OR ("noticeAdjustedById" IS NOT NULL AND "noticeAdjustedAt" IS NOT NULL)) NOT VALID');
SELECT "phase4_add_constraint"('exit_cases', 'exit_cases_withdrawn_chk',
  'CHECK ("state" <> ''WITHDRAWN'' OR ("withdrawnAt" IS NOT NULL AND "withdrawnById" IS NOT NULL)) NOT VALID');
SELECT "phase4_add_constraint"('exit_cases', 'exit_cases_lwd_chk',
  'CHECK ("lastWorkingDay" >= "resignedOn") NOT VALID');
SELECT "phase4_add_constraint"('exit_cases', 'exit_cases_backdate_chk',
  'CHECK (("backdateReason" IS NULL) = ("backdateReference" IS NULL)) NOT VALID');
SELECT "phase4_add_constraint"('exit_cases', 'exit_cases_separated_chk',
  'CHECK (("separatedAt" IS NULL) = ("separatedById" IS NULL)) NOT VALID');

-- separatedAt is written once.
CREATE OR REPLACE FUNCTION "exit_cases_separation_once"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."separatedAt" IS NOT NULL AND NEW."separatedAt" IS DISTINCT FROM OLD."separatedAt" THEN
    RAISE EXCEPTION 'exit_cases: separatedAt is set once' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "exit_cases_separation_once" ON "exit_cases";
CREATE TRIGGER "exit_cases_separation_once" BEFORE UPDATE ON "exit_cases"
  FOR EACH ROW EXECUTE FUNCTION "exit_cases_separation_once"();

-- ═══════════════════════════════════════════════════════════════════════════
-- Clearance items
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "exit_clearance_items"
  ADD COLUMN IF NOT EXISTS "ownerCapability" TEXT,
  ADD COLUMN IF NOT EXISTS "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "waivedById" TEXT,
  ADD COLUMN IF NOT EXISTS "waivedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "waiverReason" TEXT,
  ADD COLUMN IF NOT EXISTS "notApplicableReason" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "exit_clearance_items_owner_idx" ON "exit_clearance_items"("ownerId", "status");

SELECT "phase4_add_constraint"('exit_clearance_items', 'exit_clearance_items_capability_chk',
  'CHECK ("ownerCapability" IS NULL OR "ownerCapability" IN (''TEAM_LEAD'', ''DEPT_MANAGER'', ''HR'', ''ADMIN'')) NOT VALID');
SELECT "phase4_add_constraint"('exit_clearance_items', 'exit_clearance_items_done_chk',
  'CHECK ("status" <> ''DONE'' OR ("completedById" IS NOT NULL AND "completedAt" IS NOT NULL
     AND (NOT "evidenceRequired" OR "evidenceRef" IS NOT NULL))) NOT VALID');
SELECT "phase4_add_constraint"('exit_clearance_items', 'exit_clearance_items_waived_chk',
  'CHECK ("status" <> ''WAIVED'' OR ("waivedById" IS NOT NULL AND "waivedAt" IS NOT NULL
     AND "waiverReason" IS NOT NULL AND length(trim("waiverReason")) > 0)) NOT VALID');
SELECT "phase4_add_constraint"('exit_clearance_items', 'exit_clearance_items_na_chk',
  'CHECK ("status" <> ''NOT_APPLICABLE'' OR ("completedById" IS NOT NULL AND "completedAt" IS NOT NULL
     AND "notApplicableReason" IS NOT NULL AND length(trim("notApplicableReason")) > 0)) NOT VALID');
SELECT "phase4_add_constraint"('exit_clearance_items', 'exit_clearance_items_cancelled_chk',
  'CHECK ("status" <> ''CANCELLED'' OR "cancelledAt" IS NOT NULL) NOT VALID');
-- An evidence reference is an opaque internal reference: never a URL, an email
-- address, a path, a name with spaces or a raw storage key.
SELECT "phase4_add_constraint"('exit_clearance_items', 'exit_clearance_items_evidence_ref_chk',
  'CHECK ("evidenceRef" IS NULL OR ("evidenceRef" ~ ''^[A-Z][A-Z0-9]{1,15}-[A-Z0-9-]{3,48}$''
     AND "evidenceRef" ~ ''[0-9]'')) NOT VALID');

-- ═══════════════════════════════════════════════════════════════════════════
-- F&F settlements and adjustments
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "fnf_settlements"
  ADD COLUMN IF NOT EXISTS "readyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "releaseReference" TEXT,
  ADD COLUMN IF NOT EXISTS "escalationCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nextEscalationOn" DATE,
  ADD COLUMN IF NOT EXISTS "deadlineBasis" JSONB,
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "fnf_settlements_state_escalation_idx" ON "fnf_settlements"("state", "nextEscalationOn");

SELECT "phase4_add_constraint"('fnf_settlements', 'fnf_settlements_released_chk',
  'CHECK ("state" <> ''RELEASED'' OR ("releasedById" IS NOT NULL AND "releasedAt" IS NOT NULL
     AND "releaseReference" IS NOT NULL AND length(trim("releaseReference")) > 0)) NOT VALID');
SELECT "phase4_add_constraint"('fnf_settlements', 'fnf_settlements_hold_chk',
  'CHECK ("state" <> ''ON_HOLD_REVIEW_REQUIRED'' OR "holdReason" IS NOT NULL) NOT VALID');
SELECT "phase4_add_constraint"('fnf_settlements', 'fnf_settlements_ready_chk',
  'CHECK ("state" NOT IN (''READY_FOR_RELEASE'', ''RELEASED'') OR "readyAt" IS NOT NULL) NOT VALID');
SELECT "phase4_add_constraint"('fnf_settlements', 'fnf_settlements_cancelled_chk',
  'CHECK ("state" <> ''CANCELLED'' OR "cancelledAt" IS NOT NULL) NOT VALID');
SELECT "phase4_add_constraint"('fnf_settlements', 'fnf_settlements_escalation_count_chk',
  'CHECK ("escalationCount" >= 0) NOT VALID');

-- Four-eyes: the approver is never the person who recorded the adjustment.
-- Permanent Delete may REASSIGN both actors to the deleted-account principal
-- (two different people deleted at different times), so that one value is
-- allowed on both sides. The same exception appears on every four-eyes CHECK.
SELECT "phase4_add_constraint"('fnf_adjustments', 'fnf_adjustments_four_eyes_chk',
  'CHECK ("approvedById" <> "recordedById" OR "approvedById" = ''system-deleted-account'') NOT VALID');

CREATE TABLE IF NOT EXISTS "fnf_adjustment_requests" (
  "id" TEXT PRIMARY KEY,
  "settlementId" TEXT NOT NULL REFERENCES "fnf_settlements"("id") ON DELETE CASCADE,
  "subjectUserId" TEXT NOT NULL,
  "kind" "FnfAdjustmentKind" NOT NULL,
  "direction" "FnfAdjustmentDirection" NOT NULL,
  "amount" NUMERIC(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "reasonCode" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "note" TEXT,
  "reversesId" TEXT REFERENCES "fnf_adjustments"("id"),
  "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
  "requestedById" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionReason" TEXT,
  "adjustmentId" TEXT UNIQUE REFERENCES "fnf_adjustments"("id"),
  "idempotencyKey" UUID UNIQUE,
  CONSTRAINT "fnf_adjustment_requests_amount_positive_chk" CHECK ("amount" > 0),
  CONSTRAINT "fnf_adjustment_requests_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "fnf_adjustment_requests_reason_chk" CHECK (length(trim("reasonCode")) > 0 AND length(trim("reference")) > 0),
  CONSTRAINT "fnf_adjustment_requests_four_eyes_chk" CHECK ("decidedById" IS NULL OR "decidedById" <> "requestedById" OR "decidedById" = 'system-deleted-account'),
  CONSTRAINT "fnf_adjustment_requests_decided_chk" CHECK (
    ("status" IN ('PENDING') AND "decidedById" IS NULL AND "decidedAt" IS NULL)
    OR ("status" = 'CANCELLED' AND "decidedAt" IS NOT NULL)
    OR ("status" IN ('APPROVED', 'REJECTED') AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL)
  ),
  CONSTRAINT "fnf_adjustment_requests_rejection_reason_chk" CHECK (
    "status" <> 'REJECTED' OR ("decisionReason" IS NOT NULL AND length(trim("decisionReason")) > 0)
  ),
  CONSTRAINT "fnf_adjustment_requests_approved_link_chk" CHECK (("status" = 'APPROVED') = ("adjustmentId" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "fnf_adjustment_requests_settlement_idx" ON "fnf_adjustment_requests"("settlementId", "status");
CREATE INDEX IF NOT EXISTS "fnf_adjustment_requests_subject_idx" ON "fnf_adjustment_requests"("subjectUserId");

-- A decided request is frozen. The permanent-delete path keeps the same
-- row-scoped exception as fnf_adjustments (delete, or REASSIGN of actor ids).
CREATE OR REPLACE FUNCTION "fnf_adjustment_requests_freeze"()
RETURNS TRIGGER AS $$
DECLARE deleted_principal CONSTANT TEXT := 'system-deleted-account';
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF "apex_row_delete_authorized"(OLD."subjectUserId") THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'fnf_adjustment_requests rows cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'PENDING' THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'requestedById' - 'decidedById') = (to_jsonb(OLD) - 'requestedById' - 'decidedById')
     AND (NEW."requestedById" = OLD."requestedById" OR (NEW."requestedById" = deleted_principal AND "apex_row_delete_authorized"(OLD."requestedById")))
     AND (NEW."decidedById" IS NOT DISTINCT FROM OLD."decidedById" OR (NEW."decidedById" = deleted_principal AND "apex_row_delete_authorized"(OLD."decidedById")))
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'fnf_adjustment_requests: a decided request is frozen' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "fnf_adjustment_requests_freeze" ON "fnf_adjustment_requests";
CREATE TRIGGER "fnf_adjustment_requests_freeze" BEFORE UPDATE OR DELETE ON "fnf_adjustment_requests"
  FOR EACH ROW EXECUTE FUNCTION "fnf_adjustment_requests_freeze"();

-- ═══════════════════════════════════════════════════════════════════════════
-- Retention: versioned rules changed only by a four-eyes proposal
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "retention_rules"
  ADD COLUMN IF NOT EXISTS "status" "RetentionRuleStatus",
  ADD COLUMN IF NOT EXISTS "noExpiry" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "createdById" TEXT;

-- status NULL is a legacy row, read exactly as before Phase 4.
SELECT "phase4_add_constraint"('retention_rules', 'retention_rules_active_chk',
  'CHECK ("status" IS DISTINCT FROM ''ACTIVE'' OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL
     AND "policyReference" IS NOT NULL AND length(trim("policyReference")) > 0
     AND (("noExpiry" AND "retentionMonths" IS NULL) OR (NOT "noExpiry" AND "retentionMonths" > 0)))) NOT VALID');
SELECT "phase4_add_constraint"('retention_rules', 'retention_rules_version_chk',
  'CHECK ("version" >= 1) NOT VALID');

CREATE TABLE IF NOT EXISTS "retention_rule_proposals" (
  "id" TEXT PRIMARY KEY,
  "category" TEXT NOT NULL,
  "action" "RetentionProposalAction" NOT NULL,
  "retentionMonths" INTEGER,
  "noExpiry" BOOLEAN NOT NULL DEFAULT false,
  "policyReference" TEXT,
  "reason" TEXT NOT NULL,
  "baseVersion" INTEGER,
  "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
  "proposedById" TEXT NOT NULL,
  "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionReason" TEXT,
  "idempotencyKey" UUID UNIQUE,
  CONSTRAINT "retention_rule_proposals_category_chk" CHECK ("category" IN ('ATTENDANCE', 'LEAVE', 'PAYROLL')),
  CONSTRAINT "retention_rule_proposals_reason_chk" CHECK (length(trim("reason")) > 0),
  CONSTRAINT "retention_rule_proposals_values_chk" CHECK (
    "action" = 'DEACTIVATE'
    OR ("policyReference" IS NOT NULL AND length(trim("policyReference")) > 0
        AND (("noExpiry" AND "retentionMonths" IS NULL) OR (NOT "noExpiry" AND "retentionMonths" > 0)))
  ),
  CONSTRAINT "retention_rule_proposals_four_eyes_chk" CHECK ("decidedById" IS NULL OR "decidedById" <> "proposedById" OR "decidedById" = 'system-deleted-account'),
  CONSTRAINT "retention_rule_proposals_decided_chk" CHECK (
    ("status" = 'PENDING' AND "decidedById" IS NULL AND "decidedAt" IS NULL)
    OR ("status" = 'CANCELLED' AND "decidedAt" IS NOT NULL)
    OR ("status" IN ('APPROVED', 'REJECTED') AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL)
  ),
  CONSTRAINT "retention_rule_proposals_rejection_reason_chk" CHECK (
    "status" <> 'REJECTED' OR ("decisionReason" IS NOT NULL AND length(trim("decisionReason")) > 0)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "retention_rule_proposals_one_pending"
  ON "retention_rule_proposals"("category") WHERE "status" = 'PENDING';
CREATE INDEX IF NOT EXISTS "retention_rule_proposals_status_idx" ON "retention_rule_proposals"("status", "proposedAt");

-- History is append-only: a decided proposal never changes. The permanent
-- delete REASSIGN of actor ids is the only exception.
CREATE OR REPLACE FUNCTION "retention_rule_proposals_freeze"()
RETURNS TRIGGER AS $$
DECLARE deleted_principal CONSTANT TEXT := 'system-deleted-account';
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'retention_rule_proposals is append-only' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'PENDING' THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'proposedById' - 'decidedById') = (to_jsonb(OLD) - 'proposedById' - 'decidedById')
     AND (NEW."proposedById" = OLD."proposedById" OR (NEW."proposedById" = deleted_principal AND "apex_row_delete_authorized"(OLD."proposedById")))
     AND (NEW."decidedById" IS NOT DISTINCT FROM OLD."decidedById" OR (NEW."decidedById" = deleted_principal AND "apex_row_delete_authorized"(OLD."decidedById")))
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'retention_rule_proposals: a decided proposal is frozen' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "retention_rule_proposals_freeze" ON "retention_rule_proposals";
CREATE TRIGGER "retention_rule_proposals_freeze" BEFORE UPDATE OR DELETE ON "retention_rule_proposals"
  FOR EACH ROW EXECUTE FUNCTION "retention_rule_proposals_freeze"();

CREATE TABLE IF NOT EXISTS "retention_rule_versions" (
  "id" TEXT PRIMARY KEY,
  "category" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "retentionMonths" INTEGER,
  "noExpiry" BOOLEAN NOT NULL,
  "status" "RetentionRuleStatus" NOT NULL,
  "policyReference" TEXT,
  "approvedById" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL,
  "proposalId" TEXT NOT NULL REFERENCES "retention_rule_proposals"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "retention_rule_versions_category_version_key" UNIQUE ("category", "version")
);

CREATE OR REPLACE FUNCTION "retention_rule_versions_append_only"()
RETURNS TRIGGER AS $$
DECLARE deleted_principal CONSTANT TEXT := 'system-deleted-account';
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'approvedById') = (to_jsonb(OLD) - 'approvedById')
     AND NEW."approvedById" = deleted_principal AND "apex_row_delete_authorized"(OLD."approvedById")
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'retention_rule_versions is append-only: % is not permitted', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "retention_rule_versions_append_only" ON "retention_rule_versions";
CREATE TRIGGER "retention_rule_versions_append_only" BEFORE UPDATE OR DELETE ON "retention_rule_versions"
  FOR EACH ROW EXECUTE FUNCTION "retention_rule_versions_append_only"();

-- ═══════════════════════════════════════════════════════════════════════════
-- Legal holds: four-eyes confirm and reject
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "user_legal_holds" ADD COLUMN IF NOT EXISTS "idempotencyKey" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "user_legal_holds_idempotencyKey_key" ON "user_legal_holds"("idempotencyKey");

SELECT "phase4_add_constraint"('user_legal_holds', 'user_legal_holds_four_eyes_chk',
  'CHECK ("requestedById" IS NULL OR "requestedById" = ''system-deleted-account''
     OR (("placedById" IS NULL OR "placedById" <> "requestedById")
         AND ("rejectedById" IS NULL OR "rejectedById" <> "requestedById"))) NOT VALID');

-- ═══════════════════════════════════════════════════════════════════════════
-- Payroll month close: acknowledged unresolved setup and the rule version
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "attendance_month_closes"
  ADD COLUMN IF NOT EXISTS "unresolvedAcknowledgedById" TEXT,
  ADD COLUMN IF NOT EXISTS "unresolvedAcknowledgedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "unresolvedSummary" JSONB,
  ADD COLUMN IF NOT EXISTS "reportRuleVersion" TEXT;

SELECT "phase4_add_constraint"('attendance_month_closes', 'attendance_month_closes_unresolved_ack_chk',
  'CHECK (("unresolvedAcknowledgedById" IS NULL) = ("unresolvedAcknowledgedAt" IS NULL)) NOT VALID');

DROP FUNCTION "phase4_add_constraint"(TEXT, TEXT, TEXT);
