-- Add blocked ticket overlay fields (Option B)
-- isBlocked is an orthogonal state flag — TicketStatus enum is NOT changed.
-- Blocked tickets remain in their current status (IN_PROGRESS / REVIEW / etc.)
-- but have their SLA pressure suppressed while blocked.

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "isBlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "blockedAt" TIMESTAMPTZ;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "blockedReason" TEXT;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "blockedById" TEXT;

-- Indexes for dashboard blocked-count queries and filter support
CREATE INDEX IF NOT EXISTS "tickets_isBlocked_idx" ON "tickets"("isBlocked");
CREATE INDEX IF NOT EXISTS "tickets_status_isBlocked_idx" ON "tickets"("status", "isBlocked");
