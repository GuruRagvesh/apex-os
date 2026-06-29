-- AlterEnum
ALTER TYPE "TicketStatus" ADD VALUE 'PENDING_APPROVAL';

-- CreateEnum
CREATE TYPE "ApprovalState" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('TASK_CREATION', 'QUERY_TARGET', 'MANAGER_REVIEW', 'SUPER_ADMIN_OVERRIDE');

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "approvalState" "ApprovalState" NOT NULL DEFAULT 'NONE',
ADD COLUMN "approvalType" "ApprovalType",
ADD COLUMN "approverId" TEXT,
ADD COLUMN "approvalRequestedAt" TIMESTAMP(3),
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "rejectedAt" TIMESTAMP(3),
ADD COLUMN "approvalReason" TEXT;

-- CreateIndex
CREATE INDEX "tickets_approvalState_idx" ON "tickets"("approvalState");

-- CreateIndex
CREATE INDEX "tickets_approverId_idx" ON "tickets"("approverId");

-- CreateIndex
CREATE INDEX "tickets_status_approvalState_idx" ON "tickets"("status", "approvalState");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
