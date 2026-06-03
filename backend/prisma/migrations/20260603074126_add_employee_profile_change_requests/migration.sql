-- AlterTable
ALTER TABLE "project_stages" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "employee_profile_change_requests" (
    "id" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_TL_APPROVAL',
    "changes" JSONB NOT NULL,
    "reason" TEXT,
    "currentApproverId" TEXT,
    "tlApproverId" TEXT,
    "managerApproverId" TEXT,
    "adminApproverId" TEXT,
    "tlDecision" TEXT,
    "managerDecision" TEXT,
    "adminDecision" TEXT,
    "rejectionReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_profile_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_profile_change_requests_targetUserId_idx" ON "employee_profile_change_requests"("targetUserId");

-- CreateIndex
CREATE INDEX "employee_profile_change_requests_requestedById_idx" ON "employee_profile_change_requests"("requestedById");

-- CreateIndex
CREATE INDEX "employee_profile_change_requests_status_idx" ON "employee_profile_change_requests"("status");

-- CreateIndex
CREATE INDEX "employee_profile_change_requests_currentApproverId_idx" ON "employee_profile_change_requests"("currentApproverId");

-- AddForeignKey
ALTER TABLE "employee_profile_change_requests" ADD CONSTRAINT "employee_profile_change_requests_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profile_change_requests" ADD CONSTRAINT "employee_profile_change_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profile_change_requests" ADD CONSTRAINT "employee_profile_change_requests_currentApproverId_fkey" FOREIGN KEY ("currentApproverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
