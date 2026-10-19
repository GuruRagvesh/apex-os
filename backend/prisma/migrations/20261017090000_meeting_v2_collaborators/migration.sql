-- Meeting v2: meetings are planned before they start, have collaborators who
-- accept or reject an invite, an optional purpose and outside guests, and an
-- approval routed through the reporting hierarchy. Additive only: existing
-- meetings keep their values (participants default to ACCEPTED).

ALTER TABLE "meetings"
  ADD COLUMN "purpose" TEXT,
  ADD COLUMN "clientName" TEXT,
  ADD COLUMN "guestNames" TEXT,
  ADD COLUMN "isDepartmental" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "approverIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "decidedById" TEXT,
  ADD COLUMN "decidedAt" TIMESTAMP(3);

ALTER TABLE "meeting_participants"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
  ADD COLUMN "respondedAt" TIMESTAMP(3),
  ADD COLUMN "joinedAt" TIMESTAMP(3),
  ADD COLUMN "leftAt" TIMESTAMP(3);

CREATE INDEX "meetings_approvalStatus_idx" ON "meetings"("approvalStatus");
CREATE INDEX "meeting_participants_userId_status_idx" ON "meeting_participants"("userId", "status");

-- New meeting types and the running state.
ALTER TABLE "meetings" DROP CONSTRAINT IF EXISTS "meetings_type_check";
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_type_check"
  CHECK ("meetingType" IN ('SELF', 'INTERNAL', 'EXTERNAL', 'REVIEW', 'ONE_ON_ONE', 'CUSTOM'));
ALTER TABLE "meetings" DROP CONSTRAINT IF EXISTS "meetings_status_check";
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_status_check"
  CHECK ("status" IN ('PENDING', 'APPROVED', 'ACTIVE', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED'));
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_approval_status_check"
  CHECK ("approvalStatus" IN ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED'));
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_status_check"
  CHECK ("status" IN ('INVITED', 'ACCEPTED', 'REJECTED', 'LEFT'));
