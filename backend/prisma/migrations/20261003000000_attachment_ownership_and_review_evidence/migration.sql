-- Attachment ownership, purpose, review-cycle evidence and locking.
--
-- Forward-only and additive: new nullable columns, one enum, indexes and
-- foreign keys. No existing row is rewritten except the deterministic
-- classification below, and no uploader is ever guessed: rows uploaded before
-- this migration keep "uploadedById" NULL and are treated by the application
-- as legacy protected (viewable, never deletable through the normal API).

-- CreateEnum
CREATE TYPE "AttachmentPurpose" AS ENUM ('REFERENCE', 'GENERAL', 'POC', 'REVIEW_FEEDBACK');

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "lockReason" TEXT,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "purpose" "AttachmentPurpose" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "reviewCycleId" TEXT,
ADD COLUMN     "uploadedById" TEXT;

-- Existing proof-of-completion uploads keep their meaning. This reads only the
-- row's own isPoc flag; it assigns no owner, cycle or lock.
UPDATE "attachments" SET "purpose" = 'POC' WHERE "isPoc" = true;

-- CreateIndex
CREATE INDEX "attachments_ticketId_createdAt_idx" ON "attachments"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "attachments_uploadedById_idx" ON "attachments"("uploadedById");

-- CreateIndex
CREATE INDEX "attachments_reviewCycleId_idx" ON "attachments"("reviewCycleId");

-- AddForeignKey: deleting a user never deletes or orphans the evidence they
-- uploaded. A users row that still owns attachments cannot be deleted (the
-- application's permanent delete reports "Ticket Attachments Uploaded" as a
-- blocker first); such an account is deactivated or archived instead.
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: review cycles are only removed with their ticket (which
-- removes its attachments too); the file itself is never deleted by this key.
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_reviewCycleId_fkey" FOREIGN KEY ("reviewCycleId") REFERENCES "review_cycle_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
