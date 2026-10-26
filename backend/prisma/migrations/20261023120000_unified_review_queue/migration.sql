CREATE TABLE "review_queue_assignments" (
    "id" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "subjectUserId" TEXT,
    "assignedReviewerId" TEXT NOT NULL,
    "forwardedById" TEXT NOT NULL,
    "forwardReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "review_queue_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "review_queue_assignments_assignedReviewerId_endedAt_idx"
  ON "review_queue_assignments"("assignedReviewerId", "endedAt");

CREATE INDEX "review_queue_assignments_requestType_requestId_idx"
  ON "review_queue_assignments"("requestType", "requestId");

CREATE UNIQUE INDEX "review_queue_assignments_one_active_request"
  ON "review_queue_assignments"("requestType", "requestId")
  WHERE "endedAt" IS NULL;

ALTER TABLE "review_queue_assignments"
  ADD CONSTRAINT "review_queue_assignments_assignedReviewerId_fkey"
  FOREIGN KEY ("assignedReviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "review_queue_assignments"
  ADD CONSTRAINT "review_queue_assignments_forwardedById_fkey"
  FOREIGN KEY ("forwardedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "review_queue_assignments"
  ADD CONSTRAINT "review_queue_assignments_subjectUserId_fkey"
  FOREIGN KEY ("subjectUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
