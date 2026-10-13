-- Archived-user lifecycle (additive only).
--
-- Adds archive snapshots, lifecycle operations, deletion receipts, the read-only
-- retention gate tables, two user columns, a row-scoped exception to two
-- append-only triggers, and the non-login Deleted account principal.
-- Rewrites no existing row, seeds no retention rule, marks nothing verified.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isSystemAccount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sessionsRevokedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "user_lifecycle_operations" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "deleteTxid" TEXT,
    "snapshotId" TEXT,
    "actorId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_lifecycle_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_archive_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "archiveRef" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "backupRequired" BOOLEAN NOT NULL,
    "provider" TEXT,
    "environment" TEXT NOT NULL,
    "folderId" TEXT,
    "folderPath" TEXT,
    "workbookFileId" TEXT,
    "workbookSizeBytes" INTEGER,
    "workbookSha256" TEXT,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "schemaVersion" TEXT NOT NULL,
    "classificationVersion" TEXT NOT NULL,
    "dataFingerprint" TEXT NOT NULL,
    "backupFingerprint" TEXT,
    "dependencyCounts" JSONB NOT NULL,
    "ignoredSetupCounts" JSONB NOT NULL,
    "operationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "invalidationReason" TEXT,

    CONSTRAINT "user_archive_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_archive_files" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL,
    "archiveFileId" TEXT NOT NULL,
    "archivePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "sourceCount" INTEGER NOT NULL,

    CONSTRAINT "user_archive_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_deletion_receipts" (
    "receiptId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "archiveRef" TEXT NOT NULL,
    "snapshotVersion" INTEGER NOT NULL,
    "counts" JSONB NOT NULL,
    "retentionResult" TEXT NOT NULL,
    "cleanupState" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "user_deletion_receipts_pkey" PRIMARY KEY ("receiptId")
);

-- CreateTable
CREATE TABLE "user_deletion_cleanup_items" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "resourceHandleEncrypted" TEXT,
    "resourceHandleHmac" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "user_deletion_cleanup_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_rules" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "retentionMonths" INTEGER,
    "policyReference" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_legal_holds" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "placedById" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "user_legal_holds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_lifecycle_operations_idempotencyKey_key" ON "user_lifecycle_operations"("idempotencyKey");

-- CreateIndex
CREATE INDEX "user_lifecycle_operations_userId_idx" ON "user_lifecycle_operations"("userId");

-- CreateIndex
CREATE INDEX "user_lifecycle_operations_state_idx" ON "user_lifecycle_operations"("state");

-- CreateIndex
CREATE UNIQUE INDEX "user_archive_snapshots_archiveRef_key" ON "user_archive_snapshots"("archiveRef");

-- CreateIndex
CREATE INDEX "user_archive_snapshots_status_idx" ON "user_archive_snapshots"("status");

-- CreateIndex
CREATE UNIQUE INDEX "user_archive_snapshots_userId_version_key" ON "user_archive_snapshots"("userId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "user_archive_files_snapshotId_seq_key" ON "user_archive_files"("snapshotId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "user_deletion_receipts_operationId_key" ON "user_deletion_receipts"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "user_deletion_cleanup_items_receiptId_resourceHandleHmac_key" ON "user_deletion_cleanup_items"("receiptId", "resourceHandleHmac");

-- CreateIndex
CREATE UNIQUE INDEX "retention_rules_category_key" ON "retention_rules"("category");

-- CreateIndex
CREATE INDEX "user_legal_holds_userId_idx" ON "user_legal_holds"("userId");

-- AddForeignKey
ALTER TABLE "user_archive_files" ADD CONSTRAINT "user_archive_files_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "user_archive_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_deletion_cleanup_items" ADD CONSTRAINT "user_deletion_cleanup_items_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "user_deletion_receipts"("receiptId") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Lifecycle-operation identity ───────────────────────────────────────────
-- userId is required while an operation is in flight and is cleared once the
-- person has been deleted, so the row keeps no identifier of them.
ALTER TABLE "user_lifecycle_operations"
  ADD CONSTRAINT "user_lifecycle_operations_user_required_while_active"
  CHECK ("userId" IS NOT NULL OR "state" IN ('DB_DELETED', 'CLEANUP_PENDING', 'PERMANENTLY_DELETED'));

ALTER TABLE "user_lifecycle_operations"
  ADD CONSTRAINT "user_lifecycle_operations_kind_check"
  CHECK ("kind" IN ('ARCHIVE', 'REHIRE', 'PERMANENT_DELETE'));

-- At most one lifecycle operation in flight per person: archive, rehire and
-- permanent delete serialize on this index.
CREATE UNIQUE INDEX "user_lifecycle_operations_one_inflight"
  ON "user_lifecycle_operations" ("userId")
  WHERE "userId" IS NOT NULL
    AND "state" IN ('PREFLIGHTED', 'RUNNING', 'VERIFIED_FOR_DELETE', 'ARCHIVE_CLEANUP_PENDING');

-- One usable snapshot per person.
CREATE UNIQUE INDEX "user_archive_snapshots_one_usable"
  ON "user_archive_snapshots" ("userId")
  WHERE "userId" IS NOT NULL AND "status" IN ('VERIFIED', 'NO_HISTORY_VERIFIED');

-- ── Row-scoped DELETE exception for append-only tables ─────────────────────
-- True only inside the exact transaction that marked this person's permanent
-- deletion VERIFIED_FOR_DELETE. The operation id comes from a transaction-local
-- setting; the transaction id must match, so a leftover row can never authorize
-- another transaction. SECURITY INVOKER: no privilege is raised.
CREATE OR REPLACE FUNCTION "apex_row_delete_authorized"(target_user_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE op_id TEXT := current_setting('apex.lifecycle_operation_id', true);
BEGIN
  IF op_id IS NULL OR op_id = '' OR target_user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM "user_lifecycle_operations" o
     WHERE o."id" = op_id
       AND o."kind" = 'PERMANENT_DELETE'
       AND o."state" = 'VERIFIED_FOR_DELETE'
       AND o."userId" = target_user_id
       AND o."deleteTxid" = pg_current_xact_id()::text
  );
END $$;

-- Same function names, same messages; one narrow DELETE exception each.
-- UPDATE remains forbidden in every case.
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

CREATE OR REPLACE FUNCTION prevent_workday_note_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND "apex_row_delete_authorized"(OLD."userId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Workday notes are append-only';
END;
$$ LANGUAGE plpgsql;

-- ── Deleted account principal ──────────────────────────────────────────────
-- Shared records that require an author (comments, ticket history, audit
-- events) point here after a permanent deletion. Inactive, no memberships, a
-- password value that can never match a bcrypt comparison. Inserted only when
-- the lowest role exists; the application creates it the same way on first use.
-- Idempotent.
INSERT INTO "users" ("id", "email", "name", "password", "isActive", "isSystemAccount", "mustChangePassword", "roleId", "updatedAt")
SELECT 'system-deleted-account', 'deleted-account@system.invalid', 'Deleted account', '!disabled-no-login!', false, true, false, r."id", CURRENT_TIMESTAMP
  FROM "roles" r
 WHERE r."name" = 'INTERN'
ON CONFLICT ("id") DO NOTHING;
