-- Additive meeting-validation ledger. Existing meeting rows and approval
-- columns remain untouched; new meetings receive one row per approver.
CREATE TABLE "meeting_approval_responses" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "approverId" TEXT,
    "approverNameSnapshot" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "meeting_approval_responses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meeting_approval_responses_meetingId_approverId_key"
ON "meeting_approval_responses"("meetingId", "approverId");

CREATE INDEX "meeting_approval_responses_approverId_status_idx"
ON "meeting_approval_responses"("approverId", "status");

CREATE INDEX "meeting_approval_responses_meetingId_status_idx"
ON "meeting_approval_responses"("meetingId", "status");

ALTER TABLE "meeting_approval_responses"
ADD CONSTRAINT "meeting_approval_responses_meetingId_fkey"
FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meeting_approval_responses"
ADD CONSTRAINT "meeting_approval_responses_approverId_fkey"
FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
