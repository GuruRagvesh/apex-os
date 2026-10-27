-- Phase 4: employee transitions. Enum values and new enum types.
--
-- Split from 20261022090100 because PostgreSQL cannot use an enum value in
-- the same transaction that adds it. Additive only: no value is renamed or
-- removed, and IF NOT EXISTS makes a second run a no-op.

-- ── Transfers ──────────────────────────────────────────────────────────────
-- A transfer that cannot apply cleanly today is SCHEDULED for a future company
-- day. If its preview fingerprint or the effective day changes before
-- activation it becomes REVIEW_REQUIRED instead of applying different data.
ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'REVIEW_REQUIRED';
ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TYPE "TransferImpactKind" ADD VALUE IF NOT EXISTS 'OWN_LEAVE_REQUEST';
ALTER TYPE "TransferImpactKind" ADD VALUE IF NOT EXISTS 'CORRECTION';
ALTER TYPE "TransferImpactKind" ADD VALUE IF NOT EXISTS 'CHANGE_REQUEST';
ALTER TYPE "TransferImpactKind" ADD VALUE IF NOT EXISTS 'TEAM_MEMBERSHIP';
ALTER TYPE "TransferImpactKind" ADD VALUE IF NOT EXISTS 'HIERARCHY';
ALTER TYPE "TransferImpactKind" ADD VALUE IF NOT EXISTS 'PERMISSION';

-- ── Exit ───────────────────────────────────────────────────────────────────
-- A withdrawn resignation closes unfinished exit-only work without deleting it.
ALTER TYPE "ClearanceStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "FnfState" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- ── Retention four-eyes workflow ───────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "RetentionRuleStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RetentionProposalAction" AS ENUM ('CREATE', 'UPDATE', 'DEACTIVATE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
