-- Phase 1 lifecycle foundation (1 of 2): new enums, the employee-ID sequence,
-- ledger and allocator, and the new tables with their append-only triggers.
-- Source: PHASE1_FINAL_SPEC_2026-10-15 (Gate 1 approved), SQL v2.3.
--
-- Additive only. No existing row is updated or deleted. Existing rows are read
-- only to initialise employee_id_te_seq and seed employee_id_allocations.
--
-- Not declared in schema.prisma (Prisma cannot express them): CHECK
-- constraints, partial unique indexes, the sequence, functions and triggers.

CREATE TYPE "EmploymentState" AS ENUM ('SCHEDULED_TO_JOIN', 'ACTIVE', 'DEACTIVATED', 'ARCHIVED');
CREATE TYPE "SetupIssueStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'WAIVED');
CREATE TYPE "SetupIssueSeverity" AS ENUM ('INFO', 'WARNING', 'BLOCKING');
CREATE TYPE "RemediationClass" AS ENUM ('WARNING_NON_BLOCKING', 'USER_FIXABLE', 'ADMIN_FIXABLE_FRONTEND', 'SYSTEM_REPAIRABLE', 'MANUAL_EXTERNAL', 'BACKEND_OPERATIONS', 'SECURITY_OR_LEGAL_BLOCK');
CREATE TYPE "EmploymentStartReason" AS ENUM ('NEW_HIRE', 'REACTIVATION', 'REHIRE', 'LEGACY_BACKFILL');
CREATE TYPE "EmploymentEndReason" AS ENUM ('RESIGNATION', 'TERMINATION', 'DEACTIVATION', 'ARCHIVE', 'CONTRACT_END', 'OTHER');
CREATE TYPE "ProbationStatus" AS ENUM ('PROBATION', 'CONFIRMED');
CREATE TYPE "HierarchyScope" AS ENUM ('EMPLOYEE', 'DEPARTMENT', 'COMPANY');
CREATE TYPE "HierarchyRole" AS ENUM ('TEAM_LEAD', 'MANAGER');
CREATE TYPE "RoutingWorkflow" AS ENUM ('LEAVE', 'TICKET_REVIEW');
CREATE TYPE "RoutingTier" AS ENUM ('ORIGINAL_REVIEWER', 'EMPLOYEE_TL', 'ORIGINAL_DEPT_TL', 'ORIGINAL_DEPT_MANAGER', 'DEPT_TL', 'DEPT_MANAGER', 'COMPANY_MANAGER', 'HR', 'ADMIN');
CREATE TYPE "PolicyHealthKind" AS ENUM ('GAP', 'OVERLAP', 'MISSING_BASELINE', 'INVALID_FUTURE_ACTIVATION', 'NO_POLICY', 'LAST_APPLICABLE_PROTECTED');
CREATE TYPE "EvidenceAvailability" AS ENUM ('AVAILABLE', 'UNAVAILABLE');
CREATE TYPE "PolicyContextStatus" AS ENUM ('RESOLVED', 'POLICY_SETUP_PENDING');
CREATE TYPE "PunchReviewStatus" AS ENUM ('PENDING', 'REVIEWED', 'DISMISSED');
CREATE TYPE "LeaveSubmissionMode" AS ENUM ('STANDARD', 'EMERGENCY');
CREATE TYPE "LeaveFundingBucket" AS ENUM ('CASUAL', 'SICK');
CREATE TYPE "TransferStatus" AS ENUM ('COMPLETED', 'FAILED');
CREATE TYPE "TransferImpactKind" AS ENUM ('TICKET', 'PROJECT', 'LEAVE_APPROVAL', 'TICKET_REVIEW', 'PROFILE');
CREATE TYPE "ExitCaseState" AS ENUM ('NOTICE_RUNNING', 'CLEARANCE_IN_PROGRESS', 'CLEARED', 'WITHDRAWN', 'COMPLETED');
CREATE TYPE "NoticeSource" AS ENUM ('POLICY_PROBATION', 'POLICY_CONFIRMED', 'CONTRACT', 'MANAGEMENT_ADJUSTMENT');
CREATE TYPE "ClearanceCategory" AS ENUM ('HANDOVER', 'KNOWLEDGE_TRANSFER', 'ASSETS', 'DOCUMENTS', 'DEPARTMENT', 'ACCESS_SHUTDOWN', 'FINANCIAL', 'FINAL_DOCUMENTS', 'ARCHIVE_READINESS');
CREATE TYPE "ClearanceStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'WAIVED', 'NOT_APPLICABLE');
CREATE TYPE "FnfState" AS ENUM ('NOT_STARTED', 'ON_HOLD_REVIEW_REQUIRED', 'READY_FOR_RELEASE', 'RELEASED');
CREATE TYPE "FnfAdjustmentKind" AS ENUM ('ATTENDANCE', 'MISCONDUCT', 'ASSET_RECOVERY', 'NOTICE_RECOVERY', 'OTHER');
CREATE TYPE "LegalHoldStatus" AS ENUM ('REQUESTED', 'ACTIVE', 'REJECTED', 'WITHDRAWN', 'RELEASED');
CREATE TYPE "FnfAdjustmentDirection" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "RemediationAttemptPhase" AS ENUM ('FAILURE', 'VERIFICATION', 'INSTRUCTION', 'RETRY', 'RESOLUTION');

-- ── Employee ID: sequence + number-only non-reuse ledger + one serialized allocator ──
-- (decision 3; review items A, 5, 6; v2.2 items 1 and 2)
-- The ledger stores ONLY issued numbers: no code, spelling or user id survives Permanent Delete.

-- Fail-safe preflight: two DIFFERENT users holding numerically equivalent well-formed codes
-- (e.g. TE-014 and TE-14) must be corrected by a human first. Read-only report (no writes,
-- no execute mode, spellings printed to stdout only): scripts/employee-id/report-equivalent-codes.ts
DO $$
DECLARE clash_groups INTEGER;
BEGIN
  SELECT COUNT(*) INTO clash_groups FROM (
    SELECT substring("employeeId" FROM '^TE-([0-9]{1,9})$')::BIGINT AS n
      FROM "users" WHERE "employeeId" ~ '^TE-[0-9]{1,9}$'
     GROUP BY 1 HAVING COUNT(DISTINCT "id") > 1
  ) g;
  IF clash_groups > 0 THEN
    RAISE EXCEPTION 'users has % group(s) of numerically equivalent employee IDs held by different people (e.g. TE-014 and TE-14). Run scripts/employee-id/report-equivalent-codes.ts, correct the codes, then rerun this migration.', clash_groups;
  END IF;
END $$;

CREATE SEQUENCE "employee_id_te_seq" AS BIGINT MINVALUE 1 START 1;

CREATE TABLE "employee_id_allocations" (
  "number" BIGINT PRIMARY KEY CHECK ("number" > 0),
  "source" TEXT NOT NULL CHECK ("source" IN ('LEGACY', 'GENERATED', 'MANUAL')),
  "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION "employee_id_allocations_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'employee_id_allocations is immutable: % is not permitted. Employee numbers are never released or reused.', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "employee_id_allocations_no_update" BEFORE UPDATE ON "employee_id_allocations"
  FOR EACH ROW EXECUTE FUNCTION "employee_id_allocations_immutable"();
CREATE TRIGGER "employee_id_allocations_no_delete" BEFORE DELETE ON "employee_id_allocations"
  FOR EACH ROW EXECUTE FUNCTION "employee_id_allocations_immutable"();

-- Seed distinct numbers only (users + import rows). Malformed codes are ignored.
INSERT INTO "employee_id_allocations" ("number", "source")
SELECT DISTINCT n, 'LEGACY'
  FROM (
    SELECT substring("employeeId" FROM '^TE-([0-9]{1,9})$')::BIGINT AS n
      FROM "users" WHERE "employeeId" ~ '^TE-[0-9]{1,9}$'
    UNION
    SELECT substring("rawEmployeeId" FROM '^TE-([0-9]{1,9})$')::BIGINT
      FROM "attendance_import_rows" WHERE "rawEmployeeId" ~ '^TE-[0-9]{1,9}$'
  ) s
 WHERE n > 0;

SELECT setval('"employee_id_te_seq"', COALESCE((SELECT MAX("number") FROM "employee_id_allocations"), 0) + 1, false);

-- The ONLY way to set a TE code. Automatic (p_manual_code NULL) and manual allocation share it and
-- are fully serialized by one transaction-scoped advisory lock (released at COMMIT/ROLLBACK).
CREATE OR REPLACE FUNCTION "apex_assign_employee_id"(p_user_id TEXT, p_manual_code TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  -- Fixed application-wide advisory-lock key reserved for employee-ID allocation.
  alloc_lock CONSTANT BIGINT := 7311020151015;
  current_code TEXT;
  current_n BIGINT;
  n BIGINT;
  next_val BIGINT;
  inserted INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(alloc_lock);

  SELECT "employeeId" INTO current_code FROM "users" WHERE "id" = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EMPLOYEE_ID_USER_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF current_code ~ '^TE-[0-9]{1,9}$' THEN
    current_n := substring(current_code FROM '^TE-([0-9]{1,9})$')::BIGINT;
  END IF;

  IF p_manual_code IS NULL THEN
    IF current_code IS NOT NULL THEN
      RETURN current_code;                -- idempotent
    END IF;
    LOOP
      n := nextval('"employee_id_te_seq"');
      INSERT INTO "employee_id_allocations" ("number", "source") VALUES (n, 'GENERATED')
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS inserted = ROW_COUNT;
      EXIT WHEN inserted = 1;            -- defensive: cannot happen after manual advances below
    END LOOP;
  ELSE
    IF p_manual_code !~ '^TE-[1-9][0-9]{0,8}$' THEN
      RAISE EXCEPTION 'EMPLOYEE_ID_NOT_CANONICAL' USING ERRCODE = 'check_violation';
    END IF;
    IF p_manual_code = current_code THEN
      RETURN current_code;
    END IF;
    n := substring(p_manual_code FROM '^TE-([0-9]{1,9})$')::BIGINT;
    IF n IS DISTINCT FROM current_n THEN  -- same number = same person normalising TE-014 -> TE-14
      INSERT INTO "employee_id_allocations" ("number", "source") VALUES (n, 'MANUAL')
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS inserted = ROW_COUNT;
      IF inserted = 0 THEN
        RAISE EXCEPTION 'EMPLOYEE_ID_ALREADY_ISSUED' USING ERRCODE = 'unique_violation';
      END IF;
      -- Under the lock nothing else touches the sequence; advance only forward.
      SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END INTO next_val FROM "employee_id_te_seq";
      IF n + 1 > next_val THEN
        PERFORM setval('"employee_id_te_seq"', n + 1, false);
      END IF;
    END IF;
  END IF;

  UPDATE "users" SET "employeeId" = 'TE-' || n::text, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = p_user_id;
  RETURN 'TE-' || n::text;
END $$;

CREATE TABLE "employment_periods" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "startReason" "EmploymentStartReason" NOT NULL,
  "endReason" "EmploymentEndReason",
  "probationStatus" "ProbationStatus",
  "benefitEligibleFrom" DATE,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employment_periods_dates_chk" CHECK ("endDate" IS NULL OR "endDate" >= "startDate"),
  CONSTRAINT "employment_periods_end_reason_chk" CHECK (("endDate" IS NULL) = ("endReason" IS NULL))
);
CREATE INDEX "employment_periods_userId_startDate_idx" ON "employment_periods"("userId", "startDate");
CREATE UNIQUE INDEX "employment_periods_one_open_per_user" ON "employment_periods"("userId") WHERE "endDate" IS NULL;

CREATE TABLE "user_setup_issues" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT REFERENCES "users"("id") ON DELETE CASCADE,
  "code" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "severity" "SetupIssueSeverity" NOT NULL,
  "remediationClass" "RemediationClass" NOT NULL,
  "status" "SetupIssueStatus" NOT NULL DEFAULT 'OPEN',
  "dedupeKey" TEXT NOT NULL UNIQUE,
  "details" JSONB,
  "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3), "acknowledgedById" TEXT,
  "resolvedAt" TIMESTAMP(3), "resolvedById" TEXT,
  "waivedAt" TIMESTAMP(3), "waivedById" TEXT, "waivedReason" TEXT,
  "firstNotifiedAt" TIMESTAMP(3), "reminder15SentAt" TIMESTAMP(3), "monthlyDigestAt" TIMESTAMP(3),
  -- WAIVED needs an actor and reason; which codes may be waived is a server allow-list (empty in Phase 1).
  CONSTRAINT "user_setup_issues_waiver_chk" CHECK ("status" <> 'WAIVED' OR ("waivedById" IS NOT NULL AND "waivedReason" IS NOT NULL AND "waivedAt" IS NOT NULL)),
  CONSTRAINT "user_setup_issues_resolved_chk" CHECK ("status" <> 'RESOLVED' OR "resolvedAt" IS NOT NULL)
);
CREATE INDEX "user_setup_issues_userId_status_idx" ON "user_setup_issues"("userId", "status");
CREATE INDEX "user_setup_issues_status_firstNotifiedAt_idx" ON "user_setup_issues"("status", "firstNotifiedAt");

CREATE TABLE "hierarchy_assignments" (
  "id" TEXT PRIMARY KEY,
  "scope" "HierarchyScope" NOT NULL,
  "role" "HierarchyRole" NOT NULL,
  "subjectUserId" TEXT REFERENCES "users"("id") ON DELETE CASCADE,
  "departmentId" TEXT REFERENCES "departments"("id") ON DELETE CASCADE,
  "assigneeUserId" TEXT NOT NULL REFERENCES "users"("id"),
  "isPrimary" BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hierarchy_assignments_scope_chk" CHECK (
    ("scope" = 'EMPLOYEE'   AND "subjectUserId" IS NOT NULL AND "departmentId" IS NULL) OR
    ("scope" = 'DEPARTMENT' AND "departmentId" IS NOT NULL AND "subjectUserId" IS NULL) OR
    ("scope" = 'COMPANY'    AND "subjectUserId" IS NULL AND "departmentId" IS NULL AND "role" = 'MANAGER')
  ),
  CONSTRAINT "hierarchy_assignments_not_self_chk" CHECK ("subjectUserId" IS NULL OR "subjectUserId" <> "assigneeUserId")
);
CREATE UNIQUE INDEX "hierarchy_assignments_one_primary_employee" ON "hierarchy_assignments"("subjectUserId", "role") WHERE "scope" = 'EMPLOYEE' AND "isPrimary" AND "effectiveTo" IS NULL;
CREATE UNIQUE INDEX "hierarchy_assignments_one_primary_department" ON "hierarchy_assignments"("departmentId", "role") WHERE "scope" = 'DEPARTMENT' AND "isPrimary" AND "effectiveTo" IS NULL;
CREATE UNIQUE INDEX "hierarchy_assignments_one_company_manager" ON "hierarchy_assignments"("scope") WHERE "scope" = 'COMPANY' AND "isPrimary" AND "effectiveTo" IS NULL;
CREATE INDEX "hierarchy_assignments_assigneeUserId_idx" ON "hierarchy_assignments"("assigneeUserId");

CREATE TABLE "routing_snapshots" (
  "id" TEXT PRIMARY KEY,
  "workflow" "RoutingWorkflow" NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "subjectUserId" TEXT,
  "originalDepartmentId" TEXT,
  "resolvedApproverId" TEXT,
  "tier" "RoutingTier" NOT NULL,
  "fallbackReason" TEXT,
  "supersedesId" TEXT REFERENCES "routing_snapshots"("id"),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "routing_snapshots_no_hr_for_tickets_chk" CHECK (NOT ("workflow" = 'TICKET_REVIEW' AND "tier" = 'HR'))
);
CREATE INDEX "routing_snapshots_entity_idx" ON "routing_snapshots"("entityType", "entityId", "createdAt");
CREATE INDEX "routing_snapshots_resolvedApproverId_idx" ON "routing_snapshots"("resolvedApproverId");
CREATE UNIQUE INDEX "routing_snapshots_supersedes_once" ON "routing_snapshots"("supersedesId") WHERE "supersedesId" IS NOT NULL;

-- Append-only routing evidence (review item F). Same pattern as attendance_punch_evidence.
-- Only exception: inside an authorized permanent-delete transaction, a user-reference column
-- holding the deleted user may become NULL, and nothing else may change.
CREATE OR REPLACE FUNCTION "routing_snapshots_append_only"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW."id" = OLD."id" AND NEW."workflow" = OLD."workflow" AND NEW."entityType" = OLD."entityType"
     AND NEW."entityId" = OLD."entityId" AND NEW."tier" = OLD."tier"
     AND NEW."originalDepartmentId" IS NOT DISTINCT FROM OLD."originalDepartmentId"
     AND NEW."fallbackReason" IS NOT DISTINCT FROM OLD."fallbackReason"
     AND NEW."supersedesId" IS NOT DISTINCT FROM OLD."supersedesId"
     AND NEW."createdAt" = OLD."createdAt"
     AND (NEW."subjectUserId" IS NOT DISTINCT FROM OLD."subjectUserId" OR (NEW."subjectUserId" IS NULL AND "apex_row_delete_authorized"(OLD."subjectUserId")))
     AND (NEW."resolvedApproverId" IS NOT DISTINCT FROM OLD."resolvedApproverId" OR (NEW."resolvedApproverId" IS NULL AND "apex_row_delete_authorized"(OLD."resolvedApproverId")))
     AND (NEW."createdById" IS NOT DISTINCT FROM OLD."createdById" OR (NEW."createdById" IS NULL AND "apex_row_delete_authorized"(OLD."createdById")))
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'routing_snapshots is append-only: % is not permitted. A reroute appends a new snapshot linked by supersedesId.', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "routing_snapshots_no_update" BEFORE UPDATE ON "routing_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "routing_snapshots_append_only"();
CREATE TRIGGER "routing_snapshots_no_delete" BEFORE DELETE ON "routing_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "routing_snapshots_append_only"();

CREATE TABLE "policy_health_issues" (
  "id" TEXT PRIMARY KEY,
  "policyFamily" TEXT NOT NULL,
  "kind" "PolicyHealthKind" NOT NULL,
  "dedupeKey" TEXT NOT NULL UNIQUE,
  "rangeFrom" DATE, "rangeTo" DATE,
  "policyIds" JSONB NOT NULL DEFAULT '[]',
  "status" "SetupIssueStatus" NOT NULL DEFAULT 'OPEN',
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3), "resolvedById" TEXT
);
CREATE INDEX "policy_health_issues_status_idx" ON "policy_health_issues"("status");

CREATE TABLE "punch_evidence_reviews" (
  "id" TEXT PRIMARY KEY,
  "evidenceId" TEXT NOT NULL UNIQUE REFERENCES "attendance_punch_evidence"("id") ON DELETE CASCADE,
  "reasonCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" "PunchReviewStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT, "reviewedAt" TIMESTAMP(3), "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "punch_evidence_reviews_status_idx" ON "punch_evidence_reviews"("status");
-- NOTE: the append-only trigger on attendance_punch_evidence must permit the row-scoped
-- permanent-delete exception to cascade here; verified against the existing trigger in Phase 1 tests.

CREATE TABLE "department_transfers" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "fromDepartmentId" TEXT, "toDepartmentId" TEXT,
  "fromRoleId" TEXT NOT NULL, "toRoleId" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "actorId" TEXT NOT NULL,
  "status" "TransferStatus" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "department_transfers_userId_idx" ON "department_transfers"("userId", "effectiveAt");

CREATE TABLE "department_transfer_impacts" (
  "id" TEXT PRIMARY KEY,
  "transferId" TEXT NOT NULL REFERENCES "department_transfers"("id") ON DELETE CASCADE,
  "kind" "TransferImpactKind" NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
);
CREATE INDEX "department_transfer_impacts_transferId_idx" ON "department_transfer_impacts"("transferId");

CREATE TABLE "exit_cases" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "employmentPeriodId" TEXT NOT NULL REFERENCES "employment_periods"("id"),
  "state" "ExitCaseState" NOT NULL,
  "resignedOn" DATE NOT NULL,
  "noticeDays" INTEGER NOT NULL,
  "noticeSource" "NoticeSource" NOT NULL,
  "noticeAdjustmentReason" TEXT,
  "lastWorkingDay" DATE NOT NULL,
  "withdrawnAt" TIMESTAMP(3), "withdrawnById" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "exit_cases_notice_chk" CHECK ("noticeDays" >= 0),
  CONSTRAINT "exit_cases_adjustment_reason_chk" CHECK ("noticeSource" <> 'MANAGEMENT_ADJUSTMENT' OR "noticeAdjustmentReason" IS NOT NULL)
);
CREATE UNIQUE INDEX "exit_cases_one_open_per_user" ON "exit_cases"("userId") WHERE "state" IN ('NOTICE_RUNNING', 'CLEARANCE_IN_PROGRESS', 'CLEARED');

CREATE TABLE "exit_clearance_items" (
  "id" TEXT PRIMARY KEY,
  "exitCaseId" TEXT NOT NULL REFERENCES "exit_cases"("id") ON DELETE CASCADE,
  "category" "ClearanceCategory" NOT NULL,
  "ownerId" TEXT,
  "status" "ClearanceStatus" NOT NULL DEFAULT 'PENDING',
  "evidenceRef" TEXT,
  "completedAt" TIMESTAMP(3), "completedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "exit_clearance_items_unique" UNIQUE ("exitCaseId", "category")
);

CREATE TABLE "fnf_settlements" (
  "id" TEXT PRIMARY KEY,
  "exitCaseId" TEXT NOT NULL UNIQUE REFERENCES "exit_cases"("id") ON DELETE CASCADE,
  "state" "FnfState" NOT NULL DEFAULT 'NOT_STARTED',
  "holdReason" TEXT,
  "deadlineOn" DATE NOT NULL,
  "lastEscalatedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3), "releasedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

-- Itemized manual adjustments (review item J). Never created automatically.
-- Immutable: a correction is a new row whose reversesId points at the original.
CREATE TABLE "fnf_adjustments" (
  "id" TEXT PRIMARY KEY,
  "settlementId" TEXT NOT NULL REFERENCES "fnf_settlements"("id") ON DELETE CASCADE,
  "subjectUserId" TEXT NOT NULL,                 -- denormalised for the delete guard
  "kind" "FnfAdjustmentKind" NOT NULL,
  "direction" "FnfAdjustmentDirection" NOT NULL,
  "amount" NUMERIC(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "reasonCode" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "note" TEXT,
  "approvedById" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL,
  "recordedById" TEXT NOT NULL,
  "reversesId" TEXT UNIQUE REFERENCES "fnf_adjustments"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fnf_adjustments_amount_positive_chk" CHECK ("amount" > 0),
  CONSTRAINT "fnf_adjustments_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "fnf_adjustments_reason_chk" CHECK (length(trim("reasonCode")) > 0 AND length(trim("reference")) > 0),
  CONSTRAINT "fnf_adjustments_not_self_reversal_chk" CHECK ("reversesId" IS NULL OR "reversesId" <> "id")
);
CREATE INDEX "fnf_adjustments_settlementId_idx" ON "fnf_adjustments"("settlementId");

CREATE OR REPLACE FUNCTION "fnf_adjustments_append_only"()
RETURNS TRIGGER AS $$
DECLARE deleted_principal CONSTANT TEXT := 'system-deleted-account';
BEGIN
  IF TG_OP = 'DELETE' AND "apex_row_delete_authorized"(OLD."subjectUserId") THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'approvedById' - 'recordedById') = (to_jsonb(OLD) - 'approvedById' - 'recordedById')
     AND (NEW."approvedById" = OLD."approvedById" OR (NEW."approvedById" = deleted_principal AND "apex_row_delete_authorized"(OLD."approvedById")))
     AND (NEW."recordedById" = OLD."recordedById" OR (NEW."recordedById" = deleted_principal AND "apex_row_delete_authorized"(OLD."recordedById")))
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'fnf_adjustments is append-only: % is not permitted. Record a reversing adjustment instead.', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "fnf_adjustments_no_update" BEFORE UPDATE ON "fnf_adjustments"
  FOR EACH ROW EXECUTE FUNCTION "fnf_adjustments_append_only"();
CREATE TRIGGER "fnf_adjustments_no_delete" BEFORE DELETE ON "fnf_adjustments"
  FOR EACH ROW EXECUTE FUNCTION "fnf_adjustments_append_only"();

-- Reversal validity (review item 4): same settlement, opposite direction, equal amount and
-- currency, the original is not itself a reversal; "reversesId" UNIQUE allows one reversal per row.
CREATE OR REPLACE FUNCTION "fnf_adjustments_validate_reversal"()
RETURNS TRIGGER AS $$
DECLARE orig "fnf_adjustments"%ROWTYPE;
BEGIN
  IF NEW."reversesId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO orig FROM "fnf_adjustments" WHERE "id" = NEW."reversesId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FNF_REVERSAL_TARGET_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF orig."settlementId" <> NEW."settlementId" THEN
    RAISE EXCEPTION 'FNF_REVERSAL_DIFFERENT_SETTLEMENT' USING ERRCODE = 'check_violation';
  END IF;
  IF orig."direction" = NEW."direction" THEN
    RAISE EXCEPTION 'FNF_REVERSAL_SAME_DIRECTION' USING ERRCODE = 'check_violation';
  END IF;
  IF orig."amount" <> NEW."amount" OR orig."currency" <> NEW."currency" THEN
    RAISE EXCEPTION 'FNF_REVERSAL_AMOUNT_OR_CURRENCY_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  IF orig."reversesId" IS NOT NULL THEN
    RAISE EXCEPTION 'FNF_REVERSAL_OF_REVERSAL' USING ERRCODE = 'check_violation';
  END IF;
  IF orig."kind" <> NEW."kind" OR orig."subjectUserId" <> NEW."subjectUserId" THEN
    RAISE EXCEPTION 'FNF_REVERSAL_KIND_OR_SUBJECT_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "fnf_adjustments_reversal_valid" BEFORE INSERT ON "fnf_adjustments"
  FOR EACH ROW EXECUTE FUNCTION "fnf_adjustments_validate_reversal"();

-- Operation history (review items E and 2): every failure, verification, instruction, retry, resolution.
-- Lifecycle attempts are tied to their operation by a real FK; other workflows have no operation
-- table and carry only their kind and opaque correlation id.
CREATE TABLE "lifecycle_remediation_attempts" (
  "id" TEXT PRIMARY KEY,
  "operationKind" TEXT NOT NULL CHECK ("operationKind" IN ('LIFECYCLE', 'CREATE_USER', 'REACTIVATE', 'REHIRE', 'LEAVE', 'PUNCH', 'SETUP')),
  "operationId" TEXT NOT NULL,                   -- opaque, non-PII correlation id
  "lifecycleOperationId" TEXT REFERENCES "user_lifecycle_operations"("id") ON DELETE CASCADE,
  "subjectUserId" TEXT,
  "attemptNo" INTEGER NOT NULL CHECK ("attemptNo" >= 1),
  "code" TEXT NOT NULL,
  "phase" "RemediationAttemptPhase" NOT NULL,
  "outcome" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "remediation" JSONB NOT NULL,                  -- already passed through the serializer allow-list
  "serverAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lifecycle_remediation_attempts_seq" UNIQUE ("operationId", "attemptNo"),
  CONSTRAINT "lifecycle_remediation_attempts_lifecycle_link_chk"
    CHECK (("operationKind" = 'LIFECYCLE') = ("lifecycleOperationId" IS NOT NULL)),
  CONSTRAINT "lifecycle_remediation_attempts_lifecycle_id_chk"
    CHECK ("lifecycleOperationId" IS NULL OR "lifecycleOperationId" = "operationId")
);
CREATE INDEX "lifecycle_remediation_attempts_subject_idx" ON "lifecycle_remediation_attempts"("subjectUserId", "serverAt");
CREATE INDEX "lifecycle_remediation_attempts_lifecycle_idx" ON "lifecycle_remediation_attempts"("lifecycleOperationId");

-- Append-only. Inside an authorized permanent delete for the subject: rows may be deleted
-- (including via the FK cascade), subjectUserId may become NULL (running operation's attempts),
-- and actorId may move to the Deleted account principal. Nothing else ever changes.
CREATE OR REPLACE FUNCTION "lifecycle_remediation_attempts_append_only"()
RETURNS TRIGGER AS $$
DECLARE deleted_principal CONSTANT TEXT := 'system-deleted-account';
BEGIN
  IF TG_OP = 'DELETE' AND "apex_row_delete_authorized"(OLD."subjectUserId") THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'actorId' - 'subjectUserId') = (to_jsonb(OLD) - 'actorId' - 'subjectUserId')
     AND (NEW."actorId" = OLD."actorId" OR (NEW."actorId" = deleted_principal AND "apex_row_delete_authorized"(OLD."actorId")))
     AND (NEW."subjectUserId" IS NOT DISTINCT FROM OLD."subjectUserId" OR (NEW."subjectUserId" IS NULL AND "apex_row_delete_authorized"(OLD."subjectUserId")))
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'lifecycle_remediation_attempts is append-only: % is not permitted. A retry appends a new attempt.', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "lifecycle_remediation_attempts_no_update" BEFORE UPDATE ON "lifecycle_remediation_attempts"
  FOR EACH ROW EXECUTE FUNCTION "lifecycle_remediation_attempts_append_only"();
CREATE TRIGGER "lifecycle_remediation_attempts_no_delete" BEFORE DELETE ON "lifecycle_remediation_attempts"
  FOR EACH ROW EXECUTE FUNCTION "lifecycle_remediation_attempts_append_only"();
