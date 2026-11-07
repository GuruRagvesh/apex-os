-- One-on-one is a participant format, not a meeting scope. This migration is
-- architecture-only and intentionally does not copy or rewrite meeting data.
ALTER TABLE "meetings"
ADD COLUMN "meetingFormat" TEXT NOT NULL DEFAULT 'GROUP';

ALTER TABLE "meetings"
ADD CONSTRAINT "meetings_format_check"
CHECK ("meetingFormat" IN ('ONE_ON_ONE', 'GROUP'));
