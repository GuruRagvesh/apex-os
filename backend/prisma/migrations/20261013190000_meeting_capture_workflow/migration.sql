-- Retrospective meeting capture. New shared records receive a unique bridge
-- code after the organizer resumes.

ALTER TABLE "meetings"
  ADD COLUMN "meetingCode" TEXT,
  ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PERSONAL',
  ADD COLUMN "createdByRole" TEXT;

ALTER TABLE "meetings"
  ADD CONSTRAINT "meetings_visibility_check"
  CHECK ("visibility" IN ('PERSONAL', 'SHARED'));

CREATE UNIQUE INDEX "meetings_meetingCode_key" ON "meetings"("meetingCode");
CREATE INDEX "meetings_meetingCode_visibility_idx" ON "meetings"("meetingCode", "visibility");
